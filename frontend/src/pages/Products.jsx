import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { money, currencySymbol } from '../format.js';
import { Alert } from '../components/ui.jsx';

const blank = { name: '', sku: '', price: '', cost: '', stock: '', lowStockThreshold: 10, active: true };

export default function Products() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = () => api('/products').then(setItems).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const startEdit = (p) => { setEditing(p.id); setForm({ ...p, sku: p.sku || '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const reset = () => { setEditing(null); setForm(blank); };

  const save = async (e) => {
    e.preventDefault(); setError(''); setNote('');
    const body = { name: form.name, sku: form.sku || null, price: Number(form.price), cost: Number(form.cost || 0), stock: Number(form.stock || 0), lowStockThreshold: Number(form.lowStockThreshold || 0), active: form.active };
    try {
      await api(editing ? `/products/${editing}` : '/products', { method: editing ? 'PUT' : 'POST', body });
      setNote(editing ? 'Product updated.' : 'Product added.'); reset(); load();
    } catch (err) { setError(err.message); }
  };
  const remove = async (p) => {
    if (!confirm(`Remove "${p.name}"? Products with sales history are archived instead of deleted.`)) return;
    try { const r = await api(`/products/${p.id}`, { method: 'DELETE' }); setNote(r.archived ? `${p.name} has sales history, so it was archived.` : 'Deleted.'); load(); } catch (err) { setError(err.message); }
  };

  return (
    <div className="stack">
      <div className="page-head"><div><h1>Products</h1><div className="muted">Price and cost drive every profit figure, so keep cost accurate.</div></div></div>
      <Alert kind="error">{error}</Alert><Alert kind="ok">{note}</Alert>
      <form className="card" onSubmit={save}>
        <h2>{editing ? 'Edit product' : 'Add a product'}</h2>
        <div className="form-grid">
          <div><label>Name</label><input value={form.name} onChange={set('name')} required /></div>
          <div><label>SKU (optional)</label><input value={form.sku} onChange={set('sku')} /></div>
          <div><label>Price ({currencySymbol()})</label><input type="number" step="0.01" min="0" value={form.price} onChange={set('price')} required /></div>
          <div><label>Cost per unit ({currencySymbol()})</label><input type="number" step="0.01" min="0" value={form.cost} onChange={set('cost')} required /></div>
          <div><label>Stock</label><input type="number" min="0" value={form.stock} onChange={set('stock')} required /></div>
          <div><label>Low-stock alert at</label><input type="number" min="0" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} /></div>
          <div><label><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={form.active} onChange={set('active')} />Active (shown in shop)</label></div>
          <div className="row"><button className="primary">{editing ? 'Save' : 'Add product'}</button>{editing && <button type="button" onClick={reset}>Cancel</button>}</div>
        </div>
      </form>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Product</th><th className="num">Price</th><th className="num">Cost</th><th className="num">Margin</th><th className="num">Stock</th><th /></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} style={{ opacity: p.active ? 1 : 0.55 }}>
                <td><b>{p.name}</b> {!p.active && <span className="badge">archived</span>}<div className="muted small">{p.sku}</div></td>
                <td className="num">{money(p.price)}</td><td className="num">{money(p.cost)}</td>
                <td className="num">{p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0}%</td>
                <td className="num">{p.stock <= p.lowStockThreshold ? <span className="badge warn">{p.stock}</span> : p.stock}</td>
                <td className="num"><button className="sm" onClick={() => startEdit(p)}>Edit</button> <button className="sm danger" onClick={() => remove(p)}>Remove</button></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan="6" className="muted">No products yet. Add your first one above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
