// Public storefront + PayPal checkout endpoints (no login: these are used by the owner's customers).
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { asyncHandler, HttpError, parse } from '../utils/http.js';
import { createCheckout, captureForOrder } from '../services/orders.js';
import { isMock } from '../services/paypal.js';
import { discountedPrice } from '../utils/money.js';

const router = Router();

router.get('/config', (_req, res) =>
  res.json({ paypalClientId: config.paypal.clientId || null, paypalMode: config.paypal.mode, checkoutCurrency: config.paypal.currency, fxRate: config.paypal.fxRate, mock: isMock() }));

async function loadBusiness(slug) {
  const { rows } = await query('SELECT id, name, slug, category, currency, description FROM businesses WHERE slug = $1', [slug]);
  if (!rows[0]) throw new HttpError(404, 'Shop not found');
  return rows[0];
}

router.get('/shop/:slug', asyncHandler(async (req, res) => {
  const business = await loadBusiness(req.params.slug);
  const { rows } = await query(
    `SELECT p.id, p.name, p.price, p.stock, c.discount_pct AS "discountPct", c.title AS "campaignTitle"
       FROM products p
       LEFT JOIN LATERAL (
         SELECT discount_pct, title FROM campaigns c
          WHERE c.product_id = p.id AND c.business_id = p.business_id AND c.status = 'active' AND c.discount_pct > 0
            AND (c.starts_at IS NULL OR c.starts_at <= now()) AND (c.ends_at IS NULL OR c.ends_at > now())
          ORDER BY c.discount_pct DESC LIMIT 1) c ON TRUE
      WHERE p.business_id = $1 AND p.active AND p.stock > 0
      ORDER BY (c.discount_pct IS NOT NULL) DESC, p.name`,
    [business.id],
  );
  res.json({
    business: { name: business.name, slug: business.slug, category: business.category, currency: business.currency.trim(), description: business.description },
    products: rows.map((p) => ({ ...p, salePrice: p.discountPct ? discountedPrice(p.price, p.discountPct) : p.price })),
  });
}));

const orderSchema = z.object({
  items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(50) })).min(1).max(30),
  customerEmail: z.string().email().max(200).optional(),
  customerName: z.string().trim().max(120).optional(),
});

router.post('/shop/:slug/orders', asyncHandler(async (req, res) => {
  const business = await loadBusiness(req.params.slug);
  const b = parse(orderSchema, req.body);
  // merge duplicate product lines
  const merged = [...b.items.reduce((m, i) => m.set(i.productId, (m.get(i.productId) || 0) + i.quantity), new Map())].map(([productId, quantity]) => ({ productId, quantity }));
  res.status(201).json(await createCheckout({ ...business, currency: business.currency.trim() }, { ...b, items: merged }));
}));

router.post('/orders/:orderId/capture', asyncHandler(async (req, res) => {
  res.json(await captureForOrder(req.params.orderId));
}));

export default router;
