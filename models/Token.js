import { all, get, run, inTx } from '../config/db.js';

export const STATUS = {
  ISSUED: 'issued',
  QUEUED: 'queued',
  CALLED: 'called',
  SERVING: 'serving',
  IN_CONSULTATION: 'in_consultation',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
  HELD: 'held',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
};

// Allowed transitions: { fromStatus: [toStatus...] }
export const TRANSITIONS = {
  [STATUS.ISSUED]: [STATUS.QUEUED, STATUS.CANCELLED, STATUS.SKIPPED],
  [STATUS.QUEUED]: [STATUS.CALLED, STATUS.SERVING, STATUS.IN_CONSULTATION, STATUS.SKIPPED, STATUS.CANCELLED],
  [STATUS.CALLED]: [
    STATUS.SERVING,
    STATUS.IN_CONSULTATION,
    STATUS.COMPLETED,
    STATUS.SKIPPED,
    STATUS.HELD,
    STATUS.CANCELLED,
    STATUS.NO_SHOW,
  ],
  [STATUS.HELD]: [STATUS.CALLED, STATUS.SERVING, STATUS.IN_CONSULTATION, STATUS.SKIPPED, STATUS.CANCELLED, STATUS.NO_SHOW],
  [STATUS.SERVING]: [STATUS.COMPLETED, STATUS.SKIPPED, STATUS.CANCELLED, STATUS.HELD, STATUS.NO_SHOW],
  [STATUS.IN_CONSULTATION]: [STATUS.COMPLETED, STATUS.SKIPPED, STATUS.CANCELLED, STATUS.HELD, STATUS.NO_SHOW],
  [STATUS.COMPLETED]: [],
  [STATUS.SKIPPED]: [],
  [STATUS.CANCELLED]: [],
  [STATUS.NO_SHOW]: [],
};

export const PRIORITIES = ['NORMAL', 'APPOINTMENT', 'URGENT', 'EMERGENCY'];

export const TOKEN_ROW = `
  t.id, t.token_number, t.queue_seq, t.department_id, t.area_id, t.counter_id,
  t.patient_name, t.status, t.serving, t.created_at, t.called_at, t.completed_at,
  t.wait_time, t.priority, t.priority_reason, t.called_count, t.doctor_id,
  t.patient_id, t.preferred_doctor_id,
  t.estimated_wait_minutes, t.estimated_service_time,
  t.estimate_updated_at, t.estimate_updated_by,
  d.name AS department_name, d.code AS department_code, d.color AS department_color,
  a.name AS area_name, a.code AS area_code, a.floor AS area_floor,
  c.name AS counter_name,
  dr.name AS doctor_name, dr.room AS doctor_room, dr.specialization AS doctor_specialization,
  dr.qualification AS doctor_qualification, dr.experience_years AS doctor_experience,
  dr.avg_consultation_minutes AS doctor_avg_consultation_time,
  dr.status AS doctor_status,
  p.patient_no, p.phone AS patient_phone, p.age AS patient_age, p.gender AS patient_gender
`;

const JOIN = `
  FROM tokens t
  JOIN departments d ON d.id = t.department_id
  JOIN areas a ON a.id = t.area_id
  LEFT JOIN counters c ON c.id = t.counter_id
  LEFT JOIN doctors dr ON dr.id = t.doctor_id
  LEFT JOIN patients p ON p.id = t.patient_id
`;

function mapRow(row) {
  if (!row) return null;
  const avgTime = row.doctor_avg_consultation_time || 10;
  const formattedTokenCode = `${row.department_code || 'T'}-${String(row.token_number).padStart(3, '0')}`;
  return {
    ...row,
    token_code: formattedTokenCode,
    doctor_avg_consultation_time: avgTime,
    serving: !!row.serving || row.status === STATUS.SERVING || row.status === STATUS.IN_CONSULTATION,
    priority: row.priority || 'NORMAL',
    called_count: row.called_count || 0,
  };
}

export function findById(id) {
  return mapRow(get(`SELECT ${TOKEN_ROW} ${JOIN} WHERE t.id = ?`, id));
}

export function findByNumber(number) {
  return mapRow(
    get(`SELECT ${TOKEN_ROW} ${JOIN} WHERE t.token_number = ? ORDER BY t.id DESC LIMIT 1`, number)
  );
}

export function findByCode(departmentCode, number) {
  return mapRow(
    get(
      `SELECT ${TOKEN_ROW} ${JOIN}
       WHERE UPPER(d.code) = UPPER(?) AND t.token_number = ?
       ORDER BY t.id DESC LIMIT 1`,
      departmentCode,
      number
    )
  );
}

export function findActiveByPhone(phone) {
  const localNumber = String(phone || '').replace(/\D/g, '').slice(-10);
  if (!localNumber) return null;
  return mapRow(
    get(
      `SELECT ${TOKEN_ROW} ${JOIN}
       WHERE substr(
         replace(replace(replace(replace(replace(replace(p.phone, '+', ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''),
         -10
       ) = ?
         AND t.status IN ('queued', 'called', 'serving', 'in_consultation', 'held')
       ORDER BY t.id DESC
       LIMIT 1`,
      localNumber
    )
  );
}

export function list({ status, areaId, departmentId, doctorId, limit = 500 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    if (status === 'active') {
      where.push("t.status IN ('queued', 'called', 'serving', 'in_consultation', 'held')");
    } else {
      where.push('t.status = ?');
      params.push(status);
    }
  }
  if (areaId) {
    where.push('t.area_id = ?');
    params.push(areaId);
  }
  if (departmentId) {
    where.push('t.department_id = ?');
    params.push(departmentId);
  }
  if (doctorId) {
    where.push('t.doctor_id = ?');
    params.push(doctorId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT ${TOKEN_ROW} ${JOIN} ${clause} ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
    ...params,
    limit
  );
  return rows.map(mapRow);
}

// Live snapshot: currently-serving + next few queued per area.
export function live({ areaId } = {}) {
  const rows = all(
    `SELECT ${TOKEN_ROW} ${JOIN}
     WHERE t.status IN ('queued','called','serving','in_consultation','held')
       ${areaId ? 'AND t.area_id = ?' : ''}
     ORDER BY t.area_id, t.created_at, t.id`,
    ...(areaId ? [areaId] : [])
  ).map(mapRow);

  const byArea = {};
  for (const row of rows) {
    if (!byArea[row.area_id]) byArea[row.area_id] = { area: null, serving: [], queue: [], held: [] };
    const bucket = byArea[row.area_id];
    bucket.area = {
      id: row.area_id,
      name: row.area_name,
      code: row.area_code,
      floor: row.area_floor,
      department_id: row.department_id,
      department_name: row.department_name,
      department_color: row.department_color,
    };
    if (row.status === STATUS.CALLED || row.status === STATUS.SERVING || row.status === STATUS.IN_CONSULTATION) {
      bucket.serving.push(row);
    } else if (row.status === STATUS.HELD) {
      bucket.held.push(row);
    } else {
      bucket.queue.push(row);
    }
  }
  // Public display
  for (const section of Object.values(byArea)) {
    for (const arr of [section.serving, section.queue, section.held]) {
      for (const t of arr) delete t.patient_name;
    }
  }
  return Object.values(byArea);
}

export function queuePosition(id) {
  const token = get('SELECT id, area_id, doctor_id, created_at FROM tokens WHERE id = ?', id);
  if (!token) return 1;

  if (token.doctor_id) {
    return queuePositionDoctor(id);
  }

  const row = get(
    `SELECT COUNT(*) AS pos FROM tokens
     WHERE area_id = ?
       AND status = 'queued'
       AND (created_at < ? OR (created_at = ? AND id < ?))`,
    token.area_id,
    token.created_at,
    token.created_at,
    token.id
  );
  return (row?.pos || 0) + 1;
}

// Position of a token among others waiting for the SAME assigned doctor.
export function queuePositionDoctor(id) {
  const token = get('SELECT id, doctor_id, created_at FROM tokens WHERE id = ?', id);
  if (!token || !token.doctor_id) return 1;

  const row = get(
    `SELECT COUNT(*) AS pos FROM tokens
     WHERE doctor_id = ?
       AND status = 'queued'
       AND (created_at < ? OR (created_at = ? AND id < ?))`,
    token.doctor_id,
    token.created_at,
    token.created_at,
    token.id
  );
  return (row?.pos || 0) + 1;
}

export function issue({
  departmentId,
  areaId,
  patientName = null,
  patientId = null,
  doctorId = null,
  preferredDoctorId = null,
  priority = 'NORMAL',
  whatsappOptIn = false,
  estimatedWaitMinutes = null,
  estimatedServiceTime = null,
}) {
  return inTx(() => {
    // Global per-department number.
    run(
      `INSERT INTO token_seq (department_id, last_number) VALUES (?, 1)
       ON CONFLICT(department_id) DO UPDATE SET last_number = last_number + 1`,
      departmentId
    );
    const seq = get('SELECT last_number FROM token_seq WHERE department_id = ?', departmentId);
    const tokenNumber = seq.last_number;

    // Per-area queue sequence.
    const q = get(
      'SELECT COALESCE(MAX(queue_seq), 0) AS m FROM tokens WHERE area_id = ?',
      areaId
    );
    const queueSeq = q.m + 1;

    run(
      `INSERT INTO tokens
         (token_number, queue_seq, department_id, area_id, patient_name,
          patient_id, doctor_id, preferred_doctor_id, priority, status,
          estimated_wait_minutes, estimated_service_time, whatsapp_opt_in,
          whatsapp_opt_in_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?,
         CASE WHEN ? = 1 THEN datetime('now') END)`,
      tokenNumber,
      queueSeq,
      departmentId,
      areaId,
      patientName || null,
      patientId || null,
      doctorId || null,
      preferredDoctorId || null,
      priority || 'NORMAL',
      estimatedWaitMinutes,
      estimatedServiceTime,
      whatsappOptIn === true ? 1 : 0,
      whatsappOptIn === true ? 1 : 0
    );
    const id = get('SELECT last_insert_rowid() AS id').id;
    const token = findById(id);
    const position = queuePosition(id);
    return { token, position };
  });
}

// Generic guarded transition. Returns { ok, error, token }.
function transition(id, toStatus, { counterId = null } = {}) {
  return inTx(() => {
    const token = get('SELECT * FROM tokens WHERE id = ?', id);
    if (!token) return { ok: false, error: 'Token not found' };

    const allowed = TRANSITIONS[token.status] || [];
    if (!allowed.includes(toStatus) && token.status !== toStatus) {
      return { ok: false, error: `Cannot move token from '${token.status}' to '${toStatus}'` };
    }

    if (toStatus === STATUS.CALLED) {
      run(
        `UPDATE tokens SET status = ?, serving = 1, called_at = datetime('now'),
           counter_id = COALESCE(?, counter_id), wait_time = NULL WHERE id = ?`,
        toStatus,
        counterId,
        id
      );
    } else if (toStatus === STATUS.SERVING || toStatus === STATUS.IN_CONSULTATION) {
      run(
        `UPDATE tokens SET status = 'in_consultation', serving = 1 WHERE id = ?`,
        id
      );
      if (token.doctor_id) {
        run("UPDATE doctors SET status = 'in_consultation' WHERE id = ? AND status != 'emergency'", token.doctor_id);
      }
    } else if (toStatus === STATUS.COMPLETED) {
      run(
        `UPDATE tokens SET status = ?, serving = 0, completed_at = datetime('now'),
           wait_time = strftime('%s', datetime('now')) - strftime('%s', created_at)
         WHERE id = ?`,
        toStatus,
        id
      );
      if (token.doctor_id) {
        // If no other tokens are in_consultation for this doctor, set doctor back to available
        const activeConsult = get(
          "SELECT COUNT(*) AS n FROM tokens WHERE doctor_id = ? AND status IN ('called', 'in_consultation', 'serving') AND id != ?",
          token.doctor_id,
          id
        )?.n || 0;
        if (activeConsult === 0) {
          run("UPDATE doctors SET status = 'available' WHERE id = ? AND status IN ('busy', 'in_consultation')", token.doctor_id);
        }
      }
    } else {
      run(
        'UPDATE tokens SET status = ?, serving = 0 WHERE id = ?',
        toStatus,
        id
      );
    }
    return { ok: true, token: findById(id) };
  });
}

export function call(id, counterId) {
  return transition(id, STATUS.CALLED, { counterId });
}

export function serve(id) {
  return transition(id, STATUS.IN_CONSULTATION);
}

export function next(areaId, counterId) {
  const nextToken = get(
    `SELECT id FROM tokens WHERE area_id = ? AND status = 'queued'
     ORDER BY created_at, id LIMIT 1`,
    areaId
  );
  if (!nextToken) return { ok: false, error: 'No tokens waiting in this queue' };
  return transition(nextToken.id, STATUS.CALLED, { counterId });
}

export function complete(id) {
  return transition(id, STATUS.COMPLETED);
}

export function skip(id) {
  return transition(id, STATUS.SKIPPED);
}

export function hold(id) {
  return transition(id, STATUS.HELD);
}

export function cancel(id) {
  return transition(id, STATUS.CANCELLED);
}

export function setDoctor(id, doctorId) {
  const info = run('UPDATE tokens SET doctor_id = ? WHERE id = ?', doctorId, id);
  return info.changes ? findById(id) : null;
}

export function setPriority(id, priority, reason = null) {
  run('UPDATE tokens SET priority = ?, priority_reason = ? WHERE id = ?', priority, reason, id);
  return findById(id);
}

export function setPreferredDoctor(id, doctorId) {
  run('UPDATE tokens SET preferred_doctor_id = ? WHERE id = ?', doctorId, id);
  return findById(id);
}

// Re-call a token that has been called/held (increments the call/recall count).
export function recall(id, counterId) {
  return inTx(() => {
    const token = get('SELECT * FROM tokens WHERE id = ?', id);
    if (!token) return { ok: false, error: 'Token not found' };
    if (![STATUS.CALLED, STATUS.HELD, STATUS.QUEUED, STATUS.IN_CONSULTATION, STATUS.SERVING].includes(token.status)) {
      return { ok: false, error: `Cannot recall token in '${token.status}' state` };
    }
    run(
      `UPDATE tokens SET status = 'called', serving = 1, called_count = called_count + 1,
         called_at = datetime('now'), counter_id = COALESCE(?, counter_id), wait_time = NULL
       WHERE id = ?`,
      counterId,
      id
    );
    return { ok: true, token: findById(id) };
  });
}

export function noShow(id) {
  return transition(id, STATUS.NO_SHOW);
}

export function countsToday() {
  return all(
    `SELECT status, COUNT(*) AS n FROM tokens
     WHERE date(created_at) = date('now') GROUP BY status`
  );
}

export function countQueued(areaId) {
  return (
    get(
      'SELECT COUNT(*) AS n FROM tokens WHERE area_id = ? AND status = ?',
      areaId,
      STATUS.QUEUED
    )?.n || 0
  );
}

export function setEstimate(
  id,
  { estimatedWaitMinutes = null, estimatedServiceTime = null } = {},
  actorName = null
) {
  const wait =
    estimatedWaitMinutes === '' || estimatedWaitMinutes === null || estimatedWaitMinutes === undefined
      ? null
      : Number(estimatedWaitMinutes);
  if (wait !== null && (!Number.isInteger(wait) || wait < 0 || wait > 1440)) {
    throw new Error('Estimated wait must be a whole number of minutes between 0 and 1440');
  }
  const time =
    estimatedServiceTime === '' || estimatedServiceTime === null || estimatedServiceTime === undefined
      ? null
      : String(estimatedServiceTime);
  run(
    `UPDATE tokens SET estimated_wait_minutes = ?, estimated_service_time = ?,
       estimate_updated_at = datetime('now'), estimate_updated_by = ? WHERE id = ?`,
    wait,
    time,
    actorName,
    id
  );
  return findById(id);
}
