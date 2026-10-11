import * as Notify from '../../models/Notify.js';
import { normalizeIndianPhone } from '../sms/index.js';

const DEFAULT_PUBLIC_APP_URL = 'https://kims-queue.vercel.app/';
const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01/Accounts';

function safeTokenCode(token) {
  return token?.token_code || String(token?.token_number ?? 'unknown');
}

function tokenTrackingUrl(tokenId) {
  const baseUrl = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || DEFAULT_PUBLIC_APP_URL;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(`status?id=${encodeURIComponent(tokenId)}`, base).toString();
}

function displayQueueStatus(status, position) {
  if (status === 'queued') {
    if (position === 1) return 'You are next';
    if (Number.isInteger(position) && position > 1) return `Position ${position} in queue`;
    return 'Waiting in queue';
  }
  if (status === 'called') return 'Called — please proceed';
  if (status === 'held') return 'On hold — staff will recall you';
  if (status === 'serving' || status === 'in_consultation') return 'In consultation';
  if (status === 'completed') return 'Completed';
  if (status === 'skipped') return 'Skipped — contact reception';
  if (status === 'cancelled') return 'Cancelled';
  return status || 'Not available';
}

function displayWait(value) {
  if (!Number.isFinite(Number(value)) || value === null || value === undefined || value === '') {
    return 'Not available';
  }
  const minutes = Math.max(0, Number(value));
  return minutes < 5 ? '< 5 min' : `~${Math.round(minutes)} min`;
}

function contentVariables({
  token,
  patientName,
  department,
  doctor,
  room,
  queuePosition,
  estimatedWait,
  trackingUrl,
}) {
  const tokenCode = safeTokenCode(token);
  const roomName = room
    || token?.doctor_room
    || token?.counter_name
    || [token?.area_name, token?.area_floor].filter(Boolean).join(' · ')
    || 'Not assigned';
  return {
    1: tokenCode,
    2: token?.department_name || department || 'Not available',
    3: token?.doctor_name || doctor || 'Not assigned',
    4: roomName,
    5: token?.patient_name || patientName || 'Patient',
    6: displayQueueStatus(token?.status, queuePosition),
    7: displayWait(estimatedWait),
    8: trackingUrl || (token?.id ? tokenTrackingUrl(token.id) : 'Not available'),
  };
}

function validConfiguration({ accountSid, authToken, from, contentSid }) {
  return /^AC[a-f0-9]{32}$/i.test(accountSid || '')
    && Boolean(authToken)
    && /^whatsapp:\+[1-9]\d{7,14}$/.test(from || '')
    && /^HX[a-f0-9]{32}$/i.test(contentSid || '');
}

function createTwilioClient({ accountSid, authToken }) {
  return {
    messages: {
      async create({ from, to, contentSid, contentVariables: variables }) {
        const url = `${TWILIO_API_BASE}/${accountSid}/Messages.json`;
        let response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: from,
              To: to,
              ContentSid: contentSid,
              ContentVariables: variables,
            }),
            signal: AbortSignal.timeout(10000),
          });
        } catch (error) {
          const code = error?.name === 'TimeoutError' ? 'request_timeout' : 'request_failed';
          throw Object.assign(new Error(code), { code });
        }

        let result = null;
        try {
          result = await response.json();
        } catch {
          // Twilio responses normally contain JSON; never log provider response text.
        }
        if (!response.ok) {
          const safeCode = Number.isInteger(result?.code) ? `twilio_error_${result.code}` : `provider_rejected_${response.status}`;
          throw Object.assign(new Error(safeCode), { code: safeCode });
        }
        return result || {};
      },
    },
  };
}

function safeErrorCode(error) {
  if (typeof error?.code === 'string'
    && /^(request_timeout|request_failed|configuration_missing|provider_rejected_\d{3}|twilio_error_\d{1,6})$/i.test(error.code)) {
    return error.code;
  }
  if (Number.isInteger(error?.code)) return `twilio_error_${error.code}`;
  return 'delivery_failed';
}

function persistDelivery(details) {
  try {
    Notify.recordWhatsApp(details);
  } catch {
    console.error('[WhatsApp] Notification record failed.');
  }
}

export async function sendWhatsAppNotification({
  phone,
  whatsappOptIn = false,
  token,
  patientName,
  department,
  doctor,
  room,
  queuePosition,
  estimatedWait,
  trackingUrl,
}, { client = null } = {}) {
  if (phone === null || phone === undefined || String(phone).trim() === '') {
    console.info('[WhatsApp] Skipped - missing phone number');
    return { attempted: false, accepted: false, reason: 'no_phone' };
  }

  const normalizedPhone = normalizeIndianPhone(phone);
  if (!normalizedPhone) {
    console.info('[WhatsApp] Skipped - invalid phone number');
    return { attempted: false, accepted: false, reason: 'invalid_phone' };
  }

  if (process.env.TWILIO_WHATSAPP_ENABLED !== 'true') {
    console.info('[WhatsApp] Skipped - disabled');
    return { attempted: false, accepted: false, reason: 'disabled' };
  }
  if (whatsappOptIn !== true) {
    console.info('[WhatsApp] Skipped - consent not given');
    return { attempted: false, accepted: false, reason: 'consent_not_given' };
  }

  const {
    TWILIO_ACCOUNT_SID: accountSid,
    TWILIO_AUTH_TOKEN: authToken,
    TWILIO_WHATSAPP_FROM: from,
    TWILIO_WHATSAPP_CONTENT_SID: contentSid,
  } = process.env;
  const tokenCode = safeTokenCode(token);
  const persistBase = {
    tokenId: token?.id,
    patientId: token?.patient_id,
    phone: normalizedPhone,
    provider: 'twilio',
  };

  if (!validConfiguration({ accountSid, authToken, from, contentSid })) {
    const errorCode = 'configuration_missing';
    console.error(`[WhatsApp] Notification failed for token ${tokenCode}: ${errorCode}`);
    persistDelivery({ ...persistBase, status: 'FAILED', errorCode });
    return { attempted: true, accepted: false, reason: errorCode };
  }

  try {
    const twilioClient = client || createTwilioClient({ accountSid, authToken });
    const result = await twilioClient.messages.create({
      from,
      to: `whatsapp:${normalizedPhone}`,
      contentSid,
      contentVariables: JSON.stringify(contentVariables({
        token,
        patientName,
        department,
        doctor,
        room,
        queuePosition,
        estimatedWait,
        trackingUrl,
      })),
    });
    const providerMessageId = typeof result?.sid === 'string' ? result.sid : null;
    const status = typeof result?.status === 'string' ? result.status : 'accepted';
    console.info(`[WhatsApp] Notification sent for token ${tokenCode} status=${status}`);
    persistDelivery({
      ...persistBase,
      status: 'SENT',
      providerMessageId,
    });
    return {
      attempted: true,
      accepted: true,
      ...(providerMessageId ? { providerMessageId } : {}),
      status,
    };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    console.error(`[WhatsApp] Notification failed for token ${tokenCode}: ${errorCode}`);
    persistDelivery({ ...persistBase, status: 'FAILED', errorCode });
    return { attempted: true, accepted: false, reason: errorCode };
  }
}

export { contentVariables as buildWhatsAppContentVariables };
