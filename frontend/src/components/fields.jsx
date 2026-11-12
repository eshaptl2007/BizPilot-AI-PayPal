import { useState } from 'react';

export function Field({ label, error, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

export function PasswordInput({ value, onChange, autoComplete, placeholder, id }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={id} type={show ? 'text' : 'password'} value={value} onChange={onChange} autoComplete={autoComplete} placeholder={placeholder} required />
      <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? 'Hide' : 'Show'}</button>
    </div>
  );
}

export const PHONE_RE = /^\+?[0-9]{7,15}$/;
export const cleanPhone = (v) => { let s = v.trim().replace(/[\s\-().]/g, ''); if (s.startsWith('00')) s = `+${s.slice(2)}`; return s; };
export const passwordProblem = (pw) =>
  pw.length < 8 ? 'Use at least 8 characters' : !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw) ? 'Include at least one letter and one number' : null;
