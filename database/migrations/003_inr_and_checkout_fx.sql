-- =====================================================================
-- Migration 003: Indian rupee (INR) as the default currency + PayPal conversion audit
--   * New businesses and sales default to INR.
--   * Existing businesses that have NO products and NO sales are switched to INR.
--     Businesses that already hold data are left alone on purpose: their stored numbers were
--     entered in another currency, and silently relabelling them would be wrong.
--   * payments.fx_rate records the rate used when a rupee sale was charged through PayPal.
--     PayPal does not accept INR (it stopped domestic India payments in 2021), so the customer sees
--     prices in rupees and PayPal charges the USD equivalent.
--     payments.amount / payments.currency = what PayPal actually charged.
--     sales.total / sales.currency        = the price in the shop's own currency.
-- =====================================================================
BEGIN;

ALTER TABLE businesses ALTER COLUMN currency SET DEFAULT 'INR';
ALTER TABLE sales      ALTER COLUMN currency SET DEFAULT 'INR';

UPDATE businesses b SET currency = 'INR'
 WHERE b.currency = 'USD'
   AND NOT EXISTS (SELECT 1 FROM products p WHERE p.business_id = b.id)
   AND NOT EXISTS (SELECT 1 FROM sales    s WHERE s.business_id = b.id);

ALTER TABLE payments
  ADD COLUMN fx_rate NUMERIC(12,6) NOT NULL DEFAULT 1
  CONSTRAINT payments_fx_rate_positive CHECK (fx_rate > 0);   -- shop-currency units per 1 charged-currency unit

COMMIT;
