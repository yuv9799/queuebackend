import { Router } from 'express';
import * as Notify from '../models/Notify.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

// GET /notifications?tokenId=
router.get('/', requireAuth, requireRole('officer', 'admin', 'reception'), (req, res) => {
  const { tokenId } = req.query;
  res.json({ notifications: Notify.list({ tokenId }) });
});

export default router;