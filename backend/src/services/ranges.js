// Adaptive dashboard time ranges. Pure functions, no I/O (unit-tested in test/ranges.test.js).
//
// The ranges a user can pick depend on how long they have been using BizPilot ("tenure"):
//   under 1 week   -> hours   : 6H 12H 24H 48H 72H        (charts are hourly)
//   1 week - 1 mo  -> weeks   : 1D 1W 2W 3W 4W ...        (1D hourly, longer ranges daily)
//   1 month - 1 yr -> months  : 1D 1W 1M 2M 3M 6M 9M ...  (daily / weekly / monthly buckets)
//   1 year or more -> years   : 1D 1W 1M 3M 6M 1Y 2Y ...  (monthly buckets for long ranges)
// Tenure = time since the earlier of (account created, first paid sale), so a business that
// imports six months of history immediately gets the six-month ranges.

export const MAX_HOURS = 24 * 365 * 10;
const DAY = 24;

/** How wide one chart bar is for a window of this many hours. */
export function bucketFor(hours) {
  if (hours <= 72) return 'hour';
  if (hours <= DAY * 31) return 'day';
  if (hours <= DAY * 200) return 'week';
  return 'month';
}

const opt = (label, hours) => ({ key: label.toLowerCase(), label, hours, bucket: bucketFor(hours) });

const HOURS_TIER = [['6H', 6], ['12H', 12], ['24H', 24], ['48H', 48], ['72H', 72]];
const WEEKS_TIER = [['1D', DAY], ['1W', 7 * DAY], ['2W', 14 * DAY], ['3W', 21 * DAY], ['4W', 28 * DAY]];
const MONTHS_TIER = [['1D', DAY], ['1W', 7 * DAY], ['1M', 30 * DAY], ['2M', 60 * DAY], ['3M', 90 * DAY], ['6M', 180 * DAY], ['9M', 270 * DAY]];
const YEARS_TIER = [['1D', DAY], ['1W', 7 * DAY], ['1M', 30 * DAY], ['3M', 90 * DAY], ['6M', 180 * DAY], ['1Y', 365 * DAY], ['2Y', 730 * DAY], ['3Y', 1095 * DAY], ['5Y', 1825 * DAY]];

export function computeRanges(tenureHours) {
  const t = Math.max(0, Number(tenureHours) || 0);
  const days = t / DAY;
  let tier, defs, defaultKey;
  if (days < 7) { tier = 'hours'; defs = HOURS_TIER; defaultKey = '24h'; }
  else if (days < 30) { tier = 'weeks'; defs = WEEKS_TIER; defaultKey = '1w'; }
  else if (days < 365) { tier = 'months'; defs = MONTHS_TIER; defaultKey = '1m'; }
  else { tier = 'years'; defs = YEARS_TIER; defaultKey = '1y'; }

  // keep ranges that fit inside the user's history (one day of tolerance); always keep the first one,
  // and for the hours tier always offer at least up to 24H
  // hours tier: no tolerance, so a brand-new account sees 6H/12H/24H only
  const limit = tier === 'hours' ? Math.max(t, DAY) : t + DAY;
  let options = defs.filter(([, h], i) => i === 0 || h <= limit).map(([l, h]) => opt(l, h));

  // "All time" when the history is clearly longer than the biggest preset
  const last = options[options.length - 1];
  const all = Math.min(Math.ceil(t), MAX_HOURS);
  if (tier !== 'hours' && all - last.hours > DAY) options.push({ key: 'all', label: 'All time', hours: all, bucket: bucketFor(all) });

  if (!options.some((o) => o.key === defaultKey)) defaultKey = options[options.length - 1].key;
  const def = options.find((o) => o.key === defaultKey);
  return { tier, tenureDays: Math.round(days * 10) / 10, options, defaultKey, defaultHours: def.hours };
}
