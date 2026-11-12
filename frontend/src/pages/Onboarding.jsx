import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Logo from '../components/Logo.jsx';
import { Field } from '../components/fields.jsx';
import { Alert } from '../components/ui.jsx';

const CATEGORIES = [['bakery', 'Bakery'], ['clothing', 'Clothing store'], ['salon', 'Salon'], ['gift_shop', 'Gift shop'], ['cafe', 'Café'], ['grocery', 'Grocery'], ['electronics', 'Electronics'], ['other', 'Other']];

// Shown once, right after sign-up: the owner names the business and picks its type.
export default function Onboarding() {
  const { user, business, refresh, logout } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('bakery');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (business.onboarded) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/business', { method: 'PATCH', body: { name: name.trim(), category, onboarded: true } });
      await refresh();
      nav('/', { replace: true });
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="center" style={{ padding: 16 }}>
      <form className="card auth-card" style={{ width: '100%', maxWidth: 440 }} onSubmit={submit}>
        <div className="row" style={{ marginBottom: 12 }}><Logo size={40} /><b style={{ fontSize: 18 }}>BizPilot AI</b></div>
        <h2>Welcome, {user.name}! Tell us about your business</h2>
        <p className="muted small" style={{ marginTop: -6 }}>This helps BizPilot tailor recommendations. You can change it later.</p>
        <Field label="Business name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sweet Crumbs Bakery" required maxLength={100} /></Field>
        <Field label="Business type"><select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Alert kind="error">{error}</Alert>
        <button className="primary full" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Continue to dashboard'}</button>
        <div className="center-text"><button type="button" className="ghost sm" onClick={logout}>Sign out</button></div>
      </form>
    </div>
  );
}
