import { all, get } from '../config/db.js';

export function overview() {
  const total = get(
    "SELECT COUNT(*) AS n FROM tokens WHERE date(created_at) = date('now')"
  )?.n || 0;
  const completed = get(
    "SELECT COUNT(*) AS n FROM tokens WHERE date(created_at) = date('now') AND status = 'completed'"
  )?.n || 0;
  const avgWait = get(
    `SELECT AVG(wait_time) AS avg FROM tokens
     WHERE date(created_at) = date('now') AND status = 'completed' AND wait_time IS NOT NULL`
  )?.avg || 0;
  const queued = get(
    "SELECT COUNT(*) AS n FROM tokens WHERE status = 'queued'"
  )?.n || 0;
  const serving = get(
    "SELECT COUNT(*) AS n FROM tokens WHERE status = 'called'"
  )?.n || 0;
  return {
    issuedToday: total,
    completedToday: completed,
    avgWaitSeconds: Math.round(avgWait),
    queuedNow: queued,
    servingNow: serving,
  };
}

export function statusToday() {
  return all(
    `SELECT status, COUNT(*) AS n FROM tokens
     WHERE date(created_at) = date('now') GROUP BY status`
  );
}

export function hourly() {
  return all(
    `SELECT strftime('%H', created_at) AS hour, COUNT(*) AS n
     FROM tokens WHERE date(created_at) = date('now')
     GROUP BY hour ORDER BY hour`
  );
}

export function queueDepth() {
  return all(
    `SELECT a.id AS area_id, a.name AS area_name, a.code AS area_code,
            d.name AS department_name, d.color AS department_color,
            SUM(CASE WHEN t.status = 'queued' THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN t.status = 'called' THEN 1 ELSE 0 END) AS serving
     FROM areas a
     JOIN departments d ON d.id = a.department_id
     LEFT JOIN tokens t ON t.area_id = a.id
     GROUP BY a.id
     ORDER BY queued DESC`
  );
}

export function byDepartment() {
  return all(
    `SELECT d.id, d.name, d.color,
            COUNT(t.id) AS issued,
            SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM departments d
     LEFT JOIN tokens t ON t.department_id = d.id AND date(t.created_at) = date('now')
     GROUP BY d.id ORDER BY issued DESC`
  );
}