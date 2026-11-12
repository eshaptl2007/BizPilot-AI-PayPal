import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import AuthShell from '../components/AuthShell.jsx';
import { Field, PasswordInput, PHONE_RE, cleanPhone, passwordProblem } from '../components/fields.jsx';
import { Alert } from '../components/ui.jsx';
import { AuthTabs } from './Login.jsx';

export default function Register() {
  const { register } = useAuth();
  const [f, setF] = useState({ username: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const validate = () => {
    const e = {};
    if (f.username.trim().length < 2) e.username = 'Enter your username (at least 2 characters)';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = 'Enter a valid email address';
    if (!PHONE_RE.test(cleanPhone(f.phone))) e.phone = 'Enter a valid contact number, e.g. +919876543210';
    const pw = passwordProblem(f.password);
    if (pw) e.password = pw;
    return e;
  };

  const submit = async (ev) => {
    ev.preventDefault(); setError('');
    const e = validate(); setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await register({ username: f.username.trim(), email: f.email.trim(), phone: f.phone.trim(), password: f.password });
    } catch (err) {
      if (err.fields) setErrors(err.fields); else setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <form className="card auth-card" onSubmit={submit} noValidate>
        <AuthTabs active="register" />
        <h2>Create your account</h2>
        <Field label="Username" error={errors.username}><input value={f.username} onChange={set('username')} autoComplete="username" placeholder="e.g. Tulsi Patel" /></Field>
        <Field label="Email" error={errors.email}><input type="email" value={f.email} onChange={set('email')} autoComplete="email" placeholder="you@example.com" /></Field>
        <Field label="Contact number" error={errors.phone}><input type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" placeholder="+91 98765 43210" /></Field>
        <Field label="Password" error={errors.password}><PasswordInput value={f.password} onChange={set('password')} autoComplete="new-password" placeholder="Min 8 characters" /></Field>
        <Alert kind="error">{error}</Alert>
        <button className="primary full" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthShell>
  );
}
