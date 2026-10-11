# KIMS Queue SMS notifications

## Architecture

Token creation continues through the existing `POST /tokens` API. Once the token, doctor assignment, and queue estimate have been calculated and the token is saved, the Express route calls `sendTokenSMS`. That notification service validates the Indian mobile number, selects the configured SMS provider, and records its result in the existing `notifications` table. SMS errors are isolated from token creation, and the existing token response fields are unchanged; `smsNotification` is an additive field.

Provider-specific HTTP logic lives under `backend/services/sms/`. The initial provider is MSG91 Flow; additional providers can be added behind the same service boundary.

The message values come from the newly created token and its existing department, doctor, service-area/counter, queue-position, status, and wait-estimate data. The tracking link uses the existing My Token status route (`/status?id=<token-id>`).

## MSG91 account and Indian DLT setup

Before enabling production SMS, configure an MSG91 account and complete the Indian TRAI Distributed Ledger Technology (DLT) requirements applicable to your organization and message traffic:

1. Register the KIMS principal entity and obtain/verify its DLT registration.
2. Register an approved sender header (sender ID) and set it as `MSG91_SENDER_ID`.
3. Register and obtain approval for the exact transactional/service message template with your telecom operator/DLT platform.
4. Create a matching MSG91 Flow template and set its Flow/template ID as `MSG91_TEMPLATE_ID`.
5. Confirm the MSG91 Flow fields map to the approved template variables below, in the same order and wording as the approved DLT template. Delivery depends on operator approval and correct variable mapping.
6. Put the MSG91 auth key into the backend-only `MSG91_AUTH_KEY` secret.

The backend uses the MSG91 Flow API with the configured template ID; it does not submit arbitrary SMS message text. A sender header, approved DLT template, and corresponding MSG91 Flow must exist. Do not assume an unregistered message will be accepted for delivery.

## Template content and variables

Suggested template body (register the final wording and placeholders with the DLT operator and MSG91):

```text
KIMS Queue: Token {#var#} generated for {#var#}.
Department: {#var#}; Doctor: {#var#}; Counter: {#var#}.
Queue position: {#var#}; Status: {#var#}; Estimated wait: {#var#}.
Track your token: {#var#}
```

Map the MSG91 Flow's `VAR1`–`VAR9` fields to the values sent by the backend, in order:

1. `VAR1`: token number
2. `VAR2`: patient name
3. `VAR3`: department
4. `VAR4`: assigned doctor
5. `VAR5`: counter (service area/floor when a counter is not yet assigned)
6. `VAR6`: queue position
7. `VAR7`: token status
8. `VAR8`: estimated wait
9. `VAR9`: tracking URL

The Flow template's `VAR1`–`VAR9` mapping and ordering must match its approved DLT content. MSG91 associates the sender/header with the configured Flow template; the backend checks `MSG91_SENDER_ID` is configured but does not try to override the template's sender at request time. “Not assigned”/“Not available” values are used when the existing queue data has no doctor/counter/estimate.

## Environment variables

Set these only in the backend environment (never in Vite or the frontend):

| Variable | Required | Purpose |
|---|---:|---|
| `SMS_ENABLED` | Yes | Set to `true` to enable send attempts; unset/false disables SMS. |
| `SMS_PROVIDER` | No | Provider selector; defaults to `msg91`. |
| `MSG91_AUTH_KEY` | Yes when enabled | MSG91 authentication key. Treat as a secret. |
| `MSG91_TEMPLATE_ID` | Yes when enabled | MSG91 Flow template ID matching the approved DLT template. |
| `MSG91_SENDER_ID` | Yes when enabled | Expected approved sender header associated with the MSG91 Flow template. |
| `PUBLIC_APP_URL` | No | Public frontend base URL used for the existing `/status?id=...` link. Defaults to the KIMS Queue GitHub Pages URL. |

No credentials belong in `.env.example`, source control, client-side code, or any `VITE_*` variable.

## Local development

Copy `backend/.env.example` to `backend/.env` if desired, then leave `SMS_ENABLED=false` (the safe default). Token generation works normally and the backend logs only:

```text
SMS disabled; notification skipped.
```

To exercise the provider integration, use test credentials and an approved test template in a private backend-only environment. Automated tests mock `fetch`; they never call MSG91.

## Render deployment

In the Render backend service's **Environment** settings, add `SMS_ENABLED=true`, `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, and `MSG91_SENDER_ID`. Set `PUBLIC_APP_URL` if the frontend's public base URL differs from the default. Enter secrets directly in Render's secret environment settings; do not add them to the repository or frontend build configuration. Redeploy the backend after setting the variables.

## Failures, logging, and persistence

An empty or invalid phone number is not sent. Indian numbers may be entered as 10 digits or with the `+91` country code; the backend normalizes valid values before submitting them. A missing provider configuration, provider rejection, timeout, or network error is recorded as a failed SMS notification in the existing notifications table and logged with a masked phone number and a safe error category. Provider response bodies and credentials are never logged.

The notification attempt is made only after token creation succeeds. SMS failures do not roll back the token and do not change the successful HTTP status or existing response fields. A provider-accepted result means MSG91 accepted the request, not that a handset received the SMS.

## Production readiness

The integration is not production-ready until KIMS has configured the MSG91 account, sender header, DLT-approved template/Flow, and backend credentials, and has verified real delivery in the intended deployment environment.

## Twilio WhatsApp notifications

WhatsApp is an additional channel; MSG91 remains unchanged. A token is saved
before either provider is called. The kiosk and assistant ask for explicit
WhatsApp consent separately from the phone number. Consent is recorded on that
token (`whatsapp_opt_in`, with `whatsapp_opt_in_at`); existing tokens and
requests without consent default to opted out. Changing the phone number in
the kiosk or editing assistant booking details clears consent. SMS continues
to use its existing behavior.

For an opted-in token, the backend sends a Twilio Content API message using the
Content SID configured below. It does not send arbitrary free-form WhatsApp
text. The eight `ContentVariables` entries are:

1. `{{1}}`: token code
2. `{{2}}`: department
3. `{{3}}`: assigned doctor
4. `{{4}}`: doctor's room, or counter/service area if no room is assigned
5. `{{5}}`: patient name
6. `{{6}}`: queue status (for example, “You are next”)
7. `{{7}}`: estimated wait (for example, “< 5 min”)
8. `{{8}}`: public My Token URL

Create a Twilio Content Template with these variables, such as:

```text
🏥 KIMS Queue
Token: {{1}}
Department: {{2}}
Doctor: {{3}}
Room: {{4}}
Patient: {{5}}
Queue Status: {{6}}
Estimated Wait: {{7}}
Please proceed to {{4}} when called.
Track your token: {{8}}
```

Use a WhatsApp-approved utility template and ensure its approval, variable
count, and exact wording match the deployed template. In Twilio Console, open
**Messaging → Content Template Builder**, then copy that template's Content SID
(it begins with `HX`). Do not guess or reuse a Content SID from another account.
See Twilio's [Content API template guide](https://www.twilio.com/docs/content/send-templates-created-with-the-content-template-builder)
for the supported `ContentSid` and `ContentVariables` request format.

Set these in the **backend** environment only:

| Variable | Required | Purpose |
|---|---:|---|
| `TWILIO_WHATSAPP_ENABLED` | Yes | Set to `true` to allow consented sends; defaults to disabled. |
| `TWILIO_ACCOUNT_SID` | Yes when enabled | Twilio Account SID (`AC...`). |
| `TWILIO_AUTH_TOKEN` | Yes when enabled | Twilio Auth Token. Store as a backend secret. |
| `TWILIO_WHATSAPP_FROM` | Yes when enabled | WhatsApp sender in `whatsapp:+<E.164 number>` form. For Sandbox, use the sender shown in your Twilio Console. |
| `TWILIO_WHATSAPP_CONTENT_SID` | Yes when enabled | Content SID for the approved template containing the eight variables above. |

The Twilio Sandbox is for testing only. Twilio currently allows Sandbox
messages only to numbers that joined that Sandbox. Outside its 24-hour
customer-service window, the Sandbox accepts only its fixed pre-approved
templates; it does **not** support custom templates. The built-in Sandbox
templates do not contain the KIMS queue fields above, so the full queue message
cannot be tested through the Sandbox until Twilio provides an applicable
pre-approved template. Do not substitute a custom Content SID: Twilio will
reject custom templates on the Sandbox. To test the complete KIMS message,
use a WhatsApp-approved sender and approved Content Template. A free-form
message is not used as a fallback.

Sandbox recipients must send the current `join ...` code displayed by Twilio
to the Sandbox sender before testing. Sandbox membership expires after three
days, and the shared Sandbox sender allows only one message every three
seconds. Trial accounts also have message limits. See Twilio's current
[Sandbox documentation](https://www.twilio.com/docs/whatsapp/sandbox).

### Local and deployed setup

1. In Twilio Console, rotate any Auth Token that has been pasted into a chat,
   issue tracker, source file, or other shared location. Use the newly rotated
   token; do not copy the exposed one into project files.
2. Obtain the Content SID and sender from the same Twilio account configured
   for this backend. For a Sandbox, the sender must be the displayed Sandbox
   number; for production, use the approved WhatsApp sender.
3. Add the five `TWILIO_*` variables to `backend/.env` for local testing, or to
   the backend hosting service's private environment settings (for example,
   Render → service → Environment). Set `TWILIO_WHATSAPP_ENABLED=true` only
   after a compatible Content Template/SID is available.
4. Restart/redeploy the backend. Do not add Twilio variables to Vite, frontend
   environment variables, or source control.
5. In the kiosk, enter the recipient's mobile number and check the separate
   WhatsApp consent box; or, in the assistant booking confirmation, select
   **Also notify me on WhatsApp**. Confirm the token request.
6. Verify the token exists in My Token and the response reports
   `whatsappNotification.accepted`. Check the message SID/status in the
   response and the WhatsApp notification record in the staff notification
   view/database. “Accepted” means Twilio accepted the request, not that
   WhatsApp delivered it; check delivery status in Twilio Console as well.
7. To verify failure handling, temporarily disable the channel or use a
   non-joined Sandbox recipient. The token should still be created; inspect the
   notification record for a safe failure code and confirm no credentials or
   full phone number appear in backend logs.

The backend records WhatsApp outcomes in the existing `notifications` table.
Provider errors are reduced to safe error codes; Auth Tokens, message bodies,
and full recipient numbers are not logged. Twilio failure does not roll back a
saved token or block MSG91. A missing/invalid phone, absent consent, disabled
channel, or missing Twilio configuration never causes an arbitrary message to
be sent.
