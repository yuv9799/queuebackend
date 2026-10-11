import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import request from 'supertest';

const TEST_DB = path.resolve('data', 'test-whatsapp.db');
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-secret-for-whatsapp-jwt-at-least-32-chars!!';
process.env.SMS_ENABLED = 'false';
process.env.TWILIO_WHATSAPP_ENABLED = 'false';
process.env.AI_ENABLED = 'true';
for (const file of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (fs.existsSync(file)) fs.rmSync(file);
}

const { createApp } = await import('../app.js');
const { db, get, run, lastInsertId } = await import('../config/db.js');
const { sendWhatsAppNotification } = await import('../services/whatsapp/twilio.js');
const app = createApp();
let departmentId;
let areaId;

before(() => {
  run('INSERT INTO departments (name, code, color) VALUES (?, ?, ?)', 'Orthopedics', 'ORTHO', '#16a34a');
  departmentId = lastInsertId();
  run('INSERT INTO areas (department_id, name, code, floor) VALUES (?, ?, ?, ?)', departmentId, 'Orthopedic Clinic', 'ORTHO-OPD', '3rd Floor');
  areaId = lastInsertId();
  run(
    'INSERT INTO doctors (name, department_id, specialization, status, room) VALUES (?, ?, ?, ?, ?)',
    'Dr. Test Orthopedist',
    departmentId,
    'Orthopedics',
    'available',
    'Room 304',
  );
});

after(() => {
  try { db.close(); } catch {}
  for (const file of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
});

const fakeTwilioConfig = {
  TWILIO_ACCOUNT_SID: 'AC' + '0123456789abcdef' + '0123456789abcdef',
  TWILIO_AUTH_TOKEN: 'fake-twilio-auth-token',
  TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886',
  TWILIO_WHATSAPP_CONTENT_SID: 'HX' + '0123456789abcdef' + '0123456789abcdef',
};

function tokenDetails(id = 1) {
  return {
    id,
    token_code: 'ORTHO-005',
    token_number: 5,
    status: 'queued',
    patient_name: 'Test Patient',
    patient_id: null,
    department_name: 'Orthopedics',
    doctor_name: 'Dr. Test Orthopedist',
    doctor_room: 'Room 304',
    counter_name: null,
    area_name: 'Orthopedic Clinic',
    area_floor: '3rd Floor',
  };
}

async function issueToken({ phone = '+919876543210', whatsappOptIn = true } = {}) {
  const response = await request(app).post('/tokens').send({
    departmentId,
    areaId,
    patientName: 'Test Patient',
    phone,
    whatsappOptIn,
  });
  return response;
}

function fakeClient({ sid = 'fake-twilio-message-sid-0123', status = 'queued', error } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      messages: {
        async create(payload) {
          calls.push(payload);
          if (error) throw error;
          return { sid, status };
        },
      },
    },
  };
}

async function withEnv(values, callback) {
  const keys = Object.keys(values);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('disabled WhatsApp skips without constructing a Twilio client', async () => {
  const result = await withEnv({ TWILIO_WHATSAPP_ENABLED: 'false' }, () => (
    sendWhatsAppNotification({
      phone: '+919876543210',
      whatsappOptIn: true,
      token: tokenDetails(),
    })
  ));
  assert.deepEqual(result, { attempted: false, accepted: false, reason: 'disabled' });
});

test('WhatsApp requires explicit opt-in and a valid phone number', async () => {
  const { client, calls } = fakeClient();
  await withEnv({ TWILIO_WHATSAPP_ENABLED: 'true', ...fakeTwilioConfig }, async () => {
    const noConsent = await sendWhatsAppNotification({
      phone: '+919876543210',
      whatsappOptIn: false,
      token: tokenDetails(),
    }, { client });
    const noPhone = await sendWhatsAppNotification({
      whatsappOptIn: true,
      token: tokenDetails(),
    }, { client });
    const invalidPhone = await sendWhatsAppNotification({
      phone: '+9112345',
      whatsappOptIn: true,
      token: tokenDetails(),
    }, { client });
    assert.deepEqual(noConsent, { attempted: false, accepted: false, reason: 'consent_not_given' });
    assert.deepEqual(noPhone, { attempted: false, accepted: false, reason: 'no_phone' });
    assert.deepEqual(invalidPhone, { attempted: false, accepted: false, reason: 'invalid_phone' });
  });
  assert.equal(calls.length, 0);
});

test('missing Twilio configuration returns a safe failure without calling Twilio', async () => {
  const { client, calls } = fakeClient();
  const result = await withEnv({
    TWILIO_WHATSAPP_ENABLED: 'true',
    TWILIO_ACCOUNT_SID: undefined,
    TWILIO_AUTH_TOKEN: undefined,
    TWILIO_WHATSAPP_FROM: undefined,
    TWILIO_WHATSAPP_CONTENT_SID: undefined,
  }, () => sendWhatsAppNotification({
    phone: '+919876543210',
    whatsappOptIn: true,
    token: tokenDetails(),
  }, { client }));
  assert.deepEqual(result, {
    attempted: true,
    accepted: false,
    reason: 'configuration_missing',
  });
  assert.equal(calls.length, 0);
});

test('valid WhatsApp send uses Content API fields and dynamic KIMS queue variables', async () => {
  const { client, calls } = fakeClient({ status: 'queued' });
  const result = await withEnv({
    TWILIO_WHATSAPP_ENABLED: 'true',
    ...fakeTwilioConfig,
    PUBLIC_APP_URL: 'https://queue.example.test/',
  }, () => sendWhatsAppNotification({
    phone: '91 98765 43210',
    whatsappOptIn: true,
    token: tokenDetails(45),
    queuePosition: 1,
    estimatedWait: 3,
  }, { client }));
  assert.deepEqual(result, {
    attempted: true,
    accepted: true,
    providerMessageId: 'fake-twilio-message-sid-0123',
    status: 'queued',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'whatsapp:+919876543210');
  assert.equal(calls[0].from, fakeTwilioConfig.TWILIO_WHATSAPP_FROM);
  assert.equal(calls[0].contentSid, fakeTwilioConfig.TWILIO_WHATSAPP_CONTENT_SID);
  assert.deepEqual(JSON.parse(calls[0].contentVariables), {
    1: 'ORTHO-005',
    2: 'Orthopedics',
    3: 'Dr. Test Orthopedist',
    4: 'Room 304',
    5: 'Test Patient',
    6: 'You are next',
    7: '< 5 min',
    8: 'https://queue.example.test/status?id=45',
  });
  assert.equal('body' in calls[0], false);
});

test('Twilio API failure is safely recorded and does not leak secrets in logs', async () => {
  const tokenResponse = await issueToken();
  assert.equal(tokenResponse.status, 201);
  const token = tokenResponse.body.token;
  const secret = 'fake-twilio-auth-token';
  const logs = [];
  const previousError = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const result = await withEnv({
      TWILIO_WHATSAPP_ENABLED: 'true',
      ...fakeTwilioConfig,
    }, () => sendWhatsAppNotification({
      phone: '+919876543210',
      whatsappOptIn: true,
      token,
      queuePosition: tokenResponse.body.position,
      estimatedWait: tokenResponse.body.estimatedWaitMinutes,
    }, { client: fakeClient({ error: Object.assign(new Error(secret), { code: 63016 }) }).client }));
    assert.deepEqual(result, {
      attempted: true,
      accepted: false,
      reason: 'twilio_error_63016',
    });
    assert.ok(logs.some((line) => line.includes('[WhatsApp] Notification failed')));
    assert.ok(logs.every((line) => !line.includes(secret) && !line.includes('9876543210')));
    const record = get(
      "SELECT * FROM notifications WHERE token_id = ? AND channel = 'whatsapp'",
      token.id,
    );
    assert.equal(record.status, 'FAILED');
    assert.equal(JSON.parse(record.provider_response).errorCode, 'twilio_error_63016');
  } finally {
    console.error = previousError;
  }
});

test('missing Twilio credentials and WhatsApp API failures never roll back a token', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = new Map(
    ['SMS_ENABLED', 'TWILIO_WHATSAPP_ENABLED', ...Object.keys(fakeTwilioConfig)]
      .map((key) => [key, process.env[key]]),
  );
  const requests = [];
  process.env.SMS_ENABLED = 'false';
  process.env.TWILIO_WHATSAPP_ENABLED = 'true';
  Object.assign(process.env, fakeTwilioConfig);
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).startsWith('https://api.twilio.com/')) {
      return new Response(JSON.stringify({ code: 63016, message: 'safe test failure' }), { status: 400 });
    }
    throw new Error('Unexpected provider request');
  };
  try {
    const response = await issueToken();
    assert.equal(response.status, 201);
    assert.equal(response.body.token.status, 'queued');
    assert.deepEqual(response.body.whatsappNotification, {
      attempted: true,
      accepted: false,
      reason: 'twilio_error_63016',
    });
    assert.ok(requests.some(({ url }) => url.startsWith('https://api.twilio.com/')));
    assert.ok(get('SELECT id FROM tokens WHERE id = ?', response.body.token.id));
    const record = get(
      "SELECT * FROM notifications WHERE token_id = ? AND channel = 'whatsapp'",
      response.body.token.id,
    );
    assert.equal(record.status, 'FAILED');
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('SMS and WhatsApp are both attempted after token persistence', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = new Map(
    [
      'SMS_ENABLED',
      'SMS_PROVIDER',
      'MSG91_AUTH_KEY',
      'MSG91_TEMPLATE_ID',
      'MSG91_SENDER_ID',
      'TWILIO_WHATSAPP_ENABLED',
      ...Object.keys(fakeTwilioConfig),
    ].map((key) => [key, process.env[key]]),
  );
  const requests = [];
  Object.assign(process.env, {
    SMS_ENABLED: 'true',
    SMS_PROVIDER: 'msg91',
    MSG91_AUTH_KEY: 'fake-msg91-key',
    MSG91_TEMPLATE_ID: 'fake-msg91-template',
    MSG91_SENDER_ID: 'KIMS',
    TWILIO_WHATSAPP_ENABLED: 'true',
    ...fakeTwilioConfig,
  });
  globalThis.fetch = async (url, options) => {
    const urlString = String(url);
    requests.push({ url: urlString, options });
    if (urlString === 'https://control.msg91.com/api/v5/flow/') {
      return new Response(JSON.stringify({ type: 'success', request_id: 'msg91-test-id' }), { status: 200 });
    }
    if (urlString.startsWith('https://api.twilio.com/')) {
      return new Response(JSON.stringify({ sid: 'SM-whatsapp-test-id', status: 'queued' }), { status: 201 });
    }
    throw new Error('Unexpected provider request');
  };
  try {
    const response = await issueToken();
    assert.equal(response.status, 201);
    assert.equal(response.body.smsNotification.accepted, true);
    assert.equal(response.body.whatsappNotification.accepted, true);
    assert.equal(requests.length, 2);
    assert.ok(requests.some(({ url }) => url === 'https://control.msg91.com/api/v5/flow/'));
    assert.ok(requests.some(({ url }) => url.startsWith('https://api.twilio.com/')));
    assert.ok(get('SELECT id FROM tokens WHERE id = ?', response.body.token.id));
    assert.equal(
      get("SELECT COUNT(*) AS count FROM notifications WHERE token_id = ? AND channel IN ('sms', 'whatsapp')", response.body.token.id).count,
      2,
    );
    assert.equal(
      get('SELECT whatsapp_opt_in FROM tokens WHERE id = ?', response.body.token.id).whatsapp_opt_in,
      1,
    );
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('WhatsApp defaults to no consent and does not call Twilio', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = new Map(
    ['TWILIO_WHATSAPP_ENABLED', ...Object.keys(fakeTwilioConfig)]
      .map((key) => [key, process.env[key]]),
  );
  let called = false;
  Object.assign(process.env, { TWILIO_WHATSAPP_ENABLED: 'true', ...fakeTwilioConfig });
  globalThis.fetch = async () => {
    called = true;
    throw new Error('Twilio must not be called without opt-in');
  };
  try {
    const response = await issueToken({ whatsappOptIn: false });
    assert.equal(response.status, 201);
    assert.deepEqual(response.body.whatsappNotification, {
      attempted: false,
      accepted: false,
      reason: 'consent_not_given',
    });
    assert.equal(called, false);
    assert.equal(
      get('SELECT whatsapp_opt_in FROM tokens WHERE id = ?', response.body.token.id).whatsapp_opt_in,
      0,
    );
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('assistant requires a separate WhatsApp opt-in before sending the token notification', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = new Map(
    ['TWILIO_WHATSAPP_ENABLED', ...Object.keys(fakeTwilioConfig)]
      .map((key) => [key, process.env[key]]),
  );
  const requests = [];
  Object.assign(process.env, { TWILIO_WHATSAPP_ENABLED: 'true', ...fakeTwilioConfig });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ sid: 'SM-ai-whatsapp', status: 'queued' }), { status: 201 });
  };
  try {
    const sessionId = 'ai-whatsapp-opt-in-test-0001';
    const send = (body) => request(app).post('/ai/chat').send({ sessionId, ...body });
    await send({ message: 'I want Orthopedics' });
    const selected = await send({ action: { type: 'SELECT_BEST' } });
    assert.equal(selected.body.state.step, 'patient_name');
    await send({ message: 'Test Patient' });
    const confirmation = await send({ message: '+919876500001' });
    assert.equal(confirmation.body.state.step, 'confirmation');
    assert.ok(confirmation.body.actions.some((action) => action.type === 'SET_WHATSAPP_OPT_IN'));

    const consent = await send({
      action: { type: 'SET_WHATSAPP_OPT_IN', data: { enabled: true } },
    });
    assert.match(consent.body.message, /WhatsApp token notification is enabled/);
    const generated = await send({ action: { type: 'CONFIRM_BOOKING' } });
    assert.equal(generated.status, 200);
    assert.equal(generated.body.whatsappNotification.accepted, true);
    assert.equal(requests.length, 1);
    assert.equal(
      get('SELECT whatsapp_opt_in FROM tokens WHERE id = ?', generated.body.token.id).whatsapp_opt_in,
      1,
    );
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
