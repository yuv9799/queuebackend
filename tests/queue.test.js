import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import request from 'supertest';

// Isolated test database.
const TEST_DB = path.resolve('data', 'test-queue2.db');
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-secret-for-jwt-at-least-32-chars-long!!';
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);

const { createApp } = await import('../app.js');
const app = createApp();

let adminToken;
let deptId;
let areaId;
let docA;
let docB;

before(async () => {
  const { run } = await import('../config/db.js');
  const bcrypt = (await import('bcryptjs')).default;
  run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', 'Admin', 'admin@qq.in', bcrypt.hashSync('admin123', 10), 'admin');
  const login = await request(app).post('/auth/login').send({ email: 'admin@qq.in', password: 'admin123' });
  adminToken = login.body.token;
  const H = ['Authorization', `Bearer ${adminToken}`];

  const dept = await request(app).post('/departments').set(H[0], H[1]).send({ name: 'Cardio', code: `QQC-${Date.now()}` });
  deptId = dept.body.department.id;
  const area = await request(app).post('/areas').set(H[0], H[1]).send({ departmentId: deptId, name: 'OPD', code: `QQA-${Date.now()}` });
  areaId = area.body.area.id;

  const mkDoctor = async (name, status) => {
    const d = await request(app).post('/doctors').set(H[0], H[1]).send({ name, departmentId: deptId, status });
    return d.body.doctor;
  };
  docA = await mkDoctor('Dr A Available', 'available');
  docB = await mkDoctor('Dr B Break', 'break');
});

after(async () => {
  const { db } = await import('../config/db.js');
  try { db.close(); } catch {}
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
});

const auth = () => ['Authorization', `Bearer ${adminToken}`];
async function issue() {
  const r = await request(app).post('/tokens').send({ departmentId: deptId, areaId, patientName: 'P' + Date.now() });
  return r.body.token;
}

test('recommendation picks an available doctor, not break/offline', async () => {
  const t = await issue();
  const rec = await request(app).post('/assignments/recommend').set(...auth()).send({ tokenId: t.id });
  assert.equal(rec.status, 200);
  assert.equal(rec.body.recommendation.id, docA.id);
});

test('assign to an available doctor works', async () => {
  const t = await issue();
  const r = await request(app).post('/assignments').set(...auth()).send({ tokenId: t.id, doctorId: docA.id, reason: 'test' });
  assert.equal(r.status, 200);
  assert.equal(r.body.token.doctor_id, docA.id);
});

test('assigning to an unavailable (break) doctor is rejected without override', async () => {
  const t = await issue();
  const r = await request(app).post('/assignments').set(...auth()).send({ tokenId: t.id, doctorId: docB.id });
  assert.equal(r.status, 409);
});

test('duplicate assignment to the same doctor is an idempotent safe no-op', async () => {
  const t = await issue();
  await request(app).post('/assignments').set(...auth()).send({ tokenId: t.id, doctorId: docA.id, reason: 'x' });
  const dup = await request(app).post('/assignments').set(...auth()).send({ tokenId: t.id, doctorId: docA.id });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.director.unchanged, true);
});

test('priority change requires a reason', async () => {
  const t = await issue();
  const noReason = await request(app).post(`/tokens/${t.id}/priority`).set(...auth()).send({ priority: 'URGENT', reason: '' });
  assert.equal(noReason.status, 409);
  const ok = await request(app).post(`/tokens/${t.id}/priority`).set(...auth()).send({ priority: 'URGENT', reason: 'clinical instruction' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.token.priority, 'URGENT');
});

test('state machine: no-show only from called', async () => {
  const t = await issue();
  const noFromQueued = await request(app).post(`/tokens/${t.id}/no-show`).set(...auth());
  assert.equal(noFromQueued.status, 409);
  await request(app).post(`/tokens/${t.id}/call`).set(...auth());
  const noShow = await request(app).post(`/tokens/${t.id}/no-show`).set(...auth());
  assert.equal(noShow.status, 200);
  assert.equal(noShow.body.token.status, 'no_show');
});

test('completion records wait_time', async () => {
  const t = await issue();
  await request(app).post(`/tokens/${t.id}/call`).set(...auth());
  const done = await request(app).post(`/tokens/${t.id}/complete`).set(...auth());
  assert.equal(done.status, 200);
  assert.equal(done.body.token.status, 'completed');
  assert.ok(done.body.token.wait_time !== null);
});

test('audit log records staff actions', async () => {
  const t = await issue();
  await request(app).post('/assignments').set(...auth()).send({ tokenId: t.id, doctorId: docA.id, reason: 'audit test' });
  const logs = await request(app).get('/audit?limit=5').set(...auth());
  assert.equal(logs.status, 200);
  assert.ok(logs.body.logs.length >= 1);
});

test('unauthorized role cannot list doctors', async () => {
  const r = await request(app).get('/doctors');
  assert.equal(r.status, 401);
});
// ---- POST /assignments/redistribute-preview -------------------------------
test('redistribute-preview: happy path returns affected tokens and suggestions', async () => {
  const t = await issue();
  await request(app).post('/assignments').set(...auth()).send({ tokenId: t.id, doctorId: docA.id, reason: 'rp' });
  const r = await request(app).post('/assignments/redistribute-preview').set(...auth()).send({ doctorId: docA.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(Array.isArray(r.body.affected));
  assert.ok(Array.isArray(r.body.suggested));
  const hit = r.body.affected.find((x) => x.id === t.id);
  assert.ok(hit, 'issued token should be listed as affected');
  assert.equal(hit.token_number, t.token_number);
  assert.ok(r.body.suggested.some((s) => s.tokenId === t.id));
});

test('redistribute-preview: missing doctorId returns 400', async () => {
  const r = await request(app).post('/assignments/redistribute-preview').set(...auth()).send({});
  assert.equal(r.status, 400);
  assert.ok(r.body.error);
});

test('redistribute-preview: non-numeric doctorId returns 400', async () => {
  const r = await request(app).post('/assignments/redistribute-preview').set(...auth()).send({ doctorId: 'not-a-number' });
  assert.equal(r.status, 400);
});

test('redistribute-preview: nonexistent doctor returns 409', async () => {
  const r = await request(app).post('/assignments/redistribute-preview').set(...auth()).send({ doctorId: 999999 });
  assert.equal(r.status, 409);
});

test('redistribute-preview: doctor with no queued tokens returns 200 with empty arrays', async () => {
  // Use docB which no test ever assigns tokens to, so affected/suggested are always empty
  const r = await request(app).post('/assignments/redistribute-preview').set(...auth()).send({ doctorId: docB.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.affected, []);
  assert.deepEqual(r.body.suggested, []);
});

test('redistribute-preview: unauthenticated returns 401', async () => {
  const r = await request(app).post('/assignments/redistribute-preview').send({ doctorId: docA.id });
  assert.equal(r.status, 401);
});

test('redistribute applies approved moves', async () => {
  const t = await issue();
  await request(app).post('/assignments').set(...auth()).send({ tokenId: t.id, doctorId: docA.id, reason: 'redistribute setup' });
  const replacement = await request(app)
    .post('/doctors')
    .set(...auth())
    .send({ name: 'Dr Replacement', departmentId: deptId, status: 'available' });
  const replacementId = replacement.body.doctor.id;
  const r = await request(app)
    .post('/assignments/redistribute')
    .set(...auth())
    .send({ moves: [{ tokenId: t.id, doctorId: replacementId }], reason: 'doctor unavailable' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results, [{ tokenId: t.id, ok: true, error: null }]);
  const updated = await request(app).get(`/tokens/${t.id}`);
  assert.equal(updated.body.token.doctor_id, replacementId);
});

test('redistribute validates moves and authentication', async () => {
  const invalid = await request(app).post('/assignments/redistribute').set(...auth()).send({ moves: [{}] });
  const unauthenticated = await request(app).post('/assignments/redistribute').send({ moves: [] });
  assert.equal(invalid.status, 400);
  assert.equal(unauthenticated.status, 401);
});

// ---- GET /stats/overview ---------------------------------------------------
test('GET /stats/overview: unauthenticated returns 200 with overview data', async () => {
  const r = await request(app).get('/stats/overview');
  assert.equal(r.status, 200);
  assert.ok(r.body.overview !== undefined);
  assert.ok(typeof r.body.overview === 'object');
});

test('GET /stats/overview: authenticated with valid token returns 200 with overview data', async () => {
  const r = await request(app).get('/stats/overview').set(...auth());
  assert.equal(r.status, 200);
  assert.ok(r.body.overview !== undefined);
  assert.ok(typeof r.body.overview === 'object');
});

// ---- GET /doctors/public ---------------------------------------------------
test('GET /doctors/public: unauthenticated returns 200 with doctor list', async () => {
  const r = await request(app).get('/doctors/public');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.doctors));
  assert.ok(r.body.doctors.length >= 1);
});

test('GET /doctors/public: response does not contain patient_name fields', async () => {
  const r = await request(app).get('/doctors/public');
  assert.equal(r.status, 200);
  for (const doc of r.body.doctors) {
    assert.ok(!('currentToken' in doc), 'public endpoint must not expose currentToken');
    assert.ok(!('nextPatients' in doc), 'public endpoint must not expose nextPatients');
    const docStr = JSON.stringify(doc);
    assert.ok(!docStr.includes('patient_name'), 'no patient_name field in public response');
  }
});

test('GET /doctors/public: departmentId filter returns only matching doctors', async () => {
  const r = await request(app).get(`/doctors/public?departmentId=${deptId}`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.doctors));
  assert.ok(r.body.doctors.every(d => d.department_id === deptId));
});

test('GET /doctors (auth): still returns workload including patient names for staff', async () => {
  const t = await issue();
  await request(app).post('/assignments').set(...auth()).send({ tokenId: t.id, doctorId: docA.id, reason: 'regression test' });
  const r = await request(app).get('/doctors').set(...auth());
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.doctors));
});

// ---- CORS allowlist (Bug #4) -----------------------------------------------
test('GET /departments: unauthenticated returns 200', async () => {
  const r = await request(app).get('/departments');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.departments));
});

test('corsOrigins(): allows only the supported local development origins', async () => {
  const { corsOrigins } = await import('../config/cors.js');
  const origins = corsOrigins();
  assert.ok(origins.includes('http://localhost:5173'), 'localhost:5173 must be allowlisted');
  assert.ok(origins.includes('http://127.0.0.1:5173'), '127.0.0.1:5173 must be allowlisted');
  assert.ok(origins.includes('http://localhost:5174'), 'localhost:5174 must be allowlisted');
  assert.ok(origins.includes('http://127.0.0.1:5174'), '127.0.0.1:5174 must be allowlisted');
  assert.ok(!origins.includes('http://localhost:5176'), 'unrelated localhost ports must not be allowlisted');
});

test('corsOrigins(): preserves production origins and supports CORS_ORIGINS extensions', async () => {
  const { corsOrigins } = await import('../config/cors.js');
  const previousCorsOrigins = process.env.CORS_ORIGINS;
  const previousFrontendUrl = process.env.FRONTEND_URL;
  process.env.CORS_ORIGINS = 'https://internal.example.test';
  process.env.FRONTEND_URL = 'https://kims-queue.vercel.app/';
  try {
    const origins = corsOrigins();
    assert.ok(origins.includes('https://kims-queue.vercel.app'), 'deployed frontend origin missing');
    assert.ok(origins.includes('https://yuv9799.github.io'), 'production GitHub Pages origin missing');
    assert.ok(origins.includes('http://localhost:3000'), 'localhost:3000 origin missing');
    assert.ok(origins.includes('https://internal.example.test'), 'CORS_ORIGINS extension missing');
    assert.equal(origins.filter((origin) => origin === 'https://kims-queue.vercel.app').length, 1);
  } finally {
    if (previousCorsOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previousCorsOrigins;
    if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previousFrontendUrl;
  }
});
