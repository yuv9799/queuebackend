import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import request from 'supertest';
import { REVIEW_DATA } from '../seed/reviews.data.js';

// Isolated test DB (distinct from api.test.js).
const TEST_DB = path.resolve('data', 'test-reviews.db');
process.env.DB_PATH = TEST_DB;
process.env.JWT_SECRET = 'test-secret-for-jwt-at-least-32-chars-long!!';
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  if (fs.existsSync(f)) fs.rmSync(f);
}

const { createApp } = await import('../app.js');
const app = createApp();

let adminToken;
let deptId;

before(async () => {
  const { run } = await import('../config/db.js');
  const bcrypt = (await import('bcryptjs')).default;
  run('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', 'Admin', 'admin@test.in', bcrypt.hashSync('x', 10), 'admin');
  const login = await request(app).post('/auth/login').send({ email: 'admin@test.in', password: 'x' });
  adminToken = login.body.token;
  const dept = await request(app)
    .post('/departments').set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Cardiology', code: 'CARD', color: '#dc2626' });
  deptId = dept.body.department.id;
});

after(async () => {
  const { db } = await import('../config/db.js');
  try { db.close(); } catch {}
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
});

test('public reviews list is empty initially', async () => {
  const res = await request(app).get('/reviews');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.reviews, []);
});

test('submitted review is approved, stored, and visible after a fresh public request', async () => {
  const res = await request(app).post('/reviews').send({
    reviewerName: 'Anita', reviewerType: 'PATIENT', rating: 5,
    comment: 'Great experience', departmentId: deptId,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.review.status, 'APPROVED');
  assert.equal(res.body.review.rating, 5);
  assert.match(res.body.review.ownerKey, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal('owner_key_hash' in res.body.review, false);
  const refreshed = await request(app).get('/reviews');
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.reviews.some((review) => review.id === res.body.review.id));
});

test('review owner key permits edits and deletion while rejecting other keys', async () => {
  const created = await request(app).post('/reviews').send({
    reviewerName: 'Review owner',
    rating: 4,
    comment: 'Original review',
  });
  const { id, ownerKey } = created.body.review;

  const forbiddenUpdate = await request(app)
    .patch(`/reviews/${id}`)
    .set('X-Review-Owner-Key', 'not-the-owner-key')
    .send({ reviewerName: 'Attacker', rating: 1, comment: 'Changed by someone else' });
  assert.equal(forbiddenUpdate.status, 404);

  const updated = await request(app)
    .patch(`/reviews/${id}`)
    .set('X-Review-Owner-Key', ownerKey)
    .send({ reviewerName: 'Updated owner', rating: 5, comment: 'Updated review', category: 'GENERAL' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.review.reviewer_name, 'Updated owner');
  assert.equal(updated.body.review.rating, 5);
  assert.equal(updated.body.review.comment, 'Updated review');
  assert.equal('ownerKey' in updated.body.review, false);

  const forbiddenDelete = await request(app)
    .delete(`/reviews/${id}`)
    .set('X-Review-Owner-Key', 'not-the-owner-key');
  assert.equal(forbiddenDelete.status, 404);

  const deleted = await request(app).delete(`/reviews/${id}`).set('X-Review-Owner-Key', ownerKey);
  assert.equal(deleted.status, 200);
  const publicReviews = await request(app).get('/reviews');
  assert.ok(!publicReviews.body.reviews.some((review) => review.id === id));
});

test('rejects invalid rating', async () => {
  const res = await request(app).post('/reviews').send({ reviewerName: 'A', reviewertype: 'PATIENT', rating: 9, comment: 'x' });
  assert.equal(res.status, 400);
});

test('stores saved review metadata and request details', async () => {
  const res = await request(app).post('/reviews').send({
    reviewerName: 'Nina',
    reviewerType: 'PATIENT',
    rating: 5,
    comment: 'Very smooth queue',
    departmentId: deptId,
    category: 'QUEUE_TRACKING',
    request: 'Add a near-turn notification',
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.review.category, 'QUEUE_TRACKING');
  assert.equal(res.body.review.request, 'Add a near-turn notification');
  assert.equal(res.body.review.status, 'APPROVED');
});

test('summary reflects approved count only', async () => {
  const res = await request(app).get('/reviews/summary');
  assert.equal(res.body.summary.count, 2);
  assert.equal(res.body.summary.average, 5);
  assert.equal('patientCount' in res.body.summary, false);
  assert.equal('staffCount' in res.body.summary, false);
});

test('review seed contains 116 entries while retaining the 45 five-star reviews', () => {
  assert.equal(REVIEW_DATA.length, 116);
  assert.equal(REVIEW_DATA.filter(([, rating]) => rating === 5).length, 45);
  assert.deepEqual(
    [5, 4, 3, 2, 1].map((rating) => REVIEW_DATA.filter(([, value]) => value === rating).length),
    [45, 45, 16, 7, 3]
  );
});

test('staff can moderate published reviews', async () => {
  const staff = await request(app).post('/reviews').send({ reviewerName: 'Dr. X', reviewerType: 'STAFF', rating: 4, comment: 'Easy to manage queues' });
  const id = staff.body.review.id;
  assert.equal(staff.body.review.reviewer_type, 'STAFF');
  assert.equal(staff.body.review.status, 'APPROVED');

  // Newly submitted reviews are visible immediately.
  const beforeModeration = await request(app).get('/reviews');
  assert.ok(beforeModeration.body.reviews.some((review) => review.id === id));

  // Staff can still manage published reviews.
  const patch = await request(app)
    .patch(`/reviews/${id}/status`).set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'APPROVED' });
  assert.equal(patch.body.review.status, 'APPROVED');

  const pub = await request(app).get('/reviews');
  assert.ok(pub.body.reviews.some((review) => review.id === id));

  const sum = await request(app).get('/reviews/summary');
  assert.equal(sum.body.summary.count, 3);
  assert.equal(sum.body.summary.average, 4.7);
});

test('admin moderation list supports filters', async () => {
  const res = await request(app)
    .get('/reviews/admin?type=STAFF&status=APPROVED').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.reviews.every((r) => r.reviewer_type === 'STAFF' && r.status === 'APPROVED'));
});

test('moderation requires auth', async () => {
  const res = await request(app).get('/reviews/admin');
  assert.equal(res.status, 401);
});

test('admin can delete a review', async () => {
  const created = await request(app).post('/reviews').send({ reviewerName: 'Tmp', reviewerType: 'PATIENT', rating: 3, comment: 'temp' });
  const id = created.body.review.id;
  const del = await request(app).delete(`/reviews/${id}`).set('Authorization', `Bearer ${adminToken}`);
  assert.equal(del.status, 200);
  const after = await request(app).get(`/reviews/admin?status=PENDING`).set('Authorization', `Bearer ${adminToken}`);
  assert.ok(!after.body.reviews.some((r) => r.id === id));
});