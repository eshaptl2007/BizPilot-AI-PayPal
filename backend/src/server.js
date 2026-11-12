import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`BizPilot API on :${config.port}  |  PayPal: ${config.paypal.mode}  |  AI: ${config.ai.provider}`);
  if (config.paypal.mode === 'mock') console.warn('PayPal is in MOCK mode (no credentials). Set PAYPAL_CLIENT_ID/SECRET for the real sandbox.');
  if (config.ai.provider === 'rules') console.warn('No LLM key set: the deterministic rule engine will answer AI requests.');
});

const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
