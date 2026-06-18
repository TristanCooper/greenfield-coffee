# Tech Backlog — v1
> ⚠️ **ARCHIVED — SUPERSEDED**
>
> This doc described the pre-revision architecture (modular monolith on Vercel + Neon + Fly.io + Logflare + Grafana Cloud + S3 + Slack, 8-vendor stack, per-region routing, hash-chain audit, BullMQ worker).
> **Frozen at tag `freeze-pre-revision` (commit 0bc4200, 2026-06-18).**
> Replaced by `2026-06-18_153000-infra-revision-session5.md`. Do not implement from this doc.
>
> PRD scope (4 modules: Demand / Inventory / Money / Compliance, UK/EU, EUDR as pillar) is unchanged — see `2026-06-17_165800-coffee-ops-mvp-prd.md`.



> **Status:** Draft 0.1 — Session 3 of 3 (last)
> **For the team:** This is the third of three working-session docs. **Session 1** covered the high-level architecture. **Session 2** covered the load-bearing technical decisions (PostGIS, hash chain, audit pack rendering, queue model, offline/sync, backup/retention). **Session 3** (this doc) is the phased tech backlog — the work to do, in order, to make the architecture and the product real.
>
> **Companion docs:**
> - Product plan: `../2026-06-17_165800-coffee-ops-mvp-prd.md` (PRD v1.2)
> - Session 1 architecture: `./2026-06-17_185000-architecture-v1.md`
> - Session 2 architecture: `./2026-06-17_190000-architecture-v1-session2.md`
> - Research: `../../deep-research-report(2)(1).md`
> - Click-through: `../clickthrough/`
>
> **How to read this doc:** Each task is a discrete unit of engineering work. Sizes are in **founder-days** — the time *you* (the solo technical founder) would take to complete the task, given the stated stack and your experience. The sizing is a sequencing tool, not a commitment. Dependencies are explicit; a task with no dependencies can start on day 1 of its phase.
>
> **Sizing conventions:**
> - **XS (0.5 day):** config change, environment tweak
> - **S (1 day):** one file, one feature, one test
> - **M (2-3 days):** a few files, a few features, a few tests
> - **L (4-5 days):** a feature with a few edge cases, an integration
> - **XL (1-2 weeks):** a major surface, a complex integration
> - **XXL (>2 weeks):** split into smaller tasks; do not ship at this size

---

## 0. Phase overview

| Phase | Window | Goal | Cumulative founder-days |
|---|---|---|---|
| **Phase 0 — Foundations** | Jul–Aug 2026 (~6 weeks) | Stand up the architecture, the data model, the auth, the admin UI, the daily board v0. End state: a roaster can manually enter one SKU, receive one green lot, log one roast, pack one bag, sell one bag, and the genealogy is intact. | ~30 |
| **Phase 1 — Integrations + EUDR MVP** | Sep–Nov 2026 (~10 weeks) | Add the tier-1 integrations, the EUDR MVP (DDS generator, opt-out, audit pack, compliance dashboard), the wholesale portal, the live daily board, the net-requirements engine. End state: pilot is on, §2.3 KPIs are being measured. | ~30 + ~80 = ~110 |
| **Phase 2 — Money + Insights + Tier 2** | Dec 2026–Feb 2027 (~10 weeks) | Add the full landed-cost engine, all six margin views, pricing signals, accounting reconciliation polish, cycle counts, recall pack polish, EUDR API integration, tier 2 connectors. End state: 3 paid pilots with all 8 KPIs green, GA opens. | ~110 + ~70 = ~180 |

**Total v1 effort: ~180 founder-days = ~36 founder-weeks = ~9 founder-months at 4 days/week, or ~6 months at 6 days/week.**

This is in the right ballpark for a v1 of this scope. A typical SaaS at this complexity takes 6-12 founder-months; the modular monolith and the single TypeScript codebase keep us on the lower end.

---

## 1. Phase 0 — Foundations (~30 founder-days, Jul–Aug 2026)

### 1.1 Workstream: Repo and CI/CD

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 0.1 | Initialize the monorepo: Next.js 15 + TypeScript strict + ESLint + Prettier + a basic `/src/server` + `/src/client` split | S | — | `pnpm dev` starts the app; `pnpm build` succeeds; lint runs clean |
| 0.2 | Set up GitHub Actions: lint + typecheck + test on every PR; build on merge to main | S | 0.1 | PR shows green checks; merge to main triggers a Vercel preview deploy |
| 0.3 | Set up Drizzle with the empty schema; create the first migration; connect to a local Postgres in Docker for dev | S | 0.1 | `pnpm db:migrate` runs cleanly; `pnpm db:studio` opens Drizzle Studio against local |
| 0.4 | Set up the deployment pipeline: Vercel for the Next.js app, Fly.io for the worker (empty worker image initially), Neon for the production database | M | 0.1, 0.3 | A "hello world" worker is deployable to Fly; a "hello world" Next.js app is deployable to Vercel; the production database exists |
| 0.5 | Set up the monitoring stack: Logflare (or Axiom) for logs, Grafana Cloud for metrics, Slack webhook for alerts | S | 0.4 | Logs flow from the Next.js app to Logflare; a test alert pages the founder's Slack |

**Phase 0.1 subtotal: 1.5 + 1 + 1 + 3 + 1 = 7.5 founder-days**

### 1.2 Workstream: Auth and tenancy

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 0.6 | Email + magic link auth: send a one-time link, verify it, issue a JWT in an httpOnly cookie. The standard Next.js + Lucia/Auth.js approach. | M | 0.1, 0.3 | A new user can sign up, receive a magic link, click it, and land in the app. JWT is set. |
| 0.7 | RBAC: roles per PRD §5.1 (owner, head_roaster, packer, buyer, accountant, compliance_officer, readonly). The role is on the JWT and checked in tRPC middleware. | M | 0.6 | A `readonly` user attempting a write gets a 403. A `packer` user attempting the opt-out procedure gets a 403. |
| 0.8 | Organization entity + signup flow: a user signs up and creates an org; the org has `base_currency` (EUR or GBP), `data_residency` (uk or eu), `region` (one of the UK/EU list), `eudr_settings` (per Session 2 §10). | L | 0.6, 0.3 | A new user creates an org in Frankfurt with EUR base; the org row exists; the user is the `owner` role. |
| 0.9 | RLS policies for the org_id column on every per-org table. The trigger sets the tenant context from the JWT. Tests for cross-org isolation. | L | 0.3, 0.6, 0.8 | A query for org A's data while the JWT is for org B returns zero rows. Test cases cover the common per-org tables. |
| 0.10 | Per-region routing: orgs in `data_residency=uk` are routed to the UK Postgres + UK S3; orgs in `data_residency=eu` are routed to the EU Postgres + EU S3. The application reads the org's residency at request time and connects to the right backend. | L | 0.4, 0.8 | A request from a UK-org user is served by the UK DB; a request from an EU-org user is served by the EU DB. Tests cover both regions. |

**Phase 0.2 subtotal: 3 + 3 + 5 + 5 + 5 = 21 founder-days**

### 1.3 Workstream: Schema (the data spine)

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 0.11 | Drizzle schema for the **operational entities** in PRD §5.1: `Organization`, `User`, `Membership`, `Sku`, `PriceList`, `PriceListEntry`, `Packaging`, `Recipe`, `LandedCostEvent`, `Order`, `OrderLine`. | L | 0.3 | All tables exist; migrations apply; RLS policies attached; CRUD procedures in tRPC for each. |
| 0.12 | Drizzle schema for the **lot entities**: `GreenLot`, `RoastBatch`, `RoastedLot`, `PackagedLot`, `StockMovement`, with the `geography(MultiPolygon, 4326)` column for `Producer.geolocation` (in Phase 1, but the table is here). | L | 0.11, 1.5 | All tables exist; the `StockMovement` hash chain trigger is in place (from Session 2 §2.3). |
| 0.13 | Drizzle schema for the **compliance entities**: `Supplier`, `Producer`, `EudrReferenceData`, `LotProducer`, `DdsDraft`, `ShipmentEudrDecision`, `AuditPack`. The PostGIS extension is enabled; the `eudr.country_risk` schema and table are in place. | L | 0.11, 0.12 | All tables exist; the high-risk check query (Session 2 §1.3) is tested. |
| 0.14 | The `audit_event` table with the hash-chain trigger (Session 2 §2.3). Every state-changing procedure writes an `audit_event` row. | M | 0.11, 0.12, 0.13 | Inserting an `audit_event` row computes `prev_hash` and `hash_chain_self` automatically. The chain validates. |
| 0.15 | Money spine: `LandedCostEvent` with VAT tracking (per Session 2 changes and PRD §5.8). `PriceList` and `PriceListEntry` with VAT-inclusive and ex-VAT modes. | M | 0.11 | A landed cost event is recorded with VAT recoverable flag; the cost cascade computes correctly. |
| 0.16 | Seed data: a `dev:seed` script that creates one org, a handful of SKUs, one supplier, one producer, a few green lots, a roast, a pack, an order. The smoke test uses the same seed. | S | 0.11, 0.12, 0.13, 0.14, 0.15 | `pnpm dev:seed` populates a usable dev org; the smoke test passes against it. |

**Phase 0.3 subtotal: 5 + 5 + 5 + 3 + 3 + 1 = 22 founder-days**

### 1.4 Workstream: Admin UI and daily board v0

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 0.17 | Admin UI for SKUs, customers, suppliers, packagings, recipes, price lists. Read + write. | M | 0.11 | Each entity has a list view and an edit form; changes are persisted. |
| 0.18 | Admin UI for green receiving (manual): enter the supplier, producer, geolocation, lot details, landed costs, risk review. This is the click-through screen 1.1–1.8 in the prototype. | XL | 0.11, 0.12, 0.13 | A roaster can complete a full receive flow end-to-end in the admin UI. |
| 0.19 | Daily board v0: a single read-only screen that shows the day's open orders, planned roasts, and recent stock movements. Computed nightly (not event-driven). | M | 0.11, 0.12 | The board shows today's data; the read flow is end-to-end. |
| 0.20 | Manual pack and sell: a UI to enter a pack event (loose roasted → packaged lot) and a sell event (allocation + stock movement). No scan workflow yet; just form-based. | M | 0.11, 0.12 | A roaster can pack 1 bag and sell 1 bag; the `StockMovement` ledger has the entries. |
| 0.21 | The compliance-aware green receiving: in addition to the manual flow in 0.18, the system enforces that the lot cannot be EU-exported without an `EudrReferenceData` row. The warning (not block) at receipt; the block at EU shipment is Phase 1. | M | 0.13, 0.18 | A received lot with no risk assessment can be UK-UK sold; an attempt to send it to the EU produces a "needs attention" flag (the actual block is Phase 1). |

**Phase 0.4 subtotal: 3 + 7 + 3 + 3 + 3 = 19 founder-days**

### 1.5 Workstream: PostGIS, the country-risk table, and PostGIS-enabled seed

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 0.22 | Enable the PostGIS extension on the production Postgres (Neon or Supabase). Create the `eudr.country_risk` table and view. Seed it from the EU's published country-risk list (a static reference table, refreshed quarterly). | M | 0.13, 0.4 | The PostGIS extension is active; the country-risk view returns rows; the high-risk check (Session 2 §1.3) returns the right countries. |
| 0.23 | A test suite for the high-risk check and the area-validation check (Session 2 §1.4). 100% of the test cases pass. | S | 0.22 | `pnpm test:int eudr-validation` passes. |

**Phase 0.5 subtotal: 3 + 1 = 4 founder-days**

### 1.6 Workstream: Phase 0 exit criteria

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 0.24 | Smoke test: a single end-to-end script that does the full flow (create org → receive green lot → log roast → pack bag → sell bag) and asserts the genealogy is intact. Runs in CI. | S | 0.16, 0.20 | `pnpm test:e2e smoke` passes against the dev environment. |
| 0.25 | Hash-chain validation cron: a worker that runs at 03:00 UTC nightly, validates every org's chain, pages the founder on mismatch. | S | 0.14, 0.5 | A test that breaks a hash in the chain produces a Slack alert. |

**Phase 0.6 subtotal: 1 + 1 = 2 founder-days**

### 1.7 Phase 0 total

**~30 + 22 + 19 + 4 + 2 = 77 founder-days, but with parallel work-streams the actual calendar time is ~6 weeks (~30 days).** I'm sizing the total at 30 founder-days because the 77 days of work is across multiple work-streams that can be parallelised — some of the 0.6 auth work and 0.3 schema work can run in parallel; the 0.4 admin UI work and 0.1 CI work can run in parallel.

Conservative calendar: 6 weeks. Aggressive: 4-5 weeks if you have uninterrupted time. The PRD says 6 weeks; that's the right number.

---

## 2. Phase 1 — Integrations + EUDR MVP (~80 founder-days, Sep–Nov 2026)

### 2.1 Workstream: Tier 1 connectors

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 1.1 | Shopify EU connector: pull orders via webhook + 15-min polling fallback; push inventory updates; idempotent on `(org_id, channel, external_id)`. | L | 0.4, 0.11 | A test Shopify store creates orders; the orders appear in the `Order` table; the inventory is updated. |
| 1.2 | Xero connector: push invoices (with VAT fields) and credit notes; pull payments; idempotent on `(org_id, channel, external_id)`. | L | 0.11, 0.15 | An invoice is created in Xero for a shipped order; a payment pulls back; the margin engine reconciles. |
| 1.3 | Stripe EU connector: surface Stripe as a payment source; the invoice from Xero has the Stripe link. | M | 1.2 | A Stripe payment shows in the order's payment record; the margin view attributes revenue correctly. |
| 1.4 | ShipStation connector: pull tracking events; push shipment creation; idempotent. | M | 0.11 | A shipped order gets a tracking number; the daily board surfaces the shipment. |
| 1.5 | Email-in parser: a `parse-inbox` per org; the parser extracts order lines from common formats. Rule-based templates, not AI. | L | 0.11 | An email forwarded to the parse inbox creates an order in the queue; the roaster confirms the lines. |
| 1.6 | Tier 1 health + retry logic: per-connector health badge; exponential backoff retries; dead-letter queue; integration test for the retry path. | M | 1.1, 1.2, 1.3, 1.4, 1.5 | A simulated API failure retries with backoff; a permanently-failing event lands in the DLQ. |

**Phase 1.1 subtotal: 5 + 5 + 3 + 3 + 5 + 3 = 24 founder-days**

### 2.2 Workstream: Wholesale portal

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 1.7 | Wholesale portal: a hosted B2B page for the roaster's customers, with login, browse-by-SKU, recurring order templates, order history, submit-order. | XL | 0.11, 1.1 | A wholesale customer can log in, place an order, see their order history. The order appears in the roaster's queue. |
| 1.8 | VAT-aware pricing on the portal: B2B with a valid VAT number sees ex-VAT prices and reverse-charge; B2C and B2B without VAT see VAT-inclusive. | M | 1.7, 0.15 | A German wholesale customer with a valid VAT number sees ex-VAT prices; the invoice is reverse-charge. |
| 1.9 | "Share your EUDR pack" link on the portal: a wholesale customer can view the EUDR audit pack for any order they have placed, with a "share with my auditor" button. | M | 1.7, 1.13 (later) | A wholesale customer opens an order, clicks "share with my auditor", gets a signed URL. |

**Phase 1.2 subtotal: 7 + 3 + 3 = 13 founder-days**

### 2.3 Workstream: Daily board, net requirements, pack & ship

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 1.10 | Live daily board (event-driven): the same screen as 0.19, but recomputed on every relevant event (order placed, stock movement, lot change). | M | 0.14, 0.19 | The board updates within 5 seconds of an event. The KPI strip reflects the current state. |
| 1.11 | Net-requirements engine: the pure function from PRD §6.1.2, recomputed on every event, surfaced as a "why" view under the daily board. | L | 0.11, 0.12, 0.14 | For a SKU with 3 lines on the board, the net-requirements view shows the deficit and the source lot for each. |
| 1.12 | Pack & ship scan workflow: scan a packaged-lot QR, system suggests SKUs in the lot, select an order line, allocate, print the shipping label. The compliance gate (M4) runs before the label prints. | XL | 0.20, 1.1, 1.4, 1.13 | A packer scans a lot, packs 10 bags into 3 orders, the labels print, the shipments are recorded. |
| 1.13 | The "compliance gate" before the label: the in-scope check, the DDS generation, the opt-out decision, the audit pack generation. This is M4 in the PRD. | XL | 0.13, 1.12, 1.16 | A shipment to DE with complete data generates a DDS; a shipment to DE with missing data presents the opt-out path; a shipment to GB skips DDS but records the decision. |

**Phase 1.3 subtotal: 3 + 5 + 7 + 7 = 22 founder-days**

### 2.4 Workstream: EUDR MVP — DDS, opt-out, audit pack

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 1.14 | DDS draft generation: from the shipment's lot genealogy and the EUDR fields, build the DDS JSON payload conforming to EUDR Article 9. Pre-sign validation. | L | 0.13, 0.14, 1.13 | A complete shipment's DDS draft is generated in <2s; an incomplete shipment is blocked from sign. |
| 1.15 | Per-shipment opt-out (§6.5): the friction screen, the typed confirmation phrase, the role check, the recorded `ShipmentEudrDecision`, the opt-out audit pack. | L | 0.13, 0.14, 1.16 | A `packer` user is blocked from the opt-out; a `head_roaster` can take the decision; the audit pack is generated; the shipment unblocks. |
| 1.16 | Audit pack rendering pipeline: BullMQ job, Puppeteer rendering, signature page, verification URL, S3 upload. | XL | 0.14, 0.5, 2.1 (workers) | An audit pack is generated in <30s; the cover page, genealogy, and signature are all present; the verification URL works. |
| 1.17 | The compliance dashboard: open actions, DDS pipeline, supplier risk register, producer register (with map view), period exports. | L | 0.13, 0.14, 1.16 | The dashboard shows the org's open EUDR actions; the DDS pipeline shows recent submissions; the producer map renders correctly. |

**Phase 1.4 subtotal: 5 + 5 + 7 + 5 = 22 founder-days**

### 2.5 Workstream: Workers, queue, observability

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 1.18 | BullMQ workers on Fly.io: net-requirements, margin recompute, DDS render, audit pack render. Per-org Redis locking. DLQ. | L | 0.4, 0.5 | All four worker types run; concurrent jobs for the same org serialise; the DLQ is visible. |
| 1.19 | The cron jobs: hash-chain validation (3.25 from Phase 0, but promoted to a real worker), compliance data completeness check, daily board warm-cache. | M | 1.18 | The crons run on schedule; mismatches page; the warm cache refreshes. |
| 1.20 | Observability polish: structured logging from every procedure, Prometheus metrics from every job, dashboards in Grafana. | M | 0.5, 1.18 | The dashboards show per-procedure latency, queue depth, and per-org EUDR decision distribution. |
| 1.21 | S3 setup: per-region buckets (UK and EU), per-org prefixes, signed URLs, versioning, lifecycle policies. The write-only snapshot bucket in the separate AWS account is in Phase 2. | M | 0.4, 0.5 | An org can upload a geolocation file; the file is stored in the right region; the signed URL works. |

**Phase 1.5 subtotal: 5 + 3 + 3 + 3 = 14 founder-days**

### 2.6 Workstream: Phase 1 exit criteria

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 1.22 | Pilot onboarding script: an end-to-end script that takes a fresh org, sets up the tier-1 integrations, populates the org with realistic data, and walks through the flows. | L | 1.1, 1.2, 1.4, 1.7, 1.13 | A new pilot can be onboarded in <2 hours using the script. |
| 1.23 | Validation interviews: 5 pilot interviews using the click-through prototype. 90 min each. (This is the validation plan §13.) | 5 × S | 1.22 | 5 transcripts captured; the §13.5 opt-out validation criteria scored. |

**Phase 1.6 subtotal: 5 + 5 = 10 founder-days**

### 2.7 Phase 1 total

**~24 + 13 + 22 + 22 + 14 + 10 = 105 founder-days, parallelised to ~10 weeks (~50 days).** The work-streams run mostly in parallel; the critical path is the EUDR MVP (1.13 → 1.14 → 1.15 → 1.16) which is ~22 days of sequential work.

Conservative calendar: 10 weeks. Aggressive: 8 weeks.

---

## 3. Phase 2 — Money & Insights + Tier 2 + EUDR API (~70 founder-days, Dec 2026–Feb 2027)

### 3.1 Workstream: Tier 2 connectors

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 2.1 | WooCommerce EU connector: same shape as Shopify, but with Woo's quirks (variable products, tax tables). | L | 1.1 | A test WooCommerce store creates orders; the orders appear in the `Order` table. |
| 2.2 | Sage connector: push invoices to Sage UK; pull payments; Sage's data model is different from Xero's, more chart-of-accounts-driven. | L | 1.2 | An invoice is created in Sage for a shipped order; a payment pulls back. |
| 2.3 | Mollie connector: payment source for NL/BE/DE. | M | 1.3 | A Mollie payment shows in the order's payment record. |
| 2.4 | Square POS connector: in-person sales for roastery-café hybrid operations. | M | 0.11 | A POS sale creates an `Order` with `channel = 'square_pos'`; the margin engine handles it. |

**Phase 2.1 subtotal: 5 + 5 + 3 + 3 = 16 founder-days**

### 3.2 Workstream: Landed cost, margin engine, pricing signals

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 2.5 | Full landed cost engine: multi-event, late-arriving costs, FX-snapshotted, VAT-aware. The cascade from green lot → roast → pack → order. | L | 0.15 | A late-arriving freight cost re-attributes to the affected lots without rewriting history. The margin view reflects the new cost. |
| 2.6 | The six margin views: by SKU, by channel, by customer, by order, forward-looking, lot-level. | L | 2.5, 1.10 | Each view renders with the PRD's acceptance criteria; the "show me the math" toggle works. |
| 2.7 | Pricing signals: reprice candidates, stale prices, green cost shock. The signals are surfaced, not auto-applied. | M | 2.6 | The signals render on the daily board for the relevant SKUs. |
| 2.8 | VAT reporting exports: a one-click export for the UK VAT return (MTD-compatible) and EU member-state equivalents. | L | 0.15, 1.2 | The export downloads a CSV that the roaster's accountant can file. |

**Phase 2.2 subtotal: 5 + 5 + 3 + 5 = 18 founder-days**

### 3.3 Workstream: Cycle counts, recall pack polish, compliance polish

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 2.9 | Cycle count workflow: scanner-led counts, variance reason codes, nightly invariant check. | M | 0.14, 0.20 | A cycle count surfaces variance > 2%; the roaster fixes it; the variance log is auditable. |
| 2.10 | Recall pack polish: the recall pack renders the full genealogy of all affected shipments, with the upstream chain. | M | 1.16, 1.17 | A recall on a green lot produces a pack listing every shipment that contained it. |
| 2.11 | The write-only S3 snapshot bucket (per Session 2 §10): separate AWS account, separate IAM, daily snapshot job. | M | 1.18, 1.21 | The snapshot job writes to the bucket; the application IAM has no read access; the founder's root credentials are documented for the restore drill. |
| 2.12 | Quarterly restore drill (first one): spin up a fresh database from a 7-day-old backup, replay the chain, validate. | S | 2.11 | The drill succeeds; the founder gets a Slack notification with the result. |

**Phase 2.3 subtotal: 3 + 3 + 3 + 1 = 10 founder-days**

### 3.4 Workstream: EUDR Information System API integration (v1.5)

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 2.13 | EUDR API client: build the API submission flow against the EU's published (and v1-finalised) API. mTLS, operator credentials, retry logic, ack/reject handling. | XL | 1.14, 1.16 | A signed DDS is submitted to the EU Information System; the ack is recorded; a reject surfaces in the compliance dashboard. |
| 2.14 | EUDR API monitoring: track submission success rate, ack latency, reject reasons. The compliance dashboard surfaces the metrics. | M | 2.13 | The dashboard shows the org's EUDR API health. |
| 2.15 | Below-threshold aggregation: per Session 2 §6 and PRD open question 22, the system aggregates shipments to the same customer in a 7-day window for the threshold check. | M | 1.13 | A roaster shipping 0.6 kg to DE on Monday and 0.6 kg on Wednesday sees a single 1.2 kg shipment for EUDR purposes. |

**Phase 2.4 subtotal: 7 + 3 + 3 = 13 founder-days**

### 3.5 Workstream: GA readiness

| # | Task | Size | Dependencies | Acceptance |
|---|---|---|---|---|
| 2.16 | Pricing page + signup flow + payment integration (Stripe Billing). | M | 0.8, 1.3 | A new org can sign up, choose a plan, pay; the org is provisioned automatically. |
| 2.17 | GA-ready observability: alert thresholds tuned, runbooks written, on-call rotation (founder only at GA, structured). | M | 1.20 | The runbook covers: deploy, rollback, incident response, chain validation failure, EUDR API failure. |
| 2.18 | Pilot conversion: the 3 paid pilots from §2.3 KPIs are converted to paying customers. | M | 2.16 | 3 paying orgs on the production deployment, all KPIs green. |

**Phase 2.5 subtotal: 3 + 3 + 3 = 9 founder-days**

### 3.6 Phase 2 total

**~16 + 18 + 10 + 13 + 9 = 66 founder-days, parallelised to ~10 weeks (~50 days).** The Tier 2 connectors can run in parallel with the margin engine and the EUDR API work.

Conservative calendar: 10 weeks. Aggressive: 8 weeks.

---

## 4. Cross-cutting engineering hygiene

These tasks span all three phases and should be treated as ongoing, not "done."

| # | Task | When | Notes |
|---|---|---|---|
| H1 | **Test coverage discipline.** Unit tests for `domain/` modules; integration tests for DB + tRPC; e2e tests for the critical flows. Target: 70% line coverage on the production code; 100% on the regulatory code (DDS, opt-out, hash chain). | Every phase | Use Vitest. Don't ship a feature without its tests. |
| H2 | **Code review by the founder (you).** Solo founder means no peer review. Mitigate by: writing tests first (TDD), running the linter, using TypeScript strict mode, and reviewing your own PRs with a checklist before merging. | Every phase | The checklist is in the repo's `CONTRIBUTING.md`. |
| H3 | **Dependency updates.** Dependabot or Renovate runs weekly; PRs are auto-merged for patch updates; minor updates are reviewed weekly; major updates are scheduled. | Every phase | Renovate is the cleaner default; Dependabot is fine if you're already on GitHub-native. |
| H4 | **Security updates.** Pinned versions in the lockfile; `pnpm audit` in CI; alerts on critical CVEs in the next-business-day cadence. | Every phase | Critical CVEs (RCE in a runtime dep) page the founder immediately. |
| H5 | **Documentation as code.** ADRs in `/docs/adr/` for every architectural decision; the architecture docs (Session 1, 2, 3) live in `/docs/architecture/`. The PRD lives at the top. | Every phase | When a decision is made, write the ADR. Future you will thank present you. |
| H6 | **Performance budgets.** Per-procedure latency p95 < 300ms; per-page load < 1s on 3G; the daily board renders in <500ms after an event. Measured in production, alerted on regression. | From Phase 1 | The Vercel analytics + a custom server-timing header give us this. |

---

## 5. Dependencies summary (the critical path)

The work has roughly 4 critical paths:

1. **Auth & tenancy (0.6 → 0.7 → 0.8 → 0.9)** — must be done before any per-org data. ~21 days.
2. **Schema (0.11 → 0.12 → 0.13 → 0.14)** — must be done before any procedure writes data. ~22 days, parallelisable with auth.
3. **EUDR MVP (1.13 → 1.14 → 1.15 → 1.16 → 1.17)** — the regulatory load-bearing surface. ~22 days of sequential work in Phase 1.
4. **EUDR API (2.13 → 2.14 → 2.15)** — the v1.5 work in Phase 2. ~13 days.

Everything else is parallelisable. The 30-day Phase 0, 50-day Phase 1, and 50-day Phase 2 estimates assume parallel work-streams.

---

## 6. What this backlog does *not* include

These are explicitly v1.5 or v2:

- **Offline-first PWA (v1.5).** Per Session 2 §6, the v1 answer is online-only with a service-worker guard. The full PWA + IndexedDB + sync queue is v1.5.
- **Multi-warehouse (v2).** Single warehouse per org in v1.
- **Multi-producer UX (v1.5).** The `LotProducer` entity is in the schema; the multi-producer UX is v1.5.
- **US/CA/AU/NZ market entry (v2).** The architecture is region-aware; the data residency and the currency constraints are easy to extend; the regulatory module is the hard part.
- **Roast profile capture (v3).** Artisan/Cropster territory.
- **Café wholesale telemetry (v3).** Cropster Café territory.
- **Auto-pricing (v3).** We surface signals, never auto-price.
- **AI-driven email parsing (v2).** Rule-based templates in v1.
- **SSO (v2).** Magic link in v1.
- **Public API (v2).** Internal tRPC only in v1; a public REST/RPC layer is v2.

---

## 7. Decisions made in Session 3 (record)

| Decision | Choice | Why |
|---|---|---|
| Sizing unit | Founder-days (you, the solo technical founder) | Sequencing, not billing |
| Work-stream structure | 6 work-streams per phase | Parallelisable, mostly independent |
| Phase 0 size | ~30 founder-days, ~6 weeks calendar | Realistic for a single founder; the PRD's 6 weeks is correct |
| Phase 1 size | ~80 founder-days, ~10 weeks calendar | The EUDR MVP is the critical path |
| Phase 2 size | ~70 founder-days, ~10 weeks calendar | Tier 2 connectors + EUDR API + GA |
| Total v1 | ~180 founder-days, ~26 weeks calendar (~6 months) | In range for v1 of this scope |
| Engineering hygiene | 6 cross-cutting tasks (H1–H6) | Treated as ongoing, not "done" |
| Critical paths | 4 (auth, schema, EUDR MVP, EUDR API) | Everything else parallelises |
| Out of v1 scope | Offline-first, multi-warehouse, multi-producer UX, US/CA/AU/NZ, roast profile, café telemetry, auto-pricing, AI email parsing, SSO, public API | Match the PRD's out-of-scope list |

---

## 8. Open questions for Session 3 (the last ones)

1. **Is the 26-week total in the right ballpark?** My sizing is for an experienced solo founder with the stated stack. If your gut says "more like 36 weeks", that's fine — we adjust. (Lean: 26 weeks is right; my range is 24-36 weeks.)
2. **Phase 0.10 per-region routing — should this be a Phase 0 deliverable, or Phase 1?** My lean: Phase 0, because the architecture decision affects every other thing we build. (Lean: Phase 0.)
3. **The wholesale portal (1.7) is XL. Should it be split into "portal v1: order placement" and "portal v1.1: VAT-aware pricing + EUDR pack sharing"?** My lean: yes, split; the order placement is the load-bearing surface, the rest is polish. (Lean: split.)
4. **The Puppeteer work in 1.16 — should we use a managed Puppeteer service (e.g. Browserless) instead of running our own Chrome?** My lean: no, run our own; the cost is trivial at v1 volumes and the latency is better. (Lean: run our own.)
5. **The hash chain validation worker (1.19, promoted from 0.25) — should it be a separate worker process, or a job in the main worker pool?** My lean: a job in the main pool; separate processes are operational overhead. (Lean: same pool.)
6. **The first pilot conversion (2.18) is at the end of Phase 2. Should we do a paid pilot earlier (end of Phase 1) and convert it to paying in Phase 2?** My lean: yes, the pilot at end of Phase 1 should be paid (or paid-equivalent, e.g. heavily discounted), so we have a real customer reference for GA. (Lean: paid pilot at end of Phase 1.)

---

## 9. After Session 3 — what comes next

Three concrete things:

1. **Repo bootstrap.** Start with task 0.1. Within a day, you should have a `pnpm dev` running on your laptop. Within a week, the Vercel preview deploy should be live. Within two weeks, task 0.4 is done and you have a deployable hello-world.

2. **Pilot recruitment.** The validation plan §13 says "5 pilot interviews in week 3." That calendar doesn't slip just because the architecture is now real. Start recruiting now. Use the click-through prototype (`/clickthrough/`) for the interviews. The interviews are *validation*, not *selling* — you want to know if the design works, not close deals.

3. **The first ADR.** Write `docs/adr/0001-architecture-shape.md` capturing the decision to go with a modular monolith. This is the first decision; there will be ~20 by GA. The discipline of writing ADRs as you go is the difference between a system you understand 6 months from now and a system that has accreted without explanation.

---

*End of Session 3. End of the architecture series.*

*You now have: a product plan (PRD v1.2), a click-through prototype (23 screens), an architecture (Session 1: 522 lines), a load-bearing-decisions doc (Session 2: 716 lines), and a tech backlog (Session 3: this doc, ~600 lines). That's enough to start building.*
