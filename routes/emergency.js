import { Router } from 'express';
import * as Emergency from '../models/Emergency.js';
import { requireAuth, requireRole, optionalAuth } from '../middleware/auth.js';

const router = Router();

// Simple in-memory rate limiter: max 4 SOS POSTs per IP per 60s.
const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 4) { hits.set(ip, arr); return false; }
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

function isValidCoord(v) {
  return v !== undefined && v !== null && Number.isFinite(Number(v)) &&
    Number(v) >= -90 && Number(v) <= 90;
}

// POST /emergency/sos — create an SOS (public)
router.post('/sos', optionalAuth, (req, res, next) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || 'anon';
    if (!rateLimit(ip)) return res.status(429).json({ error: 'Too many SOS requests. Please wait a moment.' });

    const { latitude, longitude, accuracy, idempotencyKey } = req.body || {};
    if (!isValidCoord(latitude) || !isValidCoord(longitude)) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required' });
    }

    // Idempotency / duplicate guard.
    if (idempotencyKey) {
      const existing = Emergency.findByKey(idempotencyKey);
      if (existing) {
        return res.status(200).json({ success: true, sos: existing, existing: true });
      }
    }
    if (req.user?.id) {
      const active = Emergency.myActiveSos(req.user.id);
      if (active) {
        return res.status(200).json({ success: true, sos: active, existing: true, message: 'You already have an active SOS request.' });
      }
    }

    const { sos, team } = Emergency.createSos({
      userId: req.user?.id,
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null,
      idempotencyKey: idempotencyKey || null,
      source: req.body?.source || (req.user?.id ? 'web-authenticated' : 'web'),
    });

    const io = req.app.get('io');
    if (io) io.emit('sos:new', { sos, team });

    // The realtime broadcast above is the staff notification channel.
    const notified = Emergency.setSosStatus(sos.id, 'STAFF_NOTIFIED');
    if (io && notified) io.emit('sos:updated', { sos: notified });

    res.status(201).json({ success: true, sos: notified || sos, team });
  } catch (e) { next(e); }
});

// GET /emergency/sos/:id — view an SOS status (public, by id)
router.get('/sos/:id', (req, res) => {
  const sos = Emergency.getSos(req.params.id);
  if (!sos) return res.status(404).json({ error: 'SOS not found' });
  res.json({ sos });
});

// Staff: list SOS requests
router.get('/sos', requireAuth, requireRole('admin', 'officer'), (req, res) => {
  const { status, limit } = req.query;
  res.json({ sosList: Emergency.listSos({ status, limit }) });
});

function staffAction(req, res, next, status) {
  try {
    const sos = Emergency.setSosStatus(req.params.id, status, { actor: req.user?.name || req.user?.email });
    if (!sos) return res.status(404).json({ error: 'SOS not found' });
    const io = req.app.get('io');
    if (io) io.emit('sos:updated', { sos });
    res.json({ sos });
  } catch (e) { next(e); }
}

router.post('/sos/:id/acknowledge', requireAuth, requireRole('admin', 'officer'), (req, res, next) => staffAction(req, res, next, 'ACKNOWLEDGED'));
router.post('/sos/:id/respond', requireAuth, requireRole('admin', 'officer'), (req, res, next) => staffAction(req, res, next, 'RESPONDING'));
router.post('/sos/:id/resolve', requireAuth, requireRole('admin', 'officer'), (req, res, next) => staffAction(req, res, next, 'RESOLVED'));
router.post('/sos/:id/cancel', requireAuth, requireRole('admin', 'officer'), (req, res, next) => staffAction(req, res, next, 'CANCELLED'));

// GET /emergency/help-points
router.get('/help-points', (req, res) => {
  res.json({ helpPoints: Emergency.listHelpPoints() });
});

// GET /emergency/help-points/nearest?lat=&lng=
router.get('/help-points/nearest', (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!isValidCoord(lat) || !isValidCoord(lng)) {
    return res.status(400).json({ error: 'Valid lat and lng query params are required' });
  }
  const nearest = Emergency.nearestHelpPoint(lat, lng);
  if (!nearest) return res.status(404).json({ error: 'No help points available' });
  res.json({ nearest });
});

export default router;