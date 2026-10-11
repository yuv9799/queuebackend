import { db, migrate, run, get } from '../config/db.js';
import seedStaff from './staff.seed.js';
import seedReviews from './reviews.seed.js';
import * as User from '../models/User.js';

// Reset all data for a clean seed.
function reset() {
  run('DELETE FROM reviews');
  run('DELETE FROM sos_requests');
  run('DELETE FROM help_points');
  run('DELETE FROM tokens');
  run('DELETE FROM token_seq');
  run('DELETE FROM counters');
  run('DELETE FROM areas');
  run('DELETE FROM departments');
  run('DELETE FROM users');
  run('DELETE FROM audit_logs');
  run('DELETE FROM notifications');
  run('DELETE FROM patients');
  run('DELETE FROM doctors');
  run("DELETE FROM sqlite_sequence WHERE name IN ('tokens','token_seq','counters','areas','departments','users','reviews','help_points','sos_requests')");
}

// Departments with per-department service areas.
const DEPARTMENTS = [
  { code: 'GM', name: 'General Medicine', color: '#2563eb' },
  { code: 'CARD', name: 'Cardiology', color: '#dc2626' },
  { code: 'DERM', name: 'Dermatology', color: '#db2777' },
  { code: 'PEDS', name: 'Pediatrics', color: '#f59e0b' },
  { code: 'ORTHO', name: 'Orthopedics', color: '#0f766e' },
  { code: 'NEURO', name: 'Neurology', color: '#7c3aed' },
  { code: 'ENT', name: 'ENT', color: '#0891b2' },
  { code: 'OPHT', name: 'Ophthalmology', color: '#4f46e5' },
  { code: 'DENT', name: 'Dentistry', color: '#0284c7' },
  { code: 'GYN', name: 'Gynecology & Obstetrics', color: '#e11d48' },
  { code: 'PSYCH', name: 'Psychiatry', color: '#9333ea' },
  { code: 'GASTRO', name: 'Gastroenterology', color: '#ea580c' },
  { code: 'UROL', name: 'Urology', color: '#059669' },
  { code: 'PULM', name: 'Pulmonology', color: '#0284c7' },
  { code: 'ENDO', name: 'Endocrinology', color: '#d97706' },
  { code: 'ONCO', name: 'Oncology', color: '#be123c' },
  { code: 'SURG', name: 'General Surgery', color: '#4338ca' },
  { code: 'RAD', name: 'Radiology', color: '#ea580c' },
  { code: 'PATH', name: 'Pathology', color: '#9333ea' },
  { code: 'PHARM', name: 'Pharmacy', color: '#16a34a' },
  { code: 'EMER', name: 'Emergency', color: '#e11d48' },
  { code: 'BILL', name: 'Billing', color: '#0e7490' },
  { code: 'OPD', name: 'OP Registration', color: '#1d4ed8' },
];

const AREAS = [
  { code: 'GM-OPD', dept: 'GM', name: 'Outpatient Consultation', floor: 'Ground Floor' },
  { code: 'GM-FUP', dept: 'GM', name: 'OPD Follow-up', floor: 'Ground Floor' },
  { code: 'CARD-OPD', dept: 'CARD', name: 'OPD Consultation', floor: '2nd Floor' },
  { code: 'CARD-ECG', dept: 'CARD', name: 'ECG & Diagnostics', floor: '2nd Floor' },
  { code: 'DERM-OPD', dept: 'DERM', name: 'OPD Consultation', floor: '1st Floor' },
  { code: 'DERM-PROC', dept: 'DERM', name: 'Dermatology Procedures', floor: '1st Floor' },
  { code: 'PEDS-OPD', dept: 'PEDS', name: 'OPD Consultation', floor: '2nd Floor' },
  { code: 'PEDS-IMM', dept: 'PEDS', name: 'Immunization Clinic', floor: '2nd Floor' },
  { code: 'ORTHO-OPD', dept: 'ORTHO', name: 'OPD Consultation', floor: '3rd Floor' },
  { code: 'ORTHO-FX', dept: 'ORTHO', name: 'Fracture Clinic', floor: '3rd Floor' },
  { code: 'NEURO-OPD', dept: 'NEURO', name: 'OPD Consultation', floor: '3rd Floor' },
  { code: 'ENT-OPD', dept: 'ENT', name: 'OPD Consultation', floor: '1st Floor' },
  { code: 'OPHT-OPD', dept: 'OPHT', name: 'OPD Consultation', floor: '1st Floor' },
  { code: 'DENT-OPD', dept: 'DENT', name: 'Dental Clinic', floor: '1st Floor' },
  { code: 'GYN-OPD', dept: 'GYN', name: 'OPD Consultation', floor: '2nd Floor' },
  { code: 'PSYCH-OPD', dept: 'PSYCH', name: 'Psychiatry Clinic', floor: '3rd Floor' },
  { code: 'GASTRO-OPD', dept: 'GASTRO', name: 'OPD Consultation', floor: '3rd Floor' },
  { code: 'UROL-OPD', dept: 'UROL', name: 'Urology Consultation', floor: '3rd Floor' },
  { code: 'PULM-OPD', dept: 'PULM', name: 'Pulmonology Consultation', floor: '3rd Floor' },
  { code: 'ENDO-OPD', dept: 'ENDO', name: 'Endocrinology Clinic', floor: '3rd Floor' },
  { code: 'ONCO-OPD', dept: 'ONCO', name: 'Oncology OPD', floor: '3rd Floor' },
  { code: 'SURG-OPD', dept: 'SURG', name: 'Surgical Consultation', floor: '3rd Floor' },
  { code: 'RAD-XRAY', dept: 'RAD', name: 'X-Ray', floor: 'Ground Floor' },
  { code: 'RAD-CT', dept: 'RAD', name: 'CT & MRI Scan', floor: 'Ground Floor' },
  { code: 'PATH-SAMP', dept: 'PATH', name: 'Sample Collection', floor: 'Basement' },
  { code: 'PHARM-OP', dept: 'PHARM', name: 'Outpatient Pharmacy', floor: '1st Floor' },
  { code: 'EMER-TRI', dept: 'EMER', name: 'Emergency Triage', floor: 'Ground Floor' },
  { code: 'BILL-COUNTER', dept: 'BILL', name: 'Billing Counter', floor: 'Ground Floor' },
  { code: 'OPD-REG', dept: 'OPD', name: 'New Registration', floor: 'Ground Floor' },
];

const COUNTERS = {
  'GM-OPD': ['Counter 01', 'Counter 02', 'Counter 03'],
  'GM-FUP': ['Counter 01'],
  'CARD-OPD': ['Consult Room 1', 'Consult Room 2'],
  'CARD-ECG': ['ECG Room'],
  'DERM-OPD': ['Room 1', 'Room 2'],
  'DERM-PROC': ['Procedures'],
  'PEDS-OPD': ['Room 1', 'Room 2'],
  'PEDS-IMM': ['Immunization Room'],
  'ORTHO-OPD': ['Room 1', 'Room 2'],
  'ORTHO-FX': ['Plaster Room'],
  'NEURO-OPD': ['Room 1', 'Room 2'],
  'ENT-OPD': ['Room 1', 'Room 2'],
  'OPHT-OPD': ['Room 1', 'Vision Testing'],
  'DENT-OPD': ['Chair 1', 'Chair 2', 'Chair 3'],
  'GYN-OPD': ['Room 1', 'Room 2'],
  'PSYCH-OPD': ['Consultation 1', 'Consultation 2'],
  'GASTRO-OPD': ['Room 1', 'Room 2'],
  'UROL-OPD': ['Room 1', 'Room 2'],
  'PULM-OPD': ['Room 1', 'PFT Room'],
  'ENDO-OPD': ['Room 1', 'Diabetic Desk'],
  'ONCO-OPD': ['Room 1', 'Daycare 1'],
  'SURG-OPD': ['Room 1', 'Minor OT'],
  'RAD-XRAY': ['X-Ray Room'],
  'RAD-CT': ['CT Room 1'],
  'PATH-SAMP': ['Samp Desk 1', 'Samp Desk 2'],
  'PHARM-OP': ['Window 1', 'Window 2'],
  'EMER-TRI': ['Triage Desk'],
  'BILL-COUNTER': ['Cash 1', 'Cash 2'],
  'OPD-REG': ['Window 1', 'Window 2'],
};

const STATUSES = ['queued', 'queued', 'queued', 'completed', 'completed', 'completed', 'called', 'in_consultation', 'held', 'skipped'];

function seed() {
  migrate();
  reset();

  // Emergency help points inside the KIMS campus
  const HELP = [
    { name: 'Emergency / Trauma Department', type: 'emergency', floor: 'Ground Floor · Main Entrance Right', lat: 20.3534, lng: 85.8154 },
    { name: 'Emergency Triage Desk', type: 'triage', floor: 'Emergency Wing · Ground Floor', lat: 20.3536, lng: 85.8156 },
    { name: 'Emergency Reception', type: 'emergency', floor: 'Emergency Wing · Ground Floor', lat: 20.3533, lng: 85.8158 },
    { name: 'Main Help Desk', type: 'help', floor: 'Main Entrance · Ground Floor', lat: 20.3532, lng: 85.8152 },
    { name: 'Security Desk', type: 'security', floor: 'Main Entrance', lat: 20.3538, lng: 85.8150 },
    { name: 'Ambulance Entry', type: 'ambulance', floor: 'Emergency Wing · East', lat: 20.3531, lng: 85.8155 },
  ];
  for (const h of HELP) {
    run('INSERT INTO help_points (name, type, floor, latitude, longitude, enabled) VALUES (?, ?, ?, ?, ?, 1)', h.name, h.type, h.floor, h.lat, h.lng);
  }

  const deptIds = {};
  for (const d of DEPARTMENTS) {
    run('INSERT INTO departments (name, code, color, enabled) VALUES (?, ?, ?, 1)', d.name, d.code, d.color);
    deptIds[d.code] = get('SELECT id FROM departments WHERE code = ?', d.code).id;
  }

  const areaIds = {};
  for (const a of AREAS) {
    run('INSERT INTO areas (department_id, name, code, floor, enabled) VALUES (?, ?, ?, ?, 1)', deptIds[a.dept], a.name, a.code, a.floor);
    areaIds[a.code] = get('SELECT id FROM areas WHERE code = ?', a.code).id;
  }

  const counterIds = {};
  for (const [areaCode, names] of Object.entries(COUNTERS)) {
    if (!areaIds[areaCode]) continue;
    for (const name of names) {
      run('INSERT INTO counters (area_id, name, enabled) VALUES (?, ?, 1)', areaIds[areaCode], name);
      const c = get('SELECT id FROM counters WHERE area_id = ? AND name = ?', areaIds[areaCode], name);
      counterIds[`${areaCode}:${name}`] = c.id;
    }
  }

  // Admin + officer + reception users.
  User.create({ name: 'Admin KIMS', email: 'admin@kims.in', password: 'admin123', role: 'admin' });
  User.create({ name: 'Counter Officer', email: 'officer@kims.in', password: 'officer123', role: 'officer' });
  User.create({ name: 'Reception Staff', email: 'reception@kims.in', password: 'reception123', role: 'reception' });

  // Seed staff and doctors first so tokens can link to doctors
  seedStaff();

  // Seed tokens on a representative subset of areas
  const seedAreas = AREAS.slice(0, 16);
  const patients = ['Anita Mohanty', 'Rakesh Patnaik', 'Sneha Das', 'Bibhu Rout', 'Priya Sahoo', 'Arun Behera', 'Deepa Nanda', 'Sourav Jena', 'Mamta Panda', 'Gopal Swain', 'Rina Mishra', 'Kunal Barik', 'Lipi Senapati', 'Nikhil Tripathy', 'Suchitra Kar'];
  let pi = 0;
  const now = Date.now();

  seedAreas.forEach((areaDef, ai) => {
    const areaId = areaIds[areaDef.code];
    const count = 3 + (ai % 4); // between 3 and 6 tokens per area
    for (let i = 0; i < count; i++) {
      const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];
      const createdAt = new Date(now - Math.floor(Math.random() * 3600) * 1000);
      const createdStr = createdAt.toISOString().replace('T', ' ').slice(0, 19);
      let calledAt = null;
      let completedAt = null;
      let waitTime = null;
      if (status === 'called' || status === 'in_consultation') {
        calledAt = new Date(createdAt.getTime() + 120000).toISOString().replace('T', ' ').slice(0, 19);
      } else if (status === 'completed') {
        calledAt = new Date(createdAt.getTime() + 120000).toISOString().replace('T', ' ').slice(0, 19);
        completedAt = new Date(createdAt.getTime() + 420000).toISOString().replace('T', ' ').slice(0, 19);
        waitTime = 300;
      }
      const patient = patients[pi % patients.length];
      pi++;

      const dr = get('SELECT id FROM doctors WHERE department_id = ? ORDER BY RANDOM() LIMIT 1', deptIds[areaDef.dept]);

      run(
        `INSERT INTO tokens
           (token_number, queue_seq, department_id, area_id, doctor_id, patient_name, status, serving, created_at, called_at, completed_at, wait_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        i + 1,
        i + 1,
        deptIds[areaDef.dept],
        areaId,
        dr ? dr.id : null,
        patient,
        status,
        status === 'called' || status === 'in_consultation' ? 1 : 0,
        createdStr,
        calledAt,
        completedAt,
        waitTime
      );
    }
  });

  seedReviews();

  // Set token_seq last_number per department to match seeded counts.
  for (const d of DEPARTMENTS) {
    const maxNum = get('SELECT COALESCE(MAX(token_number),0) AS m FROM tokens WHERE department_id = ?', deptIds[d.code])?.m || 0;
    run('INSERT INTO token_seq (department_id, last_number) VALUES (?, ?) ON CONFLICT(department_id) DO UPDATE SET last_number = excluded.last_number', deptIds[d.code], maxNum);
  }

  console.log('Seed complete.');
  console.log(`  Departments: ${DEPARTMENTS.length}`);
  console.log(`  Doctors: ${get('SELECT COUNT(*) AS n FROM doctors').n}`);
  console.log(`  Areas: ${AREAS.length}`);
  console.log(`  Counters: ${get('SELECT COUNT(*) AS n FROM counters').n}`);
  console.log(`  Tokens: ${get('SELECT COUNT(*) AS n FROM tokens').n}`);
  console.log(`  Reviews: ${get('SELECT COUNT(*) AS n FROM reviews').n}`);
  console.log(`  Help Points: ${get('SELECT COUNT(*) AS n FROM help_points').n}`);
  console.log(`  Users: admin@kims.in / admin123, officer@kims.in / officer123, reception@kims.in / reception123`);
}

seed();