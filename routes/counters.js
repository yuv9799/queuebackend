import { Router } from 'express';
import * as Counter from '../models/Counter.js';
import * as Area from '../models/Area.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireRole('admin'), (req, res) => {
  const areaId = req.query.areaId;
  res.json({ counters: Counter.list({ areaId }) });
});

router.get('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const counter = Counter.findById(req.params.id);
  if (!counter) return res.status(404).json({ error: 'Counter not found' });
  res.json({ counter });
});

router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { areaId, name, enabled } = req.body || {};
  if (!areaId || !name) return res.status(400).json({ error: 'areaId and name are required' });
  if (!Area.findById(areaId)) return res.status(400).json({ error: 'Area not found' });
  res.status(201).json({ counter: Counter.create({ areaId, name, enabled }) });
});

router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const counter = Counter.findById(req.params.id);
  if (!counter) return res.status(404).json({ error: 'Counter not found' });
  const { name, enabled } = req.body || {};
  res.json({ counter: Counter.update(counter.id, { name, enabled }) });
});

router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const changes = Counter.remove(req.params.id);
  if (!changes) return res.status(404).json({ error: 'Counter not found' });
  res.json({ ok: true });
});

export default router;