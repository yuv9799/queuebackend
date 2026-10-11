const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow/';

export class SmsProviderError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export async function send({ authKey, templateId, phone, variables }) {
  let response;
  try {
    response = await fetch(MSG91_FLOW_URL, {
      method: 'POST',
      headers: {
        authkey: authKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template_id: templateId,
        short_url: '0',
        recipients: [{ mobiles: phone.replace(/^\+/, ''), ...variables }],
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    throw new SmsProviderError(error?.name === 'TimeoutError' ? 'request_timeout' : 'request_failed');
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    // Some successful provider responses have no JSON body.
  }

  if (!response.ok || result?.type === 'error' || result?.success === false) {
    throw new SmsProviderError(`provider_rejected_${response.status}`);
  }

  return {
    accepted: true,
    providerMessageId: result?.request_id || result?.message_id || null,
  };
}
