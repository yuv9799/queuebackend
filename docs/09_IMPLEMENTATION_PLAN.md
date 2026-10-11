# 09 — Implementation Plan
**KIMS Queue — Bhubaneswar Medical Sciences**
*Derived from the actual state of the codebase. Priorities: P0 Critical · P1 High · P2 Medium · P3 Low.*

---

## Completed (working today)
- Token generation kiosk with auto/best/preferred doctor assignment.
- Token status tracking + live board.
- Token lifecycle operations (call, serve, complete, hold, skip, recall, cancel, no-show, priority, estimate).
- Staff Console (Overview / Doctors / Live Queue / Tokens / Patients / History) with realtime socket sync + audit.
- **Assign Doctor** (unassigned → doctor) and **Reassign** (doctor → doctor) correctly separated (UI fix applied).
- Admin dashboard: analytics, structure CRUD, review moderation, SOS panel.
- Patient database (search/register/token history).
- Reviews lifecycle + analytics + demo seeding.
- Emergency: landing section, modal, SOS, nearest help point, tel:/Maps.
- JWT authentication, role guards, web notifications, audit log.
- Backend test suite (29 tests passing).

## Partially Implemented
| Item | What exists | What is missing |
|---|---|---|
| OTP login | Phone → demo OTP `123456` | Real SMS gateway / TOTP |
| Redistribution | `Queue.redistributePreview/Confirm` model | No HTTP route; FE methods point to missing endpoints |
| Doctor experience | Role recognized, status self-set, token ops allowed | No dedicated doctor dashboard/portal |
| Reception UX | Role + token ops per route lists | UI treats reception largely as read-mostly; guards overlap |
| `review` category "APPOINTMENTS" | constant exists | No appointment feature |
| Staff department scoping | `users.department_id` column | Not enforced on any endpoint |

## Missing (referenced/scaffolded but not implemented)
- `POST /assignments/redistribute-preview` and `POST /assignments/redistribute` (backend routes).
- SMS/WhatsApp delivery providers (`Notify.deliver` returns PENDING without a key).
- Real OTP provider.
- Dedicated doctor portal page.
- Appointment booking module.
- Full user management UI (only user list in Admin).

## Bugs / Behavior gaps
1. `/auth/me` registered in both `routes/auth.js` and `routes/otp.js`; one is shadowed — ambiguous handler (P1: dedupe).
2. Frontend `api.redistributePreview/redistributeConfirm` call routes that do not exist → would 404 if invoked (P1: wire routes or remove).
3. Public live snapshot strips `patient_name` in `Token.live`, but `Token.list` (used by `/queues/unassigned` and `/tokens`) exposes `patient_name` to any optionalAuth caller — visibility inconsistency (P2).
4. Doctor role can log into `/staff` but the StaffConsole assumes `officer/admin` operations; a doctor may see non-functional admin controls (P1/P2 UX).

## Improvements (non-blocking)
- P2: Add pagination to token/patient/review lists (currently capped, not paginated).
- P2: Add rate limiting beyond SOS; general API rate limiting.
- P3: Migrate from `node:sqlite` single file if multi-instance scaling is required.
- P3: Introduce a proper form-validation layer (currently inline).
- P2: Update documentation constants (Emergency numbers) via env config rather than hardcoded fallback.
- P3: Mobile-native vs PWA decision.

---

*Next: see `10_GAP_ANALYSIS.md`.*