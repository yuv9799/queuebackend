# 01 — Product Requirements Document (PRD)
**KIMS Queue — Bhubaneswar Medical Sciences**
*Status: Reverse-engineered from the current implementation. The codebase is the source of truth.*

---

## 1. Product Overview

- **Product name:** KIMS Queue — Hospital Queue & Token Management System
- **Institution:** Kalinga Institute of Medical Sciences (KIMS), Kushabhadra Campus, Bhubaneswar, Odisha, India
- **Product type:** Web application (SPA) + REST API + realtime (WebSocket) queue-management platform.

### Purpose
Digitize the hospital patient journey around waiting. Patients obtain a queue token for a clinical department/service area, track their live queue position and estimated wait, and are served by staff who operate the queue from a control center. The product manages departments, service areas, counters, doctors, patients, tokens, reviews, notifications, and emergency (SOS) flows.

### Problem being solved
- Long, opaque, physical waiting lines in hospital OPD/ancillary departments.
- No live visibility by patients of their position or expected wait.
- Staff managing queues manually with no realtime coordination.
- No audit trail for queue-driving actions.
- No structured feedback loop for the queue experience.
- No integrated emergency/help channel for patients inside the hospital.

### Target users
- **Patients / public** (walk-in kiosk users, no login required).
- **Admin** (`admin`).
- **Counter Officer** (`officer`).
- **Reception Staff** (`reception`).
- **Doctor** (`doctor`).

### Primary use cases
1. Patient generates a token for a department/service area.
2. Patient tracks token position and estimated wait; sees live TV board.
3. Staff assign an unassigned patient to a doctor.
4. Staff call, serve, hold, skip, complete, recall, cancel tokens.
5. Staff reassign an already-assigned patient to a different doctor.
6. Staff/admin manage the queue state in realtime; browse doctors, tokens, patients, audit log.
7. Admin manages structural entities (departments, areas, counters), staff accounts, reviews.
8. Anyone in need requests emergency assistance (SOS) and/or contacts emergency services.

### Product goals
- Reduce unnecessary physical waiting through digital tokens and live tracking.
- Provide realtime queue operations with auditability.
- Keep normal queue operations separate from emergency flows.

### Non-goals (current, based on implementation)
- Online appointment booking (the review category constant `APPOINTMENTS` exists, but there is **no booking module**).
- Patient self-service accounts/login (patients are anonymous kiosk users).
- Billing / payment integration.
- SMS/WhatsApp delivery (scaffolded, but no real provider configured).
- Mobile native app (responsive web only).

---

## 2. User Types (as implemented)

| Role | Source of truth | Login | Primary surfaces |
|---|---|---|---|
| Patient / Public | kiosk, no account | None (optional phone/name) | Home kiosk, `/status`, `/live`, `/departments`, `/help` |
| Admin — `admin` | `users` table | Email/password or OTP (phone) | `/staff` (full) and `/admin` |
| Officer — `officer` | `users` table | Email/password or OTP (phone) | `/staff` (full) |
| Reception — `reception` | `users` table | Email/password or OTP (phone) | `/staff` (limited) |
| Doctor — `doctor` | `users` table | Email/password or OTP (phone) | `/staff` (limited; no dedicated doctor portal) |

> `STAFF_ROLES = ['admin','officer','reception','doctor']` gates all staff routes in `frontend/src/App.jsx`.

---

## 3. Core Problems (as solved by the implementation)
- **Token generation with automatic load-balancing:** `POST /tokens` optionally auto-assigns the "best" doctor in the department (shortest active queue, respecting availability and a patient's preferred doctor) via `Queue.findBestDoctorForDepartment`.
- **Live, per-department queue numbering:** `tokens.token_number` increments per department (`token_seq`); per-area `queue_seq` orders the physical queue.
- **Dynamic queue position & wait estimates:** `Queue.calculateEstimates` computes people-ahead and approximate wait from an assigned doctor's average consultation time, or area position for unassigned tokens.
- **Staff control with realtime sync:** every state transition writes an audit row and broadcasts Socket.io events (`token:updated`, `queue:updated`, `staff:update`, …).
- **Doctor assignment vs reassignment:** initial assignment (`DOCTOR_ASSIGNED`) and reassignment (`DOCTOR_CHANGED`) are separated in `Queue.assign` and, since the UI fix, in the surface (**Assign Doctor** vs **Reassign**).
- **Feedback loop:** review submission → moderation → public display + analytics.
- **Emergency channel:** SOS requests with location, nearest help point, staff acknowledgement; plus `tel:`/Maps help.

---

## 4. Core Features

> Implementation status legend: **Implemented** = fully wired FE + BE + DB; **Partially Implemented** = exists but incomplete/unexposed; **Planned / Not Yet Implemented** = scaffolded/reference only.

| Feature | Description | User(s) | Status |
|---|---|---|---|
| Token generation kiosk | Select department/area, optional preferred doctor, name & phone → token + position | Public | Implemented |
| Token status tracking | Look up token by id/number; live position, wait, served/called states | Public | Implemented |
| Live TV board | Per-area serving/next/held, group by department filter | Public | Implemented |
| Departments / Areas / Counters browse | Home showcase, `/departments`, `/help` | Public | Implemented |
| Doctor auto-assignment & recommendation | Best-doctor selection + `/assignments/recommend` | Backend / staff | Implemented |
| **Assign Doctor** (unassigned → doctor) | Dedicated modal + endpoint for initial assignment | officer / admin / reception | Implemented |
| **Reassign Patient** (doctor → doctor) | Dedicated modal + endpoint | officer / admin / reception | Implemented |
| Staff Console (Overview / Doctors / Live Queue / Tokens / Patients / History) | Operational dashboard | officer / admin (+ partial reception) | Implemented |
| Token lifecycle ops | Call / recall / start / complete / hold / skip / cancel / no-show / priority / estimate | officer / admin / reception / doctor (varies) | Implemented |
| Admin dashboard (Overview / Manage / Reviews / SOS) | Analytics, structure CRUD, moderation, SOS panel | admin | Implemented |
| Doctor CRUD & status | Create/update/delete doctors, set availability | admin/officer (write), reception/doctor (status) | Implemented |
| Doctor workload/queue view | per-doctor serving/waiting/estimates | officer/admin | Implemented |
| Patients (search / register / view tokens) | Staff patient database | reception/admin/officer | Implemented |
| Reviews (submit, moderate, analytics) | Feedback lifecycle | public + staff/admin | Implemented |
| Emergency Help (landing section + modal + footer) | tel:/maps/SOS guidance, no queue-token for emergencies | Public | Implemented (UI) |
| SOS (request, staff acknowledge/respond/resolve) | Emergency alert with location + nearest help point | Public + admin/officer | Implemented |
| Notifications (web) | In-app notification records for token events | All (web sink) | Implemented |
| Redistribution (doctor unavailable) | Model `redistributePreview`/`redistributeConfirm` | staff | **Partially Implemented** (model only, no route) |
| Redistribution API | routes | staff | **Missing** (route not wired) |
| SMS / WhatsApp delivery | Pluggable providers | - | **Planned / Not Yet Implemented** (scaffold only) |

---

## 5. Functional Requirements (from implementation)
- **Token lifecycle:** `issued → queued → called → completed` with permitted transitions enforced server-side (`Token.TRANSITIONS`). States include `serving`, `in_consultation`, `held`, `skipped`, `cancelled`, `no_show`.
- **Numbering:** token numbers unique per department and monotonic; `queue_seq` per area.
- **Assignment:** a token must not be assigned to an inactive/unavailable doctor without `override`; doctor must belong to the token's department unless `override`; assigning the same doctor returns `unchanged`.
- **Realtime:** token/queue state broadcast to subscribed clients.
- **Audit:** every queue-changing action logged with actor, before/after, reason.
- **Reviews:** ratings 1–5; comments required; moderation BEFORE public display; analytics driven by `category`/`request`.
- **Emergency:** SOS rate-limited (4/min/IP), idempotent, auto-assigned to nearest help point; staff can transition states; public SOS lookup by id.
- **Auth:** JWT (7-day); email/password login; OTP login (dev-bypass OTP `123456` for demo accounts); role-based authorization on write/ops endpoints.

---

## 6. Non-Functional Requirements
- **Performance:** SQLite `WAL`; indexes on `tokens(area_id,status,created_at)` and `tokens(area_id,queue_seq)`; FIFO queries ordered by `created_at,id`.
- **Security:** bcrypt password hashing; JWT auth; role middleware; patient names omitted from the public live snapshot; config values centralized in `src/config/*` (no real hospital numbers invented).
- **Reliability:** transactional transitions (`inTx`), idempotent notifications (`idempotency_key`), append-only audit, rate-limited SOS.
- **Scalability:** single-node Express + built-in `node:sqlite` (zero native deps); realtime via Socket.io. Single SQLite file is a documented limiter for multi-instance deployment.
- **Accessibility:** visible `:focus-visible` outlines, `aria-label`/`aria-haspopup`, semantic sections, `prefers-reduced-motion` respected in the emergency landing section, keyboard-operable modals/drawers.
- **Responsiveness:** Tailwind breakpoints (`sm`,`md`,`lg`,`xl`) across all screens; no horizontal overflow on required breakpoints (375–1440+).
- **Maintainability:** centralized config (`src/config/emergency.js`, `location.js`), tokenized Tailwind theme, service layer (`services/api.js`), context providers.

---

## 7. User Stories
- As a patient, I can generate a queue token so I do not have to stand in a physical line.
- As a patient, I can track my token's live position and estimated wait so I know when to return.
- As a patient, I can watch the live board so I know who is being served.
- As a patient with an emergency, I can access emergency help without joining the normal queue.
- As an officer, I can assign an unassigned patient to a doctor so the queue can proceed.
- As an officer, I can reassign an already-assigned patient to another doctor.
- As an officer, I can call/serve/complete/hold/skip tokens so the queue moves correctly.
- As an admin, I can manage departments, areas, counters, doctors, and staff accounts.
- As an admin, I can moderate reviews and view analytics.
- As staff, I can view an audit history so actions are traceable.

---

## 8. Acceptance Criteria (major features)
- **Token generation:** Given a department and service area, issuing a token returns a token with a position and notifications; the live board updates in realtime.
- **Assign Doctor:** For an unassigned token (no `doctor_id`), the "Assign Doctor" button opens the **"Assign Patient to Doctor"** modal (labels: Select Doctor / Note), and confirming assigns the doctor, removes the token from the unassigned list, and shows the token under that doctor's queue. Assignment must not overwrite an already-assigned patient.
- **Reassign:** For an already-assigned token, "Reassign" opens the **"Reassign Patient to Doctor"** modal (Transfer / Select Destination Doctor / Reason), and confirming moves the patient to the new doctor without duplication.
- **Token lifecycle:** Transition calls are validated against allowed transitions; terminal states cannot be altered.
- **Auth/authorization:** Anonymous access to staff endpoints returns 401/403; role mismatches return 403.
- **Emergency ≠ normal queue:** Emergency actions never generate a normal queue token.

---

*Next: see `02_TRD.md` for the technical stack and architecture.*