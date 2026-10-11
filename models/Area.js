import { all, get, run, lastInsertId } from '../config/db.js';

export function list({ departmentId } = {}) {
  if (departmentId) {
    return all('SELECT * FROM areas WHERE department_id = ? ORDER BY id', departmentId);
  }
  return all('SELECT * FROM areas ORDER BY id');
}

export function findById(id) {
  return get('SELECT * FROM areas WHERE id = ?', id);
}

export function findByCode(code) {
  return get('SELECT * FROM areas WHERE code = ?', code);
}

export function create({ departmentId, name, code, floor = null, enabled = 1 }) {
  run(
    'INSERT INTO areas (department_id, name, code, floor, enabled) VALUES (?, ?, ?, ?, ?)',
    departmentId,
    name,
    code,
    floor,
    enabled ? 1 : 0
  );
  return findById(lastInsertId());
}

export function update(id, { departmentId, name, code, floor, enabled }) {
  run(
    `UPDATE areas SET
       department_id = COALESCE(?, department_id),
       name = COALESCE(?, name),
       code = COALESCE(?, code),
       floor = COALESCE(?, floor),
       enabled = COALESCE(?, enabled)
     WHERE id = ?`,
    departmentId,
    name,
    code,
    floor,
    enabled === undefined ? undefined : enabled ? 1 : 0,
    id
  );
  return findById(id);
}

export function remove(id) {
  return run('DELETE FROM areas WHERE id = ?', id).changes;
}