import { all, run, lastInsertId } from '../config/db.js';

// Record an auditable staff/system action. This is append-only and satisfies
// "WHO / WHAT / WHEN / WHY" for every queue-changing operation.
export function log({ actorId = null, actorName = null, action, targetType = null, targetId = null, oldValue = null, newValue = null, reason = null }) {
  run(
    `INSERT INTO audit_logs (actor_id, actor_name, action, target_type, target_id, old_value, new_value, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    actorId, actorName, action, targetType, targetId, oldValue, newValue, reason
  );
  return lastInsertId();
}

export function list({ limit = 200 } = {}) {
  return all(
    'SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?',
    limit
  );
}

export function listForTarget(targetType, targetId, { limit = 100 } = {}) {
  return all(
    'SELECT * FROM audit_logs WHERE target_type = ? AND target_id = ? ORDER BY id DESC LIMIT ?',
    targetType, targetId, limit
  );
}