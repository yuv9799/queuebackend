import { Router } from 'express';
import * as Audit from '../models/Audit.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('admin', 'officer'), (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 200;
  res.json({ logs: Audit.list({ limit }) });
});

export default router;