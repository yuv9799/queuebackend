import { all, get, run, lastInsertId } from '../config/db.js';

export function list({ areaId } = {}) {
  if (areaId) {
    return all('SELECT * FROM counters WHERE area_id = ? ORDER BY id', areaId);
  }
  return all('SELECT * FROM counters ORDER BY id');
}

export function findById(id) {
  return get('SELECT * FROM counters WHERE id = ?', id);
}

export function create({ areaId, name, enabled = 1 }) {
  run(
    'INSERT INTO counters (area_id, name, enabled) VALUES (?, ?, ?)',
    areaId,
    name,
    enabled ? 1 : 0
  );
  return findById(lastInsertId());
}

export function update(id, { name, enabled }) {
  run(
    'UPDATE counters SET name = COALESCE(?, name), enabled = COALESCE(?, enabled) WHERE id = ?',
    name,
    enabled === undefined ? undefined : enabled ? 1 : 0,
    id
  );
  return findById(id);
}

export function remove(id) {
  return run('DELETE FROM counters WHERE id = ?', id).changes;
}