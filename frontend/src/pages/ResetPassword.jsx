import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import AuthShell from '../components/AuthShell.jsx';
import { Field, PasswordInput, passwordProblem } from '../components/fields.jsx';
import { Alert } from '../components/ui.jsx';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setError('');
    const v = {};
    const p = passwordProblem(pw); if (p) v.password = p;
    if (pw !== pw2) v.confirm = 'Passwords do not match';
    setErrors(v); if (Object.keys(v).length) return;
    setBusy(true);
    try { await api('/auth/reset-password', { method: 'POST', body: { token, password: pw } }); setDone(true); }
    catch (err) { if (err.fields?.password) setErrors({ password: err.fields.password }); else setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <div className="card auth-card">
        <h2>Choose a new password</h2>
        {!token ? (
          <div className="stack"><Alert kind="error">This reset link is incomplete. Please request a new one.</Alert><Link className="btn primary full" to="/forgot-password">Request a new link</Link></div>
        ) : done ? (
          <div className="stack"><Alert kind="ok">Your password was updated. You can sign in now.</Alert><Link className="btn primary full" to="/login">Go to sign in</Link></div>
        ) : (
          <form onSubmit={submit} noValidate>
            <Field label="New password" error={errors.password}><PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" placeholder="Min 8 characters" /></Field>
            <Field label="Confirm new password" error={errors.confirm}><PasswordInput value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" placeholder="Repeat the password" /></Field>
            <Alert kind="error">{error}</Alert>
            {error.includes('expired') && <div className="center-text"><Link to="/forgot-password">Request a new link</Link></div>}
            <button className="primary full" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
