// Checkout lifecycle: pending sale -> PayPal order -> capture -> PAID sale (+ stock, + analytics).
// finalizePayment() is the single place a sale becomes "paid". It is idempotent, so the browser
// capture call and the PayPal webhook can both arrive (in any order, any number of times) and the
// sale is still recorded exactly once.
import { pool, query, withTransaction } from '../db/pool.js';
import { HttpError } from '../utils/http.js';
import { toCents, toChargeAmount } from '../utils/money.js';
import { config } from '../config.js';
import { activeDiscounts, insertSale, upsertCustomer } from './sales.js';
import * as paypal from './paypal.js';

/**
 * PayPal cannot charge Indian rupees, so a rupee shop is charged in PayPal's checkout currency (USD by default)
 * at a configured rate. Returns the rate: shop-currency units per 1 checkout-currency unit.
 */
export function fxRateFor(shopCurrency) {
  const checkout = config.paypal.currency;
  if (shopCurrency === checkout) return 1;
  if (config.paypal.fxRate > 0) return config.paypal.fxRate;
  throw new HttpError(500, `No exchange rate configured for ${shopCurrency} -> ${checkout} (set PAYPAL_FX_RATE)`);
}

/** items: [{ productId, quantity }]  (prices come from the DB + active campaigns) */
export async function createCheckout(business, { items, customerEmail, customerName }) {
  // 1) Persist a PENDING sale + payment row
  const pending = await withTransaction(async (client) => {
    const ids = items.map((i) => i.productId);
    const { rows: products } = await client.query(
      'SELECT id, name, price, cost, stock, active FROM products WHERE business_id = $1 AND id = ANY($2::bigint[])',
      [business.id, ids],
    );
    const byId = new Map(products.map((p) => [p.id, p]));
    const discounts = await activeDiscounts(client, business.id);

    const lines = items.map((i) => {
      const p = byId.get(i.productId);
      if (!p || !p.active) throw new HttpError(400, `Product ${i.productId} is not available`);
      if (p.stock < i.quantity) throw new HttpError(409, `Only ${p.stock} of "${p.name}" left in stock`);
      const d = discounts.get(p.id);
      const unitPrice = d ? Math.round((toCents(p.price) * (100 - d.discount_pct)) / 100) / 100 : p.price;
      return { product: p, quantity: i.quantity, unitPrice, campaignId: d?.campaign_id };
    });

    const customerId = await upsertCustomer(client, business.id, { email: customerEmail, name: customerName });
    const sale = await insertSale(client, {
      businessId: business.id, customerId, status: 'pending', source: 'paypal', currency: business.currency, lines,
    });
    return { sale, lines };
  });

  // 2) Convert to the checkout currency (INR shop -> USD charge) and create the PayPal order.
  //    The order total is the sum of the converted lines, so PayPal's own arithmetic check always passes.
  const rate = fxRateFor(business.currency);
  const chargeLines = pending.lines.map((l) => ({ name: l.product.name, quantity: l.quantity, unitPrice: toChargeAmount(l.unitPrice, rate) }));
  const chargeTotal = chargeLines.reduce((sum, l) => sum + toCents(l.unitPrice) * l.quantity, 0) / 100;
  const chargeCurrency = config.paypal.currency;

  let order;
  try {
    order = await paypal.createOrder({
      saleId: pending.sale.id,
      currency: chargeCurrency,
      total: chargeTotal,
      businessName: business.name,
      lines: chargeLines,
    });
  } catch (e) {
    await query("UPDATE sales SET status = 'failed' WHERE id = $1", [pending.sale.id]);
    throw e;
  }

  // payments.amount/currency = what PayPal charges; sales.total/currency = the shop price
  await query(
    `INSERT INTO payments (business_id, sale_id, paypal_order_id, status, amount, currency, fx_rate)
     VALUES ($1,$2,$3,'created',$4,$5,$6)`,
    [business.id, pending.sale.id, order.id, chargeTotal, chargeCurrency, rate],
  );
  return {
    saleId: pending.sale.id, orderId: order.id,
    total: pending.sale.total, currency: business.currency,
    chargeAmount: chargeTotal, chargeCurrency, fxRate: rate,
    mock: paypal.isMock(),
  };
}

/**
 * Mark a sale paid from a verified PayPal capture. Idempotent and race-safe:
 * the payment/sale rows are locked FOR UPDATE, and a second call returns { alreadyProcessed: true }.
 */
export async function finalizePayment({ orderId, captureId, amount, currency, payerEmail, payerName, raw }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT p.id AS payment_id, p.business_id, p.sale_id, s.status AS sale_status, p.amount AS charge_amount, p.currency AS charge_currency
         FROM payments p JOIN sales s ON s.id = p.sale_id AND s.business_id = p.business_id
        WHERE p.paypal_order_id = $1
        FOR UPDATE OF p, s`,
      [orderId],
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, 'Unknown PayPal order');
    if (row.sale_status === 'paid') return { saleId: row.sale_id, alreadyProcessed: true };
    if (row.sale_status !== 'pending') throw new HttpError(409, `Sale is ${row.sale_status}`);

    // Never trust the client: the captured amount must equal what we asked PayPal to charge.
    if (toCents(amount) !== toCents(row.charge_amount) || currency !== row.charge_currency.trim()) {
      await client.query("UPDATE payments SET status = 'failed', raw_response = $2 WHERE id = $1", [row.payment_id, JSON.stringify(raw ?? null)]);
      await client.query("UPDATE sales SET status = 'failed' WHERE id = $1", [row.sale_id]);
      return { saleId: row.sale_id, mismatch: true };
    }

    await client.query(
      `UPDATE payments SET status = 'completed', paypal_capture_id = $2, payer_email = $3, payer_name = $4,
              raw_response = $5, captured_at = now() WHERE id = $1`,
      [row.payment_id, captureId, payerEmail, payerName, JSON.stringify(raw ?? null)],
    );
    await client.query("UPDATE sales SET status = 'paid', sold_at = now() WHERE id = $1", [row.sale_id]);
    await client.query(
      `UPDATE products p SET stock = GREATEST(p.stock - si.quantity, 0)
         FROM sale_items si WHERE si.sale_id = $1 AND si.product_id = p.id AND p.business_id = $2`,
      [row.sale_id, row.business_id],
    );
    return { saleId: row.sale_id, alreadyProcessed: false };
  });
}

/** Browser-driven capture (after the buyer approves in the PayPal popup). */
export async function captureForOrder(orderId) {
  const { rows } = await query(
    `SELECT p.status, s.id AS sale_id, p.amount, p.currency FROM payments p JOIN sales s ON s.id = p.sale_id
      WHERE p.paypal_order_id = $1`,
    [orderId],
  );
  if (!rows[0]) throw new HttpError(404, 'Unknown order');
  if (rows[0].status === 'completed') return { saleId: rows[0].sale_id, status: 'paid', alreadyProcessed: true };

  const cap = await paypal.captureOrder(orderId, { mockAmount: rows[0].amount, mockCurrency: rows[0].currency.trim() });
  if (cap.captureStatus !== 'COMPLETED') {
    return { saleId: rows[0].sale_id, status: 'pending', paypalStatus: cap.captureStatus || cap.orderStatus };
  }
  const result = await finalizePayment(cap);
  if (result.mismatch) throw new HttpError(409, 'Captured amount did not match the order');
  return { saleId: result.saleId, status: 'paid', alreadyProcessed: result.alreadyProcessed };
}

/** Webhook entry point. `event` is the parsed JSON body. Returns a short status string. */
export async function processWebhook(headers, event) {
  const valid = await paypal.verifyWebhook(headers, event);
  if (!valid) throw new HttpError(400, 'Invalid webhook signature');

  const resourceId = event.resource?.id || null;
  const ins = await pool.query(
    `INSERT INTO paypal_webhook_events (event_id, event_type, resource_id, signature_valid, payload)
     VALUES ($1,$2,$3,TRUE,$4) ON CONFLICT (event_id) DO NOTHING RETURNING id`,
    [event.id, event.event_type, resourceId, JSON.stringify(event)],
  );
  if (!ins.rows[0]) return 'duplicate'; // already received; idempotent

  try {
    await handleEvent(event);
    await pool.query('UPDATE paypal_webhook_events SET processed_at = now() WHERE id = $1', [ins.rows[0].id]);
    return 'processed';
  } catch (e) {
    await pool.query('UPDATE paypal_webhook_events SET processing_error = $2 WHERE id = $1', [ins.rows[0].id, String(e.message).slice(0, 500)]);
    throw e; // non-2xx makes PayPal retry later
  }
}

async function handleEvent(event) {
  const r = event.resource || {};
  const orderId = r.supplementary_data?.related_ids?.order_id;
  switch (event.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED': {
      if (!orderId) return;
      await finalizePayment({
        orderId, captureId: r.id, amount: Number(r.amount?.value), currency: r.amount?.currency_code,
        payerEmail: null, payerName: null, raw: r,
      });
      return;
    }
    case 'PAYMENT.CAPTURE.REFUNDED':
    case 'PAYMENT.CAPTURE.REVERSED': {
      // Refunded sales drop out of analytics automatically (views only count status = 'paid').
      await withTransaction(async (client) => {
        const { rows } = await client.query("UPDATE payments SET status = 'refunded' WHERE paypal_capture_id = $1 RETURNING sale_id", [r.id || null]);
        if (rows[0]) await client.query("UPDATE sales SET status = 'refunded' WHERE id = $1", [rows[0].sale_id]);
      });
      return;
    }
    case 'PAYMENT.CAPTURE.DENIED': {
      if (!orderId) return;
      await withTransaction(async (client) => {
        await client.query("UPDATE payments SET status = 'failed' WHERE paypal_order_id = $1", [orderId]);
        await client.query("UPDATE sales SET status = 'failed' WHERE status = 'pending' AND id IN (SELECT sale_id FROM payments WHERE paypal_order_id = $1)", [orderId]);
      });
      return;
    }
    default:
      return; // other events are stored for audit only
  }
}
