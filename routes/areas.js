import { Router } from 'express';
import * as Area from '../models/Area.js';
import * as Department from '../models/Department.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', (req, res) => {
  const departmentId = req.query.departmentId;
  res.json({ areas: Area.list({ departmentId }) });
});

router.get('/:id', (req, res) => {
  const area = Area.findById(req.params.id);
  if (!area) return res.status(404).json({ error: 'Area not found' });
  res.json({ area });
});

router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { departmentId, name, code, floor, enabled } = req.body || {};
  if (!departmentId || !name || !code) {
    return res.status(400).json({ error: 'departmentId, name and code are required' });
  }
  if (!Department.findById(departmentId)) {
    return res.status(400).json({ error: 'Department not found' });
  }
  if (Area.findByCode(code)) return res.status(409).json({ error: 'Code already exists' });
  res.status(201).json({ area: Area.create({ departmentId, name, code, floor, enabled }) });
});

router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const area = Area.findById(req.params.id);
  if (!area) return res.status(404).json({ error: 'Area not found' });
  const { departmentId, name, code, floor, enabled } = req.body || {};
  if (code && code !== area.code && Area.findByCode(code)) {
    return res.status(409).json({ error: 'Code already exists' });
  }
  res.json({ area: Area.update(area.id, { departmentId, name, code, floor, enabled }) });
});

router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const changes = Area.remove(req.params.id);
  if (!changes) return res.status(404).json({ error: 'Area not found' });
  res.json({ ok: true });
});

export default router;