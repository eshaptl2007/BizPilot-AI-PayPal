import { HttpError } from '../utils/http.js';

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // Postgres constraint violations -> client-friendly errors
  if (err && err.code === '23505') return res.status(409).json({ error: 'Already exists', details: err.detail });
  if (err && (err.code === '23514' || err.code === '23503' || err.code === '23502')) {
    return res.status(400).json({ error: 'Invalid data', details: err.detail || err.message });
  }
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
