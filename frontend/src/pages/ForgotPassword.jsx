import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import AuthShell from '../components/AuthShell.jsx';
import { Field } from '../components/fields.jsx';
import { Alert } from '../components/ui.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { setResult(await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim() } })); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  // In development (no mail server) the API returns the link so the flow can be tested end to end.
  const devPath = result?.devResetLink ? (() => { const u = new URL(result.devResetLink); return `${u.pathname}${u.search}`; })() : null;

  return (
    <AuthShell>
      <div className="card auth-card">
        <h2>Forgot your password?</h2>
        {!result ? (
          <form onSubmit={submit} noValidate>
            <p className="muted small" style={{ marginTop: -6 }}>Enter your account email and we'll send you a link to choose a new password.</p>
            <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required /></Field>
            <Alert kind="error">{error}</Alert>
            <button className="primary full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          </form>
        ) : (
          <div className="stack">
            <Alert kind="ok">{result.message}</Alert>
            {devPath && <Alert kind="warn">Development mode: no email server is configured, so here is your reset link: <Link to={devPath}>Reset my password</Link></Alert>}
          </div>
        )}
        <div className="center-text"><Link to="/login">← Back to sign in</Link></div>
      </div>
    </AuthShell>
  );
}
