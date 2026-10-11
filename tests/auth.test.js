import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { corsOptions } from '../config/cors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Isolated test database.
const TEST_DB = path.resolve('data', 'test-auth.db');
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-secret-for-jwt-at-least-32-chars-long!!';
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);

const { createApp } = await import('../app.js');
const app = createApp();

let adminToken;
before(async () => {
  const { run } = await import('../config/db.js');
  const bcrypt = (await import('bcryptjs')).default;
  run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    'Admin', 'admin@test-auth.in', bcrypt.hashSync('admin123', 10), 'admin');
  const login = await request(app).post('/auth/login').send({ email: 'admin@test-auth.in', password: 'admin123' });
  adminToken = login.body.token;
});
after(async () => {
  const { db } = await import('../config/db.js');
  try { db.close(); } catch {}
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) if (fs.existsSync(f)) fs.rmSync(f);
});
const auth = () => ['Authorization', `Bearer ${adminToken}`];

// Test that the auth module throws when JWT_SECRET is absent or too short.
// We test this in a subprocess so the current test process already has a valid JWT_SECRET.
function runAuthSubprocess(envExtra) {
  return new Promise((resolve) => {
    // If JWT_SECRET is not being explicitly set by the test, remove it
    // from the inherited env so we can test the "absent" case.
    const env = { ...process.env };
    if (!('JWT_SECRET' in envExtra)) {
      delete env.JWT_SECRET;
    }
    Object.assign(env, envExtra);
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'middleware', 'auth.js')], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

test('auth.js throws when JWT_SECRET is not set', async () => {
  const result = await runAuthSubprocess({});
  assert.notStrictEqual(result.code, 0, 'process should exit non-zero');
  assert.match(
    result.stderr,
    /JWT_SECRET must be set to a long random value/i,
    'stderr should mention JWT_SECRET requirement'
  );
});

test('auth.js throws when JWT_SECRET is too short', async () => {
  const result = await runAuthSubprocess({ JWT_SECRET: 'too-short' });
  assert.notStrictEqual(result.code, 0, 'process should exit non-zero');
  assert.match(
    result.stderr,
    /JWT_SECRET must be set to a long random value/i,
    'stderr should mention JWT_SECRET requirement'
  );
});

test('auth.js loads when JWT_SECRET is >= 32 characters', async () => {
  const result = await runAuthSubprocess({ JWT_SECRET: 'a'.repeat(32) });
  assert.strictEqual(result.code, 0, `auth.js should load without error: ${result.stderr}`);
});

test('OTP lookup accepts equivalent phone formatting', async () => {
  const { run } = await import('../config/db.js');
  run(
    'INSERT INTO users (name, email, password_hash, role, phone, is_demo) VALUES (?, ?, ?, ?, ?, ?)',
    'Phone Demo', 'phone-demo@test.in', 'unused', 'admin', '+91 9000000001', 1
  );
  const spaced = await request(app).post('/auth/otp/request').send({ phone: '+91 9000000001' });
  const compact = await request(app).post('/auth/otp/request').send({ phone: '+919000000001' });
  assert.equal(spaced.status, 200);
  assert.equal(compact.status, 200);
  assert.equal(compact.body.devOtp, '123456');
});

test('CORS rejects unsupported localhost ports', async () => {
  await new Promise((resolve, reject) => {
    try {
      corsOptions().origin('http://localhost:5176', (err, allowed) => {
        if (err) return reject(err);
        assert.equal(allowed, false);
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
});

// ── GET /auth/users ─────────────────────────────────────────────────────────

test('GET /auth/users: admin returns { users: [...] }', async () => {
  const res = await request(app).get('/auth/users').set(...auth());
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.users));
});

test('GET /auth/users: each user has public fields, no password_hash', async () => {
  const res = await request(app).get('/auth/users').set(...auth());
  const user = res.body.users[0];
  assert.ok('id' in user && 'name' in user && 'email' in user);
  assert.ok('phone' in user && 'role' in user && 'is_demo' in user && 'created_at' in user);
  assert.ok(!('password_hash' in user));
});

test('GET /auth/users: unauthenticated returns 401', async () => {
  const res = await request(app).get('/auth/users');
  assert.equal(res.status, 401);
});

test('GET /auth/users: non-admin returns 403', async () => {
  const { run } = await import('../config/db.js');
  const bcrypt = (await import('bcryptjs')).default;
  const email = `h3test_${Date.now()}@nonadmin.in`;
  const pwHash = bcrypt.hashSync('x', 10);
  run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    'NonAdmin', email, pwHash, 'officer');
  const login = await request(app).post('/auth/login').send({ email, password: 'x' });
  const token = login.body.token;
  const res = await request(app).get('/auth/users').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
});

test('GET /auth/users: returns all roles (admin, officer, reception, doctor)', async () => {
  const { run } = await import('../config/db.js');
  const bcrypt = (await import('bcryptjs')).default;
  const roles = ['officer', 'reception', 'doctor'];
  for (const role of roles) {
    const email = `h3_role_${role}_${Date.now()}@test.in`;
    run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      role.charAt(0).toUpperCase() + role.slice(1), email, bcrypt.hashSync('x', 10), role);
  }
  const res = await request(app).get('/auth/users').set(...auth());
  const foundRoles = res.body.users.map(u => u.role);
  for (const role of ['admin', 'officer', 'reception', 'doctor']) {
    assert.ok(foundRoles.includes(role), `role "${role}" should appear in list`);
  }
});

test('admin can delete another user but not self', async () => {
  const { get } = await import('../config/db.js');
  const admin = get('SELECT id FROM users WHERE email = ?', 'admin@test-auth.in');
  const email = `delete_${Date.now()}@test.in`;
  const created = await request(app)
    .post('/auth/register')
    .set(...auth())
    .send({ name: 'Delete Me', email, password: 'delete123', role: 'officer' });
  assert.equal(created.status, 201);

  const deleted = await request(app)
    .delete(`/auth/users/${created.body.user.id}`)
    .set(...auth());
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.ok, true);

  const selfDelete = await request(app)
    .delete(`/auth/users/${admin.id}`)
    .set(...auth());
  assert.equal(selfDelete.status, 400);
});
