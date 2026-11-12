import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import AuthShell from '../components/AuthShell.jsx';
import { Field, PasswordInput } from '../components/fields.jsx';
import { Alert } from '../components/ui.jsx';

export function AuthTabs({ active }) {
  return (
    <div className="tabs">
      <Link to="/login" className={active === 'login' ? 'on' : ''}>Sign in</Link>
      <Link to="/register" className={active === 'register' ? 'on' : ''}>Create account</Link>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { await login(email.trim(), password); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <form className="card auth-card" onSubmit={submit} noValidate>
        <AuthTabs active="login" />
        <h2>Welcome back</h2>
        <p className="muted small" style={{ marginTop: -6 }}>Sign in to your BizPilot AI account.</p>
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required /></Field>
        <Field label="Password"><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Your password" /></Field>
        <Alert kind="error">{error}</Alert>
        <button className="primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <div className="center-text"><Link to="/forgot-password">Forgot password?</Link></div>
      </form>
    </AuthShell>
  );
}
