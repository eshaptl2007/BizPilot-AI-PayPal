import 'dotenv/config';

const env = process.env;

const paypalClientId = env.PAYPAL_CLIENT_ID || '';
const paypalSecret = env.PAYPAL_CLIENT_SECRET || '';
// "sandbox" (default) | "live" | "mock". Mock is only for offline development and automated tests.
let paypalMode = (env.PAYPAL_MODE || '').toLowerCase();
if (!paypalMode) paypalMode = paypalClientId && paypalSecret ? 'sandbox' : 'mock';

const aiProviderRaw = (env.AI_PROVIDER || '').toLowerCase();
const aiProvider =
  aiProviderRaw ||
  (env.ANTHROPIC_API_KEY ? 'anthropic' : env.OPENAI_API_KEY ? 'openai' : 'rules');

export const config = {
  port: Number(env.PORT || 4000),
  nodeEnv: env.NODE_ENV || 'development',
  databaseUrl: env.DATABASE_URL || 'postgres://bizpilot:bizpilot@localhost:5432/bizpilot',
  jwtSecret: env.JWT_SECRET || 'dev-only-change-me',
  clientOrigin: env.CLIENT_ORIGIN || 'http://localhost:5173',
  publicClientUrl: env.PUBLIC_CLIENT_URL || env.CLIENT_ORIGIN || 'http://localhost:5173',
  paypal: {
    mode: paypalMode,
    clientId: paypalClientId,
    secret: paypalSecret,
    webhookId: env.PAYPAL_WEBHOOK_ID || '',
    baseUrl: paypalMode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com',
    // PayPal cannot charge Indian rupees. Prices are shown in the shop's own currency (INR) and PayPal
    // charges this currency instead, converted at fxRate (shop-currency units per 1 checkout-currency unit).
    currency: (env.PAYPAL_CURRENCY || 'USD').toUpperCase(),
    fxRate: Number(env.PAYPAL_FX_RATE || 88),
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'BizPilot AI <no-reply@bizpilot.local>',
  },
  timezone: env.TIMEZONE || 'Asia/Kolkata', // chart buckets (day/hour boundaries) use this zone
  resetTokenMinutes: Number(env.RESET_TOKEN_MINUTES || 30),
  ai: {
    provider: aiProvider, // anthropic | openai | rules
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    openaiKey: env.OPENAI_API_KEY || '',
    openaiModel: env.OPENAI_MODEL || 'gpt-4o-mini',
    timeoutMs: Number(env.AI_TIMEOUT_MS || 45000),
  },
};

if (config.nodeEnv === 'production' && config.jwtSecret === 'dev-only-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
if (config.nodeEnv === 'production' && config.paypal.mode === 'mock') {
  throw new Error('PAYPAL_MODE=mock is not allowed in production');
}
