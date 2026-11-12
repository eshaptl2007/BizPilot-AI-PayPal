// Shared sale-writing logic used by manual entry, CSV import and PayPal checkout.
// Prices, costs and names are always snapshotted from the products table on the SERVER;
// the client never decides what something costs.
import { toCents, fromCents } from '../utils/money.js';

/** Highest-discount ACTIVE campaign per product (within its date window). */
export async function activeDiscounts(client, businessId) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (product_id) product_id, id AS campaign_id, discount_pct
       FROM campaigns
      WHERE business_id = $1 AND status = 'active' AND product_id IS NOT NULL AND discount_pct > 0
        AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
      ORDER BY product_id, discount_pct DESC`,
    [businessId],
  );
  return new Map(rows.map((r) => [r.product_id, r]));
}

/**
 * Insert a sale and its items.
 * lines: [{ product: {id,name,price,cost}, quantity, unitPrice? , campaignId? }]
 */
export async function insertSale(client, { businessId, customerId = null, status, source, soldAt = null, currency, lines, adjustStock = false }) {
  let subtotalC = 0, totalC = 0, campaignId = null;
  const prepared = lines.map((l) => {
    const listC = toCents(l.product.price);
    let unitC = l.unitPrice !== undefined && l.unitPrice !== null ? toCents(l.unitPrice) : listC;
    const listForRow = Math.max(listC, unitC); // history may have been sold above today's list price
    subtotalC += l.quantity * listForRow;
    totalC += l.quantity * unitC;
    if (l.campaignId && unitC < listC) campaignId = l.campaignId;
    return { ...l, listC: listForRow, unitC };
  });

  const { rows } = await client.query(
    `INSERT INTO sales (business_id, customer_id, campaign_id, subtotal, discount_total, total, currency, status, source, sold_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, coalesce($10::timestamptz, now())) RETURNING *`,
    [businessId, customerId, campaignId, fromCents(subtotalC), fromCents(subtotalC - totalC), fromCents(totalC), currency, status, source, soldAt],
  );
  const sale = rows[0];

  for (const l of prepared) {
    await client.query(
      `INSERT INTO sale_items (sale_id, business_id, product_id, product_name, quantity, list_price, unit_price, unit_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [sale.id, businessId, l.product.id, l.product.name, l.quantity, fromCents(l.listC), fromCents(l.unitC), l.product.cost],
    );
    if (adjustStock) {
      await client.query('UPDATE products SET stock = GREATEST(stock - $1, 0) WHERE id = $2 AND business_id = $3', [l.quantity, l.product.id, businessId]);
    }
  }
  return sale;
}

export async function upsertCustomer(client, businessId, { email, name }) {
  if (!email) return null;
  const { rows } = await client.query(
    `INSERT INTO customers (business_id, name, email) VALUES ($1, $2, $3)
     ON CONFLICT (business_id, lower(email)) WHERE email IS NOT NULL DO UPDATE SET name = customers.name
     RETURNING id`,
    [businessId, (name || email.split('@')[0]).slice(0, 120), email],
  );
  return rows[0].id;
}
