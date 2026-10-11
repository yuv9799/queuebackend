import { Router } from 'express';
import * as Patient from '../models/Patient.js';
import * as Token from '../models/Token.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// POST /patients — register a new patient (privileged staff only)
router.post('/', requireAuth, requireRole('reception', 'admin', 'officer'), (req, res) => {
  const { name, phone, age, gender } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const patient = Patient.findOrCreate({ name, phone, age, gender });
  res.status(201).json({ patient });
});

// GET /patients/search?q= — staff search by name / patient number / phone
router.get('/search', requireAuth, requireRole('reception', 'admin', 'officer'), (req, res) => {
  res.json({ patients: Patient.search(req.query.q) });
});

// GET /patients/:id
router.get('/:id', requireAuth, requireRole('reception', 'admin', 'officer', 'doctor'), (req, res) => {
  const patient = Patient.findById(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  res.json({ patient });
});

// GET /patients/:id/tokens — tokens for a patient
router.get('/:id/tokens', requireAuth, requireRole('reception', 'admin', 'officer', 'doctor'), (req, res) => {
  const patient = Patient.findById(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  const tokens = Token.list({}).filter((t) => Number(t.patient_id) === Number(req.params.id));
  res.json({ tokens });
});

export default router;