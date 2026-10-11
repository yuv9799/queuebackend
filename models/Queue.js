import { inTx, get, run } from '../config/db.js';
import * as Token from './Token.js';
import * as Doctor from './Doctor.js';
import * as Audit from './Audit.js';
import * as Notify from './Notify.js';

const TERMINAL = ['completed', 'cancelled', 'no_show', 'skipped'];

// Auto-select best doctor for a department when patient creates a token
export function findBestDoctorForDepartment(departmentId, { preferredDoctorId = null } = {}) {
  const doctors = Doctor.list({ departmentId, active: true });
  if (!doctors || doctors.length === 0) return null;

  // 1. If patient has preferred doctor and doctor is active and not offline
  if (preferredDoctorId) {
    const pref = doctors.find((d) => d.id === Number(preferredDoctorId));
    if (pref && !Doctor.UNAVAILABLE_FOR_NEW.includes(pref.status)) {
      return pref;
    }
  }

  // 2. Filter available doctors first
  const available = doctors.filter((d) => d.status === Doctor.STATUS.AVAILABLE);
  if (available.length > 0) {
    // Pick doctor with shortest queue
    return available.reduce((min, d) => (d.waiting < min.waiting ? d : min), available[0]);
  }

  // 3. Filter busy or in_consultation doctors
  const activeWorking = doctors.filter((d) =>
    [Doctor.STATUS.BUSY, Doctor.STATUS.IN_CONSULTATION].includes(d.status)
  );
  if (activeWorking.length > 0) {
    return activeWorking.reduce((min, d) => (d.waiting < min.waiting ? d : min), activeWorking[0]);
  }

  // 4. Fallback to any active doctor in the department with shortest queue
  return doctors.reduce((min, d) => (d.waiting < min.waiting ? d : min), doctors[0]);
}

// Calculate dynamic queue status & estimates
export function calculateEstimates(token) {
  if (!token) return null;

  const isQueued = token.status === 'queued';
  let position = null;
  let peopleAhead = 0;

  if (isQueued) {
    position = token.doctor_id ? Token.queuePositionDoctor(token.id) : Token.queuePosition(token.id);
    peopleAhead = Math.max(0, (position || 1) - 1);
  }

  const avgConsult = token.doctor_avg_consultation_time || 10;
  let estimatedWaitMinutes = 0;

  if (isQueued) {
    estimatedWaitMinutes = peopleAhead * avgConsult;
    // If doctor has an active consultation in progress, add a slight buffer (e.g. 5 min)
    if (token.doctor_status === 'in_consultation' || token.doctor_status === 'busy') {
      estimatedWaitMinutes += Math.max(2, Math.round(avgConsult / 2));
    }
  } else if (token.status === 'called') {
    estimatedWaitMinutes = 0;
  } else if (token.status === 'in_consultation' || token.status === 'serving') {
    estimatedWaitMinutes = 0;
  }

  // Calculate approximate service time
  let approximateServiceTime = null;
  if (isQueued && estimatedWaitMinutes > 0) {
    const targetDate = new Date(Date.now() + estimatedWaitMinutes * 60000);
    approximateServiceTime = targetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return {
    position,
    peopleAhead,
    estimatedWaitMinutes,
    estimatedServiceTime: token.estimated_service_time || approximateServiceTime,
  };
}

// ---- Doctor recommendation ------------------------------------------------
export function recommend(tokenId, { preferDoctorId = null, includeUnavailable = false } = {}) {
  const token = Token.findById(tokenId);
  if (!token) return { ok: false, error: 'Token not found' };
  if (TERMINAL.includes(token.status)) {
    return { ok: false, error: `Token is in '${token.status}' state and cannot be assigned` };
  }

  const eligible = Doctor.list({ departmentId: token.department_id, active: true })
    .filter((d) => includeUnavailable || !Doctor.UNAVAILABLE_FOR_NEW.includes(d.status))
    .filter((d) => (d.capacity > 0 ? d.waiting < d.capacity : true));

  if (eligible.length === 0) {
    return { ok: false, error: 'No eligible doctors are currently available for this department', alternatives: [] };
  }

  let recommended = eligible[0];
  let reason = 'Eligible + available + shortest active queue';

  const preferred = eligible.find((d) => d.id === (preferDoctorId || token.preferred_doctor_id));
  if (preferred) {
    recommended = preferred;
    reason = "Patient's preferred doctor is eligible and available";
  } else {
    recommended = eligible.reduce((a, b) => (b.waiting < a.waiting ? b : a));
    reason = 'Shortest active queue workload';
  }

  const alternatives = eligible.filter((d) => d.id !== recommended.id);
  return {
    ok: true,
    recommended: {
      id: recommended.id,
      name: recommended.name,
      specialization: recommended.specialization,
      qualification: recommended.qualification,
      status: recommended.status,
      waiting: recommended.waiting,
      room: recommended.room,
      avg_consultation_minutes: recommended.avg_consultation_minutes,
    },
    reason,
    alternatives: alternatives.map((d) => ({
      id: d.id,
      name: d.name,
      specialization: d.specialization,
      qualification: d.qualification,
      status: d.status,
      waiting: d.waiting,
      room: d.room,
      avg_consultation_minutes: d.avg_consultation_minutes,
    })),
    token,
  };
}

// ---- Assignment ----------------------------------------------------------
export function assign({
  tokenId,
  doctorId,
  actorId = null,
  actorName = null,
  reason = null,
  override = false,
  preferred = false,
}) {
  return inTx(() => {
    const t = get('SELECT * FROM tokens WHERE id = ?', tokenId);
    if (!t) return { ok: false, error: 'Token not found' };
    const dr = get('SELECT * FROM doctors WHERE id = ?', doctorId);
    if (!dr) return { ok: false, error: 'Doctor not found' };
    if (!dr.active) return { ok: false, error: 'Doctor is not active' };
    if (TERMINAL.includes(t.status)) {
      return { ok: false, error: `Cannot assign a token in '${t.status}' state` };
    }
    if (dr.department_id && t.department_id && Number(dr.department_id) !== Number(t.department_id) && !override) {
      return { ok: false, error: "Doctor does not belong to the token's department" };
    }
    if (Doctor.UNAVAILABLE_FOR_NEW.includes(dr.status) && !override) {
      return { ok: false, error: 'Doctor is currently unavailable. Only an authorized override can assign them.' };
    }
    if (Number(t.doctor_id) === Number(dr.id)) {
      return { ok: true, unchanged: true, token: Token.findById(t.id), error: null };
    }
    const old = t.doctor_id;
    run('UPDATE tokens SET doctor_id = ? WHERE id = ?', dr.id, t.id);
    Audit.log({
      actorId,
      actorName,
      action: old ? 'DOCTOR_CHANGED' : 'DOCTOR_ASSIGNED',
      targetType: 'token',
      targetId: t.id,
      oldValue: old ? String(old) : null,
      newValue: String(dr.id),
      reason: reason || (preferred ? 'Patient preferred doctor' : null),
    });
    if (preferred && !t.preferred_doctor_id) {
      run('UPDATE tokens SET preferred_doctor_id = ? WHERE id = ?', dr.id, t.id);
    }
    return { ok: true, changed: true, token: Token.findById(t.id), error: null };
  });
}

// ---- Redistribution (doctor becomes unavailable) -------------------------
export function redistributePreview(doctorId) {
  const doctor = Doctor.findById(doctorId);
  if (!doctor) return { ok: false, error: 'Doctor not found' };
  const affected = Token.list({ status: 'queued' }).filter((t) => Number(t.doctor_id) === Number(doctorId));
  if (affected.length === 0) return { ok: true, affected: [], suggested: [], doctor };
  const suggested = affected.map((t) => {
    const rec = recommend(t.id);
    return {
      tokenId: t.id,
      tokenNumber: t.token_number,
      patient: t.patient_name,
      recommended: rec.ok ? rec.recommended : null,
      reason: rec.ok ? rec.reason : 'No eligible alternative currently available',
    };
  });
  return { ok: true, affected, suggested, doctor };
}

export function redistributeConfirm({ moves = [], actorId = null, actorName = null, reason = null }) {
  const results = [];
  for (const m of moves) {
    const res = assign({
      tokenId: m.tokenId,
      doctorId: m.doctorId,
      actorId,
      actorName,
      reason: reason || 'Redistribution (doctor unavailable)',
      override: false,
    });
    results.push({ tokenId: m.tokenId, ok: res.ok, error: res.error });
  }
  return { ok: true, results };
}

// ---- Staff actions (guarded state change + audit + notification) ----
export function doCall({ tokenId, counterId = null, actorId = null, actorName = null }) {
  const before = Token.findById(tokenId);
  if (!before) return { ok: false, error: 'Token not found' };
  const res = Token.call(tokenId, counterId);
  if (!res.ok) return res;
  Audit.log({
    actorId,
    actorName,
    action: 'PATIENT_CALLED',
    targetType: 'token',
    targetId: tokenId,
    newValue: 'called',
  });
  const notifications = Notify.notify({ token: res.token, doctor: res.token.doctor_name, event: 'called' });
  return { ok: true, token: res.token, notifications };
}

export function doRecall({ tokenId, counterId = null, actorId = null, actorName = null }) {
  const res = Token.recall(tokenId, counterId);
  if (!res.ok) return res;
  Audit.log({
    actorId,
    actorName,
    action: 'PATIENT_RECALLED',
    targetType: 'token',
    targetId: tokenId,
    newValue: 'called',
  });
  const notifications = Notify.notify({ token: res.token, doctor: res.token.doctor_name, event: 'recalled' });
  return { ok: true, token: res.token, notifications };
}

export function doServe({ tokenId, actorId = null, actorName = null }) {
  const before = Token.findById(tokenId);
  if (!before) return { ok: false, error: 'Token not found' };
  const res = Token.serve(tokenId);
  if (!res.ok) return res;
  Audit.log({
    actorId,
    actorName,
    action: 'PATIENT_IN_CONSULTATION',
    targetType: 'token',
    targetId: tokenId,
    oldValue: before.status,
    newValue: 'in_consultation',
  });
  const notifications = Notify.notify({ token: res.token, doctor: res.token.doctor_name, event: 'serving' });
  return { ok: true, token: res.token, notifications };
}

export function doComplete({ tokenId, actorId = null, actorName = null }) {
  const before = Token.findById(tokenId);
  const res = Token.complete(tokenId);
  if (!res.ok) return res;
  Audit.log({
    actorId,
    actorName,
    action: 'PATIENT_COMPLETED',
    targetType: 'token',
    targetId: tokenId,
    oldValue: before.status,
    newValue: 'completed',
  });
  const notifications = Notify.notify({ token: res.token, event: 'completed' });
  return { ok: true, token: res.token, notifications };
}

export function doSkip({ tokenId, actorId = null, actorName = null, reason = null }) {
  const before = Token.findById(tokenId);
  const res = Token.skip(tokenId);
  if (!res.ok) return res;
  Audit.log({
    actorId,
    actorName,
    action: 'PATIENT_SKIPPED',
    targetType: 'token',
    targetId: tokenId,
    oldValue: before.status,
    newValue: 'skipped',
    reason,
  });
  return { ok: true, token: res.token };
}

export function doNoShow({ tokenId, actorId = null, actorName = null }) {
  const before = Token.findById(tokenId);
  const res = Token.noShow(tokenId);
  if (!res.ok) return res;
  Audit.log({
    actorId,
    actorName,
    action: 'PATIENT_NO_SHOW',
    targetType: 'token',
    targetId: tokenId,
    oldValue: before.status,
    newValue: 'no_show',
  });
  const notifications = Notify.notify({ token: res.token, event: 'no_show' });
  return { ok: true, token: res.token, notifications };
}

export function doCancel({ tokenId, actorId = null, actorName = null, reason = null }) {
  const before = Token.findById(tokenId);
  const res = Token.cancel(tokenId);
  if (!res.ok) return res;
  Audit.log({
    actorId,
    actorName,
    action: 'PATIENT_CANCELLED',
    targetType: 'token',
    targetId: tokenId,
    oldValue: before.status,
    newValue: 'cancelled',
    reason,
  });
  return { ok: true, token: res.token };
}

export function doHold({ tokenId, actorId = null, actorName = null }) {
  const res = Token.hold(tokenId);
  if (!res.ok) return res;
  Audit.log({
    actorId,
    actorName,
    action: 'PATIENT_HELD',
    targetType: 'token',
    targetId: tokenId,
    newValue: 'held',
  });
  return { ok: true, token: res.token };
}

export function setPriority({ tokenId, priority, reason = null, actorId = null, actorName = null }) {
  if (!Token.PRIORITIES.includes(priority)) {
    return { ok: false, error: `Invalid priority. Allowed: ${Token.PRIORITIES.join(', ')}` };
  }
  if (!reason) return { ok: false, error: 'A reason is required for a priority change' };
  const before = Token.findById(tokenId);
  if (!before) return { ok: false, error: 'Token not found' };
  const token = Token.setPriority(tokenId, priority, reason);
  Audit.log({
    actorId,
    actorName,
    action: 'PRIORITY_CHANGED',
    targetType: 'token',
    targetId: tokenId,
    oldValue: before.priority,
    newValue: priority,
    reason,
  });
  const notifications = Notify.notify({ token, event: 'priority_changed' });
  return { ok: true, token, notifications };
}

export function position(token) {
  if (!token || token.status !== 'queued') return null;
  if (token.doctor_id) return Token.queuePositionDoctor(token.id);
  return Token.queuePosition(token.id);
}

export function next(areaId, counterId) {
  return Token.next(areaId, counterId);
}

export function doEstimate({
  tokenId,
  estimatedWaitMinutes = null,
  estimatedServiceTime = null,
  actorId = null,
  actorName = null,
}) {
  const before = Token.findById(tokenId);
  if (!before) return { ok: false, error: 'Token not found' };

  let service =
    estimatedServiceTime === '' || estimatedServiceTime === null || estimatedServiceTime === undefined
      ? null
      : String(estimatedServiceTime);
  let wait =
    estimatedWaitMinutes === '' || estimatedWaitMinutes === null || estimatedWaitMinutes === undefined
      ? null
      : Number(estimatedWaitMinutes);

  if (service === null && wait !== null && Number.isInteger(wait)) {
    const d = new Date(Date.now() + wait * 60000);
    service = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  let token;
  try {
    token = Token.setEstimate(tokenId, { estimatedWaitMinutes: wait, estimatedServiceTime: service }, actorName);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  Audit.log({
    actorId,
    actorName,
    action: 'ESTIMATE_UPDATED',
    targetType: 'token',
    targetId: tokenId,
    oldValue: JSON.stringify({ w: before.estimated_wait_minutes, s: before.estimated_service_time }),
    newValue: JSON.stringify({ w: token.estimated_wait_minutes, s: token.estimated_service_time }),
  });
  const notifications = Notify.notify({ token, event: 'estimate_changed' });
  return { ok: true, token, notifications };
}