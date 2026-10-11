// CORS policy for the KIMS queue backend.
//
// Backend is a long-running Express + Socket.io service hosted on a persistent
// Node runtime. The frontend is hosted on Vercel; its origin(s) must be allowed
// here so browsers can call the API cross-origin.
//
// The backend authenticates with Bearer tokens (Authorization header), not
// cookies, so `credentials` stays false but the origin is strictly allowlisted
// rather than wide-open `*`. Set CORS_ORIGINS in the backend env to add more.
const DEFAULT_ORIGINS = [
  'https://queuefrontend-eiyom3ypt-yuviraj.vercel.app', // deployed Vercel frontend
  'https://kims-queue.vercel.app',
  'https://yuv9799.github.io', // production GitHub Pages frontend
  'http://localhost:5173', // Vite dev server
  'http://127.0.0.1:5173',
  'http://localhost:5174', // Vite fallback port
  'http://127.0.0.1:5174',
  'http://localhost:3000',
];

export function corsOrigins() {
  const configured = [
    process.env.FRONTEND_URL,
    ...(process.env.CORS_ORIGINS || '').split(','),
  ]
    .filter(Boolean)
    .map((s) => s.trim())
    .map((origin) => origin.replace(/\/+$/, ''));
  return [...new Set([...DEFAULT_ORIGINS, ...configured])];
}

// Express cors() options. Reflects the exact origin only when it is allowlisted
// (so browsers can send the Authorization header); non-allowlisted origins get
// no CORS headers and are blocked by the browser.
export function corsOptions() {
  const origins = corsOrigins();
  return {
    origin(origin, callback) {
      // Allow requests with no Origin header (curl, same-origin, health checks).
      if (!origin) return callback(null, true);
      if (origins.includes(origin)) return callback(null, origin);
      return callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Review-Owner-Key'],
    exposedHeaders: ['Content-Type'],
    credentials: false,
    optionsSuccessStatus: 204,
  };
}