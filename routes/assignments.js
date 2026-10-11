import { Router } from 'express';
import * as Queue from '../models/Queue.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

function emit(app, type, data) {
  const io = app.get('io');
  if (!io) return;
  io.emit('staff:update', { type: type || 'update', ...data });
  io.emit('staff:activity', { at: new Date().toISOString(), ...data });
}

// POST /assignments/recommend — transparent recommendation for a token
router.post('/recommend', requireAuth, requireRole('officer', 'admin', 'reception'), (req, res) => {
  const { tokenId, preferDoctorId } = req.body || {};
  if (!tokenId) return res.status(400).json({ error: 'tokenId is required' });
  const rec = Queue.recommend(tokenId, { preferDoctorId });
  if (!rec.ok) return res.status(409).json({ error: rec.error });
  res.json({ recommendation: rec.recommended, reason: rec.reason, alternatives: rec.alternatives, token: rec.token });
});

// POST /assignments — assign (or change) doctor for a token
router.post('/', requireAuth, requireRole('officer', 'admin', 'reception'), (req, res) => {
  const { tokenId, doctorId, reason, override, preferred } = req.body || {};
  if (!tokenId || !doctorId) return res.status(400).json({ error: 'tokenId and doctorId are required' });
  const result = Queue.assign({ tokenId, doctorId, actorId: req.user.id, actorName: req.user.name, reason, override, preferred });
  if (!result.ok) return res.status(409).json({ error: result.error });
  const token = result.token;
  emit(req.app, 'assignment', { tokenId, doctorId, assigned: result.unchanged ? false : true, tokenNumber: token?.token_number });
  res.json({ token, recommended: false, director: result });
});

// POST /assignments/redistribute-preview — dry-run: show affected tokens and suggested alternatives
router.post('/redistribute-preview', requireAuth, requireRole('officer', 'admin', 'reception'), (req, res) => {
  const { doctorId } = req.body || {};
  if (!doctorId) return res.status(400).json({ error: 'doctorId is required' });
  if (Number.isNaN(Number(doctorId))) return res.status(400).json({ error: 'doctorId must be a number' });
  const result = Queue.redistributePreview(doctorId);
  if (!result.ok) return res.status(409).json({ error: result.error });

  // Sanitize: strip PHI from affected token list (Token.list includes patients join)
  const affected = result.affected.map((t) => ({
    id: t.id,
    token_number: t.token_number,
    patient_name: t.patient_name,
  }));

  // Sanitize: strip patient names from doctor workload (withWorkload exposes currentToken/nextPatients)
  const { currentToken, nextPatients, ...safeDoctor } = result.doctor || {};

  res.json({ ok: true, affected, suggested: result.suggested, doctor: safeDoctor });
});

// POST /assignments/redistribute — apply approved redistribution moves
router.post('/redistribute', requireAuth, requireRole('officer', 'admin', 'reception'), (req, res) => {
  const { moves, reason } = req.body || {};
  if (!Array.isArray(moves)) return res.status(400).json({ error: 'moves must be an array' });
  if (moves.some((move) => !move || !Number.isInteger(Number(move.tokenId)) || !Number.isInteger(Number(move.doctorId)))) {
    return res.status(400).json({ error: 'Each move requires numeric tokenId and doctorId' });
  }

  const result = Queue.redistributeConfirm({
    moves,
    actorId: req.user.id,
    actorName: req.user.name,
    reason,
  });
  for (const item of result.results) {
    if (item.ok) emit(req.app, 'assignment', { tokenId: item.tokenId, redistributed: true });
  }
  res.json(result);
});

export default router;