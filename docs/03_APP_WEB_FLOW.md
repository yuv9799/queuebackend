# 03 — App / Web Flow Documentation
**KIMS Queue — Bhubaneswar Medical Sciences**
*Status: Reverse-engineered from the current implementation.*

All routes are served by the **same SPA**; the layout depends on the path (`App.jsx`):
- **Public/patient layout:** `Navbar` + `<main>` + `Footer` (routes `/`, `/status`, `/live`, `/departments`, `/help`, `/login`).
- **Staff layout:** `/staff`, `/staff/*`, `/console`, `/admin` → wrapped in `StaffLayout` + `RequireStaff` (and `RequireAdmin` for `/admin`).

---

## 1. Patient (Public) Flows

### 1.1 Token Generation (Kiosk)
```
Home (Token Kiosk)
  ↓  select department → areas load (auto-first area), doctors load for department
  ↓  optional: preferred doctor, patient name, phone
  ↓  Generate Token
  ↓  POST /tokens (auto-assign best/preferred doctor)
  ↓
Token issued → token id + number stored in localStorage (kims_active_token_id/number)
  ↓  toast success → "Get your token" panel
  →   link to /status (track live) · link to /live (live board)
```
Files: `components/TokenKiosk.jsx`, `components/landing/Hero.jsx`, Home's token section.

### 1.2 Token Status Tracking
```
/status (reads kims_active_token_id or ?id=, or looks up by number)
  ↓  GET /tokens/:id (public)   [or /tokens/by-number/:number]
  ↓
Show: status chip, token code, assigned doctor + room, department/area,
      live queue metrics (people ahead / position / estimated wait),
      live-synced via socket (token:updated, queue:updated)
  Actions: Refresh Status · Live Board · Get New Token (when terminal)
```
Files: `pages/TokenStatus.jsx`.

### 1.3 Live TV Board
```
/live
  ↓  GET /tokens/live (public per-area snapshot) + departments
  ↓  filter by department
  Show: per-area "Now serving" + next-up pills + on-hold list
  Realtime: subscribeAll() → refresh on token:updated/queue:updated; 15s fallback poll
```
Files: `pages/LiveBoard.jsx`.

### 1.4 Departments Browse
`/departments` → `api.departments()` + per-department `api.areas()` → cards with service chips. Files: `pages/Departments.jsx`.

### 1.5 Help / FAQ
`/help` → static FAQ accordion + helpdesk contact. Files: `pages/Help.jsx`, `components/landing/HomeFAQ.jsx`.

### 1.6 Reviews (public)
```
Home → "Read & Write Reviews" button → opens ReviewDrawer
  ↓  post /reviews (optional auth) → PENDING → admin/officer approves for public display
  ↓  Home shows approved reviews via ReviewsPanel + summary
```
Files: `components/ReviewDrawer.jsx`, `ReviewsPanel.jsx`, `StarRating.jsx`, `pages/Home.jsx`.

### 1.7 Emergency (public)
```
Home hero "🚨 Emergency" pill OR "Emergency Help" landing section OR footer button
  ↓  opens EmergencyModal (useEmergency context)
  ↓  Call Emergency (tel:), Find Emergency Department (geolocation → Maps directions),
     Contact Emergency Desk, Find Nearest Help, SOS
  SOS → POST /emergency/sos with lat/lng + idempotency key → staff notified via socket
```
Files: `components/EmergencyModal.jsx`, `context/EmergencyContext.jsx`, `components/emergency/*`, `config/emergency.js`, `config/location.js`, `services/geolocation.js`.

---

## 2. Authentication Flow
```
Login (/login)
  1. Phone number  →  POST /auth/otp/request
        - finds staff by phone; demo accounts return devOtp = 123456
  2. OTP           →  POST /auth/otp/verify  →  { token, user }
        (dev bypass for is_demo; otherwise refused - no real gateway)
Email/password alternative via POST /auth/login (if enabled by login UI)
  ↓  token stored (kims_token), AuthContext.user set
  ↓  navigate('/staff')
Staff routes require: user present + role ∈ STAFF_ROLES; /admin additionally role==='admin'
```
Files: `pages/Login.jsx`, `context/AuthContext.jsx`, `App.jsx` (RequireStaff / RequireAdmin).

---

## 3. Admin Flow
```
/staff (RequireStaff; admin = full) → StaffConsole tabs:
   Overview   – KPI cards, ⚠️ Unassigned Tokens (Assign Doctor), Live Activity Feed
   Doctors    – directory, create (admin), status changes, per-doctor queue, reassign
   Live Queue – grouped by doctor, call/start/complete/hold/skip/recall/reassign
   Tokens     – filterable list with action buttons
   Patients   – search, register new patient
   History    – audit log
/admin (RequireAdmin) → Admin tabs:
   Overview   – analytics (StatCards, Hourly/Department/QueueDepth/Status charts)
   Manage     – Departments CRUD, Users list, Add Area, Add Counter
   Reviews    – ReviewAnalytics + ReviewsPanel moderation
   SOS        – SOSPanel (list + acknowledge/respond/resolve)
```

### 3.1 Assign Doctor (unassigned → doctor)
```
Admin/Staff → Overview → "Attention Required: Unassigned Tokens" → Assign Doctor
  ↓  opens "Assign Patient to Doctor" modal (Token #N · patient)
  ↓  Select Doctor (department-filtered) + Note (optional)
  ↓  Confirm → api.tokenAssignDoctor → POST /tokens/:id/assign-doctor
  ↓  toast "Patient successfully assigned to Dr. X" → list refresh
  →  token removed from unassigned, appears under doctor queue/workload
```
Files: `pages/StaffConsole.jsx` (`assignModalToken`/`handleAssignDoctor`/modal), `services/api.js` `tokenAssignDoctor`.

### 3.2 Reassign (doctor → doctor)
```
Admin/Staff → Doctors tab or Live Queue/Tokens → "🔄 Reassign"
  ↓  opens "Reassign Patient to Doctor" modal
  ↓  Select Destination Doctor + Reason (optional)
  ↓  Confirm → api.tokenReassignDoctor → POST /tokens/:id/assign-doctor
  →  patient moves doctor→doctor (audit: DOCTOR_CHANGED)
```
Both flows share the same backend endpoint but are distinct UI/logic paths.

---

## 4. Staff (Officer / Reception) Flow
Mirrors Admin Flow but gated by role:
- **Officer:** full staff console (`isOps`); can create doctors, all token ops, assign/reassign.
- **Reception:** not `isOps`; patient + token ops per backend guards; assign-doctor, cancel, call, serve, recall, priority, estimate allowed per route role lists.

Token action matrix (`renderTokenActionButtons`):
- queued: **Call**, **Reassign**, **Skip**
- called: **Start Consult**, **Complete**, **Recall**, **Skip**
- serving/in_consultation: **Complete**

---

## 5. Doctor Flow
- A `doctor` account can enter `/staff` (`STAFF_ROLES` includes doctor).
- Doctor can set own status (`POST /doctors/:id/status` allows doctor role) and call/cancel tokens (token-op `officer` alias includes doctor).
- No dedicated doctor-only dashboard page (see Gap Analysis).

---

## 6. Token Lifecycle Flow (server-enforced)
```
issued → queued
queued → called | skipped | cancelled
called → serving | in_consultation | completed | held | skipped | cancelled | no_show | recalled(called)
held  → called | serving | in_consultation | skipped | cancelled | no_show
serving/in_consultation → completed | skipped | cancelled | held | no_show
completed/skipped/cancelled/no_show → (terminal)
```
Every transition: `Token.transition` (guarded) → audit log → notification(s) → Socket.io broadcast.

---

## 7. Queue Flow (operational view)
```
Staff "Live Queue" tab → GET /queues/live (grouped by doctor per department)
Staff "Call" → POST /tokens/:id/call → serving shows on board
Staff "Start Consult" → POST /tokens/:id/serve (CALLED→IN_CONSULTATION; doctor → in_consultation)
Staff "Complete" → POST /tokens/:id/complete → doctor back to available when no other active consult
Skip / Hold / Recall / No-show / Cancel via dedicated endpoints.
```

---

## 8. Error / Failure Flow
- API client (`services/api.js`) throws `Error(message)` on non-2xx; components `.catch()` → toast.error / inline error.
- Transition violations → 409 `{error}` → toast.
- Assignment failures (inactive/unavailable/dept mismatch) → 409 → handled; token stays unassigned (no optimistic removal).
- SOS / location errors → surfaced inline with fallback actions ("Try Again", "Open KIMS Location", "Call 108").
- Auth errors → login redirect; `/auth/me` invalid token → logout + clear localStorage.

---

*Next: see `04_UI_UX_DESIGN_BRIEF.md`.*