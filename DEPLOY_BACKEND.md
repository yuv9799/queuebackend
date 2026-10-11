# Deploying the KIMS Queue Backend

This is the **backend-only** repository (`yuv9799/queuebackend`). The backend is an
Express + Socket.io + SQLite (`node:sqlite`) service that runs as a
**long-running Node server** (`npm start` → `node server.js`).

## Frontend <-> backend connection

- Frontend is deployed on Vercel: `https://queuefrontend-eiyom3ypt-yuviraj.vercel.app/`
  (repo `yuv9799/queuefrontend`).
- The frontend reads the backend base URL from `VITE_API_URL` (build-time, set in the
  Vercel frontend project, embedded into the client bundle).
- After the backend is deployed, set `VITE_API_URL` to its base URL in the frontend
  Vercel project and **redeploy** the frontend. Do not use a GitHub URL as the API URL.

## Hosting decision — use a persistent host, not Vercel serverless

**This backend must NOT be deployed as ordinary Vercel serverless functions.** Reasons:

1. **Socket.io real-time** needs a persistent server and long-lived, shared connections.
   Vercel Functions are short-lived per-request instances — real-time queue updates
   would not work.
2. **SQLite is a file database.** Vercel serverless has an ephemeral and effectively
   read-only filesystem (outside `/tmp`). A `queue.db` written there is **not durable**
   (data is lost on cold starts and split across instances). Previously,
   `config/db.js` tried to create `<deployment root>/data` (for example,
   `/var/task/data`) at import time. That path is part of Vercel's read-only deployment
   filesystem, which caused the reported `ENOENT` during startup. The backend now
   creates the parent directory of the configured `DB_PATH`; this supports a newly
   mounted persistent disk, but does not make Vercel storage durable or writable.

That is why there is intentionally **no `backend/vercel.json`** for a `@vercel/node`
serverless build here: it would boot but lose queue/token/review data and break
real-time. Hosting the backend on a **persistent Node runtime** (Render / Railway /
Fly.io / a VPS) is required to preserve the existing functionality.

If you want to run the API stateless on Vercel anyway, the code would first need an
**external durable database** (e.g. Postgres) and a **shared Socket.io adapter** —
that is a larger change and must be reviewed before we do it.
## Entry point & commands (repo root)

- Start: `npm start` (runs `node server.js`)
- Dev: `npm run dev` (nodemon)
- Seed demo data (once, on the host): `npm run seed`
- Optional demo reviews: `npm run seed:reviews`
- Tests: `npm test`

## Recommended deploy — Render

Use the included `render.yaml` (paid Starter Docker web service, `/health` check, and
persistent 1 GB disk mounted at `/app/data`): dashboard.render.com → **New → Blueprint** → select
`yuv9799/queuebackend`. The blueprint sets `DB_PATH=/app/data/queue.db`, generates
`JWT_SECRET`, and configures `FRONTEND_URL`/`PUBLIC_APP_URL` for the deployed Vercel
frontend. Keep the service to one instance: SQLite and the in-memory Socket.io
broadcasts are single-instance. The Docker image uses Node 22 (`node:22-slim`), which
satisfies the package requirement `>=22.5.0` for built-in `node:sqlite`.

After the first successful deploy, run **`npm run seed`** once from Render → your
service → Shell if the initial demo departments/users are wanted. **This seed script
deletes existing application records before re-seeding; do not run it again against
production data.** Schema migrations are applied automatically and idempotently at
server startup; no separate migration command is required.

## Any persistent Node host (Railway / Fly / VPS)

Run `node server.js` (or the included `Dockerfile`) and keep a **persistent volume**
at `/app/data` (or wherever you set `DB_PATH`). Seed once after first boot.

## Production environment variables

| Variable | Purpose | Required |
|---|---|---|
| `PORT` | HTTP port the server listens on | Render sets `8080` in `render.yaml` |
| `HOST` | Bind address (`0.0.0.0`) | no |
| `NODE_ENV` | `production` | yes |
| `JWT_SECRET` | Long random secret for signing JWTs (`openssl rand -base64 48`) | **yes** |
| `DB_PATH` | SQLite file on a **persistent volume** | yes (e.g. `/app/data/queue.db`) |
| `FRONTEND_URL` | Frontend origin (CORS + default URL) | Set by `render.yaml` to the deployed Vercel frontend |
| `CORS_ORIGINS` | Extra comma-separated allowed origins | no |
| `PUBLIC_APP_URL` | Frontend base used for `/status` tracking links | Set by `render.yaml` |
| `TRUST_PROXY` | `1` when behind an HTTPS reverse proxy | yes on Render/NGINX |

Optional SMS/WhatsApp: `SMS_ENABLED`, `MSG91_*`, `TWILIO_*`.

## Persistence (SQLite)

- File: `/app/data/queue.db` on Render (`DB_PATH` in `render.yaml`); the 1 GB
  persistent disk is mounted at `/app/data`. Keep the database file, WAL, and SHM
  files on this mount; do not change `DB_PATH` to a path outside it.
- `config/db.js` creates the parent directory of the configured database file before
  opening SQLite, including when the mount's nested directory does not yet exist.
- WAL mode; `migrate()` creates tables/columns idempotently at startup.
- Render persistent disks require a paid web service and are tied to a single instance.
  The Blueprint selects the Starter plan to support the disk; review Render's current
  pricing before creating the service. Do not scale this SQLite-backed service to
  multiple instances.

## CORS

`config/cors.js` allows these origins by default:
- `https://queuefrontend-eiyom3ypt-yuviraj.vercel.app` (deployed Vercel frontend)
- `https://yuv9799.github.io`, `https://kims-queue.vercel.app`
- localhost dev origins (5173/5174/3000)

Add more via `FRONTEND_URL` / `CORS_ORIGINS`.

## Socket.io (real-time)

- Mounted on the same HTTP server at `/socket.io`, CORS-restricted to the allowlist.
- Production clients use WebSocket transport. Works on a persistent host with one
  server instance (broadcasts are in-memory). For multiple instances, add a shared
  Socket.io adapter (e.g. Redis) — see the hosting decision above.

## Verify after deploy

- Health: `GET <API_URL>/health` → `{ "ok": true, "service": "kims-queue", ... }`
- Departments: `GET <API_URL>/departments`
- Confirm the Render service is healthy and that the disk is mounted at `/app/data`
  before generating demo data. Re-run `npm run seed` only for an intentionally empty
  database because it resets existing data.
- Set `VITE_API_URL=<API_URL>` and redeploy the frontend, then load
  `https://queuefrontend-eiyom3ypt-yuviraj.vercel.app/`.