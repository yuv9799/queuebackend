import * as Token from '../../models/Token.js';
import * as Department from '../../models/Department.js';
import * as Area from '../../models/Area.js';
import * as Patient from '../../models/Patient.js';
import * as Queue from '../../models/Queue.js';
import * as Doctor from '../../models/Doctor.js';
import * as Audit from '../../models/Audit.js';
import * as Notify from '../../models/Notify.js';
import { sendTokenSMS } from '../sms/index.js';
import { sendWhatsAppNotification } from '../whatsapp/twilio.js';

export class TokenCreationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'TokenCreationError';
    this.status = status;
  }
}

function broadcastCreated(app, token, extra = {}) {
  const io = app?.get('io');
  if (!io) return;
  io.emit('token:updated', { token, ...extra });
  io.emit('token:created', { token, ...extra });
  io.emit('queue:updated', {
    areaId: token?.area_id,
    departmentId: token?.department_id,
    doctorId: token?.doctor_id,
  });
  io.emit('staff:update', { type: 'token', token, ...extra });
  io.emit('staff:activity', {
    at: new Date().toISOString(),
    ...extra,
    tokenNumber: token?.token_number,
    tokenCode: token?.token_code,
    doctorId: token?.doctor_id,
    doctorName: token?.doctor_name,
  });
}

export async function createQueueToken({
  app,
  body = {},
  actor = null,
  source = 'kiosk',
}) {
  const {
    departmentId,
    areaId,
    patientName,
    phone,
    preferredDoctorId,
    doctorId,
    priority,
    whatsappOptIn,
  } = body;

  if (!departmentId) throw new TokenCreationError('departmentId is required');
  const department = Department.findById(departmentId);
  if (!department || (source === 'ai_assistant' && !department.enabled)) {
    throw new TokenCreationError('Department not found');
  }

  let effectiveAreaId = areaId;
  if (effectiveAreaId) {
    const area = Area.findById(effectiveAreaId);
    if (!area || Number(area.department_id) !== Number(departmentId)
      || (source === 'ai_assistant' && !area.enabled)) {
      throw new TokenCreationError('Service area is not available for this department');
    }
  } else {
    const areas = Area.list({ departmentId })
      .filter((area) => source !== 'ai_assistant' || area.enabled);
    if (areas.length === 0) {
      throw new TokenCreationError('No service area found for this department');
    }
    effectiveAreaId = areas[0].id;
  }

  let patientId = body.patientId || null;
  if (!patientId && (patientName || phone)) {
    const patient = Patient.findOrCreate({ name: patientName || 'Walk-in', phone });
    patientId = patient.id;
  }

  let assignedDoctorId = doctorId ? Number(doctorId) : null;
  if (assignedDoctorId && source === 'ai_assistant') {
    const doctor = Doctor.findById(assignedDoctorId);
    if (!doctor || !doctor.active
      || Number(doctor.department_id) !== Number(departmentId)
      || Doctor.UNAVAILABLE_FOR_NEW.includes(doctor.status)) {
      throw new TokenCreationError('Selected doctor is no longer available');
    }
  }
  if (!assignedDoctorId) {
    const bestDoctor = Queue.findBestDoctorForDepartment(departmentId, {
      preferredDoctorId: preferredDoctorId || null,
    });
    if (bestDoctor && (source !== 'ai_assistant'
      || !Doctor.UNAVAILABLE_FOR_NEW.includes(bestDoctor.status))) {
      assignedDoctorId = bestDoctor.id;
    }
  }

  const usePriority = actor
    ? (Token.PRIORITIES.includes(priority) ? priority : 'NORMAL')
    : 'NORMAL';

  const { token, position } = Token.issue({
    departmentId,
    areaId: effectiveAreaId,
    patientName,
    patientId,
    doctorId: assignedDoctorId,
    preferredDoctorId: preferredDoctorId ? Number(preferredDoctorId) : null,
    priority: usePriority,
    whatsappOptIn: whatsappOptIn === true,
  });

  const estimates = Queue.calculateEstimates(token);
  const sourceReason = source === 'ai_assistant' ? 'Created via ai_assistant' : null;
  const assignedReason = token.doctor_name ? `Assigned to ${token.doctor_name}` : null;
  Audit.log({
    actorId: actor?.id || null,
    actorName: actor?.name || (source === 'ai_assistant' ? 'ai_assistant' : 'kiosk'),
    action: 'TOKEN_CREATED',
    targetType: 'token',
    targetId: token.id,
    newValue: String(token.token_number),
    reason: [assignedReason, sourceReason].filter(Boolean).join('; ') || null,
  });

  const notifications = Notify.notify({ token, event: 'token_created' });
  broadcastCreated(app, token, { action: 'token_created', position, ...estimates });
  const smsNotification = await sendTokenSMS({
    phone,
    token,
    patientName: token.patient_name,
    department: token.department_name,
    doctor: token.doctor_name,
    counter: token.counter_name || [token.area_name, token.area_floor].filter(Boolean).join(' · '),
    queuePosition: estimates.position,
    estimatedWait: estimates.estimatedWaitMinutes,
  }).catch((error) => {
    console.error('[SMS] Notification failed safely:', error?.name || 'Error');
    return { attempted: true, accepted: false, reason: 'delivery_failed' };
  });
  const whatsappNotification = await sendWhatsAppNotification({
    phone,
    whatsappOptIn: whatsappOptIn === true,
    token,
    patientName: token.patient_name,
    department: token.department_name,
    doctor: token.doctor_name,
    room: token.doctor_room,
    queuePosition: estimates.position,
    estimatedWait: estimates.estimatedWaitMinutes,
  }).catch((error) => {
    console.error('[WhatsApp] Notification failed safely:', error?.name || 'Error');
    return { attempted: true, accepted: false, reason: 'delivery_failed' };
  });

  return {
    token,
    position: estimates.position,
    peopleAhead: estimates.peopleAhead,
    estimatedWaitMinutes: estimates.estimatedWaitMinutes,
    estimatedServiceTime: estimates.estimatedServiceTime,
    notifications,
    smsNotification,
    whatsappNotification,
    whatsappOptIn: whatsappOptIn === true,
  };
}
