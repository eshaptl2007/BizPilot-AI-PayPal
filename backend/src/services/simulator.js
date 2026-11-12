// Business Growth Simulator - pure, deterministic, no I/O.
// "What if I offer X% off product P?"  All maths is in integer cents.
// Everything returned is a HYPOTHETICAL projection, never a promise.
import { toCents, fromCents, formatMoney } from '../utils/money.js';

export const DEFAULT_UPLIFTS = [0, 10, 25, 50, 100];

export function simulateDiscount({ price, cost, baselineUnits, windowDays, discountPct, currency = 'INR', uplifts = DEFAULT_UPLIFTS }) {
  const priceC = toCents(price);
  const costC = toCents(cost);
  const newPriceC = Math.round((priceC * (100 - discountPct)) / 100);
  const marginNowC = priceC - costC;
  const marginNewC = newPriceC - costC;
  const baselineProfitC = baselineUnits * marginNowC;

  // Units needed at the discounted price to earn at least today's profit.
  let breakEvenUnits = null;
  if (marginNewC > 0) breakEvenUnits = Math.max(0, Math.ceil(baselineProfitC / marginNewC));
  const requiredUpliftPct =
    breakEvenUnits !== null && baselineUnits > 0
      ? Math.round(((breakEvenUnits - baselineUnits) / baselineUnits) * 1000) / 10
      : null;

  const scenarios = uplifts.map((u) => {
    const units = Math.round(baselineUnits * (1 + u / 100));
    const profitC = units * marginNewC;
    return {
      label: u === 0 ? 'No extra demand' : `+${u}% units`,
      upliftPct: u,
      units,
      revenue: fromCents(units * newPriceC),
      profit: fromCents(profitC),
      profitDelta: fromCents(profitC - baselineProfitC),
      beatsBaseline: profitC >= baselineProfitC,
    };
  });

  let verdict;
  if (marginNewC <= 0) verdict = { level: 'avoid', text: 'The discounted price is at or below cost, so every sale loses money.' };
  else if (baselineUnits === 0) verdict = { level: 'unknown', text: 'There are no recent sales of this product, so there is no baseline to compare against.' };
  else if (requiredUpliftPct <= 15) verdict = { level: 'low-risk', text: `Sales only need to rise about ${requiredUpliftPct}% for this discount to pay for itself.` };
  else if (requiredUpliftPct <= 40) verdict = { level: 'moderate', text: `Sales need to rise about ${requiredUpliftPct}% to break even - plausible with good promotion, but not certain.` };
  else verdict = { level: 'risky', text: `Sales would need to rise about ${requiredUpliftPct}% just to break even. Consider a smaller discount.` };

  return {
    currency,
    discountPct,
    windowDays,
    listPrice: fromCents(priceC),
    discountedPrice: fromCents(newPriceC),
    unitCost: fromCents(costC),
    unitMarginNow: fromCents(marginNowC),
    unitMarginDiscounted: fromCents(marginNewC),
    marginPctNow: priceC ? Math.round((marginNowC / priceC) * 1000) / 10 : 0,
    marginPctDiscounted: newPriceC ? Math.round((marginNewC / newPriceC) * 1000) / 10 : 0,
    baselineUnits,
    baselineProfit: fromCents(baselineProfitC),
    breakEvenUnits,
    requiredUpliftPct,
    scenarios,
    verdict,
    disclaimer:
      'Projections are hypothetical what-if scenarios based on your recent sales. They are not forecasts or guarantees.',
  };
}

/** Plain-language fallback explanation when no LLM is available. */
export function templateNarrative(productName, sim) {
  const m = (v) => formatMoney(v, sim.currency);
  const lines = [
    `Today ${productName} sells ${sim.baselineUnits} units per ${sim.windowDays} days at ${m(sim.listPrice)}, earning ${m(sim.unitMarginNow)} profit per unit (${m(sim.baselineProfit)} in total).`,
    `At ${sim.discountPct}% off the price becomes ${m(sim.discountedPrice)} and profit per unit drops to ${m(sim.unitMarginDiscounted)}.`,
  ];
  if (sim.breakEvenUnits !== null && sim.baselineUnits > 0)
    lines.push(`You would need about ${sim.breakEvenUnits} units (${sim.requiredUpliftPct}% more) to earn the same total profit.`);
  lines.push(sim.verdict.text);
  lines.push('These figures are hypothetical, not guaranteed.');
  return lines.join(' ');
}
