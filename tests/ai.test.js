import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import request from 'supertest';
import { classifyIntent } from '../services/ai/intent.js';
import { matchDepartments } from '../services/ai/departmentMatcher.js';

const TEST_DB = path.resolve('data', 'test-ai-queue.db');
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-secret-for-ai-tests-at-least-32-chars!!';
process.env.AI_ENABLED = 'true';
process.env.SMS_ENABLED = 'false';
for (const file of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (fs.existsSync(file)) fs.rmSync(file);
}

const { createApp } = await import('../app.js');
const app = createApp();
const { create: createDepartment } = await import('../models/Department.js');
const { create: createArea } = await import('../models/Area.js');
const { create: createDoctor } = await import('../models/Doctor.js');
const { db } = await import('../config/db.js');

let department;
let area;

before(() => {
  department = createDepartment({ name: 'Dermatology', code: 'DERM' });
  area = createArea({
    departmentId: department.id,
    name: 'Skin Clinic',
    code: 'SKIN-CLINIC',
    floor: '3rd Floor',
  });
  createDoctor({
    name: 'Dr. Test Dermatologist',
    departmentId: department.id,
    specialization: 'Dermatology',
    status: 'available',
  });
});

after(() => {
  try { db.close(); } catch {}
  for (const file of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

test('intent classifier routes booking, tracking, department search and emergencies', () => {
  assert.equal(classifyIntent('I need a dermatologist').intent, 'TOKEN_BOOKING');
  assert.equal(classifyIntent('I want to check my token').intent, 'TOKEN_TRACKING');
  assert.equal(classifyIntent('Where are the departments?').intent, 'DEPARTMENT_SEARCH');
  assert.equal(classifyIntent('I was in an accident').intent, 'EMERGENCY');
  assert.equal(classifyIntent('I have chest pain').intent, 'EMERGENCY');
  assert.equal(classifyIntent('I broke my arm').intent, 'EMERGENCY');
  assert.equal(classifyIntent('What medicine should I take?').intent, 'GENERAL_INFORMATION');
});

test('department matching uses live department names for natural-language aliases', () => {
  assert.equal(matchDepartments('I want a skin doctor for acne', [department])[0].id, department.id);
  assert.equal(matchDepartments('I need a dermatologist', [department])[0].name, 'Dermatology');
  const cardiology = { id: 92, name: 'Cardiology', code: 'CARD' };
  assert.equal(matchDepartments('I need a heart doctor', [cardiology])[0].id, cardiology.id);
});

test('assistant creates a token only after explicit confirmation and masks the phone', async () => {
  const { all } = await import('../config/db.js');
  const sessionId = 'ai-booking-test-0001';
  const first = await request(app).post('/ai/chat').send({
    sessionId,
    message: 'I want to see a dermatologist',
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.intent, 'TOKEN_BOOKING');
  assert.equal(first.body.state.departmentId, department.id);
  assert.ok(first.body.actions.some((item) => item.type === 'SELECT_BEST'));
  assert.ok(first.body.actions.some((item) => item.type === 'SELECT_DOCTOR'));

  const doctorChoice = await request(app).post('/ai/chat').send({
    sessionId,
    action: { type: 'SELECT_BEST' },
  });
  assert.equal(doctorChoice.body.state.step, 'patient_name');
  assert.equal(doctorChoice.body.state.areaId, area.id);

  const name = await request(app).post('/ai/chat').send({ sessionId, message: 'Rahul Sharma' });
  assert.equal(name.body.state.step, 'phone');

  const phone = await request(app).post('/ai/chat').send({ sessionId, message: 'My mobile is 9942467719' });
  assert.equal(phone.body.state.step, 'confirmation');
  assert.equal(phone.body.confirmation.phoneMasked, '+91 ******7719');
  assert.equal(JSON.stringify(phone.body).includes('9942467719'), false);
  assert.equal(phone.body.confirmation.department, 'Dermatology');
  assert.equal(phone.body.confirmation.area, 'Skin Clinic');
  assert.ok(phone.body.actions.some((item) => item.type === 'CONFIRM_BOOKING'));
  assert.equal(all('SELECT id FROM tokens WHERE department_id = ?', department.id).length, 0);

  const generated = await request(app).post('/ai/chat').send({
    sessionId,
    action: { type: 'CONFIRM_BOOKING' },
  });
  assert.equal(generated.status, 200);
  assert.equal(generated.body.state.step, 'completed');
  assert.equal(generated.body.token.status, 'queued');
  assert.equal(generated.body.token.department, 'Dermatology');
  assert.equal(generated.body.token.doctor, 'Dr. Test Dermatologist');
  assert.equal(generated.body.smsNotification.attempted, false);

  assert.equal(all('SELECT id FROM tokens WHERE department_id = ?', department.id).length, 1);
  const repeat = await request(app).post('/ai/chat').send({
    sessionId,
    action: { type: 'CONFIRM_BOOKING' },
  });
  assert.equal(repeat.status, 200);
  assert.equal(all('SELECT id FROM tokens WHERE department_id = ?', department.id).length, 1);
});

test('assistant tracks the current saved token when it changes during a chat session', async () => {
  const firstTokenResponse = await request(app).post('/tokens').send({
    departmentId: department.id,
    areaId: area.id,
    patientName: 'First Patient',
  });
  const secondTokenResponse = await request(app).post('/tokens').send({
    departmentId: department.id,
    areaId: area.id,
    patientName: 'Second Patient',
  });
  const firstToken = firstTokenResponse.body.token;
  const secondToken = secondTokenResponse.body.token;
  assert.equal(firstTokenResponse.status, 201);
  assert.equal(secondTokenResponse.status, 201);

  const sessionId = 'ai-token-context-switch-0001';
  const firstStatus = await request(app).post('/ai/chat').send({
    sessionId,
    message: 'Where is my token?',
    context: { tokenId: firstToken.id },
  });
  assert.equal(firstStatus.body.token.token.token_code, firstToken.token_code);

  const switchedStatus = await request(app).post('/ai/chat').send({
    sessionId,
    message: 'Where is my token?',
    context: { tokenId: secondToken.id },
  });
  assert.equal(switchedStatus.body.token.token.token_code, secondToken.token_code);

  const refreshedStatus = await request(app).post('/ai/chat').send({
    sessionId,
    action: { type: 'REFRESH_TOKEN', data: { tokenId: firstToken.id } },
    context: { tokenId: secondToken.id },
  });
  assert.equal(refreshedStatus.body.token.token.token_code, secondToken.token_code);
});

test('emergency requests route away from normal token booking', async () => {
  const response = await request(app).post('/ai/chat').send({
    sessionId: 'ai-emergency-test-0001',
    message: 'I was in an accident',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.intent, 'EMERGENCY');
  assert.equal(response.body.state.emergencyDetected, true);
  assert.ok(response.body.actions.some((item) => item.type === 'OPEN_EMERGENCY'));
  assert.equal(response.body.token, undefined);
});

test('an explicitly named active doctor is selected from current department data', async () => {
  const response = await request(app).post('/ai/chat').send({
    sessionId: 'ai-doctor-name-test-0001',
    message: 'I want to see Dr. Test Dermatologist',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.state.departmentId, department.id);
  assert.equal(response.body.state.doctorName, 'Dr. Test Dermatologist');
  assert.ok(response.body.actions.every((item) => item.type === 'SELECT_AREA'));
});

test('invalid phone number cannot reach the booking confirmation step', async () => {
  const sessionId = 'ai-invalid-phone-0001';
  await request(app).post('/ai/chat').send({ sessionId, message: 'I want to see a dermatologist' });
  await request(app).post('/ai/chat').send({ sessionId, action: { type: 'SELECT_BEST' } });
  await request(app).post('/ai/chat').send({ sessionId, message: 'Asha Patient' });
  const invalidPhone = await request(app).post('/ai/chat').send({ sessionId, message: '12345' });
  assert.equal(invalidPhone.body.state.step, 'phone');
  assert.equal(invalidPhone.body.confirmation, undefined);
});

test('an active token is shown before another booking can proceed', async () => {
  const sessionId = 'ai-duplicate-test-0001';
  await request(app).post('/ai/chat').send({ sessionId, message: 'I want a dermatologist' });
  await request(app).post('/ai/chat').send({ sessionId, action: { type: 'SELECT_BEST' } });
  await request(app).post('/ai/chat').send({ sessionId, message: 'Rahul Sharma' });
  const duplicate = await request(app).post('/ai/chat').send({ sessionId, message: '9942467719' });
  assert.equal(duplicate.body.state.step, 'duplicate');
  assert.equal(duplicate.body.intent, 'TOKEN_BOOKING');
  assert.ok(duplicate.body.actions.some((item) => item.type === 'TRACK_EXISTING'));
  assert.ok(duplicate.body.actions.some((item) => item.type === 'CONTINUE_DUPLICATE'));
  const explicitContinue = await request(app).post('/ai/chat').send({
    sessionId,
    action: { type: 'CONTINUE_DUPLICATE' },
  });
  assert.equal(explicitContinue.body.state.step, 'confirmation');
  assert.ok(explicitContinue.body.actions.some((item) => item.type === 'CONFIRM_BOOKING'));
});
