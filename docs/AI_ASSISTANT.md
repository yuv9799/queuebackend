# KIMS AI Assistant

## Architecture

The assistant is mounted on public pages only. The React client sends text or a
bounded action to `POST /ai/chat` (also available at `/api/ai/chat`). The
Express backend classifies supported intents, reads live department, area,
doctor, token, and queue information through the existing application models,
and keeps booking state in a short-lived server-side session.

Token generation requires a separate **Confirm & Generate Token** action. The
assistant and the existing `POST /tokens` route share the same token-creation
service, so numbering, doctor assignment, audit logging, realtime events,
notifications, and SMS continue through the established workflow. The
assistant revalidates the department, area, doctor, name, and Indian phone
number at confirmation time. Patient phone values are not returned in assistant
responses; chat display masks numbers.

The current intent engine runs locally in the backend using explicit rules and
live database values. It does not call an external model, transmit chat content
to a third party, or require an AI API key. English and common Hindi/Hinglish
phrases are supported for the configured intents. This is a safe
intent-and-workflow assistant, not a general-purpose language model; unfamiliar
requests are routed to supported actions rather than guessed.

## Supported workflows

- Find live departments and doctors.
- Match common specialty/complaint wording to active department names.
- Select an active service area and doctor, or let existing queue logic assign
  an eligible doctor.
- Collect a patient name and Indian mobile number, show a masked confirmation,
  and generate only after explicit confirmation.
- Offer a separate, optional WhatsApp consent action during booking review;
  consent is saved with that token and defaults to off. Provider configuration
  and Twilio Sandbox constraints are documented in
  [SMS_NOTIFICATIONS.md](./SMS_NOTIFICATIONS.md).
- Warn about a matching active token for the same normalized phone number.
  Patients must explicitly choose whether to continue with another token.
- Track the token saved by the existing `kims_active_token_id` mechanism or
  look up a token number.
- Show live queue counts without exposing patient names.
- Route potential emergencies to the existing Emergency Help modal and call
  108; the assistant never diagnoses or recommends treatment.
- Use browser speech recognition when supported. English (`en-IN`) and Hindi /
  Hinglish (`hi-IN`) recognition are offered. Chrome on-device recognition is
  used when the selected language pack is installed, and Chrome is asked to
  install it when downloadable. Otherwise, recognition falls back to the
  browser's speech service. Voice input depends on browser and device support,
  microphone permission, a secure page (HTTPS or localhost), and network access
  for that fallback. The UI gives actionable guidance for permission, network,
  microphone, language, and no-speech errors. Speech is sent through the same
  assistant endpoint as typed text. Browser speech recognition may use a
  browser-vendor service; users should avoid speaking sensitive medical details
  and can type instead.

## Configuration

Set `AI_ENABLED=true` in the backend environment to enable the assistant.
Setting it to `false` disables `POST /ai/chat`. The rule-based implementation
does not require `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, or `VITE_*` secrets.
Do not add provider credentials to the frontend.

The backend limits an IP to 30 assistant requests per 10 minutes. Server-side
conversation state expires after 30 minutes and is held in process memory. The
current implementation therefore expects one backend instance; use a shared
session store and distributed rate limiter before scaling to multiple backend
instances or workers.

## Notifications and SMS

After a confirmed token is created, the existing notification service runs.
SMS remains backend-only and uses the existing MSG91/DLT configuration
documented in [SMS_NOTIFICATIONS.md](./SMS_NOTIFICATIONS.md). If notification
delivery is not accepted, the token remains valid and the assistant says it
could not send the notification. Automated tests disable SMS and never call a
real provider.

## Safety and security

- User text is treated as untrusted; the assistant has no SQL or administrative
  tools and cannot change staff or queue operations.
- Emergency language is checked before booking-state handling and is routed to
  Emergency Help, not a normal token.
- Diagnosis and medication requests receive a medical-safety response.
- Booking is only invoked by a validated, explicit confirmation action. A
  repeated confirmation in the same session returns the existing result.
- Phone numbers are normalized for Indian numbers, masked in assistant output,
  and are not included in application logs or analytics.
- Session state and per-IP rate windows are in memory, not durable across
  backend restarts.
