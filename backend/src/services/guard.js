// Guardrails between the LLM and the database. The model proposes; this code verifies.
//  - product ids must exist in the computed metrics
//  - evidence for product recommendations is REPLACED by server-computed facts
//  - discounts are clamped to a margin-safe cap
//  - type / priority / lengths are normalised, and at most 6 recommendations are kept
import { verifiedEvidence, safeDiscountCap } from './insights.js';

const TYPES = ['promote_product', 'fix_declining', 'restock', 'price_adjust', 'retain_customers', 'cut_cost', 'other'];
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null);

export function sanitizeRecommendations(raw, metrics) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const title = str(r.title, 140);
    const problem = str(r.problem, 600);
    const action = str(r.action, 600);
    const successMetric = str(r.successMetric ?? r.success_metric, 300);
    if (!title || !problem || !action || !successMetric) continue;

    const rawPid = r.productId ?? r.product_id;
    const product = metrics.products.find((p) => p.productId === Number(rawPid)) || null;

    let discount = num(r.suggestedDiscountPct ?? r.suggested_discount_pct);
    if (discount !== null) {
      discount = product ? Math.min(discount, safeDiscountCap(product)) : null;
      if (!discount) discount = null;
    }

    let evidence;
    if (product) evidence = verifiedEvidence(metrics, product.productId);
    else
      evidence = (Array.isArray(r.evidence) ? r.evidence : [])
        .filter((e) => e && typeof e.label === 'string' && (typeof e.value === 'string' || typeof e.value === 'number'))
        .slice(0, 5)
        .map((e) => ({ label: e.label.slice(0, 80), value: String(e.value).slice(0, 120) }));

    out.push({
      type: TYPES.includes(r.type) ? r.type : 'other',
      priority: [1, 2, 3].includes(Number(r.priority)) ? Number(r.priority) : 2,
      productId: product ? product.productId : null,
      title,
      problem,
      evidence,
      action,
      targetAudience: str(r.targetAudience ?? r.target_audience, 300),
      expectedCost: num(r.expectedCost ?? r.expected_cost),
      successMetric,
      suggestedDiscountPct: discount,
    });
  }
  out.sort((a, b) => a.priority - b.priority);
  return out.slice(0, 6);
}

export function sanitizeCampaignContent(raw, fallback) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const tags = Array.isArray(o.hashtags)
    ? o.hashtags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 6).map((t) => (t.startsWith('#') ? t : `#${t}`).replace(/\s+/g, ''))
    : [];
  return {
    title: str(o.title, 120) || fallback.title,
    caption: str(o.caption, 600) || fallback.caption,
    hashtags: tags.length ? tags : fallback.hashtags,
    emailSubject: str(o.emailSubject ?? o.email_subject, 140) || fallback.emailSubject,
    emailBody: str(o.emailBody ?? o.email_body, 1500) || fallback.emailBody,
  };
}
