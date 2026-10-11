# 08 — Feature / Module Inventory
**KIMS Queue — Bhubaneswar Medical Sciences**
*Status legend: ✅ Implemented · 🟡 Partially implemented · 🔴 Missing/Planned.*

---

## Authentication & Access
- **Email/Password login** — ✅ `pages/Login`(API), `context/AuthContext`, `routes/auth.js`, `models/User.js`
- **OTP phone login** — 🟡 (dev/demo bypass only; no real gateway) `routes/otp.js`
- **Session restore / me** — ✅ `AuthContext` → `/auth/me`
- **Logout** — ✅ `AuthContext` (clears localStorage)
- **Role guards (UI + API)** — ✅ `App.jsx` guards, `middleware/auth.js`

## Structure (Departments / Areas / Counters)
- Department CRUD — ✅ `Admin` manage, `routes/departments.js`, `models/Department.js`
- Area CRUD — ✅ `routes/areas.js`, `models/Area.js`
- Counter CRUD — ✅ `routes/counters.js`, `models/Counter.js`
- Browse pages — ✅ `pages/Departments`, `components/landing/DepartmentShowcase`, Home

## Queue / Tokens
- Token generation kiosk — ✅ `components/TokenKiosk`, `routes/tokens.js` (POST)
- Auto doctor assignment on issue — ✅ `models/Queue.js` `findBestDoctorForDepartment`
- Token status tracking — ✅ `pages/TokenStatus`
- Live board — ✅ `pages/LiveBoard`, `models/Token.live`
- Token lifecycle (call/serve/complete/hold/skip/recall/cancel/no-show) — ✅ `routes/tokens.js`, `models/Queue.js`, `models/Token.js` `transition`
- Priority & estimate — ✅ `routes/tokens.js`, `models/Queue.js`
- Queue position & wait estimates — ✅ `models/Queue.js` `calculateEstimates`
- **Assign Doctor (unassigned → doctor)** — ✅ `StaffConsole` (assign modal + `handleAssignDoctor`), `services/api.js` `tokenAssignDoctor`
- **Reassign Patient (doctor → doctor)** — ✅ `StaffConsole` (reassign modal + `handleReassign`), `api.tokenReassignDoctor`

## Doctors
- Doctor CRUD — ✅ `StaffConsole` Doctors tab, `routes/doctors.js`, `models/Doctor.js`
- Doctor status/availability — ✅ `routes/doctors.js`, UI status buttons
- Doctor workload/queue — ✅ `models/Doctor.js` `withWorkload`/`getQueue`
- Recommendation — ✅ `routes/assignments.js`, `models/Queue.js` `recommend`

## Staff Console
- Overview dashboard — ✅ `StaffConsole` renderOverview, `routes/staff.js` dashboard
- Unassigned attention panel — ✅ (with assign-doctor modal)
- Live activity feed — ✅ `staff:activity` + audit
- Doctors / Live Queue / Tokens / Patients / History tabs — ✅

## Admin
- Analytics (charts) — ✅ `pages/Admin`, `components/Charts`, `routes/stats.js`, `models/Stats.js`
- Review moderation & analytics — ✅ `Admin` Reviews tab, `models/Review.js`
- SOS panel — ✅ `Admin` SOS tab, `components/SOSPanel`, `routes/emergency.js`
- User list — ✅ `/auth/users` (list only; no full user-management UI)

## Patients
- Search / register / token history — ✅ `StaffConsole` Patients tab, `routes/patients.js`, `models/Patient.js`

## Reviews
- Submit (public) — ✅ `ReviewDrawer`/`ReviewsPanel` → `POST /reviews`
- Moderation — ✅ `routes/reviews.js` (status, admin list, delete)
- Summary / analytics — ✅ `routes/reviews.js`, `models/Review.js`
- Demo seeds — ✅ `seed/reviews.seed.js`

## Emergency
- Emergency Help landing section — ✅ `components/emergency/EmergencyHelp.jsx` + `EmergencyServiceCard.jsx` (tel:, Maps, Help Desk → `/help`)
- Emergency modal (call/desk/directions/nearest-help/SOS) — ✅ `components/EmergencyModal.jsx`, `context/EmergencyContext.jsx`
- SOS create/list/act — ✅ `routes/emergency.js`, `models/Emergency.js`
- Nearest help point — ✅ `models/Emergency.js` (haversine)

## Notifications
- Web notification records — ✅ `models/Notify.js`, `routes/notifications.js`
- SMS / WhatsApp — 🔴 (pluggable scaffold only; no provider)

## Audit
- Audit log + dashboard feed — ✅ `models/Audit.js`, `routes/audit.js`

## Redistribution (doctor unavailable)
- Model `redistributePreview`/`redistributeConfirm` — 🟡 (model exists)
- API route — 🔴 (not wired in `routes/assignments.js`); FE `api.redistributePreview/Confirm` point to missing routes

## Cross-cutting
- Toast notifications — ✅ `context/ToastContext.jsx`
- Realtime socket service — ✅ `services/socket.js`, `sockets/queueSocket.js`
- Config (emergency contact, verified location) — ✅ `src/config/emergency.js`, `location.js`

---

*Next: see `09_IMPLEMENTATION_PLAN.md`.*