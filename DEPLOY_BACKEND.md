# Deploying the KIMS Queue Backend

## Why this is needed

The frontend is a static Vite app; its API and data are provided by the Express
backend in `backend/`.

## Current Vercel project settings

- Frontend: `https://kims-queue.vercel.app`
- Backend: `https://kims-queue-backend.vercel.app`
- Set the frontend Vercel project's Production environment variable
  `VITE_API_URL=https://kims-queue-backend.vercel.app`. The same value is in
  `frontend/.env.production` for production builds.
- Set backend `FRONTEND_URL=https://kims-queue.vercel.app` and
  `PUBLIC_APP_URL=https://kims-queue.vercel.app/`. `CORS_ORIGINS` is only needed
  for additional origins such as preview deployments.
- For the backend Vercel project, use `backend/` as its Root Directory and let
  Vercel detect the Express app. Configure `NODE_ENV=production` and a strong
  `JWT_SECRET` in Vercel's backend project settings.

**Important:** SQLite's default file is local to the backend process. Vercel
Functions do not provide a persistent SQLite volume, so using `/tmp` would lose
or split data across cold starts and instances. Do not use the Vercel backend for
real queue/review data until the app is backed by a persistent database or the
backend is hosted on a service with a persistent volume. Verify
`https://kims-queue-backend.vercel.app/health` returns HTTP 200 after every
backend deployment; a 500 response means the backend is not ready for frontend
traffic.

## Backend entrypoint & commands

- Entry point: `backend/server.js`
- Start: `npm start` (i.e. `node server.js`)
- Local dev: `npm run dev` (nodemon)
- Seed demo data: `npm run seed` (once, on the deployed host)
- Seed 100 demo reviews: `npm run seed:reviews`
- Tests: `npm test`

## Production environment variables

| Variable | Purpose | Default | Required in prod |
|---|---|---|---|
| `PORT` | HTTP port the server listens on (most hosts inject this) | `8080` | host-injected |
| `HOST` | Bind address. `0.0.0.0` = all interfaces | `0.0.0.0` | no |
| `NODE_ENV` | `production` disables the demo-OTP bypass | `development` | yes (`production`) |
| `DB_PATH` | Absolute path of the SQLite database file | `<repo>/backend/data/queue.db` | yes → persistent volume |
| `JWT_SECRET` | Secret used to sign auth JWTs (`openssl rand -base64 48`) | dev fallback | **yes** |
| `FRONTEND_URL` | Frontend origin and default CORS allowlist entry | `https://kims-queue.vercel.app` | no |
| `CORS_ORIGINS` | Extra comma-separated allowed origins (in addition to the production and localhost origins) | — | no |
| `TRUST_PROXY` | `1` when behind an HTTPS reverse proxy | `0` | set `1` on Render/NGINX |

## Persistence (SQLite)

- The database file is `backend/data/queue.db` (`config/db.js`, overridable with `DB_PATH`).
- WAL mode is on; `migrate()` creates tables/columns idempotently at startup.
- **You must keep that directory/file on a persistent disk/volume** so data survives restarts, and seed once after the first boot. Never bake a `queue.db` into the image (excluded via `backend/.dockerignore`).

## Option A — Render (recommended, free tier)

1. Create the file `render.yaml` at the repo root (sample below), push it, then
   on [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**
   → select `yuv9799/queue-manage`. Render builds the `backend/Dockerfile`.

   ```yaml
   services:
     - type: web
       name: kims-queue-backend
       runtime: docker
       dockerfilePath: backend/Dockerfile
       healthCheckPath: /health
       disk:
         name: sqlite-data
         mountPath: /app/data
         sizeGB: 1
       envVars:
         - key: NODE_ENV
           value: production
         - key: PORT
           value: 8080
         - key: TRUST_PROXY
           value: "1"
         - key: DB_PATH
           value: /app/data/queue.db
         - key: JWT_SECRET
           generateValue: true
         - key: CORS_ORIGINS
           sync: false
   ```

2. On first deploy, run the seed command once so the demo data exists:
   `npm run seed` (in `backend/`), or in Render's Shell:
   `cd backend && npm run seed`.
3. Copy the backend public URL, e.g. `https://kims-queue-backend.onrender.com`.

## Option B — Railway / Fly.io / DigitalOcean / any Node host

Any host that runs the command `node server.js` (or the included `Dockerfile`)
and keeps a **persistent volume at `backend/data/`** (or the `DB_PATH` you set)
works. Railway, Fly.io (free tiers) and a small VPS are all fine. Seed once after
the first boot and set the env vars from the table above.

## Socket.io (real-time)

- The backend mounts Socket.io on the **same HTTP server** at the default path
  `/socket.io`, with CORS restricted to the allowlist. Production clients use
  WebSocket transport; local development retains polling fallback.
- Vercel Functions support WebSockets in beta. A connection is pinned to one
  function instance and may close at the function duration limit; the client
  reconnects and rejoins its Socket.IO room.
- This app currently uses SQLite and in-memory Socket.IO broadcasts. Vercel
  instances do not share either; use a durable database and a shared
  Socket.IO adapter/pub-sub before relying on cross-instance real-time updates.

## Point the GitHub Pages frontend at the backend

The Pages workflow in `.github/workflows/deploy.yml` builds the frontend. Set the
`VITE_API_URL` build arg so the bundle calls your deployed API (NOT localhost).

Add a workflow-level environment variable (or a GitHub Action variable named
`VITE_API_URL`) and pass it in the build step:

```yaml
- name: Build frontend
  working-directory: frontend
  run: npm run build
  env:
    VITE_API_URL: ${{ vars.VITE_API_URL }}
```

Or simpler, add it to your Bash for the build step. Then rebuild/test locally with:

```bash
cd frontend
VITE_API_URL=https://your-backend-host npm run build
```

## CORS

The backend already allows `https://yuv9799.github.io` and the localhost dev
origins by default (`backend/config/cors.js`). If you host the frontend
elsewhere, add that origin via the backend `CORS_ORIGINS` env var (comma-separated).

Note: the browser `Origin` header is only the origin (scheme + host), e.g.
`https://yuv9799.github.io` — it never includes the `/queue-manage` path. The
allowlist above is correct as-is.

## Database note

`backend/data/queue.db` (SQLite) is git-ignored on purpose. On your host, keep
`backend/data/` on a persistent volume so review/queue data survives restarts,
and run `npm run seed` (demo data) + `npm run seed:reviews` (optional 100 reviews)
once on the deployed host.

## Verify

- Backend health: `GET <API_URL>/health` → `{ "ok": true, ... }`
- Frontend: `https://yuv9799.github.io/queue-manage/` loads real data.