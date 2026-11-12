// Money helpers. Arithmetic that matters (totals, break-even) is done in integer cents.

export const toCents = (amount) => Math.round(Number(amount) * 100);
export const fromCents = (cents) => Math.round(cents) / 100;
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Price after a percentage discount, rounded to the cent. */
export function discountedPrice(price, discountPct) {
  return fromCents(Math.round((toCents(price) * (100 - Number(discountPct))) / 100));
}

/** Percentage change from previous to current; null when there is no baseline. */
export function pctChange(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Currency-aware text: INR uses Indian digit grouping (₹1,23,456), everything else en-US. */
export function formatMoney(amount, currency = 'INR') {
  const v = Number(amount || 0);
  const cur = String(currency || 'INR').trim();
  return new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(v);
}

/** Shop-currency amount -> checkout-currency amount (e.g. INR -> USD), in whole cents, never below one cent. */
export const toChargeAmount = (amount, rate) => Math.max(1, Math.round(toCents(amount) / rate)) / 100;
