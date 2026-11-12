# Devpost submission kit

Deadline: **12 Nov 2026, 12:00 pm PST** (= 13 Nov 2026, 1:30 am IST). Rules: <https://paypalaihackathon.devpost.com/rules>

## Checklist

- [ ] Public GitHub repo with all source, run instructions and the MIT `LICENSE` (set the license in the repo's *About* section)
- [ ] Deploy (Render blueprint included: `render.yaml`) **or** make sure the README run steps work for judges
- [ ] Real PayPal **Sandbox** credentials configured and one full payment tested (see README)
- [ ] Webhook registered and `PAYPAL_WEBHOOK_ID` set
- [ ] `ANTHROPIC_API_KEY` set so the demo uses the real LLM (the rule engine is only the fallback)
- [ ] Public YouTube video **under 3 minutes**, showing the app working; no copyrighted music or third-party logos
- [ ] English project description (below), list of AI tools used, link to repo and demo

## Project description (paste into Devpost)

**BizPilot AI is an autonomous growth partner for small businesses that have sales data but no analyst.**
A bakery owner knows what they earned, but not *why* celebration-cake sales are falling, which products really make money, or whether last week's promotion paid off. BizPilot closes the loop: **Understand → Decide → Create → Sell → Measure → Improve.**

*What it does.* The owner records or imports sales. BizPilot calculates real metrics in PostgreSQL (revenue, gross and net profit, margins, product trends, stock cover, repeat customers). An AI advisor reads those metrics and proposes concrete, measurable actions, each backed by evidence the server recomputes so the model cannot invent numbers. The owner approves a recommendation and BizPilot drafts a campaign (social post, hashtags, email). When the owner launches it, the discount goes live on a public storefront where customers pay through **PayPal Checkout**. Each verified payment updates stock and the dashboard instantly, and the AI measures the campaign's real before/during impact and recommends the next step. A **Growth Simulator** answers "what if I offer 10% off?" with margin, break-even units and profit scenarios, clearly labelled hypothetical.

*How PayPal is used.* Orders v2 (server-side prices, `PayPal-Request-Id` idempotency, capture), Smart Buttons in the storefront, and signature-verified webhooks (`PAYMENT.CAPTURE.COMPLETED/DENIED/REFUNDED/REVERSED`) with unique-event-id deduplication. Browser capture and webhook can race; payment finalisation is a single locked, idempotent transaction that also validates the captured amount.

*How AI is used.* Claude (Anthropic API; OpenAI also supported) produces structured-JSON recommendations, marketing copy and plain-language simulation explanations. A guard layer validates output, clamps discounts to a margin-safe limit and swaps in server-verified evidence. Every call is logged. A deterministic rule engine keeps the product working with no key.

*Who it is for.* Local shops without a marketing team: bakeries, clothing stores, salons, gift shops.

**Built with:** React, Vite, Recharts, Node.js, Express, PostgreSQL, PayPal REST API + JS SDK (Sandbox), Anthropic Claude API, Docker, Render.

**AI tools used:** Anthropic Claude (analysis, copywriting, explanations at runtime).

## Video script (target 2:40)

| Time | Show | Say |
|---|---|---|
| 0:00 | Dashboard | "Meet a bakery owner. She knows her revenue, but not what to do next. BizPilot AI turns her sales into decisions." |
| 0:20 | Dashboard trends | "Real metrics from her database: custom cakes are down 58 %, bread is growing, cheesecake is nearly out of stock." |
| 0:40 | AI Advisor → Analyse | "The AI only sees computed metrics, and every piece of evidence is re-verified by the server." |
| 1:05 | Approve & create campaign | "She approves; BizPilot drafts the post and email. She edits and launches." |
| 1:25 | Storefront + PayPal | "Customers see the offer and pay with PayPal Checkout, in the Sandbox." |
| 1:50 | Dashboard refreshes | "The verified payment updates stock and the dashboard instantly. Webhooks and capture are idempotent." |
| 2:05 | Growth Simulator | "Before discounting, she simulates: break-even is about 21 % more units. Hypothetical, never guaranteed." |
| 2:25 | Campaign results | "And BizPilot measures what really happened, then recommends the next step. Understand, decide, create, sell, measure, improve." |

## Judging criteria mapping

| Criterion | Where to look |
|---|---|
| Technological implementation | Orders v2 + webhook verification + idempotent finalisation · AI pipeline with guardrails and audit log · 13-table schema with composite FKs |
| Design | complete flow from onboarding to measured results; clean dashboard; human-approval gates |
| Potential impact | local businesses without analysts; measurable outcomes, not just content |
| Innovation | closed feedback loop, simulator, evidence the model cannot fake |
| Presentation | script above |
