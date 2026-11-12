// Public customer-facing shop. Real PayPal Checkout (Orders v2): the browser only ever sends
// product ids + quantities. Prices, discounts and totals are decided by the server.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import { money } from '../format.js';
import { Alert } from '../components/ui.jsx';

function loadPayPalSdk(clientId, currency) {
  if (window.paypal) return Promise.resolve(window.paypal);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&intent=capture&components=buttons`;
    s.onload = () => resolve(window.paypal);
    s.onerror = () => reject(new Error('Could not load the PayPal SDK'));
    document.head.appendChild(s);
  });
}

export default function Storefront() {
  const { slug } = useParams();
  const [shop, setShop] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [cart, setCart] = useState({});
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const buttonsRef = useRef(null);
  const rendered = useRef(false);
  const latest = useRef({});
  const lastOrder = useRef(null);

  const loadShop = useCallback(() => api(`/public/shop/${slug}`).then(setShop).catch((e) => setError(e.message)), [slug]);
  useEffect(() => { loadShop(); api('/public/config').then(setCfg).catch((e) => setError(e.message)); }, [loadShop]);

  const items = shop ? shop.products.filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id] })) : [];
  const total = items.reduce((s, i) => s + i.salePrice * i.qty, 0);
  const setQty = (p, q) => setCart((c) => { const n = { ...c }; const v = Math.max(0, Math.min(q, p.stock)); if (v) n[p.id] = v; else delete n[p.id]; return n; });

  // always-fresh values for PayPal callbacks
  latest.current = { items, email, name };

  const createOrder = async () => {
    const { items, email, name } = latest.current;
    const res = await api(`/public/shop/${slug}/orders`, { method: 'POST', body: { items: items.map((i) => ({ productId: i.id, quantity: i.qty })), customerEmail: email || undefined, customerName: name || undefined } });
    lastOrder.current = res;
    return res.orderId;
  };
  const capture = async (orderId) => {
    const r = await api(`/public/orders/${orderId}/capture`, { method: 'POST' });
    if (r.status === 'paid') { setDone({ orderId, total: lastOrder.current?.total ?? 0, chargeAmount: lastOrder.current?.chargeAmount, chargeCurrency: lastOrder.current?.chargeCurrency }); setCart({}); loadShop(); }
    else setError('Payment is still pending. You have not been charged yet.');
  };

  // Mount the PayPal buttons once the SDK and shop are ready
  useEffect(() => {
    if (!cfg || !shop || cfg.mock || !cfg.paypalClientId || rendered.current || !buttonsRef.current) return;
    let cancelled = false;
    loadPayPalSdk(cfg.paypalClientId, cfg.checkoutCurrency).then((paypal) => {
      if (cancelled || rendered.current || !buttonsRef.current) return;
      rendered.current = true;
      paypal.Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'pay' },
        onClick: (_d, actions) => (latest.current.items.length ? actions.resolve() : actions.reject()),
        createOrder: () => createOrder().catch((e) => { setError(e.message); throw e; }),
        onApprove: (data) => capture(data.orderID).catch((e) => setError(e.message)),
        onError: (e) => setError(`PayPal error: ${e?.message || e}`),
      }).render(buttonsRef.current);
    }).catch((e) => setError(e.message));
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, shop]);

  const simulatePay = async () => {
    setBusy(true); setError('');
    try { await capture(await createOrder()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (!shop) return <div className="shop">{error ? <Alert kind="error">{error}</Alert> : <div className="muted">Loading shop…</div>}</div>;
  const cur = shop.business.currency;

  return (
    <div className="shop">
      <div className="page-head"><div><h1>{shop.business.name}</h1><div className="muted">{shop.business.description || 'Order online and pay securely with PayPal.'}</div></div><span className="badge brand">Secure checkout by PayPal</span></div>
      {done && <Alert kind="ok">Thank you! Your order of {money(done.total, cur)} is paid{done.chargeAmount && done.chargeCurrency !== cur ? ` (PayPal charged ${money(done.chargeAmount, done.chargeCurrency)})` : ''}. PayPal order <b>{done.orderId}</b>.</Alert>}
      <Alert kind="error">{error}</Alert>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', marginTop: 16 }}>
        <div className="grid g2" style={{ alignContent: 'start' }}>
          {shop.products.map((p) => (
            <div key={p.id} className="card product">
              <div className="row spread"><b>{p.name}</b>{p.discountPct && <span className="badge warn">{p.discountPct}% OFF</span>}</div>
              <div className="price">{p.discountPct ? <s>{money(p.price, cur)}</s> : null}<b>{money(p.salePrice, cur)}</b></div>
              {p.stock <= 5 && <div className="small" style={{ color: 'var(--warn)' }}>Only {p.stock} left</div>}
              <div className="qty">
                <button className="sm" onClick={() => setQty(p, (cart[p.id] || 0) - 1)} disabled={!cart[p.id]}>−</button>
                <b>{cart[p.id] || 0}</b>
                <button className="sm" onClick={() => setQty(p, (cart[p.id] || 0) + 1)} disabled={(cart[p.id] || 0) >= p.stock}>+</button>
              </div>
            </div>
          ))}
          {shop.products.length === 0 && <div className="muted">Nothing available right now.</div>}
        </div>

        <div className="card cart">
          <h2>Your order</h2>
          {items.length === 0 ? <div className="muted">Add something from the menu.</div> : (<>
            {items.map((i) => <div key={i.id} className="row spread small" style={{ padding: '4px 0' }}><span>{i.qty}× {i.name}</span><b>{money(i.salePrice * i.qty, cur)}</b></div>)}
            <div className="row spread" style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 8 }}><b>Total</b><b>{money(total, cur)}</b></div>
            {cfg && cfg.checkoutCurrency !== cur && (
              <div className="muted small" style={{ marginTop: 6 }}>PayPal does not accept {cur}, so it will charge about <b>{money(total / cfg.fxRate, cfg.checkoutCurrency)}</b> ({money(cfg.fxRate, cur)} = {money(1, cfg.checkoutCurrency)}).</div>
            )}
          </>)}
          <div className="field" style={{ marginTop: 12 }}><label>Name (optional)</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label>Email for receipt (optional)</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          {cfg?.mock ? (<>
            <Alert kind="warn">Sandbox simulation mode: no PayPal credentials are configured on the server, so this button fakes the payment. Add PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET for real PayPal Sandbox checkout.</Alert>
            <button className="primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} disabled={!items.length || busy} onClick={simulatePay}>{busy ? 'Processing…' : 'Simulate PayPal payment'}</button>
          </>) : (
            <div ref={buttonsRef} style={{ marginTop: 8, opacity: items.length ? 1 : 0.5 }} />
          )}
        </div>
      </div>
    </div>
  );
}
