import { all, get, run, lastInsertId } from '../config/db.js';

export function list() {
  return all('SELECT * FROM departments ORDER BY id');
}

export function findById(id) {
  return get('SELECT * FROM departments WHERE id = ?', id);
}

export function findByCode(code) {
  return get('SELECT * FROM departments WHERE code = ?', code);
}

export function create({ name, code, color = '#2563eb', enabled = 1 }) {
  run(
    'INSERT INTO departments (name, code, color, enabled) VALUES (?, ?, ?, ?)',
    name,
    code,
    color,
    enabled ? 1 : 0
  );
  return findById(lastInsertId());
}

export function update(id, { name, code, color, enabled }) {
  run(
    `UPDATE departments SET
       name = COALESCE(?, name),
       code = COALESCE(?, code),
       color = COALESCE(?, color),
       enabled = COALESCE(?, enabled)
     WHERE id = ?`,
    name,
    code,
    color,
    enabled === undefined ? undefined : enabled ? 1 : 0,
    id
  );
  return findById(id);
}

export function remove(id) {
  return run('DELETE FROM departments WHERE id = ?', id).changes;
}