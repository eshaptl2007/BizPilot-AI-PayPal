import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateDiscount } from '../src/services/simulator.js';
import { buildMetrics } from '../src/services/metrics.js';
import { ruleBasedRecommendations, safeDiscountCap } from '../src/services/insights.js';
import { sanitizeRecommendations, sanitizeCampaignContent } from '../src/services/guard.js';
import { discountedPrice, pctChange, toCents } from '../src/utils/money.js';
import { extractJson } from '../src/utils/json.js';
import { business, rows } from './fixtures.js';

const metrics = () => buildMetrics({ business, hours: 30 * 24, ...rows });

test('money: cents maths avoids float drift', () => {
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(discountedPrice(6.5, 10), 5.85);
  assert.equal(discountedPrice(4, 20), 3.2);
  assert.equal(pctChange(15, 36), -58.3);
  assert.equal(pctChange(5, 0), null);
});

test('simulator: break-even units for 10% off', () => {
  const s = simulateDiscount({ price: 10, cost: 4, baselineUnits: 100, windowDays: 30, discountPct: 10 });
  assert.equal(s.discountedPrice, 9);
  assert.equal(s.unitMarginNow, 6);
  assert.equal(s.unitMarginDiscounted, 5);
  assert.equal(s.baselineProfit, 600);
  assert.equal(s.breakEvenUnits, 120); // 600 / 5
  assert.equal(s.requiredUpliftPct, 20);
  assert.equal(s.verdict.level, 'moderate');
  const flat = s.scenarios.find((x) => x.upliftPct === 0);
  assert.equal(flat.profitDelta, -100);
  assert.equal(flat.beatsBaseline, false);
  assert.equal(s.scenarios.find((x) => x.upliftPct === 25).beatsBaseline, true);
  assert.match(s.disclaimer, /hypothetical/i);
});

test('simulator: discount to/below cost has no break-even', () => {
  const s = simulateDiscount({ price: 10, cost: 6, baselineUnits: 50, windowDays: 30, discountPct: 40 });
  assert.equal(s.breakEvenUnits, null);
  assert.equal(s.verdict.level, 'avoid');
});

test('simulator: no baseline sales', () => {
  const s = simulateDiscount({ price: 10, cost: 4, baselineUnits: 0, windowDays: 30, discountPct: 10 });
  assert.equal(s.verdict.level, 'unknown');
  assert.equal(s.requiredUpliftPct, null);
});

test('metrics: totals, margin, trend and stock days', () => {
  const m = metrics();
  assert.equal(m.revenue.changePct, -16.7);
  assert.equal(m.netProfit.current, 150);
  assert.equal(m.averageOrderValue, 10);
  const cake = m.products.find((p) => p.name === 'Cake');
  assert.equal(cake.unitsChangePct, -60);
  assert.equal(cake.marginPct, 55);
  const slice = m.products.find((p) => p.name === 'Slice');
  assert.equal(slice.daysOfStockLeft, 2);
});

test('rules: finds declining, growing, restock and lapsed; skips inactive products', () => {
  const recs = ruleBasedRecommendations(metrics());
  const types = recs.map((r) => `${r.type}:${r.productId}`);
  assert.ok(types.includes('fix_declining:1'));
  assert.ok(types.includes('promote_product:2'));
  assert.ok(types.includes('restock:3'));
  assert.ok(recs.some((r) => r.type === 'retain_customers'));
  assert.ok(!recs.some((r) => r.productId === 4));
  for (const r of recs) assert.ok(r.priority >= 1 && r.successMetric);
  assert.deepEqual(recs.map((r) => r.priority), [...recs.map((r) => r.priority)].sort());
  const decl = recs.find((r) => r.type === 'fix_declining');
  assert.ok(decl.suggestedDiscountPct <= safeDiscountCap(metrics().products[0]));
  assert.ok(decl.evidence.length >= 3);
});

test('guard: drops junk, grounds product ids, clamps discount, replaces evidence', () => {
  const m = metrics();
  const raw = [
    { type: 'fix_declining', priority: 1, productId: 1, title: 'T', problem: 'P', action: 'A', successMetric: 'S', suggestedDiscountPct: 80, evidence: [{ label: 'x', value: 'FAKE 9999' }] },
    { type: 'weird', priority: 9, productId: 999, title: 'T2', problem: 'P', action: 'A', successMetric: 'S', suggestedDiscountPct: 10 },
    { title: 'no problem field' },
    null,
  ];
  const out = sanitizeRecommendations(raw, m);
  assert.equal(out.length, 2);
  assert.equal(out[0].suggestedDiscountPct, 27); // 55% margin -> cap floor(27.5)
  assert.ok(!JSON.stringify(out[0].evidence).includes('FAKE'));
  assert.equal(out[1].productId, null);       // unknown product id rejected
  assert.equal(out[1].suggestedDiscountPct, null);
  assert.equal(out[1].type, 'other');
  assert.equal(out[1].priority, 2);
  assert.deepEqual(sanitizeRecommendations('nope', m), []);
});

test('guard: campaign content falls back per field and normalises hashtags', () => {
  const fb = { title: 'FB', caption: 'FBC', hashtags: ['#a'], emailSubject: 'FS', emailBody: 'FB' };
  const c = sanitizeCampaignContent({ title: 'Hi', hashtags: ['Cake', '#Fresh deal'], caption: 5 }, fb);
  assert.equal(c.title, 'Hi');
  assert.equal(c.caption, 'FBC');
  assert.deepEqual(c.hashtags, ['#Cake', '#Freshdeal']);
});

test('llm: extractJson handles fences and prose', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => extractJson('no json here'));
});
