// Marketing studio: create campaigns (optionally from an approved AI recommendation),
// generate copy, launch (activates the storefront discount), and measure results.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { asyncHandler, HttpError, parse } from '../utils/http.js';
import { generateCampaignContent } from '../services/ai.js';
import { campaignPerformance } from '../services/analytics.js';

const router = Router();

const shape = (c) => ({
  id: c.id, recommendationId: c.recommendation_id, productId: c.product_id, productName: c.product_name ?? null,
  title: c.title, caption: c.caption, hashtags: c.hashtags, emailSubject: c.email_subject, emailBody: c.email_body,
  discountPct: c.discount_pct, status: c.status, generatedByAi: c.generated_by_ai,
  startsAt: c.starts_at, endsAt: c.ends_at, createdAt: c.created_at,
  shareUrl: `${config.publicClientUrl}/shop/${c.business_slug}`,
});

const baseSelect = `SELECT c.*, p.name AS product_name, b.slug AS business_slug
  FROM campaigns c LEFT JOIN products p ON p.id = c.product_id AND p.business_id = c.business_id
  JOIN businesses b ON b.id = c.business_id`;

router.get('/campaigns', asyncHandler(async (req, res) => {
  const { rows } = await query(`${baseSelect} WHERE c.business_id = $1 ORDER BY c.created_at DESC, c.id DESC`, [req.business.id]);
  res.json(rows.map(shape));
}));

const createSchema = z.object({
  productId: z.number().int().positive().nullable().optional(),
  recommendationId: z.number().int().positive().nullable().optional(),
  discountPct: z.number().min(0).max(90).default(0),
  generateCopy: z.boolean().default(true),
  title: z.string().trim().max(120).optional(),
});

router.post('/campaigns', asyncHandler(async (req, res) => {
  const b = parse(createSchema, req.body);
  let product = null, rec = null;

  if (b.recommendationId) {
    const r = await query('SELECT * FROM ai_recommendations WHERE id = $1 AND business_id = $2', [b.recommendationId, req.business.id]);
    rec = r.rows[0];
    if (!rec) throw new HttpError(404, 'Recommendation not found');
    if (rec.status === 'rejected') throw new HttpError(409, 'This recommendation was rejected');
  }
  const productId = b.productId ?? rec?.product_id ?? null;
  if (productId) {
    const p = await query('SELECT id, name, price, cost FROM products WHERE id = $1 AND business_id = $2', [productId, req.business.id]);
    product = p.rows[0];
    if (!product) throw new HttpError(404, 'Product not found');
  }
  // Safety: a discount may never take the price to or below cost.
  if (product && b.discountPct > 0 && product.price * (1 - b.discountPct / 100) <= product.cost)
    throw new HttpError(400, 'That discount would sell below cost');

  const discountPct = b.discountPct || Number(rec?.suggested_discount_pct) || 0;
  const copy = b.generateCopy
    ? await generateCampaignContent({ business: req.business, product, discountPct, recommendation: rec })
    : { title: b.title || 'New campaign', caption: '', hashtags: [], emailSubject: '', emailBody: '' };

  const { rows } = await query(
    `INSERT INTO campaigns (business_id, recommendation_id, product_id, title, caption, hashtags, email_subject, email_body, discount_pct, generated_by_ai)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [req.business.id, rec?.id ?? null, product?.id ?? null, b.title || copy.title, copy.caption, copy.hashtags, copy.emailSubject, copy.emailBody, discountPct, b.generateCopy],
  );
  if (rec && rec.status === 'proposed')
    await query("UPDATE ai_recommendations SET status = 'approved', decided_at = now() WHERE id = $1", [rec.id]);

  const full = await query(`${baseSelect} WHERE c.id = $1`, [rows[0].id]);
  res.status(201).json(shape(full.rows[0]));
}));

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  caption: z.string().max(600).optional(),
  hashtags: z.array(z.string().max(40)).max(10).optional(),
  emailSubject: z.string().max(140).optional(),
  emailBody: z.string().max(1500).optional(),
});

// Owners can edit AI-written copy before anything goes live.
router.patch('/campaigns/:id', asyncHandler(async (req, res) => {
  const b = parse(patchSchema, req.body);
  const { rowCount } = await query(
    `UPDATE campaigns SET title = coalesce($3,title), caption = coalesce($4,caption), hashtags = coalesce($5,hashtags),
            email_subject = coalesce($6,email_subject), email_body = coalesce($7,email_body)
      WHERE id = $1 AND business_id = $2`,
    [req.params.id, req.business.id, b.title ?? null, b.caption ?? null, b.hashtags ?? null, b.emailSubject ?? null, b.emailBody ?? null],
  );
  if (!rowCount) throw new HttpError(404, 'Campaign not found');
  const full = await query(`${baseSelect} WHERE c.id = $1`, [req.params.id]);
  res.json(shape(full.rows[0]));
}));

const launchSchema = z.object({ durationDays: z.number().int().min(1).max(90).default(7) });

// Human approval gate: nothing is discounted on the storefront until the owner launches it.
router.post('/campaigns/:id/launch', asyncHandler(async (req, res) => {
  const { durationDays } = parse(launchSchema, req.body ?? {});
  const { rowCount } = await query(
    `UPDATE campaigns SET status = 'active', starts_at = now(), ends_at = now() + make_interval(days => $3)
      WHERE id = $1 AND business_id = $2 AND status = 'draft'`,
    [req.params.id, req.business.id, durationDays],
  );
  if (!rowCount) throw new HttpError(409, 'Only draft campaigns can be launched');
  const full = await query(`${baseSelect} WHERE c.id = $1`, [req.params.id]);
  res.json(shape(full.rows[0]));
}));

router.post('/campaigns/:id/end', asyncHandler(async (req, res) => {
  const { rowCount } = await query(
    `UPDATE campaigns SET status = 'ended', ends_at = least(coalesce(ends_at, now()), now())
      WHERE id = $1 AND business_id = $2 AND status = 'active'`, [req.params.id, req.business.id]);
  if (!rowCount) throw new HttpError(409, 'Only active campaigns can be ended');
  const full = await query(`${baseSelect} WHERE c.id = $1`, [req.params.id]);
  res.json(shape(full.rows[0]));
}));

router.get('/campaigns/:id/performance', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM campaigns WHERE id = $1 AND business_id = $2', [req.params.id, req.business.id]);
  if (!rows[0]) throw new HttpError(404, 'Campaign not found');
  res.json((await campaignPerformance(rows[0])) || { note: 'Launch the campaign to start measuring results.' });
}));

export default router;
