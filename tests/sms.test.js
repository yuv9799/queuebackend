import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import request from 'supertest';

const TEST_DB = path.resolve('data', 'test-sms.db');
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-secret-for-sms-jwt-at-least-32-chars!!';
for (const file of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (fs.existsSync(file)) fs.rmSync(file);
}

const { createApp } = await import('../app.js');
const { db, get, run, lastInsertId } = await import('../config/db.js');
const app = createApp();
let departmentId;
let areaId;

before(() => {
  run('INSERT INTO departments (name, code, color) VALUES (?, ?, ?)', 'Pharmacy', 'SMS-PHARM', '#16a34a');
  departmentId = lastInsertId();
  run('INSERT INTO areas (department_id, name, code, floor) VALUES (?, ?, ?, ?)', departmentId, 'OPD Consultation', 'SMS-OPD', '3rd Floor');
  areaId = lastInsertId();
});

after(() => {
  try { db.close(); } catch {}
  for (const file of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

async function issueWithSms({ phone, patientId, smsEnv = {}, fetchResponse } = {}) {
  const envKeys = ['SMS_ENABLED', 'SMS_PROVIDER', 'MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID', 'MSG91_SENDER_ID'];
  const previousEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  const previousInfo = console.info;
  const previousError = console.error;
  const logs = [];
  const requests = [];
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, {
    SMS_ENABLED: 'true',
    MSG91_AUTH_KEY: 'test-auth-key',
    MSG91_TEMPLATE_ID: 'test-template',
    MSG91_SENDER_ID: 'KIMS',
    ...smsEnv,
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return fetchResponse || new Response(
      JSON.stringify({ type: 'success', request_id: 'test-request-id' }),
      { status: 200 }
    );
  };
  console.info = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const body = { departmentId, areaId, patientName: 'Yuvi' };
    if (phone !== undefined) body.phone = phone;
    if (patientId !== undefined) body.patientId = patientId;
    const response = await request(app).post('/tokens').send(body);
    return { response, logs, requests };
  } finally {
    globalThis.fetch = previousFetch;
    console.info = previousInfo;
    console.error = previousError;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('token without a phone is created without attempting SMS', async () => {
  const { response, requests } = await issueWithSms();
  assert.equal(response.status, 201);
  assert.equal(response.body.token.status, 'queued');
  assert.deepEqual(response.body.smsNotification, { attempted: false, accepted: false, reason: 'no_phone' });
  assert.equal(requests.length, 0);
  assert.equal(get("SELECT COUNT(*) AS count FROM notifications WHERE channel = 'sms'").count, 0);
});

test('stored patient phone is not used unless phone is provided for this token request', async () => {
  run('INSERT INTO patients (patient_no, name, phone) VALUES (?, ?, ?)', 'P-SMS-TEST', 'Stored Patient', '+919942467719');
  const patientId = lastInsertId();
  const { response, requests } = await issueWithSms({ patientId });
  assert.equal(response.status, 201);
  assert.equal(response.body.token.patient_phone, '+919942467719');
  assert.deepEqual(response.body.smsNotification, { attempted: false, accepted: false, reason: 'no_phone' });
  assert.equal(requests.length, 0);
});

test('valid Indian phone sends actual token details through MSG91 Flow', async () => {
  const { response, requests } = await issueWithSms({ phone: '+91 99424-67719' });
  assert.equal(response.status, 201);
  assert.deepEqual(response.body.smsNotification, { attempted: true, accepted: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://control.msg91.com/api/v5/flow/');
  assert.equal(requests[0].options.headers.authkey, 'test-auth-key');
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.template_id, 'test-template');
  assert.equal(payload.recipients[0].mobiles, '919942467719');
  assert.equal(payload.recipients[0].VAR1, response.body.token.token_code);
  assert.equal(payload.recipients[0].VAR2, 'Yuvi');
  assert.equal(payload.recipients[0].VAR3, 'Pharmacy');
  assert.equal(payload.recipients[0].VAR4, 'Not assigned');
  assert.equal(payload.recipients[0].VAR5, 'OPD Consultation · 3rd Floor');
  assert.equal(payload.recipients[0].VAR6, String(response.body.position));
  assert.equal(payload.recipients[0].VAR7, 'queued');
  assert.equal(payload.recipients[0].VAR9, `https://kims-queue.vercel.app/status?id=${response.body.token.id}`);
  const notification = get("SELECT * FROM notifications WHERE token_id = ? AND channel = 'sms'", response.body.token.id);
  assert.equal(notification.status, 'SENT');
  assert.equal(notification.recipient, '+919942467719');
  assert.equal(JSON.parse(notification.provider_response).providerMessageId, 'test-request-id');
});

test('SMS provider rejection does not fail token creation and logs masked phone only', async () => {
  const { response, logs } = await issueWithSms({
    phone: '9942467719',
    fetchResponse: new Response(JSON.stringify({ type: 'error' }), { status: 503 }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.token.status, 'queued');
  assert.equal(response.body.smsNotification.attempted, true);
  assert.equal(response.body.smsNotification.accepted, false);
  assert.ok(logs.some((line) => line.includes('phone=******7719')));
  assert.ok(logs.every((line) => !line.includes('9942467719') && !line.includes('test-auth-key')));
  const notification = get("SELECT * FROM notifications WHERE token_id = ? AND channel = 'sms'", response.body.token.id);
  assert.equal(notification.status, 'FAILED');
  assert.equal(JSON.parse(notification.provider_response).errorCode, 'provider_rejected_503');
});

test('invalid phone preserves token creation and is not sent', async () => {
  const { response, requests } = await issueWithSms({ phone: '12345' });
  assert.equal(response.status, 201);
  assert.equal(response.body.token.status, 'queued');
  assert.deepEqual(response.body.smsNotification, { attempted: false, accepted: false, reason: 'invalid_phone' });
  assert.equal(requests.length, 0);
});

test('missing MSG91 credentials fail safely without failing token creation', async () => {
  const { response, logs, requests } = await issueWithSms({
    phone: '9942467719',
    smsEnv: { MSG91_AUTH_KEY: '' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.token.status, 'queued');
  assert.equal(response.body.smsNotification.reason, 'provider_configuration_missing');
  assert.equal(requests.length, 0);
  assert.ok(logs.some((line) => line.includes('phone=******7719') && line.includes('provider_configuration_missing')));
  assert.ok(logs.every((line) => !line.includes('9942467719') && !line.includes('test-auth-key')));
});

test('SMS disabled keeps its existing safe skip log', async () => {
  const { response, logs, requests } = await issueWithSms({
    phone: '9942467719',
    smsEnv: { SMS_ENABLED: 'false' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.smsNotification.attempted, false);
  assert.ok(logs.includes('SMS disabled; notification skipped.'));
  assert.equal(requests.length, 0);
});

test('phone normalization accepts Indian forms and rejects invalid numbers', async () => {
  const { normalizeIndianPhone } = await import('../services/sms/index.js');
  assert.equal(normalizeIndianPhone('9942467719'), '+919942467719');
  assert.equal(normalizeIndianPhone('+91 99424-67719'), '+919942467719');
  assert.equal(normalizeIndianPhone('0919942467719'), null);
  assert.equal(normalizeIndianPhone('1234567890'), null);
});
