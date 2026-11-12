import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, pct, shortDate } from '../format.js';
import { Alert } from '../components/ui.jsx';

const STATUS = { draft: ['Draft', ''], active: ['Live', 'good'], ended: ['Ended', ''], cancelled: ['Cancelled', 'bad'] };

function Performance({ id }) {
  const [p, setP] = useState(null);
  useEffect(() => { api(`/campaigns/${id}/performance`).then(setP).catch(() => setP({ note: 'Could not load results.' })); }, [id]);
  if (!p) return <div className="muted small">Measuring…</div>;
  if (!p.before) return <div className="muted small">{p.note}</div>;
  return (
    <div className="stack">
      <div className="kv">
        <span>Units sold: before → during</span><span>{p.before.units} → {p.during.units} ({pct(p.unitsLiftPct)})</span>
        <span>Revenue: before → during</span><span>{money(p.before.revenue)} → {money(p.during.revenue)} ({pct(p.revenueLiftPct)})</span>
        <span>Gross profit: before → during</span><span>{money(p.before.grossProfit)} → {money(p.during.grossProfit)} ({pct(p.grossProfitLiftPct)})</span>
        <span>Orders using this offer</span><span>{p.campaignOrders} ({money(p.campaignRevenue)})</span>
      </div>
      <div className="muted small">{p.note}</div>
    </div>
  );
}

function CampaignCard({ c, reload, onError }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ caption: c.caption || '', emailSubject: c.emailSubject || '', emailBody: c.emailBody || '' });
  const [days, setDays] = useState(7);
  const [showPerf, setShowPerf] = useState(c.status !== 'draft');
  const act = (fn) => async () => { try { await fn(); reload(); } catch (e) { onError(e.message); } };
  const shareUrl = `${window.location.origin}/shop/${c.shareUrl.split('/shop/')[1]}`;

  return (
    <div className="card">
      <div className="row spread wrap"><div className="row"><span className={`badge ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span>{c.generatedByAi && <span className="badge brand">AI-written copy</span>}{c.discountPct > 0 && <span className="badge warn">{c.discountPct}% off{c.productName ? ` ${c.productName}` : ''}</span>}</div>
        {c.startsAt && <span className="muted small">{shortDate(c.startsAt)} – {c.endsAt ? shortDate(c.endsAt) : 'open'}</span>}</div>
      <h2 style={{ marginTop: 8 }}>{c.title}</h2>

      {!edit ? (
        <div className="stack">
          <div><div className="muted small">Social post</div><div className="pre">{c.caption}</div><div className="hashtags small">{c.hashtags.map((h) => <span key={h}>{h}</span>)}</div></div>
          <div><div className="muted small">Email — {c.emailSubject}</div><div className="pre">{c.emailBody}</div></div>
        </div>
      ) : (
        <div>
          <div className="field"><label>Social post</label><textarea value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} /></div>
          <div className="field"><label>Email subject</label><input value={f.emailSubject} onChange={(e) => setF({ ...f, emailSubject: e.target.value })} /></div>
          <div className="field"><label>Email body</label><textarea value={f.emailBody} onChange={(e) => setF({ ...f, emailBody: e.target.value })} /></div>
          <button className="primary sm" onClick={act(async () => { await api(`/campaigns/${c.id}`, { method: 'PATCH', body: f }); setEdit(false); })}>Save changes</button>
        </div>
      )}

      <div className="row wrap" style={{ marginTop: 14 }}>
        {c.status === 'draft' && <>
          <button onClick={() => setEdit(!edit)}>{edit ? 'Cancel' : 'Edit copy'}</button>
          <select style={{ width: 120 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}</select>
          <button className="primary" onClick={act(() => api(`/campaigns/${c.id}/launch`, { method: 'POST', body: { durationDays: days } }))}>Approve & launch</button></>}
        {c.status === 'active' && <button onClick={act(() => api(`/campaigns/${c.id}/end`, { method: 'POST' }))}>End campaign</button>}
        {c.status !== 'draft' && <button onClick={() => setShowPerf(!showPerf)}>{showPerf ? 'Hide results' : 'Show results'}</button>}
        <button onClick={() => { navigator.clipboard?.writeText(shareUrl); }}>Copy shop link</button>
        <a className="btn" href={shareUrl} target="_blank" rel="noreferrer">Open storefront ↗</a>
      </div>
      {c.status === 'draft' && <div className="muted small" style={{ marginTop: 6 }}>Nothing is discounted in your shop until you launch.</div>}
      {showPerf && c.status !== 'draft' && <div style={{ marginTop: 14 }}><h3>Results</h3><Performance id={c.id} /></div>}
    </div>
  );
}

export default function Campaigns() {
  const [list, setList] = useState([]);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ productId: '', discountPct: 10 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => api('/campaigns').then(setList).catch((e) => setError(e.message));
  useEffect(() => { load(); api('/products').then((p) => setProducts(p.filter((x) => x.active))).catch(() => {}); }, []);

  const create = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/campaigns', { method: 'POST', body: { productId: form.productId ? Number(form.productId) : null, discountPct: Number(form.discountPct), generateCopy: true } }); await load(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="page-head"><div><h1>Marketing Studio</h1><div className="muted">AI drafts the campaign. You edit, approve and launch. Results are measured against real sales.</div></div></div>
      <Alert kind="error">{error}</Alert>
      <form className="card" onSubmit={create}>
        <h2>New AI-assisted campaign</h2>
        <div className="form-grid">
          <div><label>Product</label><select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })}><option value="">Whole shop (no discount)</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label>Discount: {form.discountPct}%</label><input type="range" min="0" max="40" step="5" value={form.discountPct} onChange={(e) => setForm({ ...form, discountPct: e.target.value })} /></div>
          <button className="primary" disabled={busy}>{busy ? 'Writing…' : '✨ Generate campaign'}</button>
        </div>
      </form>
      {list.length === 0 && <div className="card muted">No campaigns yet. Approve a recommendation in the AI Advisor, or generate one above.</div>}
      {list.map((c) => <CampaignCard key={c.id} c={c} reload={load} onError={setError} />)}
    </div>
  );
}
