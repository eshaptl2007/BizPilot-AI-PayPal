// Turns raw SQL aggregates into the "business metrics" object. Pure and deterministic:
// this is the ONLY thing the AI is shown, so the AI can never invent a number.
import { round2, pctChange } from '../utils/money.js';

export function buildMetrics({ business, hours, totals, expenses, products, customers, series, stockSeries, ranges, bucket }) {
  const days = hours / 24; // window length in days (can be a fraction for hourly views)
  const t = totals;
  const revenue = round2(t.cur_revenue);
  const grossProfit = round2(t.cur_gross_profit);
  const exp = round2(expenses.cur);
  const prevExp = round2(expenses.prev);
  const prevRevenue = round2(t.prev_revenue);
  const prevGross = round2(t.prev_gross_profit);

  const productRows = products.map((p) => {
    const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 1000) / 10 : 0;
    const dailyRate = p.cur_units / days;
    return {
      productId: p.product_id,
      name: p.name,
      price: p.price,
      cost: p.cost,
      marginPct: margin,
      stock: p.stock,
      lowStockThreshold: p.low_stock_threshold,
      active: p.active,
      unitsCurrent: p.cur_units,
      unitsPrevious: p.prev_units,
      unitsChangePct: pctChange(p.cur_units, p.prev_units),
      revenueCurrent: round2(p.cur_revenue),
      revenuePrevious: round2(p.prev_revenue),
      revenueChangePct: pctChange(p.cur_revenue, p.prev_revenue),
      grossProfitCurrent: round2(p.cur_profit),
      revenueSharePct: revenue > 0 ? Math.round((p.cur_revenue / revenue) * 1000) / 10 : 0,
      daysOfStockLeft: dailyRate > 0 ? Math.round((p.stock / dailyRate) * 10) / 10 : null,
    };
  });

  return {
    business: { name: business.name, category: business.category, currency: business.currency },
    windowHours: hours,
    windowDays: Math.round(days * 100) / 100,
    bucket: bucket || null,
    revenue: { current: revenue, previous: prevRevenue, changePct: pctChange(revenue, prevRevenue) },
    grossProfit: {
      current: grossProfit,
      previous: prevGross,
      changePct: pctChange(grossProfit, prevGross),
      marginPct: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
    },
    expenses: { current: exp, previous: prevExp },
    netProfit: { current: round2(grossProfit - exp), previous: round2(prevGross - prevExp) },
    orders: { current: t.cur_orders, previous: t.prev_orders, changePct: pctChange(t.cur_orders, t.prev_orders) },
    averageOrderValue: t.cur_orders > 0 ? round2(revenue / t.cur_orders) : 0,
    customers: {
      withOrders: customers.total,
      repeat: customers.repeat,
      lapsed: customers.lapsed, // repeat buyers who have not bought during this window
    },
    products: productRows,
    // chart/UI-only fields (never sent to the LLM):
    series: series || [],
    stockSeries: stockSeries || { products: [], rows: [] },
    ranges: ranges || null,
  };
}
