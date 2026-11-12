-- =====================================================================
-- BizPilot AI - PostgreSQL schema (migration 001)
--
-- Design rules
--   * All money is NUMERIC(12,2). Never floating point.
--   * Every tenant-owned table carries business_id, and cross-table
--     references use COMPOSITE foreign keys (id, business_id) so a row can
--     never point at another business's product / sale / customer.
--   * sale_items snapshot price, list price, cost and product name, so
--     history and profit never change when a product is edited later.
--   * PayPal ids are UNIQUE and webhook events are stored by event id, which
--     makes payment capture and webhook processing idempotent.
--   * Timestamps are timestamptz (UTC).
-- =====================================================================

BEGIN;

-- ---------- helpers ---------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------- users -----------------------------------------------------
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
  email         TEXT        NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

-- ---------- businesses -------------------------------------------------
CREATE TABLE businesses (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (length(btrim(name)) > 0),
  slug        TEXT        NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category    TEXT        NOT NULL DEFAULT 'other'
              CHECK (category IN ('bakery','clothing','salon','gift_shop','cafe','grocery','electronics','other')),
  currency    CHAR(3)     NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (slug)
);
CREATE INDEX businesses_user_idx ON businesses (user_id);

-- ---------- products ---------------------------------------------------
CREATE TABLE products (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT         NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT           NOT NULL CHECK (length(btrim(name)) > 0),
  sku         TEXT,
  price       NUMERIC(12,2)  NOT NULL CHECK (price >= 0),
  cost        NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (cost >= 0),
  stock       INTEGER        NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 10 CHECK (low_stock_threshold >= 0),
  active      BOOLEAN        NOT NULL DEFAULT TRUE,
  image_url   TEXT,
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)               -- target for composite FKs
);
CREATE UNIQUE INDEX products_business_name_uq ON products (business_id, lower(name));
CREATE UNIQUE INDEX products_business_sku_uq  ON products (business_id, sku) WHERE sku IS NOT NULL;

-- ---------- customers --------------------------------------------------
CREATE TABLE customers (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id   BIGINT      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  email         TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);
CREATE UNIQUE INDEX customers_business_email_uq ON customers (business_id, lower(email)) WHERE email IS NOT NULL;

-- ---------- ai_runs (audit log of every LLM / rule-engine call) ----------
CREATE TABLE ai_runs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id   BIGINT      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL CHECK (kind IN ('analysis','campaign_content','simulation_narrative')),
  provider      TEXT        NOT NULL,                 -- anthropic | openai | rules
  model         TEXT,
  input_metrics JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- what the model was shown (computed numbers only)
  output        JSONB,
  fallback_used BOOLEAN     NOT NULL DEFAULT FALSE,   -- TRUE when the rule engine replaced a failed LLM call
  error         TEXT,
  latency_ms    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, business_id)
);
CREATE INDEX ai_runs_business_idx ON ai_runs (business_id, created_at DESC);

-- ---------- ai_recommendations ------------------------------------------
CREATE TABLE ai_recommendations (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id       BIGINT      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  ai_run_id         BIGINT,
  product_id        BIGINT,
  type              TEXT        NOT NULL
                    CHECK (type IN ('promote_product','fix_declining','restock','price_adjust','retain_customers','cut_cost','other')),
  priority          SMALLINT    NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),   -- 1 = highest
  title             TEXT        NOT NULL,
  problem           TEXT        NOT NULL,
  evidence          JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- list of {label, value} drawn from real metrics
  action            TEXT        NOT NULL,
  target_audience   TEXT,
  expected_cost     NUMERIC(12,2) CHECK (expected_cost IS NULL OR expected_cost >= 0),
  success_metric    TEXT        NOT NULL,
  suggested_discount_pct NUMERIC(5,2) CHECK (suggested_discount_pct IS NULL OR suggested_discount_pct BETWEEN 0 AND 90),
  status            TEXT        NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed','approved','rejected','completed')),
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, business_id),
  FOREIGN KEY (product_id, business_id) REFERENCES products (id, business_id) ON DELETE SET NULL (product_id),
  FOREIGN KEY (ai_run_id,  business_id) REFERENCES ai_runs  (id, business_id) ON DELETE SET NULL (ai_run_id)
);
CREATE INDEX ai_recs_business_status_idx ON ai_recommendations (business_id, status, created_at DESC);

-- ---------- campaigns ----------------------------------------------------
CREATE TABLE campaigns (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id       BIGINT      NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  recommendation_id BIGINT,
  product_id        BIGINT,
  title             TEXT        NOT NULL,
  caption           TEXT,
  hashtags          TEXT[]      NOT NULL DEFAULT '{}',
  email_subject     TEXT,
  email_body        TEXT,
  discount_pct      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 90),
  status            TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','active','ended','cancelled')),
  generated_by_ai   BOOLEAN     NOT NULL DEFAULT FALSE,
  starts_at         TIMESTAMPTZ,
  ends_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, business_id),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  FOREIGN KEY (product_id,        business_id) REFERENCES products (id, business_id) ON DELETE SET NULL (product_id),
  FOREIGN KEY (recommendation_id, business_id) REFERENCES ai_recommendations (id, business_id) ON DELETE SET NULL (recommendation_id)
);
CREATE INDEX campaigns_business_status_idx ON campaigns (business_id, status);

-- ---------- sales ----------------------------------------------------------
CREATE TABLE sales (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id    BIGINT        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id    BIGINT,
  campaign_id    BIGINT,
  subtotal       NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),         -- at list price
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  total          NUMERIC(12,2) NOT NULL CHECK (total >= 0),            -- what the customer pays
  currency       CHAR(3)       NOT NULL DEFAULT 'USD',
  status         TEXT          NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','paid','failed','refunded','cancelled')),
  source         TEXT          NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('manual','csv','paypal')),
  sold_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (id, business_id),
  CONSTRAINT sales_total_consistent CHECK (total = subtotal - discount_total),
  FOREIGN KEY (customer_id, business_id) REFERENCES customers (id, business_id) ON DELETE SET NULL (customer_id),
  FOREIGN KEY (campaign_id, business_id) REFERENCES campaigns (id, business_id) ON DELETE SET NULL (campaign_id)
);
CREATE INDEX sales_business_sold_idx   ON sales (business_id, sold_at DESC);
CREATE INDEX sales_business_status_idx ON sales (business_id, status, sold_at DESC);
CREATE INDEX sales_campaign_idx        ON sales (campaign_id) WHERE campaign_id IS NOT NULL;

-- ---------- sale_items -----------------------------------------------------
CREATE TABLE sale_items (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id      BIGINT        NOT NULL,
  business_id  BIGINT        NOT NULL,
  product_id   BIGINT        NOT NULL,
  product_name TEXT          NOT NULL,                       -- snapshot
  quantity     INTEGER       NOT NULL CHECK (quantity > 0),
  list_price   NUMERIC(12,2) NOT NULL CHECK (list_price >= 0),   -- snapshot of products.price
  unit_price   NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),   -- price actually charged
  unit_cost    NUMERIC(12,2) NOT NULL CHECK (unit_cost >= 0),    -- snapshot of products.cost
  CHECK (unit_price <= list_price),
  FOREIGN KEY (sale_id,    business_id) REFERENCES sales    (id, business_id) ON DELETE CASCADE,
  FOREIGN KEY (product_id, business_id) REFERENCES products (id, business_id) ON DELETE RESTRICT
);
CREATE INDEX sale_items_sale_idx    ON sale_items (sale_id);
CREATE INDEX sale_items_product_idx ON sale_items (business_id, product_id);

-- ---------- payments (PayPal) ----------------------------------------------
CREATE TABLE payments (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id       BIGINT        NOT NULL,
  sale_id           BIGINT        NOT NULL,
  provider          TEXT          NOT NULL DEFAULT 'paypal',
  paypal_order_id   TEXT          NOT NULL,
  paypal_capture_id TEXT,
  status            TEXT          NOT NULL DEFAULT 'created'
                    CHECK (status IN ('created','approved','completed','failed','refunded')),
  amount            NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency          CHAR(3)       NOT NULL,
  payer_email       TEXT,
  payer_name        TEXT,
  raw_response      JSONB,
  captured_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  FOREIGN KEY (sale_id, business_id) REFERENCES sales (id, business_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX payments_order_uq   ON payments (paypal_order_id);
CREATE UNIQUE INDEX payments_capture_uq ON payments (paypal_capture_id) WHERE paypal_capture_id IS NOT NULL;
CREATE UNIQUE INDEX payments_one_per_sale_uq ON payments (sale_id);
CREATE INDEX payments_business_idx ON payments (business_id, created_at DESC);

-- ---------- paypal_webhook_events (idempotency + audit) ----------------------
CREATE TABLE paypal_webhook_events (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id         TEXT        NOT NULL,          -- PayPal's WH-... id
  event_type       TEXT        NOT NULL,
  resource_id      TEXT,
  signature_valid  BOOLEAN     NOT NULL,
  payload          JSONB       NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at     TIMESTAMPTZ,
  processing_error TEXT
);
CREATE UNIQUE INDEX paypal_webhook_event_uq ON paypal_webhook_events (event_id);

-- ---------- expenses -------------------------------------------------------
CREATE TABLE expenses (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id BIGINT        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category    TEXT          NOT NULL
              CHECK (category IN ('rent','wages','utilities','marketing','equipment','supplies','other')),
  description TEXT,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  incurred_on DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX expenses_business_date_idx ON expenses (business_id, incurred_on DESC);

-- ---------- simulations (what-if growth simulator) --------------------------
CREATE TABLE simulations (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id      BIGINT        NOT NULL,
  product_id       BIGINT        NOT NULL,
  discount_pct     NUMERIC(5,2)  NOT NULL CHECK (discount_pct BETWEEN 0 AND 90),
  window_days      INTEGER       NOT NULL CHECK (window_days BETWEEN 7 AND 365),
  baseline_units   INTEGER       NOT NULL CHECK (baseline_units >= 0),
  baseline_profit  NUMERIC(12,2) NOT NULL,
  break_even_units INTEGER,                                    -- NULL = discount makes margin <= 0
  scenarios        JSONB         NOT NULL,
  narrative        TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  FOREIGN KEY (product_id, business_id) REFERENCES products (id, business_id) ON DELETE CASCADE
);
CREATE INDEX simulations_business_idx ON simulations (business_id, created_at DESC);

-- ---------- updated_at triggers ---------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','businesses','products','ai_recommendations','campaigns','sales','payments']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   t || '_set_updated_at', t);
  END LOOP;
END $$;

-- ---------- analytics views --------------------------------------------------
-- One row per sold line on PAID sales. Everything in the dashboard derives from this.
CREATE VIEW v_sale_item_facts AS
SELECT
  si.business_id,
  s.id                                   AS sale_id,
  s.sold_at,
  s.campaign_id,
  s.customer_id,
  s.source,
  si.product_id,
  si.product_name,
  si.quantity,
  si.quantity * si.unit_price            AS revenue,
  si.quantity * si.unit_cost             AS cost,
  si.quantity * (si.unit_price - si.unit_cost) AS gross_profit
FROM sale_items si
JOIN sales s ON s.id = si.sale_id AND s.business_id = si.business_id
WHERE s.status = 'paid';

CREATE VIEW v_daily_metrics AS
SELECT
  business_id,
  (sold_at AT TIME ZONE 'UTC')::date     AS day,
  count(DISTINCT sale_id)                AS orders,
  sum(quantity)                          AS units,
  sum(revenue)                           AS revenue,
  sum(gross_profit)                      AS gross_profit
FROM v_sale_item_facts
GROUP BY business_id, (sold_at AT TIME ZONE 'UTC')::date;

COMMIT;
