// Dependency-free input helpers for the auth flow (unit-tested in test/auth.test.js).
import crypto from 'node:crypto';

/** "+91 98765-43210" -> "+919876543210". Returns null when it is not a plausible phone number. */
export function normalizePhone(raw) {
  let s = String(raw ?? '').trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return /^\+?[0-9]{7,15}$/.test(s) ? s : null;
}

/** Returns a human-readable problem, or null when the password is acceptable. */
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 100) return 'Password is too long (max 100 characters)';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain at least one letter and one number';
  return null;
}

export const newResetToken = () => crypto.randomBytes(32).toString('hex');
/** Only this hash is stored in the database; the raw token exists only in the emailed link. */
export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
