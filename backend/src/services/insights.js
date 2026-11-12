// Deterministic rule engine that produces recommendations from metrics.
// Used (1) as the offline fallback when no LLM key is configured or the LLM fails, and
// (2) to compute SERVER-VERIFIED evidence that is attached to every AI recommendation.
import { round2, formatMoney } from '../utils/money.js';

const fmtPct = (v) => (v === null || v === undefined ? 'n/a' : `${v > 0 ? '+' : ''}${v}%`);

/** Facts about one product that are always true, pulled straight from computed metrics. */
export function verifiedEvidence(m, productId) {
  const p = m.products.find((x) => x.productId === productId);
  if (!p) return [];
  const money = (v) => formatMoney(v, m.business.currency);
  return [
    { label: 'Units sold (this period vs previous)', value: `${p.unitsCurrent} vs ${p.unitsPrevious} (${fmtPct(p.unitsChangePct)})` },
    { label: 'Revenue (this period vs previous)', value: `${money(p.revenueCurrent)} vs ${money(p.revenuePrevious)} (${fmtPct(p.revenueChangePct)})` },
    { label: 'Profit margin', value: `${p.marginPct}% (${money(round2(p.price - p.cost))} per unit)` },
    { label: 'Stock on hand', value: p.daysOfStockLeft === null ? `${p.stock} units` : `${p.stock} units (~${p.daysOfStockLeft} days at current pace)` },
  ];
}

/** Largest discount we ever suggest: keeps at least half of today's unit margin, capped at 30%. */
export function safeDiscountCap(product) {
  return Math.max(0, Math.min(30, Math.floor(product.marginPct * 0.5)));
}

/** Estimated discount given away in a 7-day promotion at current sales volume. */
export function weeklyDiscountCost(product, discountPct, windowDays) {
  const weeklyUnits = (product.unitsCurrent / windowDays) * 7;
  return round2(((product.price * discountPct) / 100) * weeklyUnits);
}

export function ruleBasedRecommendations(m) {
  const money = (v) => formatMoney(v, m.business.currency);
  const recs = [];
  const days = m.windowDays;
  const products = m.products.filter((p) => p.active);

  // 1) Declining products - biggest revenue loss first
  for (const p of products) {
    if (p.unitsPrevious >= 8 && p.unitsChangePct !== null && p.unitsChangePct <= -20) {
      const lost = round2(p.revenuePrevious - p.revenueCurrent);
      const disc = Math.min(15, safeDiscountCap(p));
      recs.push({
        type: 'fix_declining',
        priority: lost >= m.revenue.current * 0.05 ? 1 : 2,
        productId: p.productId,
        title: `Win back sales of ${p.name}`,
        problem: `${p.name} sales fell ${Math.abs(p.unitsChangePct)}% (${p.unitsPrevious} to ${p.unitsCurrent} units), about ${money(lost)} less revenue than the previous ${days} days.`,
        action: `Run a limited weekend promotion on ${p.name}${disc ? ` with ${disc}% off` : ''} and feature it in your next post and email.`,
        targetAudience: `Existing customers who bought ${p.name} before, plus local followers`,
        expectedCost: disc ? weeklyDiscountCost(p, disc, days) : 0,
        successMetric: `${p.name} units sold during the promotion vs the same number of days before it`,
        suggestedDiscountPct: disc || null,
      });
    }
  }

  // 2) Growing, healthy-margin products - ride the momentum
  for (const p of products) {
    if (p.unitsPrevious >= 8 && p.unitsChangePct !== null && p.unitsChangePct >= 20 && p.marginPct >= 50) {
      recs.push({
        type: 'promote_product',
        priority: 2,
        productId: p.productId,
        title: `Double down on ${p.name}`,
        problem: `${p.name} is growing (${fmtPct(p.unitsChangePct)} units) with a healthy ${p.marginPct}% margin, but growth is not yet being marketed.`,
        action: `Feature ${p.name} as your "customer favourite", and test a bundle (for example with a drink or pastry) rather than a discount.`,
        targetAudience: 'Regular customers and new local followers',
        expectedCost: 0,
        successMetric: `Average order value and ${p.name} units per day over the next 14 days`,
        suggestedDiscountPct: null,
      });
    }
  }

  // 3) Restock risk
  for (const p of products) {
    if (p.daysOfStockLeft !== null && p.daysOfStockLeft < 7 && p.unitsCurrent >= 5) {
      recs.push({
        type: 'restock',
        priority: p.daysOfStockLeft < 3 ? 1 : 2,
        productId: p.productId,
        title: `Restock ${p.name}`,
        problem: `Only ${p.stock} ${p.name} left, roughly ${p.daysOfStockLeft} days at the current sales pace.`,
        action: `Reorder or bake more ${p.name} before the weekend, so you do not lose sales to an empty shelf.`,
        targetAudience: null,
        expectedCost: round2(p.cost * Math.ceil((p.unitsCurrent / days) * 14)),
        successMetric: `Zero days out of stock for ${p.name} over the next 14 days`,
        suggestedDiscountPct: null,
      });
    }
  }

  // 4) Lapsed repeat customers
  if (m.customers.lapsed >= 3) {
    recs.push({
      type: 'retain_customers',
      priority: 2,
      productId: null,
      title: 'Bring back lapsed regulars',
      problem: `${m.customers.lapsed} customers who bought from you more than once have not ordered in the last ${days} days.`,
      action: 'Send a short "we miss you" email with a small, time-limited offer on their favourite item.',
      targetAudience: 'Repeat customers with no purchase in this period',
      expectedCost: null,
      successMetric: 'Number of lapsed customers who order again within 14 days',
      suggestedDiscountPct: null,
    });
  }

  // 5) Low-margin sellers
  for (const p of products) {
    if (p.marginPct < 35 && p.unitsCurrent >= 20) {
      recs.push({
        type: 'price_adjust',
        priority: 3,
        productId: p.productId,
        title: `Review the price of ${p.name}`,
        problem: `${p.name} sells well (${p.unitsCurrent} units) but only earns a ${p.marginPct}% margin.`,
        action: `Test a small price increase or cheaper ingredients for ${p.name}.`,
        targetAudience: null,
        expectedCost: 0,
        successMetric: `${p.name} gross profit per week after the change`,
        suggestedDiscountPct: null,
      });
    }
  }

  // 6) Overall profitability warning
  if (m.expenses.current > 0 && m.netProfit.current < 0) {
    recs.push({
      type: 'cut_cost',
      priority: 1,
      productId: null,
      title: 'Expenses exceed gross profit',
      problem: `Gross profit of ${money(m.grossProfit.current)} did not cover ${money(m.expenses.current)} of expenses in the last ${days} days.`,
      action: 'Review your largest expense categories and focus promotion on your highest-margin products.',
      targetAudience: null,
      expectedCost: null,
      successMetric: 'Net profit for the next period',
      suggestedDiscountPct: null,
    });
  }

  recs.sort((a, b) => a.priority - b.priority);
  return recs.slice(0, 6).map((r) => ({
    ...r,
    evidence: r.productId ? verifiedEvidence(m, r.productId) : [],
  }));
}

export function ruleBasedSummary(m) {
  const money = (v) => formatMoney(v, m.business.currency);
  const dir = m.revenue.changePct === null ? 'is new' : m.revenue.changePct >= 0 ? 'grew' : 'fell';
  const chg = m.revenue.changePct === null ? '' : ` ${Math.abs(m.revenue.changePct)}%`;
  return `Revenue ${dir}${chg} to ${money(m.revenue.current)} over the last ${m.windowDays} days, with ${money(m.grossProfit.current)} gross profit (${m.grossProfit.marginPct}% margin) and ${money(m.netProfit.current)} after expenses.`;
}
