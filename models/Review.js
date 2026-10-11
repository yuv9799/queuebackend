import { all, get, run, lastInsertId } from '../config/db.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const REVIEW_TYPES = ['PATIENT', 'STAFF'];
export const REVIEW_STATES = ['PENDING', 'APPROVED', 'REJECTED'];
export const REVIEW_CATEGORIES = [
  'TOKEN_GENERATION', 'QUEUE_TRACKING', 'LIVE_BOARD', 'WAIT_TIME',
  'MOBILE_EXPERIENCE', 'NOTIFICATIONS', 'STAFF_EXPERIENCE', 'DEPARTMENT_SELECTION',
  'SERVICE_INFORMATION', 'EMERGENCY_HELP', 'ACCESSIBILITY', 'PERFORMANCE',
  'APPOINTMENTS', 'GENERAL',
];

const ROW = `
  r.id, r.user_id, r.reviewer_name, r.reviewer_type, r.rating,
  r.comment, r.department_id, r.service_area_id, r.status, r.created_at, r.updated_at,
  r.is_demo, r.category, r.request,
  d.name AS department_name, d.code AS department_code,
  a.name AS area_name, u.email AS user_email
`;

const JOIN = `
  FROM reviews r
  LEFT JOIN departments d ON d.id = r.department_id
  LEFT JOIN areas a ON a.id = r.service_area_id
  LEFT JOIN users u ON u.id = r.user_id
`;

function mapRow(row) {
  if (!row) return null;
  return { ...row, is_demo: !!row.is_demo };
}

export function create({ userId = null, reviewerName, reviewerType = 'PATIENT', rating, comment, departmentId = null, serviceAreaId = null, category = null, request = null, isDemo = false }) {
  const type = reviewerType === 'STAFF' ? 'STAFF' : 'PATIENT';
  const rate = Math.max(1, Math.min(5, Math.round(rating)));
  const ownerKey = randomBytes(32).toString('base64url');
  run(
    `INSERT INTO reviews
       (user_id, reviewer_name, reviewer_type, owner_key_hash, rating, comment, department_id, service_area_id, status, category, request, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?)`,
    userId,
    (reviewerName || 'Anonymous').trim(),
    type,
    hashOwnerKey(ownerKey),
    rate,
    comment.trim(),
    departmentId || null,
    serviceAreaId || null,
    category || null,
    request || null,
    isDemo ? 1 : 0
  );
  return { ...findById(lastInsertId()), ownerKey };
}

function hashOwnerKey(ownerKey) {
  return createHash('sha256').update(ownerKey).digest('hex');
}

function isOwnerKeyValid(review, ownerKey) {
  if (!review?.owner_key_hash || typeof ownerKey !== 'string' || ownerKey.length < 32 || ownerKey.length > 128) return false;
  const candidate = Buffer.from(hashOwnerKey(ownerKey), 'hex');
  const stored = Buffer.from(review.owner_key_hash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function findById(id) {
  return mapRow(get(`SELECT ${ROW} ${JOIN} WHERE r.id = ?`, id));
}

export function updateOwned(id, ownerKey, { reviewerName, rating, comment, departmentId = null, category = null, request = null }) {
  const review = get('SELECT owner_key_hash FROM reviews WHERE id = ?', id);
  if (!isOwnerKeyValid(review, ownerKey)) return null;
  run(
    `UPDATE reviews
     SET reviewer_name = ?, rating = ?, comment = ?, department_id = ?,
         category = ?, request = ?, updated_at = datetime('now')
     WHERE id = ?`,
    (reviewerName || 'Anonymous').trim(),
    rating,
    comment.trim(),
    departmentId || null,
    category || null,
    request || null,
    id
  );
  return findById(id);
}

export function removeOwned(id, ownerKey) {
  const review = get('SELECT owner_key_hash FROM reviews WHERE id = ?', id);
  if (!isOwnerKeyValid(review, ownerKey)) return false;
  return run('DELETE FROM reviews WHERE id = ?', id).changes > 0;
}

function buildWhere({ status = null, type = null, departmentId = null, rating = null, category = null, isDemo = null, q = null }) {
  const where = [];
  const params = [];
  if (status && REVIEW_STATES.includes(status)) { where.push('r.status = ?'); params.push(status); }
  if (type === 'PATIENT' || type === 'STAFF') { where.push('r.reviewer_type = ?'); params.push(type); }
  if (departmentId) { where.push('r.department_id = ?'); params.push(departmentId); }
  if (rating) { where.push('r.rating = ?'); params.push(Number(rating)); }
  if (category) { where.push('r.category = ?'); params.push(category); }
  if (isDemo === true || isDemo === false) { where.push('r.is_demo = ?'); params.push(isDemo ? 1 : 0); }
  if (q && String(q).trim()) {
    where.push('(r.comment LIKE ? OR r.reviewer_name LIKE ? OR r.category LIKE ? OR d.name LIKE ?)');
    const like = `%${String(q).trim()}%`;
    params.push(like, like, like, like);
  }
  return { where, params };
}

function orderByClause(sort) {
  switch (sort) {
    case 'oldest': return 'r.created_at ASC';
    case 'highest': return 'r.rating DESC, r.created_at DESC';
    case 'lowest': return 'r.rating ASC, r.created_at DESC';
    case 'newest':
    default: return 'r.created_at DESC';
  }
}

// Public: approved reviews only, newest first, optional filters.
export function listPublic({ departmentId = null, type = null, rating = null, category = null, q = null, sort = 'newest', limit = 50 } = {}) {
  const { where, params } = buildWhere({ status: 'APPROVED', type, departmentId, rating, category, q });
  params.push(Math.min(200, Number(limit) || 50));
  return all(
    `SELECT ${ROW} ${JOIN} WHERE ${where.join(' AND ')}
     ORDER BY ${orderByClause(sort)} LIMIT ?`,
    ...params
  ).map(mapRow);
}

// Staff moderation: all reviews, filterable + sortable + searchable.
export function listAdmin({ status = null, type = null, departmentId = null, rating = null, category = null, isDemo = null, q = null, sort = 'newest', limit = 300 } = {}) {
  const { where, params } = buildWhere({ status, type, departmentId, rating, category, isDemo, q });
  params.push(Math.min(500, Number(limit) || 300));
  return all(
    `SELECT ${ROW} ${JOIN} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${orderByClause(sort)} LIMIT ?`,
    ...params
  ).map(mapRow);
}
export function summary() {
  const row = get(
    `SELECT COUNT(*) AS n,
            COALESCE(AVG(rating),0) AS avg,
            SUM(rating = 5) AS s5, SUM(rating = 4) AS s4, SUM(rating = 3) AS s3, SUM(rating = 2) AS s2, SUM(rating = 1) AS s1,
            SUM(is_demo = 1) AS demo
     FROM reviews WHERE status = 'APPROVED'`
  );
  return {
    count: row?.n || 0,
    average: Math.round((row?.avg || 0) * 10) / 10,
    demoCount: row?.demo || 0,
    distribution: {
      five: row?.s5 || 0, four: row?.s4 || 0, three: row?.s3 || 0, two: row?.s2 || 0, one: row?.s1 || 0,
    },
  };
}

// Aggregate analytics for staff/admin dashboards.
export function analytics() {
  const summaryData = summary();
  const topRequests = all(
    `SELECT COALESCE(NULLIF(r.category,''), 'GENERAL') AS theme, COUNT(*) AS n,
            GROUP_CONCAT(r.request, ' | ') AS samples
     FROM reviews r
     WHERE r.status = 'APPROVED' AND r.request IS NOT NULL AND TRIM(r.request) <> ''
     GROUP BY 1 ORDER BY n DESC, theme ASC LIMIT 10`
  ).map((r) => ({ ...r, sample: String(r.samples).split(' | ')[0] }));
  const byCategory = all(
    `SELECT COALESCE(NULLIF(r.category,''), 'GENERAL') AS category, COUNT(*) AS n
     FROM reviews r WHERE r.status = 'APPROVED' GROUP BY 1 ORDER BY n DESC`
  );
  return { summary: summaryData, topRequests, byCategory };
}

export function setStatus(id, status) {
  if (!REVIEW_STATES.includes(status)) return null;
  run("UPDATE reviews SET status = ?, updated_at = datetime('now') WHERE id = ?", status, id);
  return findById(id);
}

export function remove(id) {
  return run('DELETE FROM reviews WHERE id = ?', id).changes;
}