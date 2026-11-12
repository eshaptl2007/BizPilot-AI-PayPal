import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { HttpError, asyncHandler } from '../utils/http.js';

export const signToken = (user) =>
  jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: '7d' });

/** Requires a valid Bearer token; loads req.user and the owner's business as req.business. */
export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required');

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  const { rows } = await query(
    `SELECT u.id AS user_id, u.name AS user_name, u.email, u.phone, u.created_at AS user_created_at,
            b.id, b.name, b.slug, b.category, b.currency, b.description, b.onboarded
       FROM users u JOIN businesses b ON b.user_id = u.id
      WHERE u.id = $1 ORDER BY b.id LIMIT 1`,
    [payload.sub],
  );
  if (!rows[0]) throw new HttpError(401, 'Account not found');
  const r = rows[0];
  req.user = { id: r.user_id, name: r.user_name, email: r.email, phone: r.phone, createdAt: r.user_created_at };
  req.business = { id: r.id, name: r.name, slug: r.slug, category: r.category, currency: r.currency, description: r.description, onboarded: r.onboarded };
  next();
});
