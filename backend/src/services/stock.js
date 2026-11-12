// Pure helper for the stock-movement chart (no database access).
/** Pivot (bucket, product, units) rows into chart rows: top 5 products + "Others". */
export function pivotStock(seriesRows, movementRows, topN = 5) {
  const totals = new Map();
  for (const r of movementRows) totals.set(r.product_name, (totals.get(r.product_name) || 0) + Number(r.units));
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN).map(([n]) => n);
  const hasOthers = totals.size > top.length;
  const byBucket = new Map();
  for (const r of movementRows) {
    const row = byBucket.get(r.bucket) || {};
    const key = top.includes(r.product_name) ? r.product_name : 'Others';
    row[key] = (row[key] || 0) + Number(r.units);
    byBucket.set(r.bucket, row);
  }
  const names = hasOthers ? [...top, 'Others'] : top;
  const rows = seriesRows.map((s) => {
    const row = { bucket: s.bucket };
    for (const n of names) row[n] = (byBucket.get(s.bucket) || {})[n] || 0;
    return row;
  });
  return { products: names, rows };
}
