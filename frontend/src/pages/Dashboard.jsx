import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { BUCKET_NAME, bucketLabel, money, moneyShort, pct } from '../format.js';
import { Alert, Stat } from '../components/ui.jsx';

const PALETTE = ['#0f766e', '#1d4ed8', '#b45309', '#7c3aed', '#be185d', '#64748b'];

// What the user sees depends on how long they have been using BizPilot (decided by the server).
const TIER_NOTE = {
  hours: 'New account: hour-by-hour view',
  weeks: 'Account under a month old: hourly and daily views',
  months: 'Showing hourly, daily, weekly and monthly views as your history grows',
  years: 'Full history available: from hourly up to yearly views',
};

export default function Dashboard() {
  const [m, setM] = useState(null);
  const [hours, setHours] = useState(null); // null = let the server pick the default for this user
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    api(`/analytics/overview${hours ? `?hours=${hours}` : ''}`)
      .then((d) => { if (id === seq.current) { setM(d); setError(''); } })
      .catch((e) => id === seq.current && setError(e.message))
      .finally(() => id === seq.current && setLoading(false));
  }, [hours]);

  if (error && !m) return <Alert kind="error">{error}</Alert>;
  if (!m) return <div className="muted">Loading your business data…</div>;

  const cur = m.business.currency;
  const bucket = m.bucket;
  const options = m.ranges?.options || [];
  const active = options.find((o) => o.hours === m.windowHours);
  const rangeLabel = active ? active.label : `${m.windowHours}h`;
  const lowStock = m.products.filter((p) => p.active && p.stock <= p.lowStockThreshold);
  const empty = m.orders.current === 0 && m.orders.previous === 0;
  const axis = (b) => bucketLabel(b, bucket);
  const tip = (b) => bucketLabel(b, bucket, true);
  const byRevenue = [...m.products].sort((a, b) => b.revenueCurrent - a.revenueCurrent).slice(0, 8).map((p) => ({ name: p.name, Revenue: p.revenueCurrent, Profit: p.grossProfitCurrent }));
  const stockProducts = m.products.filter((p) => p.active).sort((a, b) => (a.daysOfStockLeft ?? 1e9) - (b.daysOfStockLeft ?? 1e9));

  return (
    <div className="stack" style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
      <div className="page-head">
        <div>
          <h1>{m.business.name}</h1>
          <div className="muted">Last {rangeLabel} vs the {rangeLabel} before · charts by {BUCKET_NAME[bucket]}</div>
          {m.ranges && <div className="muted small">{TIER_NOTE[m.ranges.tier]} · using BizPilot for {m.ranges.tenureDays < 1 ? 'less than a day' : `${m.ranges.tenureDays} days`}</div>}
        </div>
        <div className="row wrap">
          <div className="range-picker" role="group" aria-label="Time range">
            {options.map((o) => (
              <button key={o.key} className={o.hours === m.windowHours ? 'on' : ''} onClick={() => setHours(o.hours)} disabled={loading}>{o.label}</button>
            ))}
          </div>
          <Link className="btn primary" to="/advisor">✨ AI recommendations</Link>
        </div>
      </div>

      <Alert kind="error">{error}</Alert>
      {empty && <Alert kind="info">No sales in this period yet. Add products, then record sales or import a CSV under “Sales & Data”.</Alert>}

      <div className="grid g5">
        <Stat label="Revenue" value={money(m.revenue.current, cur)} change={m.revenue.changePct} />
        <Stat label="Gross profit" value={money(m.grossProfit.current, cur)} change={m.grossProfit.changePct} />
        <Stat label="Net profit (after expenses)" value={money(m.netProfit.current, cur)} />
        <Stat label="Orders" value={m.orders.current} change={m.orders.changePct} />
        <Stat label="Avg order value" value={money(m.averageOrderValue, cur)} />
      </div>

      <div className="card">
        <h2>Revenue and gross profit, per {BUCKET_NAME[bucket]}</h2>
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <AreaChart data={m.series} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="bucket" tickFormatter={axis} minTickGap={24} fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => moneyShort(v, cur)} width={64} />
              <Tooltip formatter={(v) => money(v, cur)} labelFormatter={tip} />
              <Legend />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#0f766e" fill="#99f6e4" fillOpacity={0.5} />
              <Area type="monotone" dataKey="grossProfit" name="Gross profit" stroke="#1d4ed8" fill="#bfdbfe" fillOpacity={0.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h2>Stock movement: units sold per {BUCKET_NAME[bucket]}</h2>
        <div className="muted small" style={{ marginTop: -8, marginBottom: 8 }}>Each bar shows how many units left your shelves in that {BUCKET_NAME[bucket]}, split by product.</div>
        {m.stockSeries.products.length === 0 ? <div className="muted">No units sold in this period.</div> : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={m.stockSeries.rows} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="bucket" tickFormatter={axis} minTickGap={24} fontSize={12} />
                <YAxis fontSize={12} allowDecimals={false} width={40} />
                <Tooltip labelFormatter={tip} />
                <Legend />
                {m.stockSeries.products.map((name, i) => <Bar key={name} dataKey={name} stackId="u" fill={PALETTE[i % PALETTE.length]} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Stock levels</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Product</th><th className="num">In stock</th><th className="num">Lasts about</th></tr></thead>
            <tbody>
              {stockProducts.map((p) => {
                const low = p.stock <= p.lowStockThreshold;
                return (
                  <tr key={p.productId}>
                    <td><b>{p.name}</b></td>
                    <td className="num">{low ? <span className="badge warn">{p.stock}</span> : p.stock}</td>
                    <td className="num">{p.daysOfStockLeft === null ? <span className="muted">no recent sales</span> : p.daysOfStockLeft < 1 ? <span className="down">under a day</span> : `${p.daysOfStockLeft} days`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
        <div className="card">
          <h2>Needs attention</h2>
          <div className="stack">
            {lowStock.length === 0 && m.customers.lapsed === 0 && <div className="muted">Nothing urgent. Stock levels look healthy.</div>}
            {lowStock.map((p) => (
              <div key={p.productId} className="row spread"><span><b>{p.name}</b> <span className="badge warn">Low stock</span></span><span className="muted small">{p.stock} left</span></div>
            ))}
            {m.customers.lapsed > 0 && <div className="row spread"><span><b>Lapsed regulars</b> <span className="badge warn">{m.customers.lapsed}</span></span><span className="muted small">repeat buyers not seen in {rangeLabel}</span></div>}
            <div className="row spread"><span>Repeat customers</span><b>{m.customers.repeat} of {m.customers.withOrders}</b></div>
            <div className="row spread"><span>Gross margin</span><b>{m.grossProfit.marginPct}%</b></div>
            <div className="row spread"><span>Expenses recorded in this period</span><b>{money(m.expenses.current, cur)}</b></div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Top products (revenue vs profit)</h2>
        <div style={{ height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={byRevenue} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" fontSize={12} tickFormatter={(v) => moneyShort(v, cur)} />
              <YAxis type="category" dataKey="name" width={140} fontSize={12} />
              <Tooltip formatter={(v) => money(v, cur)} />
              <Legend />
              <Bar dataKey="Revenue" fill="#0f766e" radius={[0, 4, 4, 0]} />
              <Bar dataKey="Profit" fill="#1d4ed8" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h2>Product performance</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Product</th><th className="num">Units</th><th className="num">Units trend</th><th className="num">Revenue</th><th className="num">Margin</th><th className="num">Stock</th></tr></thead>
          <tbody>
            {m.products.filter((p) => p.active).map((p) => (
              <tr key={p.productId}>
                <td><b>{p.name}</b></td>
                <td className="num">{p.unitsCurrent}</td>
                <td className="num">{p.unitsChangePct === null ? '–' : <span className={p.unitsChangePct >= 0 ? 'up' : 'down'}>{pct(p.unitsChangePct)}</span>}</td>
                <td className="num">{money(p.revenueCurrent, cur)}</td>
                <td className="num">{p.marginPct}%</td>
                <td className="num">{p.stock <= p.lowStockThreshold ? <span className="badge warn">{p.stock}</span> : p.stock}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
