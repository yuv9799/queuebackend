import { Router } from 'express';
import * as Stats from '../models/Stats.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router = Router();

// GET /stats/overview
router.get('/overview', optionalAuth, (req, res) => {
  res.json({ overview: Stats.overview() });
});

// GET /stats/status — tokens by status today
router.get('/status', requireAuth, (req, res) => {
  res.json({ status: Stats.statusToday() });
});

// GET /stats/hourly — tokens issued per hour today
router.get('/hourly', requireAuth, (req, res) => {
  res.json({ hourly: Stats.hourly() });
});

// GET /stats/queue-depth — live queue depth per area
router.get('/queue-depth', requireAuth, (req, res) => {
  res.json({ areas: Stats.queueDepth() });
});

// GET /stats/by-department
router.get('/by-department', requireAuth, (req, res) => {
  res.json({ departments: Stats.byDepartment() });
});

export default router;