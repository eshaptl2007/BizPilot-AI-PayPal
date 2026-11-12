// PayPal REST client (Orders v2 + Webhook signature verification), plain fetch.
// Modes: "sandbox" (default with credentials), "live", or "mock" (offline dev/tests only).
import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../utils/http.js';

const { paypal } = config;
export const isMock = () => paypal.mode === 'mock';

let tokenCache = { value: null, expiresAt: 0 };

async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt - 30_000) return tokenCache.value;
  const basic = Buffer.from(`${paypal.clientId}:${paypal.secret}`).toString('base64');
  const res = await fetch(`${paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, 'PayPal authentication failed', data.error_description || data.error);
  tokenCache = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.value;
}

async function api(method, path, body, extraHeaders = {}) {
  const token = await accessToken();
  const res = await fetch(`${paypal.baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issue = data.details?.[0]?.issue || data.name;
    const err = new HttpError(res.status === 422 ? 422 : 502, `PayPal error: ${issue || res.status}`, data);
    err.paypalIssue = issue;
    throw err;
  }
  return data;
}

const money = (n) => Number(n).toFixed(2);

/** Create a PayPal order for a pending sale. `lines` use the price actually charged. */
export async function createOrder({ saleId, currency, total, lines, businessName }) {
  if (isMock()) return { id: `MOCK-${crypto.randomBytes(6).toString('hex').toUpperCase()}`, status: 'CREATED' };
  return api(
    'POST',
    '/v2/checkout/orders',
    {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: `sale-${saleId}`,
          custom_id: String(saleId),
          description: `${businessName} order #${saleId}`.slice(0, 127),
          amount: {
            currency_code: currency,
            value: money(total),
            breakdown: { item_total: { currency_code: currency, value: money(total) } },
          },
          items: lines.map((l) => ({
            name: l.name.slice(0, 127),
            quantity: String(l.quantity),
            unit_amount: { currency_code: currency, value: money(l.unitPrice) },
            category: 'PHYSICAL_GOODS',
          })),
        },
      ],
      payment_source: { paypal: { experience_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } },
    },
    { 'PayPal-Request-Id': `bizpilot-order-sale-${saleId}` }, // idempotent create
  );
}

/** Capture an approved order. Returns a normalised capture result. */
export async function captureOrder(orderId, { mockAmount, mockCurrency } = {}) {
  if (isMock()) {
    return normaliseCapture({
      id: orderId,
      status: 'COMPLETED',
      payer: { email_address: 'sandbox-buyer@example.com', name: { given_name: 'Sandbox', surname: 'Buyer' } },
      purchase_units: [{ payments: { captures: [{ id: `MOCKCAP-${orderId}`, status: 'COMPLETED', amount: { value: money(mockAmount), currency_code: mockCurrency } }] } }],
    });
  }
  try {
    const data = await api('POST', `/v2/checkout/orders/${orderId}/capture`, null, {
      'PayPal-Request-Id': `bizpilot-capture-${orderId}`,
      prefer: 'return=representation',
    });
    return normaliseCapture(data);
  } catch (e) {
    // Already captured (e.g. webhook won the race): read the order instead.
    if (e.paypalIssue === 'ORDER_ALREADY_CAPTURED') return normaliseCapture(await api('GET', `/v2/checkout/orders/${orderId}`));
    throw e;
  }
}

export function normaliseCapture(order) {
  const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: order.id,
    orderStatus: order.status,
    captureId: cap?.id || null,
    captureStatus: cap?.status || null,
    amount: cap ? Number(cap.amount.value) : null,
    currency: cap?.amount.currency_code || null,
    payerEmail: order.payer?.email_address || null,
    payerName: [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(' ') || null,
    raw: order,
  };
}

/** Verify a webhook with PayPal's verify-webhook-signature API. */
export async function verifyWebhook(headers, event) {
  if (isMock()) return true; // mock mode only; production refuses to start in mock
  if (!paypal.webhookId) throw new HttpError(500, 'PAYPAL_WEBHOOK_ID is not configured');
  const h = (k) => headers[k];
  const result = await api('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: h('paypal-auth-algo'),
    cert_url: h('paypal-cert-url'),
    transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'),
    transmission_time: h('paypal-transmission-time'),
    webhook_id: paypal.webhookId,
    webhook_event: event,
  });
  return result.verification_status === 'SUCCESS';
}
