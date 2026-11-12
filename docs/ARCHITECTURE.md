# Architecture

## Layers

```
React (Vite)  ──REST/JSON──►  Express API  ──►  PostgreSQL
                                 │   ▲
                                 │   └── analytics engine (SQL aggregates → metrics object)
                                 ├──► LLM  (Claude / OpenAI)   receives METRICS only
                                 └──► PayPal REST (Orders v2, webhook verification)
```

Backend is ES modules on Node 20+. The only external HTTP clients are `fetch` calls to PayPal and the LLM, so the dependency list stays small (`express`, `pg`, `zod`, `bcryptjs`, `jsonwebtoken`, `helmet`, `cors`, `express-rate-limit`, `csv-parse`, `dotenv`).

## The AI pipeline (why it is trustworthy)

```
1 collect      SQL over v_sale_item_facts, products, customers, expenses
2 compute      metrics.js: revenue, profit, margins, trends, days-of-stock   (pure, tested)
3 prompt       LLM sees ONLY this metrics JSON + strict JSON schema + rules
4 guard        guard.js: validate shape, drop unknown product ids, clamp discount to a
               margin-safe cap, REPLACE evidence with server-computed facts
5 approve      recommendation stays "proposed" until the owner approves
6 act          approved → campaign draft (AI copy, editable) → owner launches
7 measure      campaign performance: equal-length window before vs during, from real sales
8 log          every call stored in ai_runs (input metrics, output, provider, fallback flag)
```

If there is no key, the call fails, or the output is invalid, `insights.js` (deterministic rules) returns the same structure and the run is flagged `fallback_used`. The UI states which engine answered.

## PayPal integration

| Concern | Implementation |
|---|---|
| Create order | server computes prices from DB + active campaign, inserts a **pending** sale, then `POST /v2/checkout/orders` with `PayPal-Request-Id` |
| Capture | `POST /v2/checkout/orders/:id/capture`; `ORDER_ALREADY_CAPTURED` falls back to reading the order |
| Finalise | `finalizePayment()`: row locks, amount/currency check, single transition pending → paid, stock decrement |
| Webhook | verify with `/v1/notifications/verify-webhook-signature`, insert event (unique id), then process; failures return non-2xx so PayPal retries |
| Refunds | `PAYMENT.CAPTURE.REFUNDED/REVERSED` set sale = refunded; analytics views exclude it automatically |
| Safety | sandbox by default; `mock` mode only for offline development and refused in production |

## Frontend

Pages: Dashboard (Recharts), AI Advisor, Marketing Studio, Growth Simulator, Products, Sales & Data (manual entry, CSV import, expenses), public Storefront with PayPal Smart Buttons. The token is kept in `localStorage`; the storefront needs no login.

## Known limitations (honest list)

* **No stock reservation**: stock is checked at order creation and decremented at capture; two buyers racing for the last item could both pay (stock is floored at 0, never negative).
* **Marketing is generated, not posted**: copy is produced for the owner to publish; no social/email API integration yet.
* **Campaign attribution** compares equal windows before/during, so weekday and seasonal effects can distort results; the UI says so.
* **No email receipts** to buyers.
* **Single business per user** in the UI (the schema allows several).
