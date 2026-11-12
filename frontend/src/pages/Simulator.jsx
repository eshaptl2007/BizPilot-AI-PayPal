import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { money, moneyShort } from '../format.js';
import { Alert } from '../components/ui.jsx';

const VERDICT = { 'low-risk': 'good', moderate: 'warn', risky: 'bad', avoid: 'bad', unknown: '' };

export default function Simulator() {
  const nav = useNavigate();
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [discount, setDiscount] = useState(10);
  const [windowDays, setWindowDays] = useState(30);
  const [r, setR] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api('/products').then((p) => { const a = p.filter((x) => x.active); setProducts(a); if (a[0]) setProductId(String(a[0].id)); }).catch((e) => setError(e.message)); }, []);

  const run = async (e) => {
    e?.preventDefault(); if (!productId) return;
    setBusy(true); setError('');
    try { setR(await api('/simulator', { method: 'POST', body: { productId: Number(productId), discountPct: Number(discount), windowDays: Number(windowDays), narrate: true } })); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const createCampaign = async () => {
    try { await api('/campaigns', { method: 'POST', body: { productId: Number(productId), discountPct: Number(discount), generateCopy: true } }); nav('/campaigns'); }
    catch (err) { setError(err.message); }
  };

  return (
    <div className="stack">
      <div className="page-head"><div><h1>Growth Simulator</h1><div className="muted">“What if I offer X% off?” See break-even and profit scenarios before you commit.</div></div></div>
      <Alert kind="error">{error}</Alert>
      <form className="card" onSubmit={run}>
        <div className="form-grid">
          <div><label>Product</label><select value={productId} onChange={(e) => setProductId(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label>Discount: {discount}%</label><input type="range" min="0" max="50" step="5" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          <div><label>Baseline window</label><select value={windowDays} onChange={(e) => setWindowDays(e.target.value)}>{[14, 30, 60, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}</select></div>
          <button className="primary" disabled={busy}>{busy ? 'Simulating…' : 'Run simulation'}</button>
        </div>
      </form>

      {r && (<>
        <div className="grid g3">
          <div className="card"><div className="muted small">Price</div><div className="row"><b style={{ fontSize: 22 }}>{money(r.discountedPrice)}</b><s className="muted">{money(r.listPrice)}</s></div><div className="muted small">Margin {r.marginPctNow}% → {r.marginPctDiscounted}%</div></div>
          <div className="card"><div className="muted small">Baseline (last {r.windowDays} days)</div><b style={{ fontSize: 22 }}>{r.baselineUnits} units</b><div className="muted small">{money(r.baselineProfit)} gross profit</div></div>
          <div className="card"><div className="muted small">Break-even</div><b style={{ fontSize: 22 }}>{r.breakEvenUnits === null ? 'Never' : `${r.breakEvenUnits} units`}</b><div className="muted small">{r.requiredUpliftPct === null ? 'no baseline / below cost' : `${r.requiredUpliftPct}% more than today`}</div></div>
        </div>
        <div className={`alert ${VERDICT[r.verdict.level] === 'good' ? 'ok' : VERDICT[r.verdict.level] === 'warn' ? 'warn' : VERDICT[r.verdict.level] === 'bad' ? 'error' : 'info'}`}><b>{r.verdict.level.replace('-', ' ')}:</b> {r.verdict.text}</div>

        <div className="card">
          <h2>Profit change vs today, by hypothetical demand</h2>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={r.scenarios.map((s) => ({ name: s.label, delta: s.profitDelta }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" fontSize={12} /><YAxis fontSize={12} tickFormatter={moneyShort} width={64} />
                <Tooltip formatter={(v) => money(v)} /><ReferenceLine y={0} stroke="#64748b" />
                <Bar dataKey="delta" name="Profit change">{r.scenarios.map((s, i) => <Cell key={i} fill={s.profitDelta >= 0 ? '#15803d' : '#b91c1c'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th>Scenario</th><th className="num">Units</th><th className="num">Revenue</th><th className="num">Gross profit</th><th className="num">vs today</th></tr></thead>
            <tbody>{r.scenarios.map((s) => <tr key={s.label}><td>{s.label}</td><td className="num">{s.units}</td><td className="num">{money(s.revenue)}</td><td className="num">{money(s.profit)}</td><td className={`num ${s.profitDelta >= 0 ? 'up' : 'down'}`}>{money(s.profitDelta)}</td></tr>)}</tbody>
          </table></div>
        </div>

        {r.narrative && <div className="card"><h3>In plain words</h3><p style={{ margin: 0 }}>{r.narrative}</p></div>}
        <div className="row wrap"><button className="primary" onClick={createCampaign} disabled={r.verdict.level === 'avoid'}>Create a campaign with this discount</button><span className="muted small">{r.disclaimer}</span></div>
      </>)}
    </div>
  );
}
