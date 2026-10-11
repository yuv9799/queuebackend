# 02 — Technical Requirements Document (TRD)
**KIMS Queue — Bhubaneswar Medical Sciences**
*Status: Reverse-engineered from the current implementation.*

---

## 1. Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Frontend — React 18 SPA (Vite 5 build)                   │
│  src/pages, src/components, src/context, src/services      │
│  React Router v6     Socket.io-client     Axios-like fetch │
└───────────────┬────────────────────────────────────────────┘
                │ REST (JSON) + WebSocket (Socket.io)
                ▼
┌────────────────────────────────────────────────────────────┐
│  Backend — Node.js (>=22.5) + Express 4                   │
│  routes/* (REST)   models/* (data access)  sockets/*       │
│  middleware/auth.js (JWT + roles)                          │
└───────────────┬────────────────────────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────────────────────┐
│  Database — SQLite via built-in node:sqlite (DatabaseSync) │
│  config/db.js  ·  WAL mode  ·  foreign_keys ON  ·  migrate()│
└────────────────────────────────────────────────────────────┘
```

**Realtime transport:** Socket.io server (`server.js`) sits beside the Express app; queues/departments/tokens/staff receive push events. Frontend service `services/socket.js` exposes `getSocket()`, `subscribeAll()`, `subscribeStaff()`.

---

## 2. Frontend

| Concern | Technology / Implementation |
|---|---|
| Framework | React 18.3 (ReactDOM `createRoot`) |
| Language | JavaScript (JSX), ESM |
| Build tool | Vite 5.4 |
| Routing | `react-router-dom` v6 (`BrowserRouter`, `Routes`, `Route`, `Navigate`, `useNavigate`, `useSearchParams`) |
| UI styling | Tailwind CSS 3.4 + PostCSS + Autoprefixer; design tokens in `tailwind.config.js`; a `@layer components` set in `src/index.css` |
| Realtime | `socket.io-client` 4.7 |
| Charts | `recharts` 2.12 (admin analytics) |
| State management | React Context (`AuthContext`, `ToastContext`, `EmergencyContext`) + local component state (no Redux/Zustand) |
| API communication | `services/api.js` — central `fetch` wrapper against `VITE_API_URL` (default `http://localhost:8080`) |
| Auth handling | `AuthContext` stores JWT in `localStorage` (`kims_token`), calls `/auth/me` to restore session |
| Forms/Validation | Native HTML validation + inline guards in components |
| Icons | Emoji glyphs and inline SVG (no icon library) |
| Environment | `import.meta.env.VITE_API_URL` |

**Entry:** `src/main.jsx` → `<AuthProvider><BrowserRouter><App/>`. `App.jsx` renders the public layout (Navbar + `<main>` + Footer + ReviewDrawer) or the staff layout depending on the path.

---

## 3. Backend

| Concern | Technology / Implementation |
|---|---|
| Framework | Express 4.19 |
| Language | JavaScript ESM (`"type": "module"`) |
| App bootstrap | `createApp()` in `app.js`; `server.js` starts HTTP + Socket.io |
| Routing | `routes/*.js` (auth, otp, departments, areas, counters, tokens, stats, reviews, emergency, doctors, patients, queues, assignments, notifications, audit, staff) |
| Business/service logic | `models/*.js` (Token, Queue, Doctor, Patient, Department, Area, Counter, User, Audit, Notify, Review, Emergency, Stats) |
| Middleware | `middleware/auth.js` — `requireAuth`, `requireRole(...)`, `optionalAuth`; CORS; `express.json({limit:'1mb'})`; morgan logger |
| Authentication | JWT (HMAC) via `jsonwebtoken`, 7-day expiry, secret from `JWT_SECRET` (dev default provided) |
| Authorization | `requireRole('admin'|'officer'|'reception'|'doctor')` on each route |
| Validation | Manual validation at model/route layer (e.g., priorities whitelist, rating bounds, coordinate ranges, wait-time bounds) |
| Error handling | Global error middleware in `app.js` → 500 JSON; route handlers return structured `{ error }`; 404 handler |
| Transactions | `config/db.js` `inTx(fn)` (BEGIN/COMMIT/ROLLBACK) for guarded transitions |
| Audit | `models/Audit.js` append-only `audit_logs` |

---

## 4. Database

| Concern | Detail |
|---|---|
| Technology | SQLite (built-in `node:sqlite`, `DatabaseSync`) |
| Location | `backend/data/queue.db` (override with `DB_PATH`) |
| PRAGMA | WAL journal, `foreign_keys = ON`, `busy_timeout = 5000` |
| Migrations | Idempotent `migrate()` in `config/db.js` (SCHEMA + `ensureColumn` ALTERs) |
| Tables | `users, departments, areas, counters, token_seq, tokens, patients, doctors, notifications, reviews, help_points, sos_requests, audit_logs` |
| Relationships | See `05_BACKEND_SCHEMA.md` |
| Indexes | `tokens(area_id,status,created_at)`, `tokens(area_id,queue_seq)`, `reviews(status)`, `sos(status/created/user)`, `notifications(token/status)`, `audit_logs(created_at)`, `users(phone)` unique |

> No ORM — direct parameterized SQL through helper functions `all/get/run` in `config/db.js`.

---

## 5. Infrastructure & External Services

| Item | Actual state |
|---|---|
| Hosting / deployment | None configured (local dev; scripts `npm run dev`, `npm run build`, `npm run seed`) |
| Storage | Local SQLite file |
| Env vars | `PORT` (8080), `DB_PATH`, `JWT_SECRET`, `VITE_API_URL`, `SMS_PROVIDER_KEY`, `WHATSAPP_PROVIDER_KEY`, `NODE_ENV` |
| External APIs | Google Maps **directions/pin URLs built client-side** (`src/config/emergency.js`) — no server dependency |
| Geolocation | Browser Geolocation API (`services/geolocation.js`) |
| Calls | `tel:` links (configurable numbers in `src/config/emergency.js`) |
| Messaging | In-app `web` notification sink implemented; **SMS/WhatsApp providers not wired** (scaffolded in `models/Notify.js`, no real provider key) |
| OTP | **Dev/demo only** — no real SMS gateway; demo accounts accept `123456` (`NODE_ENV !== 'production'`) |
| Analytics / monitoring | Admin analytics via Recharts over `/stats/*` and `/reviews/analytics`; no external APM/monitoring |

---

*Next: see `03_APP_WEB_FLOW.md`.*