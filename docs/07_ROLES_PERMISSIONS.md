# 07 — Role & Permission Documentation
**KIMS Queue — Bhubaneswar Medical Sciences**
*Derived from `backend/middleware/auth.js`, route guards, and frontend `App.jsx` guards.*

---

## 1. Roles
| Role | Source | Login | Notes |
|---|---|---|---|
| **Public / Patient** | none | none | anonymous kiosk + status/live/departments/help + review + SOS |
| **Admin** `admin` | `users.role` | email/OTP | full staff console + `/admin` |
| **Officer** `officer` | `users.role` | email/OTP | operational staff |
| **Reception** `reception` | `users.role` | email/OTP | front-desk staff |
| **Doctor** `doctor` | `users.role` | email/OTP | clinician (limited) |

## 2. Authentication mechanism
- JWT (HMAC, 7-day) issued by login / OTP-verify; stored in `localStorage` (`kims_token`).
- `requireAuth` resolves `users` by token sub; `requireRole(...)` enforces role membership (403 otherwise).
- Frontend `RequireStaff` (roles `admin|officer|reception|doctor`) and `RequireAdmin` (`admin`) gate routes (UI only; backend is authoritative).

## 3. Permission matrix
Legend: ✅ allowed · (—) not applicable/public · blank denied.

| Action / Endpoint | Patient | Admin | Officer | Reception | Doctor |
|---|---|---|---|---|---|
| Token generation (`POST /tokens`) | ✅ | ✅ | ✅ | ✅ | ✅¹ |
| Token status lookup | ✅ | ✅ | ✅ | ✅ | ✅ |
| Live board / departments / help | ✅ | ✅ | ✅ | ✅ | ✅ |
| Submit review | ✅ | ✅ | ✅ | ✅ | ✅ |
| SOS create / get | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Assign Doctor** (`/tokens/:id/assign-doctor`) | | ✅ | ✅ | ✅ | |
| **Reassign** (same endpoint) | | ✅ | ✅ | ✅ | |
| Call/Recall/Serve/Complete/Skip/Hold/No-show/Next | | ✅ | ✅¹ | ✅¹ | ✅¹ |
| Cancel token | | ✅ | ✅ | ✅ | ✅ |
| Priority / Estimate | | ✅ | ✅ | ✅ | |
| Doctor status change | | ✅ | ✅ | ✅ | ✅ |
| Doctor create/update | | ✅ | ✅ | | |
| Doctor delete | | ✅ | | | |
| Department/Area/Counter CRUD | | ✅ | | | |
| Patients register/search | | ✅ | ✅ | ✅ | |
| `/staff` console (UI) | | ✅ | ✅ | ✅ (limited) | ✅ (limited) |
| `/admin` (UI) | | ✅ | | | |
| Admin analytics / review moderation | | ✅ | ✅ (analytics/moderation) | | |
| Review delete | | ✅ | | | |
| SOS staff list/act | | ✅ | ✅ | | |
| Audit log | | ✅ | ✅ | | |
| Notification list | | ✅ | ✅ | ✅ | |

¹ Token-op route uses the shared `officer` alias = roles `officer|admin|reception|doctor`. Reception/doctor therefore inherit these token actions even where the UI is read-mostly.

## 4. Notes / uncertainties
- **Doctor is a recognized role** but has **no dedicated doctor portal**; doctors land on the same StaffConsole with limited (mostly read) interaction and can set their own status. This is under-specified (see Gap Analysis).
- `users.department_id` (staff department scoping) and `users.disabled` exist in the DB model; **disabled blocking is enforced** in OTP/auth, but **department scoping is not applied** to any current endpoint.
- Reception is technically permitted on `assign-doctor` and token ops by role lists; the UI still flags reception as non-operations (`isOps=false`) for create-doctor/admin actions.
- `/auth/me` is registered twice (auth.js and otp.js); Express resolves to the first (auth.js) handler. The duplicate in `otp.js` is effectively shadowed.

---

*Next: see `08_FEATURE_MODULE_INVENTORY.md`.*