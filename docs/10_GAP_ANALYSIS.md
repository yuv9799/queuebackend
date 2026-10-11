# 10 — Gap Analysis / Future Improvements
**KIMS Queue — Bhubaneswar Medical Sciences**

Compares **PRD vs Frontend vs Backend vs Database vs User Flows**. Severity: **P0-P3**.

---

## Gaps

### GAP-1 — Redistribution UI has no backend route
- **Current state:** FE `api.redistributePreview`/`redistributeConfirm` call `POST /assignments/redistribute-preview` and `/redistribute`; backend `routes/assignments.js` does **not** expose them.
- **Expected state:** Either expose the `Queue.redistributePreview`/`redistributeConfirm` model via routes (and add a staff UI), or remove the unused FE methods.
- **Affected:** `services/api.js`, `routes/assignments.js`, `models/Queue.js`.
- **Severity:** P1.
- **Recommended action:** Wire routes behind `officer/admin/reception`; add a "Reassign all from unavailable doctor" action in Doctor tab, or document as planned and remove FE stubs.

### GAP-2 — Duplicate `/auth/me` registration
- **Current state:** `routes/auth.js` and `routes/otp.js` both define `GET /me`; both mounted at `/auth`. First handler wins.
- **Expected state:** one canonical `/auth/me`.
- **Affected:** `routes/auth.js`, `routes/otp.js`.
- **Severity:** P1 (maintainability / ambiguity).
- **Recommended action:** keep the auth.js handler; remove the duplicate from `otp.js` (the disabled-account check could move into `requireAuth`).

### GAP-3 — Patient-name visibility inconsistency
- **Current state:** `Token.live` strips `patient_name` for the public board; `Token.list` (backed by `/tokens` optionalAuth and `/queues/unassigned`) returns `patient_name` to any token holder.
- **Expected state:** consistent privacy policy for patient-name exposure.
- **Affected:** `models/Token.js`, `routes/tokens.js`, `routes/queues.js`.
- **Severity:** P2.
- **Recommended action:** define and enforce a single projection for public vs staff token payloads.

### GAP-4 — Doctor role lacks a dedicated surface
- **Current state:** `doctor` may open `/staff` and set own status, but StaffConsole is officer/admin-centric; no clinician dashboard.
- **Expected state:** a goals-aligned doctor portal or restricted staff view.
- **Affected:** `pages/StaffConsole.jsx`, `App.jsx`.
- **Severity:** P1/P2.
- **Recommended action:** add a doctor-scoped view (current patient, waiting list, complete action) reusing existing endpoints.

### GAP-5 — Reception vs operations role overlap
- **Current state:** reception is allowed `assign-doctor`, priority, estimate and all token ops via route role lists, but UI marks reception as non-operations (`isOps=false`).
- **Expected state:** a single, documented authorization source; UI consistency.
- **Affected:** `routes/tokens.js`, `pages/StaffConsole.jsx`, `07_ROLES_PERMISSIONS.md`.
- **Severity:** P2.
- **Recommended action:** tighten route role lists or surface reception capabilities in the UI; document the matrix as implemented.

### GAP-6 — Appointment feature is taxonomy-only
- **Current state:** `REVIEW_CATEGORIES` includes `APPOINTMENTS`; no booking module/frontend/db table.
- **Expected state:** either build appointments or mark explicitly as planned.
- **Affected:** `models/Review.js` (constant).
- **Severity:** P3.
- **Recommended action:** remove the constant or add an appointment module.

### GAP-7 — SMS/WhatsApp/OTP providers not delivered
- **Current state:** `Notify.deliver` returns `PENDING:no_provider_configured` without provider keys; OTP is a demo bypass.
- **Expected state:** real provider integration (env keys) or explicit "planned".
- **Affected:** `models/Notify.js`, `routes/otp.js`.
- **Severity:** P1 (for production readiness); P3 (for demo).
- **Recommended action:** integrate a provider behind `SMS_PROVIDER_KEY`/`WHATSAPP_PROVIDER_KEY`; generate/verify real OTP.

### GAP-8 — No real user-management UI
- **Current state:** Admin lists users (`/auth/users`) but cannot edit/disable from UI; model supports `setDisabled`.
- **Expected state:** user CRUD / enable-disable / role edits.
- **Affected:** `pages/Admin.jsx`, `routes/auth.js`, `models/User.js`.
- **Severity:** P2.
- **Recommended action:** add management UI + endpoint for `users.disabled` / phone.

### GAP-9 — List endpoints are capped but not paginated
- **Current state:** tokens/patients/reviews capped by `limit` with no pagination cursor.
- **Expected state:** pagination for large datasets.
- **Affected:** `models/Token.js`, `models/Review.js`, `models/Patient.js`.
- **Severity:** P3.

### GAP-10 — Staff department scoping unused
- **Current state:** `users.department_id` column exists; no endpoint enforces it.
- **Expected state:** if intended, enforce scope in routes.
- **Affected:** `config/db.js`, routes.
- **Severity:** P3.

---

## Cross-document consistency sign-off
The ten documents describe the same system:
- **Assign vs Reassign:** PRD lists both ✅; App-flow has both flows; UI brief lists both modals; Schema has `tokens.doctor_id` + `DOCTOR_ASSIGNED/DOCTOR_CHANGED` audit; API documents `/tokens/:id/assign-doctor`; Roles matrix shows officer/admin/reception; Feature inventory lists both ✅; Implementation plan marks both completed (GAP none for this).
- **Emergency:** PRD, flow, UI brief, schema (sos_requests/help_points), API, roles, inventory all align.
- **Doctor auto-assignment & redistribution:** inventory flags redistribution as partial; TRD/API/schema reflect the missing route (GAP-1).

---

## Final summary
**Documentation created:** `docs/01_PRD.md` → `docs/10_GAP_ANALYSIS.md` (10 files).
**Application audit:** frontend, backend, database, APIs, roles, and user flows reviewed from source.
**Major completed:** token/queue system, staff console, admin analytics, reviews, emergency/SOS, auth + RBAC.
**Partially implemented:** OTP (demo), redistribution (model-only), doctor portal, reception UX, appointments (taxonomy-only), SMS/WhatsApp.
**Top gaps:** redistribution route missing (P1), duplicate `/auth/me` (P1), patient-name visibility (P2), doctor/reception role surface (P1/P2).