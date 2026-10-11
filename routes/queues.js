import { Router } from 'express';
import * as Doctor from '../models/Doctor.js';
import * as Dept from '../models/Department.js';
import * as Token from '../models/Token.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /queues/live — staff operational view, grouped by doctor.
router.get('/live', requireAuth, requireRole('officer', 'admin', 'reception'), (req, res) => {
  const departments = Dept.list();
  const doctors = Doctor.list();
  const live = departments.map((dept) => {
    const deptDoctors = doctors.filter((d) => Number(d.department_id) === Number(dept.id));
    return {
      department: dept,
      doctors: deptDoctors.map((d) => ({
        id: d.id,
        name: d.name,
        room: d.room,
        specialization: d.specialization,
        status: d.status,
        active: d.active,
        waiting: d.waiting,
        capacity: d.capacity,
        totalAtDoctor: d.waiting,
      })),
    };
  });
  res.json({ queues: live });
});

// GET /queues/unassigned — queued tokens with no doctor assignment yet
// (these drive the "needs assignment / attention" panel).
router.get('/unassigned', requireAuth, requireRole('officer', 'admin', 'reception'), (req, res) => {
  res.json({ tokens: Token.list({ status: 'queued' }).filter((t) => !t.doctor_id) });
});

export default router;