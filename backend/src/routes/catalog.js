// Business profile, products and expenses (all scoped to the signed-in owner's business).
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler, HttpError, parse, slugify } from '../utils/http.js';
import { CATEGORIES } from './auth.js';

const router = Router();

// ---- business ---------------------------------------------------------------
const businessSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  category: z.enum(CATEGORIES).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  onboarded: z.literal(true).optional(), // can only be switched on, never back off
});

router.patch('/business', asyncHandler(async (req, res) => {
  const b = parse(businessSchema, req.body);
  const business = await withTransaction(async (client) => {
    const cur = (await client.query('SELECT onboarded FROM businesses WHERE id = $1 FOR UPDATE', [req.business.id])).rows[0];
    // First-time setup: derive a clean storefront URL from the real business name.
    let slug = null;
    if (!cur.onboarded && b.name) {
      const base = slugify(b.name);
      slug = base;
      for (let n = 2; (await client.query('SELECT 1 FROM businesses WHERE slug = $1 AND id <> $2', [slug, req.business.id])).rowCount; n++) slug = `${base}-${n}`;
    }
    const { rows } = await client.query(
      `UPDATE businesses SET name = coalesce($2, name), category = coalesce($3, category), description = coalesce($4, description),
              slug = coalesce($5, slug), onboarded = coalesce($6, onboarded)
        WHERE id = $1 RETURNING id, name, slug, category, currency, description, onboarded`,
      [req.business.id, b.name ?? null, b.category ?? null, b.description ?? null, slug, b.onboarded ?? null],
    );
    return rows[0];
  });
  res.json(business);
}));

// ---- products -----------------------------------------------------------------
const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(40).nullable().optional(),
  price: z.number().min(0).max(1_000_000),
  cost: z.number().min(0).max(1_000_000).default(0),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  lowStockThreshold: z.number().int().min(0).default(10),
  active: z.boolean().default(true),
});

const productSelect = `id, name, sku, price, cost, stock, low_stock_threshold AS "lowStockThreshold", active, created_at AS "createdAt"`;

router.get('/products', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT ${productSelect} FROM products WHERE business_id = $1 ORDER BY active DESC, name`, [req.business.id]);
  res.json(rows);
}));

router.post('/products', asyncHandler(async (req, res) => {
  const p = parse(productSchema, req.body);
  const { rows } = await query(
    `INSERT INTO products (business_id, name, sku, price, cost, stock, low_stock_threshold, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${productSelect}`,
    [req.business.id, p.name, p.sku || null, p.price, p.cost, p.stock, p.lowStockThreshold, p.active],
  );
  res.status(201).json(rows[0]);
}));

router.put('/products/:id', asyncHandler(async (req, res) => {
  const p = parse(productSchema, req.body);
  const { rows } = await query(
    `UPDATE products SET name=$3, sku=$4, price=$5, cost=$6, stock=$7, low_stock_threshold=$8, active=$9
      WHERE id=$1 AND business_id=$2 RETURNING ${productSelect}`,
    [req.params.id, req.business.id, p.name, p.sku || null, p.price, p.cost, p.stock, p.lowStockThreshold, p.active],
  );
  if (!rows[0]) throw new HttpError(404, 'Product not found');
  res.json(rows[0]);
}));

// Products with sales history cannot be deleted (FK RESTRICT) - they are archived instead.
router.delete('/products/:id', asyncHandler(async (req, res) => {
  const used = await query('SELECT 1 FROM sale_items WHERE product_id = $1 AND business_id = $2 LIMIT 1', [req.params.id, req.business.id]);
  if (used.rowCount) {
    const { rowCount } = await query('UPDATE products SET active = FALSE WHERE id = $1 AND business_id = $2', [req.params.id, req.business.id]);
    if (!rowCount) throw new HttpError(404, 'Product not found');
    return res.json({ archived: true });
  }
  const { rowCount } = await query('DELETE FROM products WHERE id = $1 AND business_id = $2', [req.params.id, req.business.id]);
  if (!rowCount) throw new HttpError(404, 'Product not found');
  res.json({ deleted: true });
}));

// ---- expenses -----------------------------------------------------------------
const expenseSchema = z.object({
  category: z.enum(['rent', 'wages', 'utilities', 'marketing', 'equipment', 'supplies', 'other']),
  description: z.string().trim().max(200).optional(),
  amount: z.number().positive().max(10_000_000),
  incurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.get('/expenses', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, category, description, amount, incurred_on::text AS "incurredOn" FROM expenses
      WHERE business_id = $1 ORDER BY incurred_on DESC, id DESC LIMIT 200`, [req.business.id]);
  res.json(rows);
}));

router.post('/expenses', asyncHandler(async (req, res) => {
  const e = parse(expenseSchema, req.body);
  const { rows } = await query(
    `INSERT INTO expenses (business_id, category, description, amount, incurred_on)
     VALUES ($1,$2,$3,$4, coalesce($5::date, CURRENT_DATE)) RETURNING id, category, description, amount, incurred_on::text AS "incurredOn"`,
    [req.business.id, e.category, e.description || null, e.amount, e.incurredOn || null],
  );
  res.status(201).json(rows[0]);
}));

router.delete('/expenses/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM expenses WHERE id = $1 AND business_id = $2', [req.params.id, req.business.id]);
  if (!rowCount) throw new HttpError(404, 'Expense not found');
  res.json({ deleted: true });
}));

export default router;
