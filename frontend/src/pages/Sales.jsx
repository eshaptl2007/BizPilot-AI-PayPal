import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { currencySymbol, dateTime, money } from '../format.js';
import { Alert } from '../components/ui.jsx';

const TEMPLATE = 'date,product,quantity,unit_price,order_id\n2026-10-01,Croissant,2,140,A100\n2026-10-01,Sourdough Loaf,1,250,A100\n2026-10-02,Baguette,3,,A101\n';

export default function Sales() {
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [sale, setSale] = useState({ productId: '', quantity: 1 });
  const [exp, setExp] = useState({ category: 'rent', description: '', amount: '' });
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef();

  const load = async () => {
    try {
      const [p, s, e] = await Promise.all([api('/products'), api('/sales?limit=25'), api('/expenses')]);
      setProducts(p.filter((x) => x.active)); setSales(s); setExpenses(e.slice(0, 12));
    } catch (err) { setError(err.message); }
  };
  useEffect(() => { load(); }, []);

  const flash = (msg) => { setNote(msg); setError(''); };

  const addSale = async (e) => {
    e.preventDefault();
    try { await api('/sales', { method: 'POST', body: { items: [{ productId: Number(sale.productId), quantity: Number(sale.quantity) }] } }); flash('Sale recorded.'); setSale({ productId: '', quantity: 1 }); load(); }
    catch (err) { setError(err.message); }
  };
  const addExpense = async (e) => {
    e.preventDefault();
    try { await api('/expenses', { method: 'POST', body: { category: exp.category, description: exp.description || undefined, amount: Number(exp.amount) } }); flash('Expense added.'); setExp({ category: 'rent', description: '', amount: '' }); load(); }
    catch (err) { setError(err.message); }
  };
  const delExpense = async (id) => { try { await api(`/expenses/${id}`, { method: 'DELETE' }); load(); } catch (err) { setError(err.message); } };

  const onFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const csv = await file.text();
      const r = await api('/import/csv', { method: 'POST', body: { csv } });
      setImportResult(r); flash(`Imported ${r.imported} sales.`); load();
    } catch (err) { setError(err.message); }
    if (fileRef.current) fileRef.current.value = '';
  };
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'bizpilot-sales-template.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="stack">
      <div className="page-head"><div><h1>Sales & data</h1><div className="muted">Bring your numbers in: type them, or upload a CSV.</div></div></div>
      <Alert kind="error">{error}</Alert><Alert kind="ok">{note}</Alert>

      <div className="grid g2">
        <form className="card" onSubmit={addSale}>
          <h2>Record a sale</h2>
          <div className="form-grid">
            <div><label>Product</label><select value={sale.productId} onChange={(e) => setSale({ ...sale, productId: e.target.value })} required><option value="">Choose…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} ({money(p.price)})</option>)}</select></div>
            <div><label>Quantity</label><input type="number" min="1" value={sale.quantity} onChange={(e) => setSale({ ...sale, quantity: e.target.value })} /></div>
            <button className="primary">Add sale</button>
          </div>
        </form>
        <div className="card">
          <h2>Import sales from CSV</h2>
          <p className="muted small">Columns: <code>date, product, quantity, unit_price (optional), order_id (optional)</code>. Product names must match your Products list.</p>
          <div className="row wrap"><input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} /><button className="sm" onClick={downloadTemplate}>Download template</button></div>
          {importResult?.skipped?.length > 0 && (
            <div className="alert warn" style={{ marginTop: 10 }}>{importResult.skipped.length} rows skipped:
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{importResult.skipped.slice(0, 5).map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}</ul></div>
          )}
        </div>
      </div>

      <div className="grid g2">
        <div className="card">
          <h2>Recent sales</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Items</th><th className="num">Total</th><th /></tr></thead>
            <tbody>{sales.map((s) => (
              <tr key={s.id}><td className="small">{dateTime(s.soldAt)}</td>
                <td className="small">{(s.items || []).map((i) => `${i.quantity}× ${i.name}`).join(', ')}</td>
                <td className="num">{money(s.total)}</td>
                <td>{s.source === 'paypal' ? <span className="badge brand">PayPal</span> : <span className="badge">{s.source}</span>} {s.status !== 'paid' && <span className="badge warn">{s.status}</span>}</td></tr>))}
            </tbody></table></div>
        </div>
        <div className="card">
          <h2>Expenses</h2>
          <form className="form-grid" onSubmit={addExpense} style={{ marginBottom: 12 }}>
            <div><label>Category</label><select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })}>{['rent', 'wages', 'utilities', 'marketing', 'equipment', 'supplies', 'other'].map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>Note</label><input value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} /></div>
            <div><label>Amount ({currencySymbol()})</label><input type="number" step="0.01" min="0.01" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} required /></div>
            <button className="primary">Add</button>
          </form>
          <table><tbody>{expenses.map((x) => (
            <tr key={x.id}><td className="small">{x.incurredOn}</td><td>{x.category}<div className="muted small">{x.description}</div></td><td className="num">{money(x.amount)}</td><td><button className="sm ghost danger" onClick={() => delExpense(x.id)}>✕</button></td></tr>))}
          </tbody></table>
        </div>
      </div>
    </div>
  );
}
