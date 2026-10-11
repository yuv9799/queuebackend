import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'queue.db');

fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'officer', -- admin | officer | reception
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  code       TEXT    NOT NULL UNIQUE,
  color      TEXT    NOT NULL DEFAULT '#2563eb',
  enabled    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS areas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,
  code          TEXT    NOT NULL UNIQUE,
  floor         TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS counters (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id  INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  enabled  INTEGER NOT NULL DEFAULT 1
);

-- Global token counter so numbers keep rising across all areas (per department).
CREATE TABLE IF NOT EXISTS token_seq (
  department_id INTEGER PRIMARY KEY,
  last_number   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  token_number INTEGER NOT NULL,              -- global per-department number
  queue_seq    INTEGER NOT NULL,              -- per-area 1,2,3...
  department_id INTEGER NOT NULL REFERENCES departments(id),
  area_id      INTEGER NOT NULL REFERENCES areas(id),
  counter_id   INTEGER REFERENCES counters(id),
  patient_name TEXT,
  status       TEXT    NOT NULL DEFAULT 'queued', -- issued|queued|called|completed|skipped|held|cancelled
  serving      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  called_at    TEXT,
  completed_at TEXT,
  wait_time    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tokens_area_status
  ON tokens(area_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_tokens_queue_seq
  ON tokens(area_id, queue_seq);

CREATE TABLE IF NOT EXISTS reviews (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER REFERENCES users(id),
  reviewer_name    TEXT    NOT NULL,
  reviewer_type    TEXT    NOT NULL DEFAULT 'PATIENT', -- PATIENT | STAFF
  owner_key_hash   TEXT,
  rating           INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment          TEXT    NOT NULL,
  department_id    INTEGER REFERENCES departments(id),
  service_area_id  INTEGER REFERENCES areas(id),
  status           TEXT    NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT,
  is_demo          INTEGER NOT NULL DEFAULT 0,
  category         TEXT,
  request          TEXT
);

CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

CREATE TABLE IF NOT EXISTS help_points (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  type       TEXT,
  floor      TEXT,
  latitude   REAL    NOT NULL,
  longitude  REAL    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sos_requests (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sos_number       TEXT    NOT NULL UNIQUE,
  user_id          INTEGER REFERENCES users(id),
  latitude         REAL    NOT NULL,
  longitude        REAL    NOT NULL,
  accuracy         REAL,
  status           TEXT    NOT NULL DEFAULT 'ACTIVE', -- ACTIVE|STAFF_NOTIFIED|ACKNOWLEDGED|RESPONDING|RESOLVED|CANCELLED|FAILED
  idempotency_key  TEXT    UNIQUE,
  assigned_help_id INTEGER REFERENCES help_points(id),
  nearest_distance REAL,
  source           TEXT    DEFAULT 'web',
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  acknowledged_at  TEXT,
  responding_at    TEXT,
  resolved_at      TEXT,
  resolved_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_sos_status ON sos_requests(status);
CREATE INDEX IF NOT EXISTS idx_sos_created ON sos_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_sos_user ON sos_requests(user_id);

-- ============================================================
-- Staff Control Center extensions
-- ============================================================

CREATE TABLE IF NOT EXISTS doctors (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  name                     TEXT    NOT NULL,
  department_id            INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  specialization           TEXT,
  qualification            TEXT,
  experience_years         INTEGER DEFAULT 5,
  avg_consultation_minutes INTEGER DEFAULT 10,
  status                   TEXT    NOT NULL DEFAULT 'available', -- available|busy|in_consultation|break|offline|emergency
  room                     TEXT,
  capacity                 INTEGER NOT NULL DEFAULT 0,           -- 0 = no fixed operational limit
  active                   INTEGER NOT NULL DEFAULT 1,
  created_at               TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS patients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_no TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  phone      TEXT,
  age        INTEGER,
  gender     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Notification events. Providers (SMS/WhatsApp/Web) are pluggable; the row
-- records the event and its delivery state. idempotency_key UNIQUE prevents
-- duplicate sends for the same event.
CREATE TABLE IF NOT EXISTS notifications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id         INTEGER REFERENCES tokens(id) ON DELETE CASCADE,
  patient_id       INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  event            TEXT    NOT NULL,                   -- token_created|doctor_assigned|approaching|called|recalled|doctor_changed|queue_delayed|completed|no_show|priority_changed
  channel          TEXT    NOT NULL DEFAULT 'web',     -- sms|whatsapp|web
  recipient        TEXT,
  message          TEXT,
  status           TEXT    NOT NULL DEFAULT 'PENDING', -- PENDING|SENT|DELIVERED|FAILED|RETRYING|SKIPPED
  provider         TEXT,
  provider_response TEXT,
  idempotency_key  TEXT    UNIQUE,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  sent_at          TEXT,
  failed_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_token ON notifications(token_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER,
  actor_name  TEXT,
  action      TEXT    NOT NULL, -- TOKEN_CREATED|DOCTOR_ASSIGNED|DOCTOR_CHANGED|PATIENT_CALLED|PATIENT_RECALLED|PATIENT_SKIPPED|PATIENT_NO_SHOW|PRIORITY_CHANGED|QUEUE_REASSIGNED|DOCTOR_STATUS_CHANGED|PATIENT_COMPLETED|PATIENT_CANCELLED|NOTIFICATION_SENT
  target_type TEXT,
  target_id   INTEGER,
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export function migrate() {
  db.exec(SCHEMA);
  // Idempotent migration for databases created before these columns existed.
  ensureColumn('reviews', 'is_demo', 'is_demo INTEGER NOT NULL DEFAULT 0');
  ensureColumn('reviews', 'category', 'category TEXT');
  ensureColumn('reviews', 'request', 'request TEXT');
  ensureColumn('reviews', 'owner_key_hash', 'owner_key_hash TEXT');

  // Staff Control Center extensions on existing tables (idempotent).
  ensureColumn('users', 'phone', 'phone TEXT');
  ensureColumn('users', 'is_demo', 'is_demo INTEGER NOT NULL DEFAULT 0');
  ensureColumn('users', 'disabled', 'disabled INTEGER NOT NULL DEFAULT 0');

  ensureColumn('doctors', 'qualification', 'qualification TEXT');
  ensureColumn('doctors', 'experience_years', 'experience_years INTEGER DEFAULT 5');
  ensureColumn('doctors', 'avg_consultation_minutes', 'avg_consultation_minutes INTEGER DEFAULT 10');

  ensureColumn('tokens', 'patient_id', 'patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL');
  ensureColumn('tokens', 'doctor_id', 'doctor_id INTEGER REFERENCES doctors(id) ON DELETE SET NULL');
  ensureColumn('tokens', 'priority', "priority TEXT NOT NULL DEFAULT 'NORMAL'"); // NORMAL|APPOINTMENT|URGENT|EMERGENCY
  ensureColumn('tokens', 'whatsapp_opt_in', 'whatsapp_opt_in INTEGER NOT NULL DEFAULT 0');
  ensureColumn('tokens', 'whatsapp_opt_in_at', 'whatsapp_opt_in_at TEXT');
  ensureColumn('tokens', 'priority_reason', 'priority_reason TEXT');
  ensureColumn('tokens', 'called_count', 'called_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn('tokens', 'preferred_doctor_id', 'preferred_doctor_id INTEGER REFERENCES doctors(id) ON DELETE SET NULL');

  // Staff-assigned wait/service estimates (single, consistent representation).
  ensureColumn('tokens', 'estimated_wait_minutes', 'estimated_wait_minutes INTEGER');
  ensureColumn('tokens', 'estimated_service_time', 'estimated_service_time TEXT');
  ensureColumn('tokens', 'estimate_updated_at', 'estimate_updated_at TEXT');
  ensureColumn('tokens', 'estimate_updated_by', 'estimate_updated_by TEXT');

  // Optional per-staff department scope (NULL = can manage all, preserves current
  // behavior). Backend uses this to reject updates to other departments.
  ensureColumn('users', 'department_id', 'department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL');

  // Unique index for phone-based lookup (separate from the column ALTER, since
  // SQLite does not allow adding a UNIQUE constraint directly via ALTER).
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone)');
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}
export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}
export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
export function lastInsertId() {
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}
export function inTx(fn) {
  db.exec('BEGIN');
  try {
    const res = fn();
    db.exec('COMMIT');
    return res;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}