import { Router } from 'express';
import * as Department from '../models/Department.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ departments: Department.list() });
});

router.get('/:id', (req, res) => {
  const dept = Department.findById(req.params.id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  res.json({ department: dept });
});

router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const { name, code, color, enabled } = req.body || {};
  if (!name || !code) return res.status(400).json({ error: 'name and code are required' });
  if (Department.findByCode(code)) return res.status(409).json({ error: 'Code already exists' });
  res.status(201).json({ department: Department.create({ name, code, color, enabled }) });
});

router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const dept = Department.findById(req.params.id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  const { name, code, color, enabled } = req.body || {};
  if (code && code !== dept.code && Department.findByCode(code)) {
    return res.status(409).json({ error: 'Code already exists' });
  }
  res.json({ department: Department.update(dept.id, { name, code, color, enabled }) });
});

router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const changes = Department.remove(req.params.id);
  if (!changes) return res.status(404).json({ error: 'Department not found' });
  res.json({ ok: true });
});

export default router;