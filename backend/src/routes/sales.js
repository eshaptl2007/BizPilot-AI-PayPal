import { Router } from 'express';
import { z } from 'zod';
import { parse as parseCsv } from 'csv-parse/sync';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler, HttpError, parse } from '../utils/http.js';
import { insertSale, upsertCustomer } from '../services/sales.js';

const router = Router();

router.get('/sales', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const { rows } = await query(
    `SELECT s.id, s.sold_at AS "soldAt", s.total, s.discount_total AS "discountTotal", s.status, s.source,
            c.name AS "customerName",
            (SELECT json_agg(json_build_object('name', si.product_name, 'quantity', si.quantity, 'unitPrice', si.unit_price) ORDER BY si.id)
               FROM sale_items si WHERE si.sale_id = s.id) AS items
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id AND c.business_id = s.business_id
      WHERE s.business_id = $1 ORDER BY s.sold_at DESC, s.id DESC LIMIT $2`,
    [req.business.id, limit],
  );
  res.json(rows);
}));

const manualSchema = z.object({
  items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(10_000), unitPrice: z.number().min(0).optional() })).min(1).max(50),
  soldAt: z.string().datetime().optional(),
  customerEmail: z.string().email().optional(),
  customerName: z.string().max(120).optional(),
});

router.post('/sales', asyncHandler(async (req, res) => {
  const b = parse(manualSchema, req.body);
  const sale = await withTransaction(async (client) => {
    const { rows: products } = await client.query(
      'SELECT id, name, price, cost FROM products WHERE business_id = $1 AND id = ANY($2::bigint[])',
      [req.business.id, b.items.map((i) => i.productId)],
    );
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines = b.items.map((i) => {
      const product = byId.get(i.productId);
      if (!product) throw new HttpError(400, `Unknown product ${i.productId}`);
      return { product, quantity: i.quantity, unitPrice: i.unitPrice };
    });
    const customerId = await upsertCustomer(client, req.business.id, { email: b.customerEmail, name: b.customerName });
    return insertSale(client, { businessId: req.business.id, customerId, status: 'paid', source: 'manual', soldAt: b.soldAt, currency: req.business.currency, lines, adjustStock: true });
  });
  res.status(201).json(sale);
}));

// CSV import. Columns: date, product, quantity, unit_price (optional), order_id (optional, groups rows into one sale)
const csvSchema = z.object({ csv: z.string().min(1).max(2_000_000) });

router.post('/import/csv', asyncHandler(async (req, res) => {
  const { csv } = parse(csvSchema, req.body);
  let records;
  try {
    records = parseCsv(csv, { columns: (h) => h.map((x) => x.trim().toLowerCase().replace(/\s+/g, '_')), skip_empty_lines: true, trim: true, bom: true });
  } catch (e) {
    throw new HttpError(400, `Could not read CSV: ${e.message}`);
  }
  if (records.length > 20_000) throw new HttpError(400, 'Too many rows (max 20,000)');

  const result = await withTransaction(async (client) => {
    const { rows: products } = await client.query('SELECT id, name, price, cost FROM products WHERE business_id = $1', [req.business.id]);
    const byName = new Map(products.map((p) => [p.name.toLowerCase(), p]));
    const skipped = [];
    const groups = new Map(); // key -> { date, lines }

    records.forEach((r, idx) => {
      const row = idx + 2; // header is line 1
      const product = byName.get(String(r.product || '').toLowerCase());
      const quantity = Number.parseInt(r.quantity, 10);
      const date = new Date(r.date);
      const unitPrice = r.unit_price === undefined || r.unit_price === '' ? undefined : Number(r.unit_price);
      if (!product) return skipped.push({ row, reason: `Unknown product "${r.product}" (add it under Products first)` });
      if (!Number.isInteger(quantity) || quantity < 1) return skipped.push({ row, reason: 'Invalid quantity' });
      if (Number.isNaN(date.getTime())) return skipped.push({ row, reason: 'Invalid date' });
      if (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice < 0)) return skipped.push({ row, reason: 'Invalid unit_price' });
      const key = r.order_id ? `o:${r.order_id}` : `r:${row}`;
      if (!groups.has(key)) groups.set(key, { date, lines: [] });
      groups.get(key).lines.push({ product, quantity, unitPrice });
    });

    let imported = 0;
    for (const g of groups.values()) {
      // History import: do not touch current stock levels.
      await insertSale(client, { businessId: req.business.id, status: 'paid', source: 'csv', soldAt: g.date.toISOString(), currency: req.business.currency, lines: g.lines });
      imported++;
    }
    return { imported, skipped };
  });
  res.status(201).json(result);
}));

export default router;
