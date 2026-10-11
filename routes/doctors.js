import { Router } from 'express';
import * as Doctor from '../models/Doctor.js';
import * as Audit from '../models/Audit.js';
import { requireAuth, requireRole, optionalAuth } from '../middleware/auth.js';

const router = Router();

// GET /doctors/public — public listing of active doctors for kiosk selection
router.get('/public', (req, res) => {
  const { departmentId, specialization, status, search, q } = req.query;
  const doctors = Doctor.list({
    departmentId: departmentId ? Number(departmentId) : undefined,
    specialization,
    status,
    search: search || q,
    active: true,
  });
  // Strip patient names from workload data — currentToken and nextPatients contain patient_name
  const safe = doctors.map(({ currentToken, nextPatients, ...doc }) => doc);
  res.json({ doctors: safe });
});

// GET /doctors — list doctors with optional filters (search, department, specialization, status) (Auth)
router.get('/', requireAuth, (req, res) => {
  const { departmentId, specialization, status, search, q, active } = req.query;
  const doctors = Doctor.list({
    departmentId: departmentId ? Number(departmentId) : undefined,
    specialization,
    status,
    search: search || q,
    active: active !== undefined ? active === 'true' || active === '1' : undefined,
  });
  res.json({ doctors });
});

// GET /doctors/:id — single doctor details + workload
router.get('/:id', requireAuth, (req, res) => {
  const doctor = Doctor.findById(req.params.id);
  if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
  res.json({ doctor });
});

// GET /doctors/:id/queue — live queue for a specific doctor
router.get('/:id/queue', requireAuth, (req, res) => {
  const queueData = Doctor.getQueue(req.params.id);
  if (!queueData) return res.status(404).json({ error: 'Doctor not found' });
  res.json(queueData);
});

// POST /doctors — create a doctor
router.post('/', requireAuth, requireRole('admin', 'officer'), (req, res) => {
  const {
    name,
    departmentId,
    specialization,
    qualification,
    experience_years,
    avg_consultation_minutes,
    status,
    room,
    capacity,
  } = req.body || {};

  if (!name) return res.status(400).json({ error: 'Doctor name is required' });

  const doctor = Doctor.create({
    name,
    departmentId,
    specialization,
    qualification,
    experience_years: experience_years ? Number(experience_years) : 5,
    avg_consultation_minutes: avg_consultation_minutes ? Number(avg_consultation_minutes) : 10,
    status: status || Doctor.STATUS.AVAILABLE,
    room,
    capacity: capacity ? Number(capacity) : 0,
  });

  Audit.log({
    actorId: req.user.id,
    actorName: req.user.name,
    action: 'DOCTOR_CREATED',
    targetType: 'doctor',
    targetId: doctor.id,
    newValue: `Created ${name}`,
  });

  const io = req.app.get('io');
  if (io) {
    io.emit('doctor:created', { doctor });
    io.emit('staff:update', { type: 'doctor_created', doctor });
  }

  res.status(201).json({ doctor });
});

// PUT /doctors/:id or PATCH /doctors/:id — update doctor
const updateDoctorHandler = (req, res) => {
  const doctor = Doctor.findById(req.params.id);
  if (!doctor) return res.status(404).json({ error: 'Doctor not found' });

  const updated = Doctor.update(doctor.id, req.body || {});

  Audit.log({
    actorId: req.user.id,
    actorName: req.user.name,
    action: 'DOCTOR_UPDATED',
    targetType: 'doctor',
    targetId: doctor.id,
    newValue: JSON.stringify(req.body),
  });

  const io = req.app.get('io');
  if (io) {
    io.emit('doctor:updated', { doctor: updated });
    io.emit('staff:update', { type: 'doctor_updated', doctor: updated });
  }

  res.json({ doctor: updated });
};

router.put('/:id', requireAuth, requireRole('admin', 'officer'), updateDoctorHandler);
router.patch('/:id', requireAuth, requireRole('admin', 'officer'), updateDoctorHandler);

// POST /doctors/:id/status or PATCH /doctors/:id/status — operational status
const updateStatusHandler = (req, res) => {
  const { status } = req.body || {};
  const valid = ['available', 'busy', 'in_consultation', 'break', 'offline', 'emergency'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${valid.join(', ')}` });
  }
  const doctor = Doctor.findById(req.params.id);
  if (!doctor) return res.status(404).json({ error: 'Doctor not found' });

  const updated = Doctor.setStatus(doctor.id, status);

  Audit.log({
    actorId: req.user.id,
    actorName: req.user.name,
    action: 'DOCTOR_STATUS_CHANGED',
    targetType: 'doctor',
    targetId: doctor.id,
    oldValue: doctor.status,
    newValue: status,
  });

  const io = req.app.get('io');
  if (io) {
    io.emit('doctor:status', { doctorId: doctor.id, status, doctor: updated });
    io.emit('staff:update', { type: 'doctor_status', doctor: updated });
    io.emit('queue:updated', { departmentId: doctor.department_id, doctorId: doctor.id });
  }

  res.json({ doctor: updated });
};

router.post('/:id/status', requireAuth, requireRole('officer', 'admin', 'reception', 'doctor'), updateStatusHandler);
router.patch('/:id/status', requireAuth, requireRole('officer', 'admin', 'reception', 'doctor'), updateStatusHandler);

// DELETE /doctors/:id — remove doctor
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const changes = Doctor.remove(req.params.id);
  if (!changes) return res.status(404).json({ error: 'Doctor not found' });
  const io = req.app.get('io');
  if (io) {
    io.emit('doctor:deleted', { doctorId: req.params.id });
    io.emit('staff:update', { type: 'doctor_deleted', doctorId: req.params.id });
  }
  res.json({ ok: true });
});

export default router;