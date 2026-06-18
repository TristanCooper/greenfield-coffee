# Greenfield v1 — Consolidated Plan

> **Status:** Draft 1.0 — for founder review after the clean-slate reset (2026-06-18)
> **Supersedes:** none. The repo was wiped this session; the only surviving spec is the planning corpus in `.hermes/plans/`.
> **Source docs (in repo, do not edit, link from here):**
> - PRD: `.hermes/plans/2026-06-17_165800-coffee-ops-mvp-prd.md` v1.2
> - Infra revision: `.hermes/plans/2026-06-18_153000-infra-revision-session5.md`
> - Archived (history only): sessions 1–4 of architecture/kanban work

> **For the team:** This is the single document that says "what we are building, on what, in what order, with which decisions still open." It is the only plan. Any later spec work either patches this file or links out from it. No parallel planning docs.

> **Founder decisions baked in (resolved 2026-06-18, end of wipe session):**
> 1. **Data residency = UK only at v1.** `Organization.data_residency` field stays in the schema with the binding-per-org language from PRD §4.3 preserved, but the only allowed value at signup in v1 is `'uk'`. All v1 orgs (UK roasters and any EU roasters we accept during pilot) live in the single `eu-west-2` Supabase project. The `'eu'` value is a schema-level placeholder; the second region (`eu-central-1`) lands post-pilot when the first EU customer asks for proof of EU-only hosting in writing. See §11.1 for the resolved decision and the migration path to B (two regions) when triggered.
> 2. **Audit log = append-only with RLS-refusal in v1.** No cryptographic hash chain at launch. `audit_event` uses RLS-as-permission-model (no `UPDATE`/`DELETE` policies) + `BEFORE UPDATE/DELETE` trigger that raises `EXCEPTION`. PRD §3 principle 10 is **partially met** — events are tamper-resistant, not tamper-evident. Hash chain + nightly validator deferred to v1.5 (or earlier if a pilot customer asks "what stops a rogue admin from editing an old row?"). See §11.2 for the resolved decision and the upgrade path.

---

## 0. Read me first

**Three things matter and everything else follows from them:**

1. **The product is a UK/EU coffee-roastery operations platform with EUDR as a first-class pillar.** PRD §1.1, §3 principle 9. The data model is the spine; the EUDR deadline is the forcing function.
2. **The platform is a modular monolith, one codebase, multi-tenant SaaS, on Vercel + Supabase + Slack + GitHub.** Infra Session 5 §2. Three vendors, free tiers, single region `eu-west-2` (London) for v1 — `data_residency = 'uk'` at signup, single Supabase project, second region deferred.
3. **v1 is a focused slice.** Anti-scope is in §10 below. Anything in that list is a no — push back, don't negotiate.

**Two material conflicts between the PRD and the infra revision were flagged in §11 (open decisions). The founder has resolved both** — see the "Founder decisions baked in" box at the top, and §11 for the resolved call + the upgrade path.

---

## 1. Product (what we're shipping)

### 1.1 Goal

Ship one coffee-native operations platform, **metric by default**, **EUR/GBP-native**, that replaces the spreadsheet + email + roaster-app + ecommerce-backend stack for a 1–20-person UK/EU roastery. Four product modules, one data spine:

| Module | What it does |
|---|---|
| **M1 Demand** | Order ingestion across channels, net-requirements engine, daily production board, pack & ship |
| **M2 Supply** | Green/loose-roasted/packaged stock with full lot genealogy, variable-weight conversion, count, recall pack |
| **M3 Money** | Landed cost (EUR/GBP, FX-snapshotted, VAT-aware), BOM, margin by SKU/channel/customer, pricing signals |
| **M4 Compliance** | EUDR-ready DDS, geolocation-linked traceability, supplier due-diligence, audit packs |

Two system modules glue them together: **S1 Integrations Hub** (Shopify EU, Xero, Stripe EU, ShipStation at launch; WooCommerce, Sage, Mollie, Square in Phase 2) and **S2 Identity & Tenancy** (magic-link auth, RBAC with `compliance_officer` role, org tenancy, audit log).

### 1.2 Customer

Primary persona is the **UK/EU growth-stage roastery** (PRD §2.1): 6–20 staff, founder + head roaster + production + 1–2 commercial/admin, based in UK/IE/NL/DE/FR/Nordics/BE/IT/ES, 450–6,800 kg roasted/month, multi-channel, **EUDR-exposed (current or potential)**. Decision-maker is the owner or head of operations. Buying trigger is usually a specific event, including **EUDR deadline anxiety** (enforcement: 30 December 2026).

Secondary persona is the **UK/EU founder-led micro** (1–5 staff, <450 kg/mo, single channel). Not designed for in v1.

### 1.3 v1 success criteria (90 days post-onboarding)

PRD §2.3 — 8 KPIs; 3-of-8 miss = not ready for paid GA. The two **EUDR-specific** KPIs are the wedge:

- EUDR DDS generation in <2 min for any shipment in scope, with all required fields populated
- 100% of in-scope green lots have a complete `EudrReferenceData` (geolocation polygon, supplier, country of harvest, harvest year)
- 100% of shipments have a `ShipmentEudrDecision` recorded with the correct scope outcome

Other KPIs: admin time per 100 orders ↓ ≥50%, roast start time earlier by ≥60 min/day, stock count variance <2%, gross margin visibility 100% of SKUs, lot trace <5 min, daily active use ≥80% of business days.

---

## 2. Non-negotiable principles (reviewer should reject PRs that violate)

PRD §3, summarised:

1. **Coffee-native data model** — one roasted batch becomes many bag sizes; yield loss is real; blends inherit genealogy; freshness windows exist.
2. **One source of truth per concept** — no integration duplicates a record.
3. **Exception-first UI** — home screen answers "what needs me today?"
4. **Floor-resilient** — pack/ship, count, receive on tablet, one-handed, patchy Wi-Fi. Offline-tolerant data entry is v1 (deferred sync queue), not polish.
5. **Reverse-traceable** — every outbound shipment → green lot in ≤3 clicks. Every green lot → all shipments fed.
6. **Money is a first-class event** — margin from real cost allocations on real stock movements, not derived reports.
7. **Metric by default** — kg/g canonical; imperial (lb/oz) is opt-in UI preference for specific SKUs, never an internal unit.
8. **EUR/GBP-native** — money in minor units of explicit ISO 4217; `base_currency` is EUR or GBP at signup; multi-currency events FX-snapshotted at event time; VAT first-class (UK 20%, DE 19%, NL 21%, FR 20%, IE 23%, etc., reverse-charge for B2B cross-border).
9. **Compliance is operational** — same record drives operations and compliance. Never re-enter data.
10. **Regulatory defensibility by default** — every state-changing action leaves a tamper-resistant audit trail. *(v1 ships append-only with RLS-refusal; cryptographic hash chain is v1.5. See §11.2.)*
11. **Per-shipment EUDR opt-out only, friction-laden by design, never org-wide.** *(See §6.5 below — the load-bearing product call.)*

---

## 3. Tech stack (the working baseline)

Infra Session 5 §2, locked:

| Layer | Choice | Notes |
|---|---|---|
| Frontend + API | **Next.js 15 App Router**, tRPC v11, Zod | TypeScript strict (no implicit any, noUncheckedIndexedAccess, noImplicitOverride) |
| ORM | **Drizzle** | Schema-first, generated migrations |
| Database | **Supabase Postgres 15 + PostGIS + pgcrypto** | Free tier; PostGIS for `geography(MultiPolygon, 4326)` on `Producer.geolocation`. **pgcrypto is enabled for forward compatibility (the v1.5 hash chain) but unused at v1** — `audit_event` is append-only via RLS + trigger, no cryptographic chain at launch. |
| Auth | **Supabase Auth (GoTrue)** | Magic-link email; JWT in httpOnly cookie; RLS-aware |
| Storage | **Supabase Storage** | RLS-aware buckets; `lot-photos`, `dds-documents`, `audit-packs` |
| Background work | **pg_cron** (DB-side) + **Vercel Cron** (app-side) | Replaces BullMQ + Fly.io. No Redis, no separate worker runtime. |
| Observability | **Supabase Logs** + **Vercel function logs** + **Vercel Analytics** | Replaces Logflare + Grafana Cloud. 7-day log retention on free tier. |
| Alerts | **Slack incoming webhook** | pg_cron health + Vercel deploy notifications |
| CI | **GitHub Actions** | Lint + typecheck + test on PR; build on merge to main |
| Deployment | **Vercel** (`lhr1` London) | Hobby tier pre-pilot; Pro ($20/mo) when bandwidth/invocations exceed |
| Region | **`eu-west-2` (London)** | Single region for v1. `Organization.data_residency = 'uk'` is the only allowed value at signup. Second region (`eu-central-1`) deferred to v1.5 — see §11.1. |
| Package manager | **pnpm** | Monorepo: `apps/web` + `packages/db` + `packages/money` |
| Test runner | **Vitest 2** | Not Jest |
| Lint/format | ESLint flat config + Prettier | |

**Vendor count: 3 (Vercel + Supabase + Slack) + GitHub.** Pre-pilot infra cost: **$0/mo.** Post-first-paid-pilot: ~$45/mo (Vercel Pro + Supabase Pro + Slack free).

### 3.1 Free-tier constraints to design around

| Constraint | Value | Workaround / when to upgrade |
|---|---|---|
| Supabase DB size | 500 MB | Fine for 0–3 pilots; Supabase Pro ($25/mo) at first paying pilot → 8 GB |
| Supabase storage | 1 GB | ~10K lot photos / DDS PDFs |
| Supabase egress | 5 GB/mo | Watch when serving pack/ship photos |
| Supabase project pause | After 7 days idle | **7-day keepalive via Vercel Cron** (infra §5) |
| Supabase log retention | 7 days | Adequate for pilot |
| Vercel bandwidth | 100 GB/mo | Pro at $20/mo when exceeded |
| Vercel function invocations | 1000/day on hobby | Pro when exceeded |
| Vercel cron | 2 jobs max, 1/day each on hobby | Consolidate or upgrade |
| pg_cron | No documented job-count limit | Free |
| PostGIS | Free-tier-eligible | Enable in dashboard |
| pgcrypto | Free-tier-eligible | Enable in dashboard |

---

## 4. Data model (the spine)

PRD §5, complete list. The schema is the product; everything else (auth, integrations, UI) serves it.

### 4.1 Core entities (v1)

`Organization`, `User`, `Membership` (with `role` enum: `owner`, `head_roaster`, `pack_ship`, `buyer_receiving`, `accountant`, `compliance_officer`, `readonly`), `Sku`, `PriceList`, `PriceListEntry`, `Packaging`, `Recipe`, `LandedCostEvent`, `Order`, `OrderLine`, `OrderEdit`, `PurchaseOrder` (schema in, UI in v1.5), `IntegrationConnection`.

### 4.2 Lot entities (the chain of custody)

`GreenLot`, `RoastBatch`, `RoastedLot`, `PackagedLot`, `StockMovement` (the immutable ledger: `receipt`, `roast_consume`, `roast_produce`, `pack_consume`, `pack_produce`, `count_adjust`, `sale_consume`, `return_receive`, `destruction`), `LotAllocation` (private-label reservation), `ReturnEvent`.

### 4.3 Money entities

`LandedCostEvent` (per-event currency, FX snapshot, VAT flag), `MarginView` (six materialised views: by SKU / by channel / by customer / by period / by green lot / by order), `FxRate` (snapshot table).

### 4.4 Compliance entities (the EUDR pillar) — **net-new for v1**

`Supplier` (with `risk_assessment` jsonb, `dds_reference` for upstream DDS, `eori`), `Producer` (with `geolocation: { type: 'polygon', coordinates: jsonb }` — PostGIS `geography(MultiPolygon, 4326)`), `EudrReferenceData` (per green lot; `risk_status` denormalised from supplier + producer, recomputed via trigger), `LotProducer` (v1 = single-producer UX; schema supports multi-producer for v1.5), `DdsDraft` (one per in-scope shipment; PDF + JSON output for manual TRACES-style submission in v1, API in v1.5), `ShipmentEudrDecision` (one per shipment, **always**, even out-of-scope), `AuditPack` (signed PDF/JSON bundle; `scope: 'shipment' | 'period' | 'supplier' | 'recall'`), `audit_event` (append-only).

### 4.5 Audit log (regulatory defensibility)

`audit_event`: `(id, org_id, user_id, action, entity_type, entity_id, diff jsonb, occurred_at)`. **Append-only via RLS-as-permission-model** (no `UPDATE`/`DELETE` policies) **plus a `BEFORE UPDATE/DELETE` trigger that raises `EXCEPTION`**. No cryptographic hash chain at v1 — see §11.2 for the resolved call and the v1.5 upgrade path (Postgres `BEFORE INSERT` trigger computing `hash_prev` + `hash_self` per org, nightly validator, audit pack merkle root). The `pgcrypto` extension is enabled at the database level so the v1.5 work is a code change, not a schema migration.

### 4.6 Variable-weight conversion (the coffee-specific part)

PRD §5.2. The canonical unit is grams. Every stock event records `weight_kg` + `count` (where applicable). Yield is computed at `RoastBatch` completion: `roasted_weight_out / green_weight_in`. Pack events convert loose-roasted weight to packaged-lot count by `unit_weight_g`.

### 4.7 Genealogy graph

PRD §5.3. `GreenLot` → `RoastBatch` → `RoastedLot` → `PackagedLot` → `OrderLine` → `Shipment`. Stored as FK edges plus a denormalised `lineage` jsonb for fast reverse-trace queries.

---

## 5. Module specs (one-line summaries; full text in PRD §6)

### 5.1 M1: Demand
- **Order ingestion** (PRD §6.1.1) — Shopify EU, WooCommerce, Square POS, wholesale portal, email-in (rule-based), manual. Webhook-first + 15-min polling fallback. Idempotency on `(org_id, channel, external_id)`. Normalised to `Order` + `OrderLine`; raw payload in `jsonb` for debugging.
- **Net-requirements engine** (§6.1.2) — pure function recomputed on every relevant event. Default 7-day horizon. Outputs daily production board rows.
- **Daily production board** (§6.1.3) — mobile + desktop, three sections (Roast/Pack/Ship today), one-tap actions, "what changed" diff.
- **Pack & ship** (§6.1.4) — scan-or-tap workflow. Pack from loose-roasted or packaged. Sub-rollbacks on scan error.

### 5.2 M2: Supply
- **Green receiving** (§6.2.1) — PO optional in v1; lot created from supplier invoice or weight ticket. Status `available` blocks roast when quarantine set.
- **Roasting event** (§6.2.2) — `RoastBatch` with `green_lot_components` + weights. `RoastedLot` + paired `StockMovement`s in one tx.
- **Variable-weight pack** (§6.2.3) — `PackagedLot` with source-roasted-lot components, qty, unit weight, packaging used.
- **Counts & adjustments** (§6.2.4) — cycle count; negative adjusts need reason code; nightly invariant check.
- **Recall pack** (§6.2.5) — input: green lot ID / SKU + date / customer. Output: paginated, exportable list of affected shipments. Read-only "recall simulation" mode.
- **Returns** (§6.2.6) — `ReturnEvent` linked to original shipment. Restock or quarantine.
- **Transfers** (§6.2.7) — single warehouse only; `warehouse_location_id` captured for forward compatibility.

### 5.3 M3: Money
- **Landed cost engine** (§6.3.1) — late-arriving costs split between unroasted and already-roasted portions via explicit `cost_adjustment_cents` memo lines (no history rewrite).
- **Margin views** (§6.3.2) — six views, CSV/Xero-compatible export. Cost-snapshot-at-roast (default; audit-defensible) with cost-snapshot-at-sale toggle visible in dev only (PRD open Q5).
- **Pricing signals** (§6.3.3) — surface margin + cogs + channel mix; roaster confirms. No auto-pricing.

### 5.4 M4: Compliance (the EUDR pillar)
- **Supplier register** (§6.4.1) — risk assessment (country / producer / supply chain / overall), `dds_reference` upstream, certifications, EORI. Block roast if missing risk assessment.
- **Producer register** (§6.4.2) — with map view, polygon validation, area-sanity-check (warn if polygon area vs `area_hectares` delta >20%), verification source (`self_reported` / `third_party_verified` / `satellite_imagery` / `ground_survey`).
- **In-scope check at pack time** (§6.4.3) — warning (not block) at green receipt if `country_risk = high`; hard block at EU shipment if any lot lacks `EudrReferenceData`. Bypass requires explicit reason in `audit_event`.
- **DDS generator** (§6.4.4) — auto-draft from in-scope green lots. Manual review/sign/submit in v1; v1.5 adds TRACES-style API.
- **Audit pack rendering** — Puppeteer (not @react-pdf) on a React component template; signature page with verification URL + QR code; append-only artifact.
- **Supplier risk review workflow** — periodic re-assessment; denormalised `EudrReferenceData.risk_status` recomputed by trigger on supplier/producer change.

### 5.5 M4b: Per-shipment opt-out — **net-new for v1.2**

PRD §6.5, the load-bearing product call.

**The system offers opt-out only when:** (a) destination is EU member state or NI, AND (b) net mass ≥ `small_quantity_threshold_kg` (default 1.0 kg), AND (c) `scope_decision = 'in_scope_requires_dds'`, AND (d) DDS generation has an issue OR the roaster actively chooses opt-out.

**The system blocks opt-out when:** any lot is on the published EU high-risk country list, OR any lot lacks a risk assessment. Hard floor; no workaround.

**The friction path (§6.5.2):**
1. **Why** — required `reason_code` (or `reason_text` if `code = 'other'`)
2. **Who** — must be `owner`, `compliance_officer`, or `head_roster` role
3. **Confirm** — type the system-required phrase *exactly* (with per-shipment nonce). v1 phrase: *"I confirm this shipment does not require a Due Diligence Statement under EUDR. I am the operator of record."* — **subject to EU regulatory lawyer review (PRD open Q18) before v1 ships**

**What gets recorded:** `ShipmentEudrDecision` with `mode = 'opt_out'`, reason, role snapshot, typed phrase, timestamp, destination context. Signed `AuditPack` (the opt-out audit pack) generated at decision time. `AuditEvent` written to the chain. Shipment unblocked.

**Edge cases (§6.5.6):** UK-UK → not offered. Below threshold → not offered. High-risk lot → blocked. No risk assessment → blocked. Packer role → blocked. Typo on phrase → blocked. Dismiss without deciding → shipment stays blocked. Change mind later → new decision with `supersedes_id` linking to prior (PRD open Q19 — recommend v1.0).

**Compliance dashboard:** show per-org opt-out rate (last 90 days). Default threshold for "want help?" prompt: 30% (PRD open Q20). Neutral framing, no judgement.

### 5.6 S1: Integrations Hub
- **Tier 1 (Phase 1):** Shopify EU, Xero UK/EU, Stripe EU, ShipStation. Email-in parser (rule-based).
- **Tier 2 (Phase 2):** WooCommerce EU, Sage, Mollie, Square POS.
- **Wholesale portal v1** — built-in, hosted B2B page; per-customer price-list binding; **VAT-aware pricing** (B2B EU with VAT number → reverse-charge, VAT-exclusive; UK or B2C → VAT-inclusive); **EUDR pack sharing** (wholesale customers can view/share their order's audit pack with their own auditor — the most-requested feature in early interviews, per PRD §7.1.4).
- **Rate limits & retries** — token bucket per connector, exp backoff + jitter, max 5 attempts, DLQ with operator alert on final failure.

### 5.7 S2: Identity & Tenancy
- Magic-link auth (Supabase Auth). **No SSO in v1.**
- RBAC roles: `owner`, `head_roaster`, `pack_ship`, `buyer_receiving`, `accountant` (read all, write pricing only — PRD open Q8), `compliance_officer` (write EUDR + audit packs, no stock/recipes/pricing), `readonly`.
- `Organization` with `country_code`, `region` (one of 16 UK/EU codes), `base_currency` ∈ {EUR, GBP} at signup, `eudr_settings` jsonb (small-quantity threshold, default_mode `enforce`/`flag_only`, country-risk list reference), `data_residency` ∈ {'uk'} at v1 (see §11.1 — `'eu'` is reserved for the second region in v1.5).
- **Data residency per org** — `Organization.data_residency = 'uk'` at signup, single Supabase project in `eu-west-2` (London) for v1. See §11.1 for the resolved call and the v1.5 upgrade to per-region routing.
- **GDPR posture** — every User/Customer has data-export + right-to-be-forgotten flows; anonymisation (PII → pseudonymous ID) with secure lookup table. Order rows preserved for regulatory retention; PII replaced.
- `audit_event` log, append-only via RLS-refusal + `BEFORE UPDATE/DELETE` trigger (no cryptographic chain at v1 — see §11.2 for the resolved call and the v1.5 upgrade path).

---

## 6. Phasing (what we build when)

PRD §10. The spine ships as one product with feature flags, not as modules in sequence. **EUDR is in Phase 1, not Phase 3**, because the deadline is 30 Dec 2026.

### 6.1 Phase 0 — Foundations (Jul–Aug 2026, ~6 weeks)

**Goal:** roaster can manually do the end-to-end flow (SKU → receive green with producer/polygon/supplier risk → roast → pack → sell → DDS draft) with the genealogy intact.

- Repo + CI + deploy skeleton (Next.js 15 + TS strict + pnpm monorepo + GitHub Actions)
- Supabase project (`eu-west-2`) with PostGIS + pgcrypto enabled
- Auth + RLS + tenancy + RBAC (incl. `compliance_officer`)
- Full data model in DB (all entities, including EUDR entities)
- `audit_event` append-only via RLS-as-permission + `BEFORE UPDATE/DELETE` trigger (no cryptographic chain at v1; v1.5 adds the hash chain + nightly validator — see §11.2)
- Money spine: `LandedCostEvent`, `PriceList` (VAT-inclusive/ex-VAT modes), cost cascade
- Admin UI v0: SKUs, customers, suppliers, packagings, recipes, price lists, **EUDR producer register with map view**, supplier risk register
- Manual order entry + manual stock movement UI
- Daily production board v0 (read-only, computed nightly)
- Compliance-aware green receiving flow v0 (mandatory producer + supplier fields)
- 7-day Supabase keepalive via Vercel Cron
- pg_cron audit-pack-freshness placeholder (no-op job until v1.5)

**Exit criteria:** the manual end-to-end flow works, with a DDS draft generated for the test shipment.

### 6.2 Phase 1 — Integrations + Daily Workflow + EUDR MVP (Sep–Nov 2026, ~10 weeks)

**Goal:** first pilot onboarding at end of phase. §2.3 KPIs being measured.

- Tier 1 connectors: Shopify EU, Xero, Stripe EU, ShipStation
- Email-in parser
- Wholesale portal v1 (VAT-aware + EUDR pack sharing)
- Net-requirements engine (live, event-driven)
- Live daily board
- Pack & ship scan workflow (with mandatory DDS for in-scope shipments)
- Invoice generation (VAT-correct by construction, MTD-compatible payload)
- **EUDR MVP** — full green-receiving flow, DDS generator (PDF + JSON), **per-shipment opt-out path with full friction (§6.5) and signed opt-out audit pack**, compliance dashboard, supplier risk review
- Audit pack rendering (Puppeteer + React component template, signature page with QR)

**Exit criteria:** §2.3 KPIs being measured in pilot; **at least one real DDS filed via manual TRACES-style submission** + **at least one opt-out taken with a real reason** (validates the data shapes and the friction path).

### 6.3 Phase 2 — Money & Insights + Tier 2 Integrations (Dec 2026–Feb 2027, ~10 weeks)

**Goal:** GA no later than mid-Feb 2027. All paying customers on Phase 1 by 30 Dec 2026 (the EUDR enforcement deadline).

- Full landed cost engine (multi-event, late-arriving, FX, VAT-aware)
- All six margin views (ex-VAT)
- Pricing signals
- Accounting reconciliation polish
- Recall pack feature
- Cycle count workflows
- **EUDR API integration** with EU Information System (v1.5 — manual submission remains as fallback)
- Tier 2 connectors: WooCommerce EU, Sage, Mollie, Square POS

**Exit criteria:** 3 paid pilots with all 7 KPIs green (the 7th is EUDR data completeness).

### 6.4 Phase 3+ (post-MVP, roadmap)

Roast profile capture (read-only), multi-warehouse, tipping-point alerts (auto-reprice), mobile native, US/CA/AU/NZ market entry (requires US-USD, imperial default, different compliance regime), subscription management, customs broker integration.

---

## 7. Phase 0 backlog (founder-day sized; dependencies explicit)

This is the unblocking sequence for the next 6 weeks. Sourced from infra Session 5 §4 with notes. Cards 0.1–0.4, 0.5, 0.7, 0.9, 0.10, 0.11, 0.13, 0.15, 0.16, 0.17, 0.20 are the load-bearing ones. **Sequencing caveat:** Session 5 sized the pre-revision stack at 30 days; the revised sizing is 57 days. The 27-day growth buys real EUDR risk UI (0.20), GeoJSON map picker (0.17), and higher-quality admin UI work. Founder will re-baseline after 0.1–0.4 land.

### 7.1 Phase 0.1 — Repo, CI, deploy skeleton (~4 founder-days)

| # | Task | Size | Deps | Acceptance |
|---|---|---|---|---|
| 0.1 | Init monorepo: Next.js 15 + TS strict + ESLint + Prettier + `apps/web` + `packages/db` + `packages/money` | S | — | `pnpm dev` starts; `pnpm build` succeeds; lint clean |
| 0.2 | GitHub Actions: lint + typecheck + test on PR; build on merge to main | S | 0.1 | PR shows green; merge triggers Vercel preview |
| 0.3 | Create Supabase project (`eu-west-2`), enable PostGIS + pgcrypto, set Vercel env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` port 6543, `DATABASE_URL_DIRECT` port 5432) | S | — | See `SUPABASE.md` for the operator walkthrough |
| 0.4 | Drizzle schema: empty starter + first migration + `pnpm db:migrate` against Supabase | S | 0.1, 0.3 | Migration applies; `pnpm db:studio` opens against Supabase |

### 7.2 Phase 0.2 — Auth, tenancy, RLS (~7.5 founder-days)

| # | Task | Size | Deps | Acceptance |
|---|---|---|---|---|
| 0.5 | Supabase Auth: magic-link sign-in, JWT in httpOnly cookie via `@supabase/ssr` | S | 0.3 | User clicks magic link → lands in app, cookie set |
| 0.6 | RLS helpers: `set_tenant_context(org_id)` SQL function + Drizzle middleware that calls it per request | M | 0.3, 0.5 | Cross-org query returns zero rows; tests pass |
| 0.7 | Organization entity + signup flow: user signs up → creates org with `base_currency`, `region`, `eudr_settings`; founder becomes `owner`; `compliance_officer` role available | M | 0.5, 0.6 | Org row exists; RLS scoped correctly; role enforcement works |
| 0.8 | Vercel Cron 7-day keepalive ping to Supabase | XS | 0.3 | Cron visible in Vercel dashboard; Supabase project stays active |

### 7.3 Phase 0.3 — Data spine (~20.5 founder-days)

| # | Task | Size | Deps | Acceptance |
|---|---|---|---|---|
| 0.9 | Drizzle schema: operational entities — `Organization`, `User`, `Membership`, `Sku`, `PriceList`, `PriceListEntry`, `Packaging`, `Recipe`, `LandedCostEvent`, `Order`, `OrderLine` | L | 0.4 | Tables exist; migrations apply; CRUD tRPC procedures |
| 0.10 | Drizzle schema: lot entities — `GreenLot`, `RoastBatch`, `RoastedLot`, `PackagedLot`, `StockMovement` | L | 0.9 | Tables exist; `audit_event` append-only trigger in place |
| 0.11 | Drizzle schema: compliance entities — `Supplier`, `Producer` (with PostGIS `geography(MultiPolygon, 4326)`), `EudrReferenceData`, `LotProducer`, `DdsDraft`, `ShipmentEudrDecision`, `AuditPack` | L | 0.10 | Tables exist; high-risk check query (PRD §6.4) tested |
| 0.12 | `audit_event` table: append-only via RLS-as-permission + `BEFORE UPDATE/DELETE` trigger (no hash chain at v1; `pgcrypto` is enabled for forward compatibility) | S | 0.9 | UPDATE/DELETE raises exception; every state-changing procedure inserts one row in the same tx |
| 0.13 | Money spine: `LandedCostEvent` with VAT tracking (UK 20%, DE 19%, NL 21%, etc.), `PriceList` with VAT-inclusive/ex-VAT modes, cost cascade green→roast→pack→order | M | 0.9 | Landed cost recorded with recoverable flag; cost cascade computes correctly |
| 0.14 | Seed data: `pnpm dev:seed` populates one org, SKUs, supplier, producer, green lots, roast, pack, order. Smoke test reuses it. | S | 0.9–0.13 | Seed runs cleanly; smoke test passes against it |
| 0.15 | pg_cron: schedule audit-pack freshness check (placeholder, no-op until v1.5) | XS | 0.4 | Job visible in `cron.job`; manual run succeeds |

### 7.4 Phase 0.4 — Admin UI v0 + smoke (~25 founder-days)

| # | Task | Size | Deps | Acceptance |
|---|---|---|---|---|
| 0.16 | Admin UI: SKUs, customers, suppliers, packagings, recipes, price lists (read + write), permission-aware | L | 0.9 | Forms CRUD each entity; validation works |
| 0.17 | Manual green-receiving flow: supplier, producer, geolocation (GeoJSON map picker), lot details, costs, risk review | L | 0.11 | Founder can receive a green lot end-to-end; EUDR risk warning surfaces |
| 0.18 | Daily board v0: read-only screen, computed via Vercel Cron at 03:00 UTC, "what needs me today" | M | 0.10 | Board renders; cron visible in vercel.json; refresh works |
| 0.19 | Manual pack + sell: form-based pack event and sell event (no scan workflow yet) | M | 0.10 | Founder can pack a bag and sell it; stock ledger updates |
| 0.20 | Compliance-aware green receiving: warning at receipt if `country_risk = high`, block at EU shipment if any lot lacks `EudrReferenceData` | M | 0.11 | Warning blocks ship; bypass requires explicit reason logged to `audit_event` |
| 0.21 | Smoke test: end-to-end script — create org → receive green lot → log roast → pack bag → sell bag → produce DDS draft | M | 0.14, 0.16, 0.17, 0.19, 0.20 | Script runs clean against seeded data; output matches expected |
| 0.22 | Test suite: high-risk check (PRD §6.4) + area-validation check (polygon vs `area_hectares`) | M | 0.11 | Unit + integration tests pass; CI green |

**Phase 0 total: ~57 founder-days.** Pre-pilot infra cost: $0.

---

## 8. Validation plan (before build, parallel to Phase 0)

PRD §13 — 4-week, 5-roaster cycle running concurrently with Phase 0.

**Cohort:** 5 UK/EU roasters, 6–20 staff, 450–6,800 kg/mo, multi-channel. Mix: 2 UK, 1 NL, 1 DE, 1 FR. Channel mix: 2 wholesale-heavy, 2 DTC-heavy, 1 café/private-label. EUDR maturity: ≥2 in active dialogue with suppliers about geolocation. Paid pilot (€500/mo, waived on conversion). Pilot contract must define: we generate the DDS, operator signs and submits, operator is the legal entity of record.

**Activities:**
- W1 diary study (hours on order entry, inventory recon, last margin error, last lot trace, last compliance document)
- W2 workflow mapping (90-min session, walk yesterday's orders + most recent green lot paperwork)
- W3 prototype walkthrough — use the click-through at `.hermes/plans/clickthrough/index.html` (23 screens, revised for v1.2 to include the per-shipment opt-out path)
- W4 pricing & commitment (proposed pricing, EUDR module **included not add-on**)

**Decision criteria to proceed to build (≥3 of 5 roasters must):**
- Identify ≥3 of 6 deep-research pain points as "active, painful, last 30 days"
- Identify ≥1 as **EUDR-related and "active, painful, last 30 days"** (market-fit signal)
- Say "yes I would pay €X/mo at the proposed price"
- Agree to 90-day paid pilot starting Phase 1 ship

**EUDR-specific validation (§13.4):** 2-3 standalone conversations with (a) EUDR consultant/trade body (validates regulation interpretation, DDS schema, opt-out phrase wording), (b) wholesale customer (validates "share EUDR pack" from buyer's side), (c) green importer/trader (validates `Supplier.dds_reference` model).

**Per-shipment opt-out validation (§13.5):** separate scenario at end of each interview, ~10 min. Berlin-wholesale-Yirgacheffe scenario. Success criteria: 3/5 say opt-out "makes sense" / "would use it"; 3/5 correctly identify what it does without prompting; 0/5 expect org-wide opt-out; 0/5 want packers to take the decision.

If 2 or fewer pass, revisit §6.5 — the friction is probably wrong, or the framing is unclear.

---

## 9. Open items the founder must decide (PRD §11 + §14 + infra Session 5 §8)

These block code or shape the product. Each has a recommended default; the founder owns the override.

| # | Item | Recommendation | Source |
|---|---|---|---|
| 1 | Database (Postgres + PostGIS) | Confirm Postgres + PostGIS | PRD open Q1 |
| 2 | Hash chain library | **Not used at v1.** When the v1.5 chain is added: SHA-256 of canonical JSON (RFC 8785); Postgres `BEFORE INSERT` trigger; per-org chain; nightly validator (pg_cron) | Resolved in §11.2 |
| 3 | Idempotency keys for outbound integrations | ULID per event | PRD open Q3 |
| 4 | Offline queue store on client | IndexedDB + service worker; in-scope EU shipments cannot advance DDS offline | PRD open Q4, Q12 |
| 5 | Cost snapshot timing | Roast time (audit-defensible); cost-at-sale toggle in dev only | PRD open Q5 |
| 6 | Lot ownership enforcement | In `net_requirements` recompute, check `LotAllocation` before allocating | PRD open Q6 |
| 7 | Multi-currency UX | Per-event FX snapshot, base currency aggregation; display is straightforward, audit explanation needs care | PRD open Q7 |
| 8 | Accountant role scope | Read all, write pricing only | PRD open Q8 |
| 9 | Wholesale portal pricing | Per-customer login bound to a specific account (not free for all) | PRD open Q9 |
| 10 | Customer-master dedup | No automatic dedup in v1; manual merge | PRD open Q10 |
| 11 | VAT validation | VIES/HMRC public APIs on demand (free, rate-limited); revisit if rate limits bite | PRD open Q11 |
| 12 | EUDR + offline UX | "Pending compliance" on daily board; server-side authority for DDS state | PRD open Q12 |
| 13 | `LotProducer` in v1 or v1.5 | Single-producer in v1; multi-producer in v1.5 | PRD open Q13 |
| 14 | NI VAT regime | Treat as UK (data residency `uk`, base currency GBP) with `region = 'NI'` + special VAT handling flag | PRD open Q14 |
| 15 | EUDR smallholder relief | Ship without in v1; add when EU framework settles | PRD open Q15 |
| 16 | Self-reported producer override | Free-text reason + uploaded PDF + checkbox confirming regulatory risk | PRD open Q16 |
| 17 | Regulator update subscription | Static reference table in v1; email alerts in v2 | PRD open Q17 |
| 18 | **Opt-out confirmation phrase wording** | **EU regulatory lawyer review before v1 ships** (~£1,500, 2-4 hours) | PRD open Q18 |
| 19 | `supersedes_id` on `ShipmentEudrDecision` | v1.0 (recommended) | PRD open Q19 |
| 20 | Opt-out rate as leading indicator | Show in compliance dashboard, neutral framing, "want help?" link at 30% threshold (configurable per org) | PRD open Q20 |
| 21 | Opt-out audit pack legal text | Same legal review as #18 (combined engagement) | PRD open Q21 |
| 22 | Below-threshold multi-parcel aggregation | v1 treats each shipment independently; v1.5 adds 7-day aggregation if EU guidance settles on it | PRD open Q22 |

Plus the four PRD Appendix B items that block Phase 0:
- **Pricing tier structure + EUDR module included not add-on** — by end of Phase 0
- **Brand name + domain + visual identity** — by end of Phase 0
- **Data residency decision** — **resolved** (single region `eu-west-2`, `data_residency = 'uk'` only at v1, second region deferred to v1.5 — see §11.1)
- **Cloud provider (AWS London/Frankfurt vs Hetzner/OVHcloud)** — by end of Phase 0

---

## 10. Anti-scope (the no list)

Anything in this list is **out of scope for v1**. If a task asks for it, push back.

**From PRD §1.2 + §15:**
- Roast profile capture / control (Artisan/Cropster domain)
- Cupping/QC scoring linked to roast batches
- Café-side wholesale telemetry (Cropster Café domain)
- Multi-roastery / multi-warehouse (single org, single warehouse in v1)
- Direct roaster hardware control
- Native mobile apps (responsive web only)
- SSO
- AI-driven email parsing (rule-based templates only)
- Auto-pricing
- Public API for third parties
- Subscriptions management (we receive, we don't bill)
- Loyalty / CRM
- Equipment maintenance scheduling
- EUDR Information System API integration (v1.5)
- EUDR smallholder small-quantity relief (v1.5)
- EU pre-pack average-weight auditing UI (v1.5)
- Cross-region data mirrors (v1.5)
- Multi-producer green lots (v1.5; schema in v1)
- Customs broker / commercial-invoice integration (v1.5)
- US/Canada/AU/NZ market entry (v2)
- **Org-wide EUDR opt-out** (intentionally not in the product; per-shipment only — see §5.5)
- **Auto-detection / auto-skip of "obviously" out-of-scope shipments** (the system prompts at ship time so the roaster makes an active decision)
- **Below-threshold aggregation across shipments to the same customer** (v1 treats each shipment independently)

**From infra Session 5:**
- USD support
- Multi-region hosting (single region `eu-west-2` for v1; second region is v1.5 — see §11.1)
- Hash-chain audit at v1 launch (resolved: deferred to v1.5 — see §11.2)
- Dedicated worker runtime (no BullMQ, no Fly.io, no Redis)
- Per-org data residency in different regions (resolved: deferred to v1.5 — see §11.1)

---

## 11. Resolved decisions (founder-owned)

Two material conflicts between the PRD and the infra revision were flagged in this section. The founder resolved both on 2026-06-18. The full resolution log is in §13.

### 11.1 Data residency — **resolved: UK only at v1, second region deferred to v1.5**

**The call (2026-06-18):** `Organization.data_residency` field stays in the schema with the binding-per-org language from PRD §4.3 preserved. The only allowed value at signup in v1 is `'uk'`. All v1 orgs — UK roasters and any EU roasters we accept during pilot — live in the single `eu-west-2` Supabase project. The `'eu'` value exists in the schema as a forward placeholder.

**Why this and not B (two regions from day 1):**
- The v1 pilot cohort is 5 roasters, **2 UK + 1 NL + 1 DE + 1 FR** per PRD §13.1. Pilot-tier customers do not yet require EU-only hosting in writing. The German and Dutch pilots are acceptable on `eu-west-2` London for the validation cycle (UK adequacy decision in force since 2021, recognised by EU GDPR).
- Two regions = per-org routing in Vercel middleware (5 founder-days) + cross-region mirroring. Not free.
- The schema stays ready for B. `data_residency` is on `Organization` from day 1; an `eu` org in v1 lives on `eu-west-2` and we tell the customer "we're in London until you trigger the EU region."

**Upgrade path to B (v1.5 or earlier, triggered):**
- **Trigger:** the first EU customer asks for proof of EU-only hosting in writing (most likely a German wholesale account mid-pilot, per infra §3.2). Or first paying EU customer at GA. Whichever comes first.
- **Work:** spin up a second Supabase project in `eu-central-1` (Frankfurt). Update Drizzle to support per-project config based on `data_residency`. Add per-org routing in Vercel middleware (one route that fans out to the right Supabase project). Add cross-region read-only mirrors if needed.
- **Migration:** orgs with `data_residency = 'uk'` stay in `eu-west-2`. Orgs with `'eu'` (none at v1, will exist at v1.5) live in `eu-central-1`. No data movement for existing orgs.

**Consequences for other docs:**
- PRD §4.3 is implemented as "binding per org, single value in v1" (the PRD's own words).
- PRD §7.2 data-residency requirement: satisfied for the pilot cohort.
- The PRD's Appendix B "Data residency" item is closed.

**If a pilot customer refuses to be in `eu-west-2`:** escalate. The trigger above applies — we move to B, even mid-pilot. (Cost: ~5 founder-days, plus a few days of infra ops.)

### 11.2 Audit log — **resolved: append-only with RLS-refusal in v1, hash chain deferred to v1.5**

**The call (2026-06-18):** ship `audit_event` as append-only via RLS-as-permission-model (no `UPDATE`/`DELETE` policies) plus a `BEFORE UPDATE/DELETE` trigger that raises `EXCEPTION`. **No cryptographic hash chain at v1.** `pgcrypto` is enabled at the database level so the v1.5 work is a code change, not a schema migration.

**Why this and not A (hash chain from day 1):**
- Hash chain = SHA-256 of canonical JSON via Postgres `BEFORE INSERT` trigger, per-org chain, nightly validator (pg_cron), audit pack merkle root. ~6 founder-days + ongoing nightly ops.
- The append-only-with-RLS-refusal model handles the **non-malicious-insider** case: a roaster or accountant can't accidentally edit a row, and a misbehaving application can't either. The "UPDATE/DELETE raises exception" trigger is a hard stop.
- The hash chain handles the **malicious-insider** case: a rogue admin with database access who edits the row in place or deletes it and rewrites history. This is the PRD §3 principle 10 scenario.
- Pilot cohort in v1 is small and trusted (founder's direct relationships). The malicious-insider scenario is real for paid GA at scale, not for a 5-roaster pilot.
- The upgrade path to A is clean: add the trigger, add the `hash_prev` + `hash_self` columns, backfill from the existing `audit_event` rows, start the nightly validator. The data is already in order.

**Upgrade path to A (v1.5 or earlier, triggered):**
- **Trigger:** any of (a) first pilot customer asks "what stops a rogue admin from editing an old row?", (b) the per-shipment opt-out is being used in anger and we want cryptographic certainty for the opt-out audit pack, (c) paid GA opens.
- **Work:** Postgres `BEFORE INSERT` trigger computes `hash_prev` (per org) + `hash_self` = SHA-256 of canonical JSON of the row. Nightly pg_cron validator walks the chain per org and pages on break. Audit pack rendering uses the merkle root. ~6 founder-days, mostly trigger + test.
- **Backfill:** one-off script reads existing `audit_event` rows per org, computes the chain forward from a `null` `hash_prev`, writes `hash_prev` + `hash_self`. Re-runnable.

**Consequences for other docs:**
- PRD §3 principle 10 is **partially met**. Events are tamper-resistant (RLS + trigger refuse), not tamper-evident (no chain). The plan calls this out in the §0 read-me-first and the §11.2 box.
- The hash-chain row in §9 is closed.
- Infra Session 5 §3.3 default is the chosen path; no change required.

**Pilot-customer question to pre-empt:** "what stops a rogue admin from editing an old row?" — the v1 answer is "RLS + trigger refuse UPDATE and DELETE on the table; the database refuses the operation." The v1.5 answer is "the cryptographic chain detects any in-place edit or row deletion, including ones that bypass the trigger." This is a known gap, documented in the audit pack, and a sales-blocker only for very risk-sensitive customers.

### 11.3 Other open decisions

- **EU regulatory lawyer review of opt-out phrase + audit-pack legal text** (~£1,500, 2-4 hours, by end of Phase 0). Recommended, blocks v1.5-grade wording. Drives the v1 opt-out phrase text: *"I confirm this shipment does not require a Due Diligence Statement under EUDR. I am the operator of record."*
- **VAT validation: VIES/HMRC public APIs on demand vs paid service** (PRD open Q11). Lean: free, fallback to paid if rate limits bite.
- **Cloud provider decision** (PRD Appendix B — by end of Phase 0). Not blocking 0.1–0.4 (Supabase is the cloud). Becomes load-bearing when a customer asks for "UK or EU sovereign provider" — see PRD §4.3.

---

## 12. Working with this plan

- **This is the only plan.** Future planning work either patches this file (surgical edits) or links out from it. No parallel docs.
- **Phase 0 backlog in §7 is the working queue.** When a card lands, mark it done; when one is in flight, update its status; when one changes scope, edit its row.
- **The validation plan in §8 runs in parallel with Phase 0.** Diary study in W1 doesn't block coding; pilot cohort decisions in W4 are the gate before Phase 1.
- **Resolved decisions in §11 are the founder's history.** New decisions get appended to the log in §13.
- **Anti-scope in §10 is the no list.** When in doubt, check here first; if a task is in this list, push back.

---

## 13. Founder decisions log

Append-only. One row per decision, dated. Future decisions get added at the bottom in the same shape.

| Date | Decision | Source | Consequence | Trigger for revisit |
|---|---|---|---|---|
| 2026-06-18 | Wipe the repo in its entirety; keep only the planning corpus in `.hermes/plans/`; delete tag `freeze-pre-revision`; reset history to a single root commit | Wipe session, founder instruction | Working tree = spec only; `main` = single commit `9366e58`; clean slate for Phase 0 build | None — irreversible |
| 2026-06-18 | **Data residency = UK only at v1.** `Organization.data_residency ∈ {'uk'}` at signup; single Supabase project in `eu-west-2`; `'eu'` value is a schema-level placeholder | Founder call during wipe session | §11.1; all v1 orgs in London; satisfies pilot cohort's residency expectations; PRD §4.3 implemented as "binding, single value in v1" | First EU customer asks for proof of EU-only hosting in writing (PRD §3.2) — move to two-region (B) |
| 2026-06-18 | **Audit log = append-only with RLS-refusal in v1.** `pgcrypto` enabled for forward compatibility; no hash chain at launch | Founder call during wipe session | §11.2; PRD §3 principle 10 partially met (tamper-resistant, not tamper-evident); `audit_event` schema has no `hash_*` columns at v1 | Any of: pilot customer asks "what stops a rogue admin from editing an old row?"; opt-out used in anger; paid GA opens — add hash chain + nightly validator (A) |
| TBD | Pricing tier structure (EUDR module included, not add-on) | PRD §13.2 W4; PRD Appendix B | By end of Phase 0 | n/a |
| TBD | Brand name + domain + visual identity | PRD Appendix B | By end of Phase 0 | n/a |
| TBD | Cloud provider (AWS London/Frankfurt vs Hetzner/OVHcloud) | PRD §4.3; PRD Appendix B | By end of Phase 0; not blocking 0.1–0.4 (Supabase is the cloud) | First customer asks for sovereign provider |
| TBD | EU regulatory lawyer review of opt-out phrase + audit-pack legal text (~£1,500) | PRD open Q18 + Q21 | By end of Phase 0; v1 ships with current phrase text, v1.5 with lawyer-reviewed text | EUDR wording changes; legal counsel needed earlier |

*End of consolidated plan. Next file to write when Phase 0 starts: the per-card acceptance criteria in `.hermes/plans/` as separate small files (or a kanban). This plan is the spec; the cards are the work breakdown.*
