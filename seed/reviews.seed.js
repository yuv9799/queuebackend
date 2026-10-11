// Idempotent review seeder for the bundled sample reviews.
import { migrate, run, get } from '../config/db.js';
import { REVIEW_DATA } from './reviews.data.js';

migrate();

function lookup(mode, code) {
  const table = mode === 'dept' ? 'departments' : 'areas';
  if (!code) return null;
  const row = get(`SELECT id FROM ${table} WHERE code = ?`, code);
  return row ? row.id : null;
}

function iso(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function seedReviews() {
  // Clean sample reviews from previous runs.
  run('DELETE FROM reviews WHERE is_demo = 1');

  const now = Date.now();
  let inserted = 0;
  for (let i = 0; i < REVIEW_DATA.length; i++) {
    const [type, rating, comment, category, request, deptCode, areaCode, name] = REVIEW_DATA[i];
    // Remove legacy sample rows written before the demo flag was set.
    run(
      `DELETE FROM reviews
       WHERE is_demo = 0 AND status = 'APPROVED'
         AND reviewer_name = ? AND comment = ? AND rating = ?`,
      name,
      comment,
      rating
    );
    const departmentId = lookup('dept', deptCode);
    const serviceAreaId = deptCode ? lookup('area', areaCode || null) : null;
    // Stagger timestamps so newest/oldest sorting is meaningful.
    const createdAt = iso(now - (i * 3600 + (i % 7) * 6000) * 1000);
    run(
      `INSERT INTO reviews
         (reviewer_name, reviewer_type, rating, comment, category, request,
          department_id, service_area_id, status, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', 1, ?)`,
      name,
      type,
      rating,
      comment,
      category || null,
      request || null,
      departmentId,
      serviceAreaId,
      createdAt
    );
    inserted++;
  }

  const summary = get(
    `SELECT COUNT(*) AS n,
            COALESCE(AVG(rating),0) AS avg,
            SUM(rating=5) s5, SUM(rating=4) s4, SUM(rating=3) s3, SUM(rating=2) s2, SUM(rating=1) s1
     FROM reviews WHERE status = 'APPROVED'`
  );
  console.log('Reviews seeded.');
  console.log(`  total      : ${summary.n}`);
  console.log(`  avg rating : ${Math.round(summary.avg * 10) / 10}`);
  console.log(`  5★:${summary.s5} 4★:${summary.s4} 3★:${summary.s3} 2★:${summary.s2} 1★:${summary.s1}`);
  return inserted;
}

// Allow running directly: `node seed/reviews.seed.js`
if (process.argv[1] && process.argv[1].endsWith('reviews.seed.js')) {
  seedReviews();
}

export default seedReviews;