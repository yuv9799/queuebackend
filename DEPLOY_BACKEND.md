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
   (data is lost on cold starts and split across instances), and the default
   `fs.mkdirSync('data/')` in `config/db.js` can fail on a read-only filesystem.

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

Use the included `render.yaml` (adds a persistent 1 GB disk at `/app/data`):
dashboard.render.com → **New → Blueprint** → select `yuv9799/queuebackend`.
Set the env vars below (especially `JWT_SECRET` and `FRONTEND_URL`), then run
**`npm run seed`** once (Render → your service → Shell) so demo departments/users exist.

## Any persistent Node host (Railway / Fly / VPS)

Run `node server.js` (or the included `Dockerfile`) and keep a **persistent volume**
at `/app/data` (or wherever you set `DB_PATH`). Seed once after first boot.

## Production environment variables

| Variable | Purpose | Required |
|---|---|---|
| `PORT` | HTTP port the server listens on | host-injected |
| `HOST` | Bind address (`0.0.0.0`) | no |
| `NODE_ENV` | `production` | yes |
| `JWT_SECRET` | Long random secret for signing JWTs (`openssl rand -base64 48`) | **yes** |
| `DB_PATH` | SQLite file on a **persistent volume** | yes (e.g. `/app/data/queue.db`) |
| `FRONTEND_URL` | Frontend origin (CORS + default URL) | yes (the Vercel frontend) |
| `CORS_ORIGINS` | Extra comma-separated allowed origins | no |
| `PUBLIC_APP_URL` | Frontend base used for `/status` tracking links | no |
| `TRUST_PROXY` | `1` when behind an HTTPS reverse proxy | yes on Render/NGINX |

Optional SMS/WhatsApp: `SMS_ENABLED`, `MSG91_*`, `TWILIO_*`.

## Persistence (SQLite)

- File: `data/queue.db` (`config/db.js`, overridable with `DB_PATH`).
- WAL mode; `migrate()` creates tables/columns idempotently at startup.
- Keep the file on a **persistent volume**; `data/` is git-ignored and never committed.

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
- Set `VITE_API_URL=<API_URL>` and redeploy the frontend, then load
  `https://queuefrontend-eiyom3ypt-yuviraj.vercel.app/`.