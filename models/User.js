import { get, all, run, inTx, lastInsertId } from '../config/db.js';
import bcrypt from 'bcryptjs';

// Returns user row without the password hash.
export const PUBLIC_FIELDS = 'id, name, email, phone, role, is_demo, created_at';

export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export function findByEmail(email) {
  return get(`SELECT ${PUBLIC_FIELDS}, password_hash FROM users WHERE email = ?`, email);
}

export function findByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return all(`SELECT ${PUBLIC_FIELDS}, password_hash FROM users WHERE phone IS NOT NULL`)
    .find((user) => normalizePhone(user.phone) === normalized) || null;
}

export function findById(id) {
  return get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`, id);
}

export function list() {
  return all(`SELECT ${PUBLIC_FIELDS} FROM users ORDER BY id`);
}

export function create({ name, email, password, role = 'officer', phone = null, isDemo = 0 }) {
  const hash = password ? bcrypt.hashSync(password, 10) : null;
  run(
    'INSERT INTO users (name, email, password_hash, role, phone, is_demo) VALUES (?, ?, ?, ?, ?, ?)',
    name,
    (email || '').toLowerCase().trim(),
    hash,
    role,
    phone,
    isDemo ? 1 : 0
  );
  return findById(lastInsertId());
}

export function setDisabled(id, disabled) {
  run('UPDATE users SET disabled = ? WHERE id = ?', disabled ? 1 : 0, id);
  return findById(id);
}

export function setPhone(id, phone) {
  run('UPDATE users SET phone = ? WHERE id = ?', phone, id);
  return findById(id);
}

export function remove(id) {
  return inTx(() => {
    const user = findById(id);
    if (!user) return null;
    run('UPDATE reviews SET user_id = NULL WHERE user_id = ?', id);
    run('UPDATE sos_requests SET user_id = NULL WHERE user_id = ?', id);
    run('DELETE FROM users WHERE id = ?', id);
    return user;
  });
}

export function verifyPassword(user, password) {
  return user.password_hash ? bcrypt.compareSync(password, user.password_hash) : false;
}