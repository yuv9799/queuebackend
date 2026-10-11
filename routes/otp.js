import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { findByPhone, findById } from '../models/User.js';
import { signToken, JWT_SECRET } from '../middleware/auth.js';

const router = Router();

// DEV / DEMO ONLY OTP bypass. Never enabled in production.
const DEMO_OTP = process.env.NODE_ENV === 'production' ? null : '123456';

// POST /auth/otp/request  { phone }
// Looks up a staff member by verified phone number. In dev, returns the demo
// OTP so the two demo accounts are testable without a real SMS gateway.
router.post('/otp/request', (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone is required' });
  const user = findByPhone(phone);
  if (!user) return res.status(404).json({ error: 'No staff account found for this phone number' });
  if (user.disabled) return res.status(403).json({ error: 'This account is disabled' });
  const devOtp = user.is_demo ? DEMO_OTP : null;
  res.json({ ok: true, phone, devOtp, demo: !!user.is_demo });
});

// POST /auth/otp/verify  { phone, otp }
router.post('/otp/verify', (req, res) => {
  const { phone, otp } = req.body || {};
  if (!phone || !otp) return res.status(400).json({ error: 'phone and otp are required' });

  const user = findByPhone(phone);
  if (!user) return res.status(404).json({ error: 'No staff account found for this phone number' });
  if (user.disabled) return res.status(403).json({ error: 'This account is disabled' });

  // DEMO / DEV bypass: the seeded demo accounts accept 123456.
  if (user.is_demo && DEMO_OTP && otp === DEMO_OTP) {
    const { password_hash, ...safe } = user;
    return res.json({ token: signToken(safe), user: safe, demo: true });
  }

  // A production OTP provider would validate the code here. There is no real
  // gateway configured, so this path is intentionally refused.
  return res.status(401).json({ error: 'Invalid or expired OTP' });
});

// GET /auth/me  (authenticated) — also blocks disabled accounts.
router.get('/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const user = findById(payload.id);
  if (!user) return res.status(401).json({ error: 'Invalid user' });
  if (user.disabled) return res.status(403).json({ error: 'This account is disabled' });
  res.json({ user });
});

export default router;