import { all, get, run, lastInsertId } from '../config/db.js';

export const STATUS = {
  AVAILABLE: 'available',
  BUSY: 'busy',
  IN_CONSULTATION: 'in_consultation',
  BREAK: 'break',
  OFFLINE: 'offline',
  EMERGENCY: 'emergency',
};

// Doctors that should not receive new automatic assignments without an explicit override.
export const UNAVAILABLE_FOR_NEW = [STATUS.OFFLINE, STATUS.BREAK];

export function list({ departmentId, specialization, status, search, active, limit = 500 } = {}) {
  const where = [];
  const params = [];

  if (departmentId) {
    where.push('d.department_id = ?');
    params.push(departmentId);
  }
  if (specialization) {
    where.push('LOWER(d.specialization) LIKE ?');
    params.push(`%${specialization.toLowerCase()}%`);
  }
  if (status) {
    where.push('d.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(LOWER(d.name) LIKE ? OR LOWER(d.specialization) LIKE ? OR LOWER(d.room) LIKE ? OR LOWER(dept.name) LIKE ?)');
    const s = `%${search.toLowerCase()}%`;
    params.push(s, s, s, s);
  }
  if (active !== undefined) {
    where.push('d.active = ?');
    params.push(active ? 1 : 0);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(
    `SELECT d.*,
            dept.name AS department_name,
            dept.code AS department_code,
            dept.color AS department_color
     FROM doctors d
     LEFT JOIN departments dept ON dept.id = d.department_id
     ${clause}
     ORDER BY dept.name ASC, d.name ASC
     LIMIT ?`,
    ...params,
    limit
  );

  return rows.map((r) => withWorkload({ ...r, active: !!r.active }));
}

export function findById(id) {
  const row = get(
    `SELECT d.*,
            dept.name AS department_name,
            dept.code AS department_code,
            dept.color AS department_color
     FROM doctors d
     LEFT JOIN departments dept ON dept.id = d.department_id
     WHERE d.id = ?`,
    id
  );
  if (!row) return null;
  return withWorkload({ ...row, active: !!row.active });
}

// Workload & queue status for a doctor.
export function withWorkload(doctor) {
  const waiting = get(
    "SELECT COUNT(*) AS n FROM tokens WHERE doctor_id = ? AND status = 'queued'",
    doctor.id
  )?.n || 0;

  const currentToken = get(
    `SELECT t.id, t.token_number, t.status, t.called_at, t.patient_name, t.priority,
            d.code AS department_code
     FROM tokens t
     LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.doctor_id = ? AND t.status IN ('called', 'serving', 'in_consultation')
     ORDER BY t.called_at DESC, t.id DESC LIMIT 1`,
    doctor.id
  );

  const totalServed = get(
    "SELECT COUNT(*) AS n FROM tokens WHERE doctor_id = ? AND status = 'completed'",
    doctor.id
  )?.n || 0;

  const nextPatients = all(
    `SELECT t.id, t.token_number, t.patient_name, t.status, t.created_at, t.priority,
            d.code AS department_code
     FROM tokens t
     LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.doctor_id = ? AND t.status = 'queued'
     ORDER BY t.created_at ASC, t.id ASC
     LIMIT 5`,
    doctor.id
  );

  const avgTime = doctor.avg_consultation_minutes || 10;
  const estimatedQueueMinutes = waiting * avgTime;

  return {
    ...doctor,
    avg_consultation_minutes: avgTime,
    experience_years: doctor.experience_years || 5,
    qualification: doctor.qualification || 'MBBS',
    waiting,
    current: waiting,
    currentToken: currentToken || null,
    totalServed,
    servedCount: totalServed,
    nextPatients,
    estimatedQueueMinutes,
  };
}

export function getQueue(id) {
  const doctor = findById(id);
  if (!doctor) return null;

  const serving = all(
    `SELECT t.*, d.code AS department_code, d.name AS department_name
     FROM tokens t
     LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.doctor_id = ? AND t.status IN ('called', 'serving', 'in_consultation')
     ORDER BY t.called_at DESC, t.id DESC`,
    id
  );

  const waiting = all(
    `SELECT t.*, d.code AS department_code, d.name AS department_name
     FROM tokens t
     LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.doctor_id = ? AND t.status = 'queued'
     ORDER BY t.created_at ASC, t.id ASC`,
    id
  );

  return {
    doctor,
    serving,
    waiting,
    waitingCount: waiting.length,
    estimatedWaitMinutes: waiting.length * (doctor.avg_consultation_minutes || 10),
  };
}

export function create({
  name,
  departmentId,
  specialization = null,
  qualification = 'MBBS',
  experience_years = 5,
  avg_consultation_minutes = 10,
  status = STATUS.AVAILABLE,
  room = null,
  capacity = 0,
}) {
  run(
    `INSERT INTO doctors (
       name, department_id, specialization, qualification,
       experience_years, avg_consultation_minutes, status, room, capacity, active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    name,
    departmentId || null,
    specialization,
    qualification,
    experience_years || 5,
    avg_consultation_minutes || 10,
    status,
    room,
    capacity || 0
  );
  return findById(lastInsertId());
}

export function update(
  id,
  {
    name,
    departmentId,
    specialization,
    qualification,
    experience_years,
    avg_consultation_minutes,
    status,
    room,
    capacity,
    active,
  }
) {
  run(
    `UPDATE doctors SET
       name = COALESCE(?, name),
       department_id = COALESCE(?, department_id),
       specialization = COALESCE(?, specialization),
       qualification = COALESCE(?, qualification),
       experience_years = COALESCE(?, experience_years),
       avg_consultation_minutes = COALESCE(?, avg_consultation_minutes),
       status = COALESCE(?, status),
       room = COALESCE(?, room),
       capacity = COALESCE(?, capacity),
       active = COALESCE(?, active)
     WHERE id = ?`,
    name,
    departmentId === undefined ? undefined : departmentId,
    specialization,
    qualification,
    experience_years,
    avg_consultation_minutes,
    status,
    room,
    capacity,
    active === undefined ? undefined : active ? 1 : 0,
    id
  );
  return findById(id);
}

export function setStatus(id, status) {
  run('UPDATE doctors SET status = ? WHERE id = ?', status, id);
  return findById(id);
}

export function remove(id) {
  return run('DELETE FROM doctors WHERE id = ?', id).changes;
}

export function eligibleFor(departmentId) {
  const rows = all(
    `SELECT id FROM doctors
     WHERE department_id = ? AND active = 1 AND status IN ('available','busy','in_consultation','emergency')`,
    departmentId
  );
  return rows.map((r) => r.id);
}