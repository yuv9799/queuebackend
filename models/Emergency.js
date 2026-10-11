import { all, get, run, lastInsertId } from '../config/db.js';

export const SOS_STATUS = [
  'ACTIVE', 'STAFF_NOTIFIED', 'ACKNOWLEDGED', 'RESPONDING', 'RESOLVED', 'CANCELLED', 'FAILED',
];
const ACTIVE_STATES = ['ACTIVE', 'STAFF_NOTIFIED', 'ACKNOWLEDGED', 'RESPONDING'];

// --- Help points ---
export function listHelpPoints() {
  return all('SELECT * FROM help_points WHERE enabled = 1 ORDER BY id');
}

function toRad(deg) { return (deg * Math.PI) / 180; }

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearestHelpPoint(lat, lng) {
  const points = listHelpPoints();
  if (points.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const p of points) {
    const d = haversineM(lat, lng, p.latitude, p.longitude);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return { helpPoint: best, distance: Math.round(bestDist) };
}

// --- SOS ---
export function myActiveSos(userId) {
  if (!userId) return null;
  const row = get(
    `SELECT * FROM sos_requests WHERE user_id = ? AND status IN (${ACTIVE_STATES.map(() => '?').join(',')})
     ORDER BY created_at DESC LIMIT 1`,
    userId,
    ...ACTIVE_STATES
  );
  return row ? mapSos(row) : null;
}

export function findByKey(key) {
  if (!key) return null;
  const row = get('SELECT * FROM sos_requests WHERE idempotency_key = ? LIMIT 1', key);
  return row ? mapSos(row) : null;
}

function mapSos(row) {
  return {
    id: row.id,
    sosNumber: row.sos_number,
    userId: row.user_id,
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    status: row.status,
    source: row.source,
    assigned: row.assigned_help_id ? get('SELECT * FROM help_points WHERE id = ?', row.assigned_help_id) : null,
    nearestDistance: row.nearest_distance,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
    respondingAt: row.responding_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

export function createSos({ userId = null, latitude, longitude, accuracy = null, idempotencyKey = null, source = 'web' }) {
  const sos_number = genSosNumber();
  const nearest = nearestHelpPoint(latitude, longitude);
  const assignedHelpId = nearest ? nearest.helpPoint.id : null;
  const nearestDistance = nearest ? nearest.distance : null;

  run(
    `INSERT INTO sos_requests
       (sos_number, user_id, latitude, longitude, accuracy, status, idempotency_key,
        assigned_help_id, nearest_distance, source)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
    sos_number,
    userId,
    latitude,
    longitude,
    accuracy,
    idempotencyKey,
    assignedHelpId,
    nearestDistance,
    source
  );
  const id = lastInsertId();
  const sos = get('SELECT * FROM sos_requests WHERE id = ?', id);
  const mapped = { ...mapSos(sos), inProgressStatus: 'ACTIVE' };
  // Return assigned team details.
  const team = nearest
    ? { name: nearest.helpPoint.name, distance: nearest.distance, floor: nearest.helpPoint.floor }
    : { name: 'Emergency Response Team', distance: null, floor: null };
  return { sos: mapSos(sos), team };
}

function genSosNumber() {
  return 'SOS-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function getSos(id) {
  const row = get('SELECT * FROM sos_requests WHERE id = ?', id);
  return row ? mapSos(row) : null;
}

export function listSos({ status = null, limit = 50 } = {}) {
  const where = [];
  const params = [];
  if (status && SOS_STATUS.includes(status)) { where.push('status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(Math.min(200, Number(limit) || 50));
  const rows = all(`SELECT * FROM sos_requests ${clause} ORDER BY created_at DESC LIMIT ?`, ...params);
  return rows.map(mapSos);
}

export function setSosStatus(id, status, { actor = null } = {}) {
  if (!SOS_STATUS.includes(status)) return null;
  const sets = ['status = ?'];
  const params = [status];
  const col = (name) => { sets.push(`${name} = ?`); params.push("datetime('now')"); };
  if (status === 'ACKNOWLEDGED') col('acknowledged_at');
  if (status === 'RESPONDING') col('responding_at');
  if (status === 'RESOLVED') { col('resolved_at'); sets.push('resolved_by = ?'); params.push(actor); }
  run(`UPDATE sos_requests SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  return mapSos(get('SELECT * FROM sos_requests WHERE id = ?', id));
}

export function removeSos(id) {
  return run('DELETE FROM sos_requests WHERE id = ?', id).changes;
}