// SQL aggregates for the dashboard + AI. Every query is scoped by business_id ($1) and reads
// from v_sale_item_facts (paid sales only), so pending/failed/refunded orders never count.
import { query } from '../db/pool.js';
import { buildMetrics } from './metrics.js';
import { round2 } from '../utils/money.js';
import { config } from '../config.js';
import { bucketFor, computeRanges } from './ranges.js';
import { pivotStock } from './stock.js';

export const SQL = {
  totals: `
    SELECT
      coalesce(sum(revenue)      FILTER (WHERE sold_at >= $2), 0)                          AS cur_revenue,
      coalesce(sum(gross_profit) FILTER (WHERE sold_at >= $2), 0)                          AS cur_gross_profit,
      count(DISTINCT sale_id)    FILTER (WHERE sold_at >= $2)                              AS cur_orders,
      coalesce(sum(revenue)      FILTER (WHERE sold_at >= $3 AND sold_at < $2), 0)         AS prev_revenue,
      coalesce(sum(gross_profit) FILTER (WHERE sold_at >= $3 AND sold_at < $2), 0)         AS prev_gross_profit,
      count(DISTINCT sale_id)    FILTER (WHERE sold_at >= $3 AND sold_at < $2)             AS prev_orders
    FROM v_sale_item_facts
    WHERE business_id = $1 AND sold_at >= $3`,

  expenses: `
    SELECT
      coalesce(sum(amount) FILTER (WHERE incurred_on >= $2::date), 0)                              AS cur,
      coalesce(sum(amount) FILTER (WHERE incurred_on >= $3::date AND incurred_on < $2::date), 0)   AS prev
    FROM expenses WHERE business_id = $1 AND incurred_on >= $3::date`,

  products: `
    SELECT p.id AS product_id, p.name, p.price, p.cost, p.stock, p.low_stock_threshold, p.active,
      coalesce(sum(f.quantity)     FILTER (WHERE f.sold_at >= $2), 0)                        AS cur_units,
      coalesce(sum(f.revenue)      FILTER (WHERE f.sold_at >= $2), 0)                        AS cur_revenue,
      coalesce(sum(f.gross_profit) FILTER (WHERE f.sold_at >= $2), 0)                        AS cur_profit,
      coalesce(sum(f.quantity)     FILTER (WHERE f.sold_at >= $3 AND f.sold_at < $2), 0)     AS prev_units,
      coalesce(sum(f.revenue)      FILTER (WHERE f.sold_at >= $3 AND f.sold_at < $2), 0)     AS prev_revenue
    FROM products p
    LEFT JOIN v_sale_item_facts f
           ON f.product_id = p.id AND f.business_id = p.business_id AND f.sold_at >= $3
    WHERE p.business_id = $1
    GROUP BY p.id
    ORDER BY cur_revenue DESC, p.name`,

  customers: `
    SELECT count(*)                                              AS total,
           count(*) FILTER (WHERE orders >= 2)                   AS repeat,
           count(*) FILTER (WHERE orders >= 2 AND last_order < $2) AS lapsed
    FROM (
      SELECT customer_id, count(DISTINCT sale_id) AS orders, max(sold_at) AS last_order
      FROM v_sale_item_facts
      WHERE business_id = $1 AND customer_id IS NOT NULL
      GROUP BY customer_id
    ) c`,

  // Time-bucketed series. $1 business, $2 window start, $3 bucket (hour|day|week|month), $4 window end, $5 time zone.
  // generate_series gives every bucket a row, so quiet hours/days show as zero instead of gaps.
  series: `
    SELECT to_char(g.bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
           coalesce(d.orders, 0) AS orders, coalesce(d.units, 0) AS units,
           coalesce(d.revenue, 0) AS revenue, coalesce(d.gross_profit, 0) AS gross_profit
      FROM generate_series(date_trunc($3::text, $2::timestamptz AT TIME ZONE $5::text),
                           date_trunc($3::text, $4::timestamptz AT TIME ZONE $5::text),
                           ('1 ' || $3::text)::interval) AS g(bucket)
      LEFT JOIN (
        SELECT date_trunc($3::text, sold_at AT TIME ZONE $5::text) AS bucket,
               count(DISTINCT sale_id) AS orders, sum(quantity) AS units,
               sum(revenue) AS revenue, sum(gross_profit) AS gross_profit
          FROM v_sale_item_facts
         WHERE business_id = $1 AND sold_at >= $2 AND sold_at < $4
         GROUP BY 1) d ON d.bucket = g.bucket
     ORDER BY g.bucket`,

  // Units leaving stock per bucket per product (same parameters as `series`).
  stockMovement: `
    SELECT to_char(date_trunc($3::text, sold_at AT TIME ZONE $5::text), 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
           product_name, sum(quantity) AS units
      FROM v_sale_item_facts
     WHERE business_id = $1 AND sold_at >= $2 AND sold_at < $4
     GROUP BY 1, 2`,

  // First paid sale: used with the account creation date to work out the user's tenure.
  firstSale: `SELECT min(sold_at) AS first_sold FROM sales WHERE business_id = $1 AND status = 'paid'`,

  // campaign before/during comparison for its product
  campaignWindow: `
    SELECT
      coalesce(sum(quantity)     FILTER (WHERE sold_at >= $3 AND sold_at < $4), 0) AS during_units,
      coalesce(sum(revenue)      FILTER (WHERE sold_at >= $3 AND sold_at < $4), 0) AS during_revenue,
      coalesce(sum(gross_profit) FILTER (WHERE sold_at >= $3 AND sold_at < $4), 0) AS during_profit,
      coalesce(sum(quantity)     FILTER (WHERE sold_at >= $5 AND sold_at < $3), 0) AS before_units,
      coalesce(sum(revenue)      FILTER (WHERE sold_at >= $5 AND sold_at < $3), 0) AS before_revenue,
      coalesce(sum(gross_profit) FILTER (WHERE sold_at >= $5 AND sold_at < $3), 0) AS before_profit
    FROM v_sale_item_facts
    WHERE business_id = $1 AND product_id = $2 AND sold_at >= $5 AND sold_at < $4`,

  campaignSales: `
    SELECT count(*) AS orders, coalesce(sum(total), 0) AS revenue
    FROM sales WHERE business_id = $1 AND campaign_id = $2 AND status = 'paid'`,
};

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const num = (v) => round2(v);

/** Time since the user started: earlier of account creation and first paid sale. */
export async function tenureHours(business, userCreatedAt, now = new Date()) {
  const { rows } = await query(SQL.firstSale, [business.id]);
  const first = rows[0]?.first_sold ? new Date(rows[0].first_sold) : null;
  const created = userCreatedAt ? new Date(userCreatedAt) : now;
  const since = first && first < created ? first : created;
  return Math.max(0, (now - since) / HOUR);
}

/**
 * Metrics for the trailing `hours` window (vs the equally long window before it).
 * opts.withSeries = false skips the chart queries (the AI advisor does not need them).
 * opts.userCreatedAt is needed for the adaptive range options.
 */
export async function getMetrics(business, hours, { now = new Date(), withSeries = true, userCreatedAt = null } = {}) {
  const curStart = new Date(now.getTime() - hours * HOUR);
  const prevStart = new Date(now.getTime() - 2 * hours * HOUR);
  const bucket = bucketFor(hours);
  const queries = [
    query(SQL.totals, [business.id, curStart, prevStart]),
    query(SQL.expenses, [business.id, curStart, prevStart]),
    query(SQL.products, [business.id, curStart, prevStart]),
    query(SQL.customers, [business.id, curStart]),
  ];
  if (withSeries) {
    const p = [business.id, curStart, bucket, now, config.timezone];
    queries.push(query(SQL.series, p), query(SQL.stockMovement, p), tenureHours(business, userCreatedAt, now));
  }
  const [totals, expenses, products, customers, series, movement, tenure] = await Promise.all(queries);

  const seriesRows = series
    ? series.rows.map((r) => ({ bucket: r.bucket, orders: r.orders, units: Number(r.units), revenue: num(r.revenue), grossProfit: num(r.gross_profit) }))
    : [];
  return buildMetrics({
    business,
    hours,
    bucket,
    totals: totals.rows[0],
    expenses: expenses.rows[0],
    products: products.rows,
    customers: customers.rows[0],
    series: seriesRows,
    stockSeries: movement ? pivotStock(seriesRows, movement.rows) : undefined,
    ranges: withSeries ? computeRanges(tenure) : undefined,
  });
}

/** Units sold of a product over the trailing window (simulator baseline). */
export async function unitsSold(businessId, productId, days, now = new Date()) {
  const { rows } = await query(
    `SELECT coalesce(sum(quantity), 0) AS units FROM v_sale_item_facts
      WHERE business_id = $1 AND product_id = $2 AND sold_at >= $3`,
    [businessId, productId, new Date(now.getTime() - days * DAY)],
  );
  return rows[0].units;
}

export async function campaignPerformance(campaign, now = new Date()) {
  if (!campaign.product_id || !campaign.starts_at) return null;
  const start = new Date(campaign.starts_at);
  const end = new Date(Math.min(campaign.ends_at ? new Date(campaign.ends_at).getTime() : Infinity, now.getTime()));
  if (end <= start) return null;
  const before = new Date(start.getTime() - (end.getTime() - start.getTime()));
  const [win, attributed] = await Promise.all([
    query(SQL.campaignWindow, [campaign.business_id, campaign.product_id, start, end, before]),
    query(SQL.campaignSales, [campaign.business_id, campaign.id]),
  ]);
  const w = win.rows[0];
  const lift = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
  return {
    periodDays: Math.round((end - start) / DAY),
    before: { units: w.before_units, revenue: round2(w.before_revenue), grossProfit: round2(w.before_profit) },
    during: { units: w.during_units, revenue: round2(w.during_revenue), grossProfit: round2(w.during_profit) },
    unitsLiftPct: lift(w.during_units, w.before_units),
    revenueLiftPct: lift(w.during_revenue, w.before_revenue),
    grossProfitLiftPct: lift(w.during_profit, w.before_profit),
    campaignOrders: attributed.rows[0].orders,
    campaignRevenue: round2(attributed.rows[0].revenue),
    note: 'Compares the campaign period with an equal-length period just before it. Other factors (weekday, season) can also move sales.',
  };
}
