import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler, HttpError, parse, slugify } from '../utils/http.js';
import { hashToken, newResetToken, normalizePhone, passwordProblem } from '../utils/validation.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { sendResetEmail } from '../services/mailer.js';

const router = Router();

export const CATEGORIES = ['bakery', 'clothing', 'salon', 'gift_shop', 'cafe', 'grocery', 'electronics', 'other'];

const fieldError = (path, message) => new HttpError(400, 'Validation failed', [{ path, message }]);

// ---------------------------------------------------------------- sign up
const registerSchema = z.object({
  username: z.string().trim().min(2, 'Username must be at least 2 characters').max(50),
  email: z.string().trim().email('Enter a valid email address').max(200),
  phone: z.string().trim().min(1, 'Contact number is required').max(30),
  password: z.string().max(100),
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const b = parse(registerSchema, req.body);
    const phone = normalizePhone(b.phone);
    if (!phone) throw fieldError('phone', 'Enter a valid contact number (7 to 15 digits, e.g. +919876543210)');
    const pwProblem = passwordProblem(b.password);
    if (pwProblem) throw fieldError('password', pwProblem);

    const hash = await bcrypt.hash(b.password, 10);

    const { user, business } = await withTransaction(async (client) => {
      if ((await client.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [b.email])).rowCount)
        throw new HttpError(409, 'An account with this email already exists');
      if ((await client.query('SELECT 1 FROM users WHERE phone = $1', [phone])).rowCount)
        throw new HttpError(409, 'An account with this contact number already exists');

      const u = (await client.query(
        'INSERT INTO users (name, email, password_hash, phone) VALUES ($1,$2,$3,$4) RETURNING id, name, email, phone',
        [b.username, b.email, hash, phone],
      )).rows[0];

      // A starter business is created now; the owner names it (and picks the type) on the next screen.
      const base = slugify(`${b.username} shop`);
      let slug = base;
      for (let n = 2; (await client.query('SELECT 1 FROM businesses WHERE slug = $1', [slug])).rowCount; n++) slug = `${base}-${n}`;
      const biz = (await client.query(
        `INSERT INTO businesses (user_id, name, slug, category, onboarded) VALUES ($1,$2,$3,'other',FALSE)
         RETURNING id, name, slug, category, currency, onboarded`,
        [u.id, `${b.username}'s Business`, slug],
      )).rows[0];
      return { user: u, business: biz };
    });
    res.status(201).json({ token: signToken(user), user, business });
  }),
);

// ---------------------------------------------------------------- sign in
const loginSchema = z.object({ email: z.string().trim().email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') });

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const b = parse(loginSchema, req.body);
    const { rows } = await query('SELECT id, name, email, phone, password_hash FROM users WHERE lower(email) = lower($1)', [b.email]);
    const u = rows[0];
    // same error for unknown email and wrong password (no account enumeration)
    if (!u || !(await bcrypt.compare(b.password, u.password_hash))) throw new HttpError(401, 'Invalid email or password');
    res.json({ token: signToken(u), user: { id: u.id, name: u.name, email: u.email, phone: u.phone } });
  }),
);

// ---------------------------------------------------------------- forgot / reset password
const FORGOT_MESSAGE = 'If an account exists for that email, a password reset link has been sent.';

router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = parse(z.object({ email: z.string().trim().email('Enter a valid email address') }), req.body);
    const out = { message: FORGOT_MESSAGE }; // identical answer whether or not the account exists

    const { rows } = await query('SELECT id, name, email FROM users WHERE lower(email) = lower($1)', [email]);
    const user = rows[0];
    if (user) {
      const token = newResetToken();
      await withTransaction(async (client) => {
        await client.query("DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day'");
        await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [user.id]); // older links stop working
        await client.query(
          'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + make_interval(mins => $3))',
          [user.id, hashToken(token), config.resetTokenMinutes],
        );
      });

      const link = `${config.publicClientUrl}/reset-password?token=${token}`;
      let sent = false;
      try {
        sent = await sendResetEmail(user, link, config.resetTokenMinutes);
      } catch (e) {
        console.error('[auth] could not send reset email:', e.message);
      }
      if (!sent) {
        if (config.nodeEnv === 'production') console.warn('[auth] SMTP is not configured; reset email was NOT sent');
        else {
          // Development convenience: no mail server needed. Never exposed in production.
          console.log(`[auth] password reset link for ${user.email}: ${link}`);
          out.devResetLink = link;
        }
      }
    }
    res.json(out);
  }),
);

const resetSchema = z.object({ token: z.string().min(20).max(200), password: z.string().max(100) });

router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const b = parse(resetSchema, req.body);
    const pwProblem = passwordProblem(b.password);
    if (pwProblem) throw fieldError('password', pwProblem);
    const newHash = await bcrypt.hash(b.password, 10);

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, user_id FROM password_reset_tokens
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [hashToken(b.token)],
      );
      if (!rows[0]) throw new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.');
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [rows[0].user_id, newHash]);
      await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [rows[0].user_id]);
    });
    res.json({ message: 'Password updated. You can sign in now.' });
  }),
);

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user, business: req.business }));

export default router;
