import { run, get, all } from '../config/db.js';
import { DOCTORS_DATA } from './doctors.data.js';

const PATIENTS = [
  ['Anita Mohanty', '+919800010001', 34, 'F'],
  ['Rakesh Patnaik', '+919800010002', 45, 'M'],
  ['Sneha Das', '+919800010003', 28, 'F'],
  ['Bibhu Rout', '+919800010004', 52, 'M'],
  ['Priya Sahoo', '+919800010005', 39, 'F'],
  ['Deepa Nanda', '+919800010006', 41, 'F'],
  ['Sourav Jena', '+919800010007', 31, 'M'],
  ['Mamta Panda', '+919800010008', 29, 'F'],
  ['Gopal Swain', '+919800010009', 58, 'M'],
  ['Rina Mishra', '+919800010010', 36, 'F'],
  ['Kunal Barik', '+919800010011', 48, 'M'],
  ['Lipi Senapati', '+919800010012', 26, 'F'],
  ['Nikhil Tripathy', '+919800010013', 35, 'M'],
  ['Suchitra Kar', '+919800010014', 44, 'F'],
  ['Arun Behera', '+919800010015', 50, 'M'],
];

export default function seedStaff() {
  // Demo staff phone numbers + demo flags.
  run("UPDATE users SET phone = '+91 9000000001', is_demo = 1 WHERE email = 'admin@kims.in'");
  run("UPDATE users SET phone = '+91 9000000002', is_demo = 1 WHERE email = 'officer@kims.in'");
  run("UPDATE users SET phone = '+91 9000000003', is_demo = 1 WHERE email = 'reception@kims.in'");

  // Insert all 120+ realistic doctors
  for (const d of DOCTORS_DATA) {
    const dept = get('SELECT id FROM departments WHERE code = ?', d.dept);
    run(
      `INSERT INTO doctors (
         name, department_id, specialization, qualification,
         experience_years, avg_consultation_minutes, status, room, capacity, active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      d.name,
      dept ? dept.id : null,
      d.spec,
      d.qual || 'MBBS',
      d.exp || 5,
      d.avgTime || 10,
      d.status || 'available',
      d.room,
      d.capacity || 20
    );
  }

  // Insert realistic patient records
  for (const [name, phone, age, gender] of PATIENTS) {
    run(
      'INSERT INTO patients (patient_no, name, phone, age, gender) VALUES (?, ?, ?, ?, ?)',
      `PAT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name,
      phone,
      age,
      gender
    );
  }

  // Assign queued and active tokens to doctors in their department
  const allTokens = all('SELECT id, department_id, status FROM tokens');
  for (const t of allTokens) {
    const dr = get(
      'SELECT id FROM doctors WHERE department_id = ? AND active = 1 ORDER BY RANDOM() LIMIT 1',
      t.department_id
    );
    if (dr) {
      run('UPDATE tokens SET doctor_id = ? WHERE id = ?', dr.id, t.id);
    }
  }

  // Set realistic priorities and reasons for some tokens
  const queuedTokens = all('SELECT id FROM tokens WHERE status = ?', 'queued');
  for (const t of queuedTokens) {
    const prio = ['NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'APPOINTMENT', 'URGENT'][
      Math.floor(Math.random() * 6)
    ];
    const reason = prio === 'URGENT' ? 'Senior citizen priority / acute discomfort' : null;
    run('UPDATE tokens SET priority = ?, priority_reason = ? WHERE id = ?', prio, reason, t.id);
  }

  // A couple demo audit rows
  run(
    'INSERT INTO audit_logs (actor_name, action, target_type, new_value, reason) VALUES (?,?,?,?,?)',
    'Counter Officer',
    'DOCTOR_ASSIGNED',
    'token',
    'Initial Batch',
    'System startup queue distribution'
  );
}