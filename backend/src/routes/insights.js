// Analytics, AI growth advisor and the what-if simulator.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { asyncHandler, HttpError, parse } from '../utils/http.js';
import { getMetrics, unitsSold, tenureHours } from '../services/analytics.js';
import { analyzeBusiness, saveRecommendations, simulationNarrative, aiStatus } from '../services/ai.js';
import { simulateDiscount } from '../services/simulator.js';
import { MAX_HOURS, computeRanges } from '../services/ranges.js';

const router = Router();

const daysSchema = z.coerce.number().int().min(7).max(180).default(30);
const hoursSchema = z.coerce.number().int().min(1).max(MAX_HOURS).optional();

// ?hours=N picks a window; without it the server picks the default for this user's tenure.
router.get('/analytics/overview', asyncHandler(async (req, res) => {
  const requested = parse(hoursSchema, req.query.hours);
  const opts = { userCreatedAt: req.user.createdAt };
  const hours = requested ?? computeRanges(await tenureHours(req.business, req.user.createdAt)).defaultHours;
  res.json(await getMetrics(req.business, hours, opts));
}));

// ---- AI advisor ----------------------------------------------------------------
router.get('/ai/status', (_req, res) => res.json(aiStatus()));

router.post('/ai/analyze', asyncHandler(async (req, res) => {
  const days = parse(daysSchema, req.body?.days);
  const metrics = await getMetrics(req.business, days * 24, { withSeries: false });
  if (metrics.orders.current === 0 && metrics.orders.previous === 0)
    throw new HttpError(400, 'Add some sales (or import a CSV) before running the AI analysis.');

  const result = await analyzeBusiness(req.business, metrics);
  // New analysis supersedes older still-undecided proposals.
  await query("DELETE FROM ai_recommendations WHERE business_id = $1 AND status = 'proposed'", [req.business.id]);
  const saved = await saveRecommendations(req.business.id, result.runId, result.recommendations);
  res.json({ summary: result.summary, provider: result.provider, model: result.model, fallback: result.fallback, recommendations: saved.map(shapeRec) });
}));

const shapeRec = (r) => ({
  id: r.id, type: r.type, priority: r.priority, productId: r.product_id, title: r.title, problem: r.problem,
  evidence: r.evidence, action: r.action, targetAudience: r.target_audience, expectedCost: r.expected_cost,
  successMetric: r.success_metric, suggestedDiscountPct: r.suggested_discount_pct, status: r.status, createdAt: r.created_at,
});

router.get('/ai/recommendations', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM ai_recommendations WHERE business_id = $1
      ORDER BY (status = 'proposed') DESC, created_at DESC, priority LIMIT 60`, [req.business.id]);
  res.json(rows.map(shapeRec));
}));

router.patch('/ai/recommendations/:id', asyncHandler(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['approved', 'rejected', 'completed']) }), req.body);
  const { rows } = await query(
    'UPDATE ai_recommendations SET status = $3, decided_at = now() WHERE id = $1 AND business_id = $2 RETURNING *',
    [req.params.id, req.business.id, status],
  );
  if (!rows[0]) throw new HttpError(404, 'Recommendation not found');
  res.json(shapeRec(rows[0]));
}));

// ---- what-if simulator -----------------------------------------------------------
const simSchema = z.object({
  productId: z.number().int().positive(),
  discountPct: z.number().min(0).max(90),
  windowDays: z.number().int().min(7).max(365).default(30),
  narrate: z.boolean().default(true),
});

router.post('/simulator', asyncHandler(async (req, res) => {
  const b = parse(simSchema, req.body);
  const { rows } = await query('SELECT id, name, price, cost FROM products WHERE id = $1 AND business_id = $2', [b.productId, req.business.id]);
  const product = rows[0];
  if (!product) throw new HttpError(404, 'Product not found');

  const baselineUnits = await unitsSold(req.business.id, product.id, b.windowDays);
  const sim = simulateDiscount({ price: product.price, cost: product.cost, baselineUnits, windowDays: b.windowDays, discountPct: b.discountPct, currency: req.business.currency.trim() });
  const narrative = b.narrate ? await simulationNarrative(req.business, product, sim) : null;

  const saved = await query(
    `INSERT INTO simulations (business_id, product_id, discount_pct, window_days, baseline_units, baseline_profit, break_even_units, scenarios, narrative)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [req.business.id, product.id, b.discountPct, b.windowDays, sim.baselineUnits, sim.baselineProfit, sim.breakEvenUnits, JSON.stringify(sim.scenarios), narrative],
  );
  res.json({ id: saved.rows[0].id, product: { id: product.id, name: product.name }, ...sim, narrative });
}));

export default router;
