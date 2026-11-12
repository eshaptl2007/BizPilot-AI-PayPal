// Money is shown in the shop's own currency (Indian rupees by default, with lakh/crore digit grouping).
// AuthProvider calls setCurrency() with the business currency right after login.
let currentCurrency = 'INR';
export const setCurrency = (c) => { currentCurrency = String(c || 'INR').trim(); };
export const getCurrency = () => currentCurrency;
const locale = (c) => (c === 'INR' ? 'en-IN' : 'en-US');

export const money = (v, currency = currentCurrency) => {
  const n = Number(v || 0);
  return new Intl.NumberFormat(locale(currency), {
    style: 'currency', currency,
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
  }).format(n);
};
/** Compact form for chart axes: ₹1.2L, ₹45K */
export const moneyShort = (v, currency = currentCurrency) =>
  new Intl.NumberFormat(locale(currency), { style: 'currency', currency, notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(Number(v || 0));

export const pct = (v) => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : ''}${v}%`);
export const shortDate = (d) => new Date(d).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
export const dateTime = (d) => new Date(d).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---- chart bucket labels. Buckets arrive as naive local timestamps like "2026-11-12T15:00:00" (IST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hour12 = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
export function bucketLabel(b, bucket, long = false) {
  const [date, time] = String(b).split('T');
  const [y, m, d] = date.split('-').map(Number);
  const h = Number((time || '0').split(':')[0]);
  switch (bucket) {
    case 'hour': return long ? `${d} ${MONTHS[m - 1]}, ${hour12(h)}` : hour12(h);
    case 'day': return `${d} ${MONTHS[m - 1]}`;
    case 'week': return long ? `Week of ${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]}`;
    case 'month': return long ? `${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} '${String(y).slice(2)}`;
    default: return b;
  }
}
export const BUCKET_NAME = { hour: 'hour', day: 'day', week: 'week', month: 'month' };

export const currencySymbol = (currency = currentCurrency) =>
  new Intl.NumberFormat(locale(currency), { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value || currency;
