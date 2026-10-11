import { all, get, run, lastInsertId } from '../config/db.js';

// Pluggable notification providers. Only 'web' ships with a real in-app sink;
// sms/whatsapp providers are swappable. A failing external provider never rolls
// back the queue operation — events are recorded and retryable.

const CHANNELS = ['web', 'sms', 'whatsapp'];

// Patient default communication preferences (web always on). In production this
// would be per-patient storage; SMS/WhatsApp require a configured provider key.
export function preferencesFor(/* patientId */) {
  return { web: true, sms: false, whatsapp: false };
}

function buildMessage(event, token, doctor) {
  const dept = token?.department_name || '';
  switch (event) {
    case 'token_created':
      return `KIMS Queue\n\nToken: ${token.token_number}\nDepartment: ${dept}\nStatus: Waiting\n\nWe will notify you when your turn approaches.`;
    case 'doctor_assigned':
      return `KIMS Queue\n\nToken: ${token.token_number}\nDoctor: ${doctor}\nDepartment: ${dept}`;
    case 'approaching':
      return `KIMS Queue\n\nToken: ${token.token_number} is approaching.\nCurrent position: ${token.position}\nPlease stay near the ${dept} department.`;
    case 'called':
      return `KIMS Queue\n\n🔔 Token ${token.token_number}\nPlease proceed to: ${dept}${token.room ? ' - ' + token.room : ''}\nDoctor: ${doctor}`;
    case 'recalled':
      return `KIMS Queue\n\n🔔 Token ${token.token_number} (recall)\nPlease proceed to: ${dept}${token.room ? ' - ' + token.room : ''}`;
    case 'doctor_changed':
      return `KIMS Queue\n\nYour assigned doctor has changed.\nNew doctor: ${doctor}`;
    case 'queue_delayed':
      return `KIMS Queue\n\nThere is a delay in the ${dept} queue.\nYour position remains: ${token.position}`;
    case 'priority_changed':
      return `KIMS Queue\n\nYour token ${token.token_number} priority updated to ${token.priority}.`;
    case 'completed':
      return `KIMS Queue\n\nYour consultation has been completed. Thank you.`;
    case 'no_show':
      return `KIMS Queue\n\nYour token ${token.token_number} was marked as no-show. Please contact staff.`;
    case 'serving':
      return `KIMS Queue\n\nYour token ${token.token_number} is being served.\nPlease proceed to ${dept}${token.room ? ' - ' + token.room : ''}.`;
    case 'estimate_changed':
      return `KIMS Queue\n\nYour estimated waiting time has been updated.\n\nToken: ${token.token_number}\nEstimated wait: ${token.estimated_wait_minutes ?? 'not set'} min\nEstimated service: Around ${token.estimated_service_time ?? 'not set'}`;
    default:
      return `KIMS Queue update for token ${token?.token_number || ''}.`;
  }
}

// Enqueue a notification event. Idempotent per (event, tokenId, channel).
// Returns the notification row or the pre-existing one if already queued.
export function notify({ token, doctor = null, event, idempotencyKey = null, channels = null }) {
  const tokenId = token?.id;
  const patientId = token?.patient_id;
  const recipient = token?.phone || null;
  const message = buildMessage(event, token, doctor);

  const results = [];
  const wanted = channels || ['web'];
  for (const channel of wanted) {
    if (!CHANNELS.includes(channel)) continue;
    const prefs = preferencesFor(patientId, channel);
    if (channel !== 'web' && !prefs[channel]) {
      // Patient has this channel off; record as SKIPPED for traceability.
      const skipped = create({ tokenId, patientId, event, channel, recipient, message, status: 'SKIPPED', idempotencyKey: key(idempotencyKey, event, tokenId, channel) });
      results.push(skipped);
      continue;
    }
    const existing = existingFor(key(idempotencyKey, event, tokenId, channel));
    if (existing) { results.push(existing); continue; }
    const n = create({ tokenId, patientId, event, channel, recipient, message, idempotencyKey: key(idempotencyKey, event, tokenId, channel) });
    const delivered = deliver(n);
    results.push(mark(n.id, delivered.status, delivered.provider_response));
  }
  return results;
}

function key(prefix, event, tokenId, channel) {
  return `${prefix || 'evt'}:${event}:${tokenId}:${channel}`;
}

function existingFor(k) {
  return get('SELECT * FROM notifications WHERE idempotency_key = ?', k);
}

function create({ tokenId, patientId, event, channel, recipient, message, status = 'PENDING', idempotencyKey }) {
  run(
    `INSERT INTO notifications (token_id, patient_id, event, channel, recipient, message, status, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    tokenId, patientId, event, channel, recipient, message, status, idempotencyKey
  );
  return get('SELECT * FROM notifications WHERE id = ?', lastInsertId());
}

// Provider dispatch. 'web' succeeds immediately. SMS/WhatsApp require a provider
// key; if none is configured the event is recorded as PENDING (retryable) and
// never treated as delivered — the queue operation itself is unaffected.
function deliver(n) {
  if (n.channel === 'web') {
    return { status: 'DELIVERED', provider_response: 'web:ok' };
  }
  const providerKey = process.env[`${n.channel.toUpperCase()}_PROVIDER_KEY`];
  if (!providerKey) {
    return { status: 'PENDING', provider_response: `${n.channel}:no_provider_configured` };
  }
  // A real provider integration would go here. Keep it invisible to the queue.
  return { status: 'SENT', provider_response: `${n.channel}:queued` };
}

export function mark(id, status, providerResponse = null) {
  const now = status.match(/^(SENT|DELIVERED)$/) ? ", sent_at = datetime('now')" : status === 'FAILED' ? ", failed_at = datetime('now')" : '';
  run(`UPDATE notifications SET status = ?, provider_response = COALESCE(?, provider_response)${now} WHERE id = ?`, status, providerResponse, id);
  return get('SELECT * FROM notifications WHERE id = ?', id);
}

export function recordSms({
  tokenId,
  patientId,
  phone,
  status,
  provider,
  providerMessageId = null,
  errorCode = null,
}) {
  const token = get('SELECT id FROM tokens WHERE id = ?', tokenId);
  if (!token) return null;
  const providerResponse = JSON.stringify({
    ...(providerMessageId ? { providerMessageId } : {}),
    ...(errorCode ? { errorCode } : {}),
  });
  const idempotencyKey = `token-sms:${tokenId}`;
  const existing = existingFor(idempotencyKey);
  if (existing) return existing;
  run(
    `INSERT INTO notifications
       (token_id, patient_id, event, channel, recipient, status, provider, provider_response, idempotency_key, sent_at, failed_at)
     VALUES (?, ?, 'token_created', 'sms', ?, ?, ?, ?, ?,
       CASE WHEN ? = 'SENT' THEN datetime('now') END,
       CASE WHEN ? = 'FAILED' THEN datetime('now') END)`,
    tokenId,
    patientId || null,
    phone,
    status,
    provider,
    providerResponse,
    idempotencyKey,
    status,
    status
  );
  return existingFor(idempotencyKey);
}

export function recordWhatsApp({
  tokenId,
  patientId,
  phone,
  status,
  provider = 'twilio',
  providerMessageId = null,
  errorCode = null,
}) {
  const token = get('SELECT id FROM tokens WHERE id = ?', tokenId);
  if (!token) return null;
  const providerResponse = JSON.stringify({
    ...(providerMessageId ? { providerMessageId } : {}),
    ...(errorCode ? { errorCode } : {}),
  });
  const idempotencyKey = `token-whatsapp:${tokenId}`;
  const existing = existingFor(idempotencyKey);
  if (existing) return existing;
  run(
    `INSERT INTO notifications
       (token_id, patient_id, event, channel, recipient, status, provider, provider_response, idempotency_key, sent_at, failed_at)
     VALUES (?, ?, 'token_created', 'whatsapp', ?, ?, ?, ?, ?,
       CASE WHEN ? = 'SENT' THEN datetime('now') END,
       CASE WHEN ? = 'FAILED' THEN datetime('now') END)`,
    tokenId,
    patientId || null,
    phone,
    status,
    provider,
    providerResponse,
    idempotencyKey,
    status,
    status
  );
  return existingFor(idempotencyKey);
}

export function list({ tokenId = null, limit = 200 } = {}) {
  if (tokenId) {
    return all('SELECT * FROM notifications WHERE token_id = ? ORDER BY id DESC LIMIT ?', tokenId, limit);
  }
  return all('SELECT * FROM notifications ORDER BY id DESC LIMIT ?', limit);
}