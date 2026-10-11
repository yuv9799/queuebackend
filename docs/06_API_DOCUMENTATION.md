# 06 — API Documentation
**KIMS Queue — Bhubaneswar Medical Sciences**
*Reverse-engineered from `backend/app.js`, `backend/routes/*.js`, and `frontend/src/services/api.js`.*

**Conventions**
- Base URL: `http://localhost:8080` (backend). All routes are also exposed under `/api` (e.g. `/api/tokens`).
- Auth: `Authorization: Bearer <jwt>` via `requireAuth`; roles via `requireRole(...)`.
- Errors: JSON `{ error: string }`; 4xx for client/authorization, 409 for state conflicts, 500 fallback.
- "officer alias" (in `tokens.js`) = roles `officer | admin | reception | doctor`.

---

## Health
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` or `/api/health` | — | `{ ok, service, ts }` |

## Authentication
| Method | Path | Auth/Role | Request | Response | Notes |
|---|---|---|---|---|---|
| POST | `/auth/login` | public | `{ email, password }` | `{ token, user }` | bcrypt verify → JWT (7d) |
| POST | `/auth/register` | admin | `{ name, email, password, role }` | `201 { user }` | role ∈ admin\|officer\|reception\|doctor |
| GET | `/auth/me` | auth | — | `{ user }` | current user *(TODO: two handlers registered; auth.js one wins)* |
| GET | `/auth/users` | admin | — | `{ users }` | list staff |
| POST | `/auth/otp/request` | public | `{ phone }` | `{ ok, phone, devOtp, demo }` | finds staff by phone; demo returns OTP |
| POST | `/auth/otp/verify` | public | `{ phone, otp }` | `{ token, user, demo }` | dev bypass for demo; else refused |

**DB:** users. **Frontend consumers:** `AuthContext`, `Login`.

---

## Departments / Areas / Counters (structure)
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| GET | `/departments` | public | list departments |
| GET | `/departments/:id` | public | one department |
| POST | `/departments` | admin | create (name, code, color, enabled) |
| PUT | `/departments/:id` | admin | update |
| DELETE | `/departments/:id` | admin | delete |
| GET | `/areas?departmentId=` | public | list areas |
| GET | `/areas/:id` | public | one area |
| POST | `/areas` | admin | create (departmentId, name, code, floor) |
| PUT | `/areas/:id` | admin | update |
| DELETE | `/areas/:id` | admin | delete |
| GET | `/counters?areaId=` | auth | list counters |
| GET | `/counters/:id` | auth | one counter |
| POST | `/counters` | admin | create (areaId, name) |
| PUT | `/counters/:id` | admin | update |
| DELETE | `/counters/:id` | admin | delete |

**DB:** departments, areas, counters. **Consumers:** TokenKiosk, Departments, LiveBoard, Home, Admin manage tab.

---

## Tokens
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| POST | `/tokens` | public (optionalAuth) | issue token |
| GET | `/tokens/live` | public | per-area snapshot `{ serving, queue, held }` |
| GET | `/tokens/by-number/:number` | public | lookup + estimates |
| GET | `/tokens` | optionalAuth | filter (status, areaId, departmentId, doctorId, limit) |
| GET | `/tokens/:id/status` | public | token + estimates alias |
| GET | `/tokens/:id` | public | token + estimates |
| POST/PATCH | `/tokens/:id/call` | officer alias | call → called |
| POST/PATCH | `/tokens/:id/recall` | officer alias | recall (called) |
| POST/PATCH | `/tokens/:id/serve` `/start` | officer alias | called → serving/in_consultation |
| POST/PATCH | `/tokens/:id/complete` | officer alias | → completed |
| POST/PATCH | `/tokens/:id/skip` | officer alias | → skipped |
| POST/PATCH | `/tokens/:id/no-show` | officer alias | → no_show |
| POST/PATCH | `/tokens/:id/hold` | officer alias | → held |
| POST/PATCH | `/tokens/:id/cancel` | officer/admin/reception/doctor | → cancelled |
| POST/PATCH | `/tokens/:id/assign-doctor` | officer/admin/reception | set doctor (assign OR reassign) |
| POST | `/tokens/:id/priority` | officer/admin/reception | `{ priority, reason }` |
| POST | `/tokens/:id/estimate` | officer/admin/reception | `{ estimatedWaitMinutes, estimatedServiceTime }` |
| POST | `/tokens/next` | officer alias | call next queued in area |

**Issue token request:** `{ departmentId, areaId?, patientName?, phone?, preferredDoctorId?, doctorId?, priority? (staff), patientId? }`
**Issue token response:** `{ token, position, peopleAhead, estimatedWaitMinutes, estimatedServiceTime, notifications }`
**assign-doctor request:** `{ doctorId, reason?, override? }` → `{ token, ...estimates }` (audit: DOCTOR_ASSIGNED when previously unassigned, DOCTOR_CHANGED when reassigning).

**DB:** tokens, token_seq, departments, areas, counters, doctors, patients, notifications, audit_logs.
**Frontend consumers:** `TokenKiosk`, `TokenStatus`, `LiveQueueCard`, `LiveBoard`, `StaffConsole`.

---

*Part B: doctors, patients, queues, assignments, staff, stats, reviews, emergency, notifications, audit.*

---

## Doctors
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| GET | `/doctors/public` | public | active doctors (departmentId/specialization/status/search/q) |
| GET | `/doctors` | auth | list with filters + workload |
| GET | `/doctors/:id` | auth | doctor + workload |
| GET | `/doctors/:id/queue` | auth | `{ doctor, serving, waiting, waitingCount, estimatedWaitMinutes }` |
| POST | `/doctors` | admin\|officer | create |
| PUT/PATCH | `/doctors/:id` | admin\|officer | update |
| POST/PATCH | `/doctors/:id/status` | officer\|admin\|reception\|doctor | set availability |
| DELETE | `/doctors/:id` | admin | delete |

**DB:** doctors, tokens (workload queries). **Consumers:** TokenKiosk, StaffConsole.

## Patients
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| POST | `/patients` | reception\|admin\|officer | register (find-or-create) |
| GET | `/patients/search?q=` | reception\|admin\|officer | search name/number/phone |
| GET | `/patients/:id` | optionalAuth | one patient |
| GET | `/patients/:id/tokens` | optionalAuth | patient's tokens |

**DB:** patients, tokens. **Consumers:** StaffConsole (Patients tab).

## Queues
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| GET | `/queues/live` | officer\|admin\|reception | queues grouped by doctor per department |
| GET | `/queues/unassigned` | officer\|admin\|reception | `{ tokens }` queued with no doctor |

**DB:** departments, doctors, tokens. **Consumers:** StaffConsole (Live Queue, Overview).

## Assignments
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| POST | `/assignments/recommend` | officer\|admin\|reception | `{ tokenId, preferDoctorId }` → recommendation + alternatives |
| POST | `/assignments` | officer\|admin\|reception | `{ tokenId, doctorId, reason?, override?, preferred? }` → assign/change |
| POST | `/assignments/redistribute-preview` `/redistribute` | (referenced by FE) | **NOT implemented in backend** (see Gap Analysis) |

**DB:** tokens, doctors, audit. **Consumers:** StaffConsole.

## Staff
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| GET | `/staff/dashboard` | admin\|officer\|reception | summary metrics + `unassigned` + recent activity |

**DB:** tokens, doctors, notifications, audit. **Consumers:** StaffConsole Overview.

## Stats
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| GET | `/stats/overview` | auth | issuedToday, completedToday, avgWaitSeconds, queuedNow, servingNow |
| GET | `/stats/status` | auth | tokens by status today |
| GET | `/stats/hourly` | auth | tokens per hour today |
| GET | `/stats/queue-depth` | auth | queued/serving per area |
| GET | `/stats/by-department` | auth | issued/completed per department |

**DB:** tokens, areas, departments. **Consumers:** Admin Overview, LiveQueueCard (overview).

## Reviews
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| GET | `/reviews` | public | approved reviews (filters: departmentId/type/rating/category/q/sort/limit) |
| GET | `/reviews/summary` | public | aggregate rating + distribution |
| GET | `/reviews/analytics` | admin\|officer | top requested improvements + categories |
| POST | `/reviews` | public (optionalAuth) | submit `{ reviewerName?, reviewerType, rating, comment, departmentId?, serviceAreaId?, category?, request? }` |
| GET | `/reviews/admin` | admin\|officer | moderation list (status/type/etc.) |
| PATCH | `/reviews/:id/status` | admin\|officer | approve/reject/pending |
| DELETE | `/reviews/:id` | admin | delete |

**DB:** reviews. **Consumers:** ReviewsPanel, ReviewDrawer, Admin Reviews, StarRating.

## Emergency
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| POST | `/emergency/sos` | public (optionalAuth) | create SOS (rate-limited 4/min/IP, idempotent) |
| GET | `/emergency/sos/:id` | public | get SOS status |
| GET | `/emergency/sos` | admin\|officer | list SOS |
| POST | `/emergency/sos/:id/acknowledge\|respond\|resolve\|cancel` | admin\|officer | state transition |
| GET | `/emergency/help-points` | public | list help points |
| GET | `/emergency/help-points/nearest?lat=&lng=` | public | nearest help point |

**DB:** sos_requests, help_points. **Consumers:** EmergencyModal, SOSPanel.

## Notifications
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| GET | `/notifications?tokenId=` | officer\|admin\|reception | list notifications |

**DB:** notifications. **Consumers:** StaffConsole (bell), audit of delivery.

## Audit
| Method | Path | Auth/Role | Purpose |
|---|---|---|---|
| GET | `/audit?limit=` | admin\|officer | audit log |

**DB:** audit_logs. **Consumers:** StaffConsole History.

---

*Next: see `07_ROLES_PERMISSIONS.md`.*