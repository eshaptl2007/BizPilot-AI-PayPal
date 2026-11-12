// AI orchestration:  metrics (computed in SQL/JS)  ->  LLM (structured JSON)  ->  guard  ->  DB.
// If no LLM is configured, or the call fails / returns junk, the deterministic rule engine answers
// instead and the run is logged with fallback_used = true.
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { callLLM, extractJson, llmAvailable } from './llm.js';
import { sanitizeRecommendations, sanitizeCampaignContent } from './guard.js';
import { ruleBasedRecommendations, ruleBasedSummary } from './insights.js';
import { templateNarrative } from './simulator.js';

const SYSTEM_ANALYST = `You are BizPilot, an analyst for a small business owner with no marketing or data team.
You receive METRICS that were computed by software from the owner's real sales database.
Rules:
- Use ONLY numbers present in METRICS. Never invent sales, customers, competitors or prices.
- Amounts are in METRICS.business.currency. For INR write the rupee sign (₹) with Indian digit grouping (for example ₹1,25,000). Never use $.
- Never promise or guarantee results. Use cautious language ("could", "test", "measure").
- Recommend between 2 and 5 concrete actions, most important first (priority 1 = most urgent).
- Every recommendation must be measurable: say exactly which metric will show whether it worked.
- Any discount you suggest must keep the unit margin positive.
- Reply with ONE JSON object and nothing else, in this exact shape:
{"summary": string,
 "recommendations": [{
   "type": "promote_product"|"fix_declining"|"restock"|"price_adjust"|"retain_customers"|"cut_cost"|"other",
   "priority": 1|2|3,
   "productId": number|null,
   "title": string, "problem": string,
   "evidence": [{"label": string, "value": string}],
   "action": string, "targetAudience": string|null,
   "expectedCost": number|null, "successMetric": string,
   "suggestedDiscountPct": number|null }]}`;

async function logRun(businessId, kind, { provider, model, input, output, fallback, error, latency }) {
  const { rows } = await query(
    `INSERT INTO ai_runs (business_id, kind, provider, model, input_metrics, output, fallback_used, error, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [businessId, kind, provider, model || null, JSON.stringify(input), JSON.stringify(output ?? null), fallback, error || null, latency],
  );
  return rows[0].id;
}

/** Strip bulky fields (daily series) before showing metrics to the model. */
const llmView = ({ series, stockSeries, ranges, ...rest }) => rest;

export async function analyzeBusiness(business, metrics) {
  const started = Date.now();
  let summary, recs, provider = 'rules', model = null, fallback = false, error = null;

  if (llmAvailable()) {
    try {
      const res = await callLLM({
        system: SYSTEM_ANALYST,
        user: `METRICS:\n${JSON.stringify(llmView(metrics))}`,
        maxTokens: 2500,
      });
      const parsed = extractJson(res.text);
      recs = sanitizeRecommendations(parsed.recommendations, metrics);
      if (!recs.length) throw new Error('Model returned no valid recommendations');
      summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim().slice(0, 600) : ruleBasedSummary(metrics);
      provider = res.provider;
      model = res.model;
    } catch (e) {
      fallback = true;
      error = String(e.message || e).slice(0, 500);
      console.warn('[ai] LLM failed, using rule engine:', error);
    }
  }
  if (!recs) {
    recs = ruleBasedRecommendations(metrics);
    summary = ruleBasedSummary(metrics);
  }

  const runId = await logRun(business.id, 'analysis', {
    provider, model, input: llmView(metrics), output: { summary, recommendations: recs },
    fallback, error, latency: Date.now() - started,
  });
  return { runId, summary, recommendations: recs, provider, model, fallback };
}

export async function saveRecommendations(businessId, runId, recs) {
  const saved = [];
  for (const r of recs) {
    const { rows } = await query(
      `INSERT INTO ai_recommendations
         (business_id, ai_run_id, product_id, type, priority, title, problem, evidence, action,
          target_audience, expected_cost, success_metric, suggested_discount_pct)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [businessId, runId, r.productId, r.type, r.priority, r.title, r.problem, JSON.stringify(r.evidence),
       r.action, r.targetAudience, r.expectedCost, r.successMetric, r.suggestedDiscountPct],
    );
    saved.push(rows[0]);
  }
  return saved;
}

// ------------------------------------------------------------------ marketing content
function templateCampaign({ business, product, discountPct, goal }) {
  const name = product ? product.name : business.name;
  const offer = discountPct ? `${discountPct}% off` : 'a special offer';
  const tag = (s) => `#${s.replace(/[^A-Za-z0-9]/g, '')}`;
  return {
    title: product ? `${name}: ${offer} this weekend` : `${business.name} weekend special`,
    caption: `${product ? `${name} is ${offer}` : `Something special at ${business.name}`} for a limited time. ${goal ? goal + ' ' : ''}Order online in seconds or drop by the shop.`,
    hashtags: [tag(name), tag(business.name), '#ShopLocal', '#SmallBusiness'],
    emailSubject: `${product ? name : business.name}: ${offer}, this weekend only`,
    emailBody: `Hi there,\n\nFor a limited time ${product ? name : 'our best sellers'} ${discountPct ? `${discountPct}% off` : 'are on offer'} at ${business.name}.\n\nOrder online or visit us in store.\n\nThank you for supporting a small business!\n${business.name}`,
  };
}

export async function generateCampaignContent({ business, product, discountPct, recommendation }) {
  const started = Date.now();
  const fallbackContent = templateCampaign({ business, product, discountPct, goal: recommendation?.action });
  let content = fallbackContent, provider = 'rules', model = null, fallback = false, error = null;
  const input = { business: { name: business.name, category: business.category }, product: product ? { name: product.name, price: product.price } : null, discountPct, recommendation: recommendation ? { title: recommendation.title, action: recommendation.action, targetAudience: recommendation.target_audience } : null };

  if (llmAvailable()) {
    try {
      const res = await callLLM({
        system: `You write short, friendly marketing copy for a small ${business.category} business. Use only the facts given (product, discount). Prices are in Indian rupees (₹) when the currency is INR; never use $. Do not invent prices, dates, awards or claims. No guarantees. Reply with ONE JSON object only: {"title": string, "caption": string (max 280 chars, social post), "hashtags": string[] (3-5), "emailSubject": string, "emailBody": string (under 120 words)}`,
        user: `FACTS:\n${JSON.stringify(input)}`,
        maxTokens: 900,
      });
      content = sanitizeCampaignContent(extractJson(res.text), fallbackContent);
      provider = res.provider;
      model = res.model;
    } catch (e) {
      fallback = true;
      error = String(e.message || e).slice(0, 500);
      console.warn('[ai] campaign copy LLM failed, using template:', error);
    }
  }
  await logRun(business.id, 'campaign_content', { provider, model, input, output: content, fallback, error, latency: Date.now() - started });
  return { ...content, provider, fallback };
}

// ------------------------------------------------------------------ simulator narrative
export async function simulationNarrative(business, product, sim) {
  const started = Date.now();
  let text = templateNarrative(product.name, sim), provider = 'rules', model = null, fallback = false, error = null;
  if (llmAvailable()) {
    try {
      const res = await callLLM({
        system: 'You explain a what-if discount simulation to a small business owner in 3-4 plain sentences. Use only the numbers provided; amounts are in sim.currency (write ₹ for INR, never $). State clearly that all projections are hypothetical, not guaranteed. Reply with ONE JSON object only: {"narrative": string}',
        user: `SIMULATION for ${product.name}:\n${JSON.stringify(sim)}`,
        maxTokens: 500,
      });
      const parsed = extractJson(res.text);
      if (typeof parsed.narrative === 'string' && parsed.narrative.trim()) text = parsed.narrative.trim().slice(0, 1200);
      provider = res.provider;
      model = res.model;
    } catch (e) {
      fallback = true;
      error = String(e.message || e).slice(0, 500);
    }
  }
  await logRun(business.id, 'simulation_narrative', { provider, model, input: sim, output: { narrative: text }, fallback, error, latency: Date.now() - started });
  return text;
}

export const aiStatus = () => ({ provider: config.ai.provider, model: config.ai.provider === 'anthropic' ? config.ai.anthropicModel : config.ai.provider === 'openai' ? config.ai.openaiModel : null });
