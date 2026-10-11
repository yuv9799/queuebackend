import * as Notify from '../../models/Notify.js';
import * as Msg91 from './msg91.js';

const PROVIDERS = { msg91: Msg91 };
const DEFAULT_PUBLIC_APP_URL = 'https://kims-queue.vercel.app/';

export function normalizeIndianPhone(phone) {
  if (phone === null || phone === undefined || String(phone).trim() === '') return null;
  const value = String(phone).trim();
  if (!/^[+\d\s().-]+$/.test(value)) return null;
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0091')) digits = digits.slice(4);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `+91${digits}`;
}

function maskPhone(phone) {
  return `******${phone.slice(-4)}`;
}

function trackingUrl(tokenId) {
  const baseUrl = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || DEFAULT_PUBLIC_APP_URL;
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(`status?id=${encodeURIComponent(tokenId)}`, base).toString();
}

function logDelivery(phone, tokenCode, status, reason = null) {
  const message = status === 'accepted'
    ? `SMS request: phone=${maskPhone(phone)} token=${tokenCode} status=accepted`
    : `SMS delivery failed: phone=${maskPhone(phone)} token=${tokenCode} reason=${reason}`;
  if (status === 'accepted') console.info(message);
  else console.error(message);
}

function persistDelivery(details) {
  try {
    Notify.recordSms(details);
  } catch {
    console.error('SMS notification record failed.');
  }
}

export async function sendTokenSMS({
  phone,
  token,
  patientName,
  department,
  doctor,
  counter,
  queuePosition,
  estimatedWait,
  trackingUrl: providedTrackingUrl,
}) {
  if (process.env.SMS_ENABLED !== 'true') {
    console.info('SMS disabled; notification skipped.');
    return { attempted: false, accepted: false };
  }
  if (phone === null || phone === undefined || String(phone).trim() === '') {
    return { attempted: false, accepted: false, reason: 'no_phone' };
  }

  const normalizedPhone = normalizeIndianPhone(phone);
  if (!normalizedPhone) {
    console.info('SMS notification skipped: invalid phone number.');
    return { attempted: false, accepted: false, reason: 'invalid_phone' };
  }

  const tokenCode = token?.token_code || String(token?.token_number ?? 'unknown');
  const providerName = (process.env.SMS_PROVIDER || 'msg91').toLowerCase();
  const provider = PROVIDERS[providerName];
  let accepted = false;
  let providerMessageId = null;
  let errorCode = null;

  try {
    if (!provider) {
      errorCode = 'provider_not_supported';
      throw new Error(errorCode);
    }
    const { MSG91_AUTH_KEY: authKey, MSG91_TEMPLATE_ID: templateId, MSG91_SENDER_ID: senderId } = process.env;
    if (providerName === 'msg91' && (!authKey || !templateId || !senderId)) {
      errorCode = 'provider_configuration_missing';
      throw new Error(errorCode);
    }
    const result = await provider.send({
      authKey,
      templateId,
      phone: normalizedPhone,
      variables: {
        VAR1: tokenCode,
        VAR2: patientName || 'Walk-in',
        VAR3: department || 'Not available',
        VAR4: doctor || 'Not assigned',
        VAR5: counter || 'Not available',
        VAR6: String(queuePosition ?? 'Not available'),
        VAR7: token?.status || 'Not available',
        VAR8: estimatedWait === null || estimatedWait === undefined ? 'Not available' : String(estimatedWait),
        VAR9: providedTrackingUrl || trackingUrl(token?.id),
      },
    });
    accepted = result.accepted;
    providerMessageId = result.providerMessageId;
  } catch (error) {
    errorCode = error?.code || (error?.message === 'provider_configuration_missing' || error?.message === 'provider_not_supported'
      ? error.message
      : 'delivery_failed');
  }

  const result = { attempted: true, accepted };
  if (accepted) {
    logDelivery(normalizedPhone, tokenCode, 'accepted');
  } else {
    logDelivery(normalizedPhone, tokenCode, 'failed', errorCode || 'delivery_failed');
    result.reason = errorCode || 'delivery_failed';
  }

  persistDelivery({
    tokenId: token?.id,
    patientId: token?.patient_id,
    phone: normalizedPhone,
    status: accepted ? 'SENT' : 'FAILED',
    provider: providerName,
    providerMessageId,
    errorCode,
  });
  return result;
}
