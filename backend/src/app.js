import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import salesRoutes from './routes/sales.js';
import insightsRoutes from './routes/insights.js';
import campaignRoutes from './routes/campaigns.js';
import publicRoutes from './routes/public.js';
import webhookRoutes from './routes/webhooks.js';
import { query } from './db/pool.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.clientOrigin.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '3mb' }));

  app.get('/api/health', async (_req, res) => {
    try {
      await query('SELECT 1');
      res.json({ ok: true, paypal: config.paypal.mode, ai: config.ai.provider });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false });
  const publicLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });

  const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false });
  app.use('/api/auth/forgot-password', forgotLimiter);
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/public', publicLimiter, publicRoutes);
  app.use('/api/webhooks', webhookRoutes);

  // Everything below needs a signed-in business owner.
  app.use('/api', requireAuth);
  app.use('/api/ai', aiLimiter);
  app.use('/api/simulator', aiLimiter);
  app.use('/api', catalogRoutes);
  app.use('/api', salesRoutes);
  app.use('/api', insightsRoutes);
  app.use('/api', campaignRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
