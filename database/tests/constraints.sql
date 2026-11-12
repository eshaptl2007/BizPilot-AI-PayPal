-- Negative tests: every statement below MUST fail. Run: psql -f constraints.sql
-- Each block prints PASS when the database rejected the bad write.
CREATE OR REPLACE FUNCTION pg_temp.expect_fail(label text, stmt text) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
    RAISE EXCEPTION 'FAIL: % was accepted', label;
  EXCEPTION WHEN check_violation OR foreign_key_violation OR unique_violation OR not_null_violation THEN
    RAISE NOTICE 'PASS: %', label;
  END;
END $$ LANGUAGE plpgsql;

BEGIN;
INSERT INTO users(name,email,password_hash) VALUES ('T2','other@example.com','x');
INSERT INTO businesses(user_id,name,slug) SELECT id,'Other Shop','other-shop' FROM users WHERE email='other@example.com';

SELECT pg_temp.expect_fail('negative price',
  $$INSERT INTO products(business_id,name,price) SELECT id,'Bad',-1 FROM businesses WHERE slug='other-shop'$$);
SELECT pg_temp.expect_fail('negative stock',
  $$INSERT INTO products(business_id,name,price,stock) SELECT id,'Bad2',1,-5 FROM businesses WHERE slug='other-shop'$$);
SELECT pg_temp.expect_fail('duplicate email (case-insensitive)',
  $$INSERT INTO users(name,email,password_hash) VALUES ('Dup','OTHER@example.com','x')$$);
SELECT pg_temp.expect_fail('bad slug',
  $$INSERT INTO businesses(user_id,name,slug) SELECT id,'X','Bad Slug' FROM users WHERE email='other@example.com'$$);
SELECT pg_temp.expect_fail('sale total != subtotal - discount',
  $$INSERT INTO sales(business_id,subtotal,discount_total,total) SELECT id,10,1,10 FROM businesses WHERE slug='other-shop'$$);
SELECT pg_temp.expect_fail('cross-tenant sale_item (product of another business)',
  $$WITH s AS (INSERT INTO sales(business_id,subtotal,total) SELECT id,3,3 FROM businesses WHERE slug='other-shop' RETURNING id,business_id)
    INSERT INTO sale_items(sale_id,business_id,product_id,product_name,quantity,list_price,unit_price,unit_cost)
    SELECT s.id, s.business_id, (SELECT id FROM products WHERE business_id=(SELECT id FROM businesses WHERE slug='sweet-crumbs') LIMIT 1), 'x',1,3,3,1 FROM s$$);
SELECT pg_temp.expect_fail('unit_price above list_price',
  $$INSERT INTO sale_items(sale_id,business_id,product_id,product_name,quantity,list_price,unit_price,unit_cost)
    SELECT s.id,s.business_id,p.id,p.name,1,3,4,1 FROM sales s JOIN products p ON p.business_id=s.business_id LIMIT 1$$);
SELECT pg_temp.expect_fail('zero quantity',
  $$INSERT INTO sale_items(sale_id,business_id,product_id,product_name,quantity,list_price,unit_price,unit_cost)
    SELECT s.id,s.business_id,p.id,p.name,0,3,3,1 FROM sales s JOIN products p ON p.business_id=s.business_id LIMIT 1$$);
SELECT pg_temp.expect_fail('discount over 90%',
  $$INSERT INTO campaigns(business_id,title,discount_pct) SELECT id,'Crazy',95 FROM businesses WHERE slug='other-shop'$$);
SELECT pg_temp.expect_fail('invalid recommendation status',
  $$INSERT INTO ai_recommendations(business_id,type,title,problem,action,success_metric,status)
    SELECT id,'other','t','p','a','m','done' FROM businesses WHERE slug='other-shop'$$);

-- PayPal idempotency
INSERT INTO sales(business_id,subtotal,total,status) SELECT id,5,5,'pending' FROM businesses WHERE slug='other-shop';
INSERT INTO payments(business_id,sale_id,paypal_order_id,amount,currency)
  SELECT business_id,id,'ORDER-1',5,'USD' FROM sales WHERE business_id=(SELECT id FROM businesses WHERE slug='other-shop');
SELECT pg_temp.expect_fail('duplicate paypal_order_id',
  $$INSERT INTO payments(business_id,sale_id,paypal_order_id,amount,currency)
    SELECT business_id,id,'ORDER-1',5,'USD' FROM sales WHERE business_id=(SELECT id FROM businesses WHERE slug='other-shop')$$);
INSERT INTO paypal_webhook_events(event_id,event_type,signature_valid,payload) VALUES ('WH-1','PAYMENT.CAPTURE.COMPLETED',true,'{}');
SELECT pg_temp.expect_fail('duplicate webhook event',
  $$INSERT INTO paypal_webhook_events(event_id,event_type,signature_valid,payload) VALUES ('WH-1','PAYMENT.CAPTURE.COMPLETED',true,'{}')$$);

-- Migration 002: phone numbers and password reset tokens
UPDATE users SET phone = '+919876543210' WHERE email = 'other@example.com';
SELECT pg_temp.expect_fail('phone with letters',
  $$UPDATE users SET phone = '98765abc10' WHERE email = 'other@example.com'$$);
SELECT pg_temp.expect_fail('phone too short',
  $$UPDATE users SET phone = '12345' WHERE email = 'other@example.com'$$);
SELECT pg_temp.expect_fail('duplicate phone number',
  $$UPDATE users SET phone = '+919876543210' WHERE email = 'demo@bizpilot.ai'$$);
INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
  SELECT id, 'hash-1', now() + interval '30 minutes' FROM users WHERE email = 'other@example.com';
SELECT pg_temp.expect_fail('duplicate reset token hash',
  $$INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
    SELECT id, 'hash-1', now() + interval '30 minutes' FROM users WHERE email = 'other@example.com'$$);
SELECT pg_temp.expect_fail('reset token already expired at creation',
  $$INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
    SELECT id, 'hash-2', now() - interval '1 minute' FROM users WHERE email = 'other@example.com'$$);
ROLLBACK;
