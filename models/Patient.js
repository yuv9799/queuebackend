import { all, get, run, lastInsertId } from '../config/db.js';

let seq = 0;
function nextPatientNo() {
  seq += 1;
  return `P${String(Date.now() % 1000000).padStart(6, '0')}${seq}`;
}

export function findById(id) {
  return get('SELECT * FROM patients WHERE id = ?', id);
}

export function findByPhone(phone) {
  return get('SELECT * FROM patients WHERE phone = ? ORDER BY id DESC LIMIT 1', phone);
}

// Simple LIKE-based search across the public fields staff are allowed to see.
export function search(q) {
  if (!q || !String(q).trim()) return [];
  const like = `%${String(q).trim()}%`;
  return all(
    `SELECT * FROM patients
     WHERE name LIKE ? OR patient_no LIKE ? OR phone LIKE ?
     ORDER BY created_at DESC LIMIT 50`,
    like, like, like
  );
}

export function create({ name, phone = null, age = null, gender = null }) {
  if (!name) throw new Error('name is required');
  const patientNo = nextPatientNo();
  run(
    'INSERT INTO patients (patient_no, name, phone, age, gender) VALUES (?, ?, ?, ?, ?)',
    patientNo, name, phone, age, gender
  );
  return findById(lastInsertId());
}

// Find an existing patient by phone, otherwise register a new one (idempotent).
export function findOrCreate({ name, phone = null, age = null, gender = null }) {
  if (phone) {
    const existing = findByPhone(phone);
    if (existing) return existing;
  }
  return create({ name, phone, age, gender });
}