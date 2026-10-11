import { Router } from 'express';
import { get } from '../config/db.js';
import * as Doctor from '../models/Doctor.js';
import * as Audit from '../models/Audit.js';
import * as Notify from '../models/Notify.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /staff/dashboard — top-level operational summary + activity + attention.
router.get('/dashboard', requireAuth, requireRole('admin', 'officer', 'reception'), (req, res) => {
  const patientsWaiting = get("SELECT COUNT(*) AS n FROM tokens WHERE status = 'queued'")?.n || 0;
  const activeConsultations = get("SELECT COUNT(*) AS n FROM tokens WHERE status = 'called'")?.n || 0;
  const completedToday = get("SELECT COUNT(*) AS n FROM tokens WHERE date(created_at) = date('now') AND status = 'completed'")?.n || 0;
  const urgent = get("SELECT COUNT(*) AS n FROM tokens WHERE status = 'queued' AND priority IN ('URGENT','EMERGENCY')")?.n || 0;
  const noShow = get("SELECT COUNT(*) AS n FROM tokens WHERE date(created_at) = date('now') AND status = 'no_show'")?.n || 0;
  const skippedToday = get("SELECT COUNT(*) AS n FROM tokens WHERE date(created_at) = date('now') AND status = 'skipped'")?.n || 0;
  const cancelledToday = get("SELECT COUNT(*) AS n FROM tokens WHERE date(created_at) = date('now') AND status = 'cancelled'")?.n || 0;

  const doctors = Doctor.list();
  const doctorsAvailable = doctors.filter((d) => d.status === 'available' && d.active).length;
  const doctorsBusy = doctors.filter((d) => ['busy', 'in_consultation'].includes(d.status)).length;
  const doctorsUnavailable = doctors.filter((d) => ['break', 'offline'].includes(d.status) || !d.active).length;

  // Attention: queued tokens with no doctor assignment yet.
  const unassigned = get("SELECT COUNT(*) AS n FROM tokens WHERE status = 'queued' AND doctor_id IS NULL")?.n || 0;
  const notificationFailures = Notify.list({}).filter((n) => ['FAILED', 'RETRYING'].includes(n.status) || (n.status === 'PENDING' && n.channel !== 'web')).length;

  res.json({
    summary: {
      patientsWaiting,
      activeConsultations,
      completedToday,
      doctorsAvailable,
      doctorsBusy,
      doctorsUnavailable,
      urgent,
      unassigned,
      noShow,
      skippedToday,
      cancelledToday,
      notificationFailures,
    },
    activity: Audit.list({ limit: 25 }),
  });
});

export default router;