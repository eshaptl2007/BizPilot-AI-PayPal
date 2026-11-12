-- =====================================================================
-- BizPilot AI - demo seed data
--
-- Creates a demo user + a bakery with 90 days of realistic, deterministic sales:
--   * Sourdough Loaf / Baguette   -> clearly GROWING
--   * Custom Celebration Cake     -> clearly DECLINING (high-margin, the AI should notice)
--   * Cheesecake Slice            -> low stock
--   * Cinnamon Roll               -> had a past 20%-off campaign (measurable before/after)
--
-- All amounts are in Indian rupees (INR).
-- Login:  demo@bizpilot.ai  /  Demo@1234        Storefront slug: sweet-crumbs
-- Safe to run more than once (skips if the demo user already exists).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $seed$
DECLARE
  v_user_id     BIGINT;
  v_biz_id      BIGINT;
  v_campaign_id BIGINT;
  v_sale_id     BIGINT;

  p_names   TEXT[]    := ARRAY['Sourdough Loaf','Baguette','Croissant','Chocolate Cupcake','Cinnamon Roll','Custom Celebration Cake','Cheesecake Slice','Cold Brew Coffee'];
  p_skus    TEXT[]    := ARRAY['BRD-001','BRD-002','PST-001','CKE-001','PST-002','CKE-002','DSR-001','BEV-001'];
  p_price   NUMERIC[] := ARRAY[250.00, 120.00, 140.00, 120.00, 160.00, 1800.00, 220.00, 180.00];
  p_cost    NUMERIC[] := ARRAY[85.00, 35.00, 40.00, 35.00, 50.00, 750.00, 80.00, 45.00];
  p_stock   INT[]     := ARRAY[38, 55, 60, 45, 30, 12, 5, 70];
  p_weight  NUMERIC[] := ARRAY[1.4, 1.2, 2.0, 1.5, 1.0, 0.35, 0.8, 1.3];
  p_slope   NUMERIC[] := ARRAY[0.9, 0.8, 0.0, -0.1, 0.0, -0.65, -0.3, 0.1];
  p_ids     BIGINT[]  := ARRAY[]::BIGINT[];

  first_names TEXT[] := ARRAY['Aarav','Maya','Vivaan','Priya','Aditya','Sneha','Ishaan','Isha','Ananya','Kabir','Diya','Rohan','Saanvi','Neha','Arjun'];
  last_names  TEXT[] := ARRAY['Shah','Patel','Sharma','Joshi','Mehta','Gupta','Trivedi','Desai','Iyer','Kapoor'];
  c_ids       BIGINT[] := ARRAY[]::BIGINT[];

  i INT; d INT; k INT; n_orders INT; o INT; tries INT;
  t NUMERIC; dow INT; w NUMERIC; wsum NUMERIC; r NUMERIC; acc NUMERIC;
  pick INT; qty INT; n_items INT;
  it_prod INT[]; it_qty INT[]; it_price NUMERIC[]; it_list NUMERIC[];
  subtotal NUMERIC; total NUMERIC; in_campaign BOOLEAN; cust BIGINT; sold TIMESTAMPTZ;
  weights NUMERIC[];
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE lower(email) = 'demo@bizpilot.ai') THEN
    RAISE NOTICE 'Demo data already present - skipping seed.';
    RETURN;
  END IF;

  PERFORM setseed(0.42);   -- deterministic demo data

  INSERT INTO users (name, email, password_hash)
  VALUES ('Demo Owner', 'demo@bizpilot.ai', crypt('Demo@1234', gen_salt('bf', 10)))
  RETURNING id INTO v_user_id;

  INSERT INTO businesses (user_id, name, slug, category, currency, description)
  VALUES (v_user_id, 'Sweet Crumbs Bakery', 'sweet-crumbs', 'bakery', 'INR',
          'Neighbourhood bakery: fresh bread, pastries and custom celebration cakes.')
  RETURNING id INTO v_biz_id;

  -- products
  FOR i IN 1..array_length(p_names, 1) LOOP
    INSERT INTO products (business_id, name, sku, price, cost, stock, low_stock_threshold)
    VALUES (v_biz_id, p_names[i], p_skus[i], p_price[i], p_cost[i], p_stock[i], 10)
    RETURNING id INTO v_sale_id;                 -- (re-using variable as scratch)
    p_ids := p_ids || v_sale_id;
  END LOOP;

  -- customers
  FOR i IN 1..45 LOOP
    INSERT INTO customers (business_id, name, email, first_seen_at)
    VALUES (v_biz_id,
            first_names[1 + (i % array_length(first_names,1))] || ' ' || last_names[1 + ((i * 7) % array_length(last_names,1))],
            lower(first_names[1 + (i % array_length(first_names,1))] || '.' || last_names[1 + ((i * 7) % array_length(last_names,1))] || i || '@example.com'),
            now() - ((90 - (i % 80)) || ' days')::interval)
    RETURNING id INTO v_sale_id;
    c_ids := c_ids || v_sale_id;
  END LOOP;

  -- a finished campaign: 20% off Cinnamon Rolls, 52 -> 45 days ago
  INSERT INTO campaigns (business_id, product_id, title, caption, hashtags, email_subject, email_body,
                         discount_pct, status, generated_by_ai, starts_at, ends_at)
  VALUES (v_biz_id, p_ids[5], 'Warm Cinnamon Roll Week',
          'Fresh out of the oven: all week, every cinnamon roll is 20% off. Come say hi!',
          ARRAY['#CinnamonRoll','#FreshBaked','#SweetCrumbs'],
          'This week only: 20% off cinnamon rolls',
          'Hi! For one week only, our cinnamon rolls are 20% off. See you at the counter.',
          20, 'ended', FALSE,
          date_trunc('day', now()) - interval '52 days', date_trunc('day', now()) - interval '45 days')
  RETURNING id INTO v_campaign_id;

  -- 90 days of paid sales
  FOR d IN REVERSE 89..0 LOOP
    t   := (89 - d)::numeric / 89;                                   -- 0 (oldest) .. 1 (today)
    dow := extract(dow FROM (date_trunc('day', now()) - (d || ' days')::interval))::int;
    n_orders := round((18 + random() * 8) * CASE WHEN dow IN (0, 6) THEN 1.4 ELSE 1.0 END);

    FOR o IN 1..n_orders LOOP
      n_items := 1 + (random() < 0.45)::int + (random() < 0.15)::int;
      it_prod := ARRAY[]::INT[]; it_qty := ARRAY[]::INT[]; it_price := ARRAY[]::NUMERIC[]; it_list := ARRAY[]::NUMERIC[];
      in_campaign := FALSE;

      FOR k IN 1..n_items LOOP
        tries := 0;
        LOOP
          -- weights for this day (trend + campaign boost)
          weights := ARRAY[]::NUMERIC[]; wsum := 0;
          FOR i IN 1..array_length(p_names, 1) LOOP
            w := p_weight[i] * greatest(0.05, 1 + p_slope[i] * t);
            IF i = 5 AND d BETWEEN 45 AND 52 THEN w := w * 2.2; END IF;
            weights := weights || w; wsum := wsum + w;
          END LOOP;
          r := random() * wsum; acc := 0; pick := 1;
          FOR i IN 1..array_length(p_names, 1) LOOP
            acc := acc + weights[i];
            IF r <= acc THEN pick := i; EXIT; END IF;
          END LOOP;
          tries := tries + 1;
          EXIT WHEN NOT (pick = ANY (it_prod)) OR tries > 6;
        END LOOP;
        CONTINUE WHEN pick = ANY (it_prod);

        qty := CASE WHEN pick = 6 THEN 1 ELSE 1 + (random() < 0.25)::int + (random() < 0.1)::int END;
        it_prod := it_prod || pick;
        it_qty  := it_qty  || qty;
        it_list := it_list || p_price[pick];
        IF pick = 5 AND d BETWEEN 45 AND 52 THEN
          it_price := it_price || round(p_price[pick] * 0.80, 2);
          in_campaign := TRUE;
        ELSE
          it_price := it_price || p_price[pick];
        END IF;
      END LOOP;

      subtotal := 0; total := 0;
      FOR i IN 1..array_length(it_prod, 1) LOOP
        subtotal := subtotal + it_qty[i] * it_list[i];
        total    := total    + it_qty[i] * it_price[i];
      END LOOP;

      cust := CASE WHEN random() < 0.70
                   THEN c_ids[1 + floor(power(random(), 1.6) * array_length(c_ids, 1))::int]
                   ELSE NULL END;
      sold := least(date_trunc('day', now()) - (d || ' days')::interval
                    + ((7 + random() * 11) || ' hours')::interval,
                    now() - interval '5 minutes');

      INSERT INTO sales (business_id, customer_id, campaign_id, subtotal, discount_total, total,
                         currency, status, source, sold_at)
      VALUES (v_biz_id, cust, CASE WHEN in_campaign THEN v_campaign_id END,
              subtotal, subtotal - total, total, 'INR', 'paid', 'manual', sold)
      RETURNING id INTO v_sale_id;

      FOR i IN 1..array_length(it_prod, 1) LOOP
        INSERT INTO sale_items (sale_id, business_id, product_id, product_name, quantity, list_price, unit_price, unit_cost)
        VALUES (v_sale_id, v_biz_id, p_ids[it_prod[i]], p_names[it_prod[i]], it_qty[i],
                it_list[i], it_price[i], p_cost[it_prod[i]]);
      END LOOP;
    END LOOP;
  END LOOP;

  -- expenses: last 3 months of running costs + one equipment purchase
  FOR i IN 0..2 LOOP
    INSERT INTO expenses (business_id, category, description, amount, incurred_on)
    SELECT v_biz_id, x.cat, x.descr, x.amt, x.dt
    FROM (VALUES
      ('rent',      'Shop rent',           45000.00, (date_trunc('month', current_date) - (i || ' months')::interval)::date),
      ('wages',     'Staff salaries',     120000.00, (date_trunc('month', current_date) - (i || ' months')::interval + interval '27 days')::date),
      ('utilities', 'Electricity and water', 10500.00 + i * 450, (date_trunc('month', current_date) - (i || ' months')::interval + interval '9 days')::date),
      ('supplies',  'Packaging and cleaning', 7500.00, (date_trunc('month', current_date) - (i || ' months')::interval + interval '4 days')::date),
      ('marketing', 'Flyers and local ads',    5000.00, (date_trunc('month', current_date) - (i || ' months')::interval + interval '14 days')::date)
    ) AS x(cat, descr, amt, dt)
    WHERE x.dt <= current_date AND x.dt > current_date - 90;
  END LOOP;
  INSERT INTO expenses (business_id, category, description, amount, incurred_on)
  VALUES (v_biz_id, 'equipment', 'Second display fridge', 24000.00, current_date - 40);

  RAISE NOTICE 'Seeded demo business % (user %)', v_biz_id, v_user_id;
END
$seed$;
