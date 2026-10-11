import { Router } from 'express';
import * as Review from '../models/Review.js';
import { requireAuth, requireRole, optionalAuth } from '../middleware/auth.js';

const router = Router();

// GET /reviews — public approved reviews with filters/sort/search
router.get('/', (req, res) => {
  const { departmentId, type, rating, category, q, sort, limit } = req.query;
  res.json({ reviews: Review.listPublic({ departmentId, type, rating, category, q, sort, limit }) });
});

// GET /reviews/summary — aggregate rating (public)
router.get('/summary', (req, res) => {
  res.json({ summary: Review.summary() });
});

// GET /reviews/analytics — aggregates + top requested improvements (staff)
router.get('/analytics', requireAuth, requireRole('admin', 'officer'), (req, res) => {
  res.json({ analytics: Review.analytics() });
});

// POST /reviews — submit feedback (public; attaches user_id when authenticated)
router.post('/', optionalAuth, (req, res, next) => {
  try {
    const { reviewerName, reviewerType, rating, comment, departmentId, serviceAreaId, category, request } = req.body || {};
    const text = comment && String(comment).trim();
    if (!text) return res.status(400).json({ error: 'Review comment is required' });
    const rate = Number(rating);
    if (!rate || rate < 1 || rate > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    const review = Review.create({
      userId: req.user?.id,
      reviewerName,
      reviewerType,
      rating: rate,
      comment: text,
      departmentId,
      serviceAreaId,
      category: category || null,
      request: request || null,
    });
    res.status(201).json({ review });
  } catch (e) {
    next(e);
  }
});

// Update a review using the private key returned once when it was created.
router.patch('/:id', (req, res, next) => {
  try {
    const { reviewerName, rating, comment, departmentId, category, request } = req.body || {};
    const text = comment && String(comment).trim();
    const rate = Number(rating);
    if (!text) return res.status(400).json({ error: 'Review comment is required' });
    if (!Number.isInteger(rate) || rate < 1 || rate > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    const review = Review.updateOwned(req.params.id, req.get('X-Review-Owner-Key'), {
      reviewerName: reviewerName == null ? 'Anonymous' : String(reviewerName),
      rating: rate,
      comment: text,
      departmentId: departmentId || null,
      category: category || null,
      request: request || null,
    });
    if (!review) return res.status(404).json({ error: 'Review not found or ownership could not be verified' });
    res.json({ review });
  } catch (e) {
    next(e);
  }
});

// Staff moderation — all reviews with filters
router.get('/admin', requireAuth, requireRole('admin', 'officer'), (req, res) => {
  const { status, type, departmentId, rating, category, isDemo, q, sort, limit } = req.query;
  const isDemoFlag = isDemo === 'true' || isDemo === '1' ? true : isDemo === 'false' || isDemo === '0' ? false : null;
  res.json({ reviews: Review.listAdmin({ status, type, departmentId, rating, category, isDemo: isDemoFlag, q, sort, limit }) });
});

// Approve / reject
router.patch('/:id/status', requireAuth, requireRole('admin', 'officer'), (req, res) => {
  const { status } = req.body || {};
  const review = Review.setStatus(req.params.id, status);
  if (!review) return res.status(400).json({ error: 'Invalid status' });
  res.json({ review });
});

// Review owner may delete with their private key; admins retain moderation access.
router.delete('/:id', optionalAuth, (req, res) => {
  if (req.user?.role === 'admin') {
    const changes = Review.remove(req.params.id);
    if (!changes) return res.status(404).json({ error: 'Review not found' });
    return res.json({ ok: true });
  }
  if (!Review.removeOwned(req.params.id, req.get('X-Review-Owner-Key'))) {
    return res.status(404).json({ error: 'Review not found or ownership could not be verified' });
  }
  res.json({ ok: true });
});

export default router;