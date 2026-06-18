# Unified Coffee Operations MVP — Product Requirements Document

> **For the team:** This PRD fuses the three MVPs (A: Order Ingest & Roast Planner, B: Variable-Weight Inventory & Traceability, C: Margin Cockpit) into a single shippable product, with **EUDR compliance built in as a fourth pillar from day one** for the **UK and EU** roaster market. The three MVP modules were not separable in the research — every pain point, every case study, and every competitive gap points at the same root cause: **a roaster's "system of record" is fragmented across spreadsheets, roaster apps, ecommerce backends, and accounting tools.** The market gap is the same in the UK/EU as elsewhere, but the regulatory environment is sharper: **EUDR applies to coffee placed on, sold in, or exported from the EU from 30 December 2026**, and UK importers face parallel due-diligence obligations under the UK Forest Risk Commodities regime. Every competitor in the research treats compliance as a feature or a roadmap item. We are making it a first-class product pillar from the first pilot.

**Status:** Draft v1.2 — for engineering review
**Owner:** Product
**Date:** 2026-06-17
**Target market:** United Kingdom + European Union (initial); expansion to US, Canada, AU/NZ in v2
**Target first ship:** Nov 2026 (pilot)
**Target GA:** Q1 2027, ahead of EUDR enforcement

---

## 1. Goal & non-goals

### 1.1 Goal

Ship a single, coffee-native operations platform, **metric by default**, **EUR/GBP-native**, that lets a 1–20-person roastery replace the spreadsheet + email + roaster-app + ecommerce-backend stack with one workflow that handles:

1. **Demand** — orders from every channel, in one place, with a roast need computed automatically
2. **Supply** — green, loose-roasted, and packaged stock with full lot genealogy and variable-weight conversion
3. **Money** — landed cost in EUR/GBP with FX snapshots, margin by SKU/channel/customer, and pricing signals tied to live inventory
4. **Compliance** — EUDR-ready due-diligence statements, geolocation-linked traceability, and audit packs generated automatically from the same lot genealogy that drives operations (no duplicate data entry)

### 1.2 Non-goals (this MVP)

- Roast-curve telemetry / Cropster-style profile capture (Phase 3)
- Café wholesale telemetry (Phase 4)
- Direct roaster hardware control (deferred; import-only is fine)
- Multi-warehouse / multi-roastery (single roastery, single warehouse per org in v1)
- Built-in accounting (we **integrate** with Xero, QuickBooks, and Sage, not replace)
- Marketplace (no third-party roasters on the platform)
- Mobile native apps (responsive web is sufficient for v1)
- US/Canada/AU/NZ market entry (v2; we are UK/EU-only at launch)
- Auto-pricing (we surface signals, the roaster confirms — same as before)
- AI-driven email parsing (rule-based templates in v1)
- **Org-wide EUDR opt-out** (intentionally not in the product; EUDR is a per-shipment obligation and the system enforces per-shipment opt-out only — see §3 principle 11 and §6.5)
- **Auto-skip EUDR for "obviously" non-EU shipments** (the system prompts at the moment of shipment so the roaster makes an active, recorded decision; we do not silently skip)

### 1.3 Why now

The research identified six pain points; the top three — fragmented order capture, variable-weight inventory, and weak margin visibility — have the same fix: a single system of record with the data model below. Vendors split these across products. Customers stitch them badly. The wedge is building the spine first, then layering workflow UIs on top.

In the UK/EU market, that wedge is reinforced by a hard external deadline: **EUDR applies to coffee from 30 December 2026**. Roasters selling into the EU must file a Due Diligence Statement (DDS) for every shipment, supported by geolocation data on the plot of land where the coffee was grown, a risk assessment, and risk-mitigation measures. The UK regime is similar in shape. Roasters who can prove this from their operating system — not as a separate compliance tool, not as a spreadsheet add-on — have a real differentiator at a moment when most competitors are still working out what the regulation means. Building EUDR into the data model from the start is also cheaper than retrofitting: every entity we already need (green lot, supplier, roast batch, packaged lot, shipment) is part of the compliance chain.

**On opt-out:** EUDR is a per-shipment legal obligation, not an org-wide one. A roaster who sells only to UK consumers is in scope for *zero* of those shipments. A roaster who takes a single wholesale order to Berlin is in scope for *that one* shipment. The product must therefore support per-shipment opt-out (§6.5) for the cases where the roaster genuinely cannot file a DDS — but the opt-out is *recorded*, *authorised*, and *audit-defensible*, not silent. The product does not include an "EUDR off" org-wide switch on purpose: it would dilute the USP, weaken the audit story, and put the roaster in a worse position than they would be with no product at all.

---

## 2. Target customer & success criteria

### 2.1 Primary persona: "UK/EU growth-stage roastery"

- 6–20 staff, founder + head roaster + production + 1–2 commercial/admin
- Based in the **UK, Ireland, Netherlands, Germany, France, Nordics, Belgium, Italy, or Spain** (priority geos; see §13 for cohort design)
- Multi-channel: wholesale + DTC + ≥1 of (subscription, café, private label, B2B ingredient supply)
- 1,000–15,000 kg roasted/month (≈2,200–33,000 lbs/mo at the same midpoint; the deep research's "1,000–15,000 lbs" band translates to ~450–6,800 kg/mo) — *see unit note below*
- Currently using: 1 ecommerce backend (Shopify EU or WooCommerce EU) + 1 accounting tool (Xero or Sage; QBO EU is rare) + ≥1 spreadsheet + handwritten or app-based roast log
- **EUDR-exposed (current OR potential)**: at least some of their coffee is sold into EU member states today, OR they are the EU importer of record, OR they supply a roaster/wholesaler who files the DDS, OR they take occasional EU orders. The "potential" part matters because a roaster who is purely UK-UK today but could take an EU order tomorrow is a real persona — and they need the per-shipment opt-out path (§6.5) to handle the first EU order that arrives before they've done the supplier risk paperwork.
- Decision-maker is usually the owner or head of operations
- Buying trigger: a specific event (busy season, new wholesale account, new SKU launch, cash crunch, lost recall, **EUDR deadline anxiety**) — **not** generic "we should modernize"

**Unit note:** the deep research used pounds; this product is metric by default. The deep research's "1,000–15,000 lbs/mo" maps to **~450–6,800 kg/mo** at the rough midpoint. For UK/EU roasters this is the right band: small enough to still have a founder in production, large enough to be multi-channel and EUDR-relevant. A separate sub-persona at **<450 kg/mo** is the "hobbyist / market trader" tier — not v1 target.

### 2.2 Secondary persona: "UK/EU founder-led micro"

- 1–5 staff, single channel dominant (DTC or farmers' market), <450 kg/month
- Likely **not** EUDR-relevant themselves (small direct sales only, no imports of relevance) but may *use* our genealogy features if they supply a B2B customer who is. We do **not** design the core UX for this persona in v1; they can be a later tier or an entry-level plan.

### 2.3 Pilot success criteria (90 days post-onboarding)

| Metric | Target | Why it matters |
|---|---|---|
| Admin time per 100 orders | ↓ ≥50% from baseline | Direct ROI; matches the Andytown / Joe Van Gogh case-study framing |
| Roast start time | Moves earlier by ≥60 min/day | Removes the "couldn't start roasting until 10:30" failure mode |
| Stock count variance | <2% on monthly cycle count | Proves the variable-weight ledger is trustworthy |
| Gross margin visibility | 100% of SKUs have computed landed cost + realised margin | Proves the margin engine is wired into real stock movements |
| Time to produce a lot trace | <5 min for any single outbound shipment | Proves the genealogy is intact |
| **EUDR DDS generation** | **DDS draft generated in <2 min for any shipment in scope, with all required fields populated from the system** | **Proves the compliance data foundation is wired into the operational record** |
| **EUDR data completeness** | **100% of in-scope green lots have a complete `EudrReferenceData` record (geolocation polygon, supplier, country of harvest, harvest year)** | **Proves the roaster can actually file, not just generate an empty form** |
| **Per-shipment EUDR decision coverage** | **100% of shipments have a `ShipmentEudrDecision` recorded, with the correct scope outcome (in_scope_dds_filed / in_scope_opted_out / out_of_scope / below_threshold / opted_in_voluntary) and the correct `mode` for that outcome** | **Proves the per-shipment decision is being made for every shipment, not just for the in-scope ones** |
| Daily active use | ≥1 user logs in on ≥80% of business days | Adoption proxy — past the "set up and forgot" failure mode |

If 3 of 8 are missed at 90 days, the product is not ready for paid GA.

---

## 3. Product principles

These are non-negotiable for v1. Reviewer should reject PRs that violate them.

1. **Coffee-native data model.** The system must understand that one roasted batch becomes many bag sizes, that yield loss is real, that blends inherit component genealogy, and that freshness windows exist. Generic inventory models break on day one — every schema decision flows from this.
2. **One source of truth per concept.** A SKU has one master record. A lot has one record. An order has one record. Integrations sync to it; they do not duplicate it.
3. **Exception-first UI.** The home screen answers "what needs me today?" not "here is your dashboard."
4. **Floor-resilient.** Pack/ship, count, and receive flows must work on tablet, with one-handed use, on patchy Wi-Fi. Offline-tolerant data entry is a v1 requirement (deferred sync queue), not a polish item.
5. **Reverse-traceable.** Every outbound shipment must be traceable to a green lot in ≤3 clicks. Every green lot must be traceable forward to all shipments it fed.
6. **Money is a first-class event, not a derived report.** Margin numbers come from real, auditable cost allocations on real stock movements, not from "config in admin, hope it's right."
7. **Metric by default.** The system is built around **kilograms and grams** as the canonical unit of weight. The product UI shows **kg / g** in every stock context. **Imperial display (lb / oz) is opt-in per user** (UI preference only — never a primary input), and is available for saleable SKUs where the customer-facing pack size is in lb/oz. **The data model and all internal logic never depend on imperial units.** UK customers see kg; US-export customers see lb if explicitly enabled.
8. **EUR/GBP-native.** All money fields are stored as **minor units of an explicit ISO 4217 currency**. The org's `base_currency` is **EUR or GBP** at signup (no USD/USD-equivalent allowed in v1; see §1.2). Multi-currency events (e.g. a green purchase in USD) are FX-snapshotted at event time into the base currency. **VAT is a first-class concept**: every landed cost, packaging cost, and sale is VAT-aware. UK VAT (20% standard, 5%/0% reduced), EU member-state VAT (DE 19%, NL 21%, FR 20%, IE 23%, etc.), and reverse-charge for B2B cross-border are all supported in the data model from day one, even if the full VAT-reporting UI ships in v1.5.
9. **Compliance is operational, not bolted on.** The same record that drives the lot genealogy drives the EUDR Due Diligence Statement. The same supplier record that stores a phone number stores a deforestation-risk status and a geolocation document. The same shipment record that produces a packing slip produces a customs-ready export document. **The roaster never has to re-enter data to be compliant.** If a screen requires manual data entry that another screen already has, the design is wrong.
10. **Regulatory defensibility by default.** Every state-changing action leaves a tamper-evident audit trail (hash-chained events per §7.2). The roaster must be able to hand an auditor a complete, signed, time-ordered record of their supply chain on demand — without it being a fire drill.
11. **EUDR opt-out is per-shipment, never org-wide, and friction-laden by design.** EUDR is a *per-shipment* legal obligation, not an org-wide one. A roaster who sells only to UK consumers for ten months and then takes a single wholesale order to Berlin in month eleven has EUDR exposure *on that one shipment*, not on the previous ten months of UK sales. Therefore: the system does not allow the roaster to "turn off EUDR for the org" — that mode is **not in the product**. Instead, opt-out is a per-shipment decision taken at ship time, in front of the destination country, with explicit acknowledgement of what the opt-out means and an audit-trail event recording who opted out and why. The friction is not user-hostile; it is *audit-defensible*. If a regulator later asks "why did this shipment not have a DDS?", the roaster can answer with a signed record, not with a shrug.

---

## 4. Architecture overview

### 4.1 Module map

The product has **four primary modules** that share **one data spine** and **two system modules** that glue them together.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Demand        Inventory / Trace       Money         Compliance      │
│  ────────      ─────────────────       ──────        ───────────     │
│  Orders        Lots (green /            Landed costs  EUDR ref data  │
│   ↓              roasted / packaged)    BOMs          Supplier due   │
│  Net           Stock ledger              Allocations   diligence      │
│   requirements  Variable-weight          Margin engine  Geolocation   │
│   ↓              conversion                            plots          │
│  Roast         Genealogy graph          Pricing       DDS generator  │
│   planner                                     signals  Audit packs    │
│   ↓                                                       ↑           │
│  Pack & ship ──────────────────────────────────────────────────────  │
└──────────────┬──────────────────────────────┬────────────────────────┘
               │                              │
        ┌──────┴──────┐                ┌──────┴──────┐
        │ Integrations │                │  Identity / │
        │  Hub         │                │  Tenancy    │
        └──────────────┘                └─────────────┘
```

**Four product modules:**

- **M1: Demand** — multi-channel order ingestion, net-requirements engine, daily production board, pack & ship
- **M2: Supply** — green inventory, lot genealogy, stock ledger with variable-weight conversion, count & audit, recall pack
- **M3: Money** — landed cost engine (EUR/GBP, VAT-aware, FX-snapshotted), BOM, margin by SKU/channel/customer, repricing signals
- **M4: Compliance** — EUDR-ready due-diligence statements, geolocation-linked traceability, supplier due-diligence records, audit packs, customs export documents (only M4 is **net-new** relative to the original research's three-MVP framing)

**Two system modules:**

- **S1: Integrations Hub** — Shopify, WooCommerce, Square POS, Xero, Sage, QuickBooks EU, ShipStation, Stripe EU, Mollie, email-in, CSV upload. *See §7 for the EU-specific connector list.*
- **S2: Identity & Tenancy** — auth, RBAC (Owner, Head Roaster, Pack/Ship, Buyer/Receiving, Accountant, Compliance Officer), audit log (hash-chained), org switching, **data residency per org (UK or EU region)**

### 4.2 Data flow (one sentence per path)

1. **Order → stock need:** an order line → SKU + qty + promised-by → net against (packed stock + loose roasted stock + scheduled-roast allocations) → produces a deficit by roast date → rolls up into the daily roast board.
2. **Roast → stock:** a finished roast batch → green weight consumed + yield % → creates a loose-roasted lot in the green warehouse's child space → packages draw from that lot on packing → pack events deduct from loose and create packaged lots.
3. **Cost → margin:** a landed-cost event on a green lot (in EUR, GBP, or another currency with FX snapshot) → rolls up to every roasted lot derived from it → rolls up to every packaged lot derived from those → rolls up to every sale line that draws from those → margin = revenue − (allocated green cost + allocated pack cost + allocated labour), with VAT tracked separately and reported in line with UK/EU VAT rules.
4. **Order → invoice:** shipped order lines → invoice draft in accounting system (push to Xero / Sage / QBO EU) → payment event returns via webhook → margin engine reconciles. **Invoices are VAT-correct by construction** (rate, reverse-charge flag, B2B vs B2C logic) so the roaster's MTD/VAT return is a one-click export, not a manual reconciliation.
5. **Green receipt → EUDR reference:** a green lot is received with a supplier document and a **geolocation polygon** (the plot of land where the coffee was grown, as required by EUDR Article 9) → the system creates an `EudrReferenceData` record linked to the lot → risk assessment status is recorded (low / standard / high) → the lot is roasteable, and every downstream shipment that draws from it is in-scope for a DDS.
6. **Shipment → DDS:** an outbound shipment is confirmed → the system computes the set of in-scope green lots feeding it → drafts a **Due Diligence Statement** with all EUDR-required fields (operator/importer identifiers, product description, HS code 0901, country of harvest, geolocation, supplier DDS reference if the supplier has filed upstream) → the operator reviews, signs, and submits to the EU Information System via the **TRACES-like API** (or exports the PDF for manual filing in v1; full API integration is v1.5).

### 4.3 Deployment shape

- Multi-tenant SaaS, single Postgres + per-tenant row-level isolation (RLS) for the v1 data plane
- API server: typed (TypeScript or Go) with a generated OpenAPI spec
- Frontend: SPA (React) with route-level code splitting
- Background workers: for net-requirements recompute, integration syncs, margin rollups, EUDR risk-assessment recompute
- Event log: append-only, hash-chained per tenant for audit defensibility
- File storage: S3-compatible (supplier docs, cupping sheets, exported audit packs, geolocation polygon files)
- **UK/EU data residency:** at signup, each org chooses **UK** (London) or **EU** (Frankfurt or Dublin) as its data region. The choice is binding for the org's lifetime in v1; cross-region migration is a v2 ops project. This satisfies the UK GDPR / EU GDPR "data stays in region" expectations of most enterprise customers and removes a sales-blocker for any roaster that has been asked by their wholesale customer about cross-border data flows.
- **Hosting provider preference:** a UK or EU-domiciled cloud provider (e.g. AWS London / Frankfurt / Ireland, or a sovereign provider like Hetzner or OVHcloud) is required for the v1 launch. This is a procurement constraint, not just an engineering one — wholesale customers will ask.
- **EUDR Information System integration:** in v1 we generate the DDS payload as a signed JSON and produce a printable PDF; full API submission to the EU TRACES-like system is v1.5 (the EU is still finalising the API; our design must not lock us into pre-finalisation shapes).

(Tech stack choices — language, framework, specific hosting provider — are out of scope for this PRD; see separate infra doc when it's written.)

---

## 5. Data model (the spine)

This is the **load-bearing** part of the document. Review carefully.

### 5.1 Core entities (v1)

#### `Organization`
A roastery tenant. One roastery = one org in v1. Sub-orgs (e.g. multi-location) are not in scope.

```
id, name, legal_name, trading_name?,
country_code: text,        -- ISO 3166-1 alpha-2, e.g. 'GB', 'IE', 'NL', 'DE'
region: text,              -- 'GB' | 'IE' | 'NL' | 'DE' | 'FR' | 'BE' | 'IT' | 'ES' | 'SE' | 'DK' | 'FI' | 'NO' | 'AT' | 'PL' | 'PT' | 'CH'
base_currency: text,        -- ISO 4217; v1 constraint: 'EUR' | 'GBP' only
vat_number?: text,          -- e.g. 'GB123456789' or 'NL123456789B01'
data_residency: 'uk' | 'eu',
timezone: text,             -- IANA, e.g. 'Europe/London', 'Europe/Amsterdam'
units: { weight: 'metric', display_imperial: bool, currency_display: 'code' | 'symbol' },
eudr_settings: {
  default_mode: 'enforce' | 'flag_only',   -- see §6.5; org-level default; cannot be 'opt_out_org' (that mode is not in the product)
  default_mode_set_at, default_mode_set_by_user_id,
  small_quantity_threshold_kg: numeric(6,3) DEFAULT 1.0,  -- EUDR negligible-quantity threshold
  require_opt_out_reason: bool DEFAULT true,              -- per-shipment opt-out must include a reason
  require_opt_out_double_confirm: bool DEFAULT true,      -- roaster must type a confirmation phrase
},
created_at
```

**Invariants:**
- `base_currency IN ('EUR', 'GBP')` enforced at DB level.
- `data_residency = 'uk' iff country_code in {'GB'} else 'eu'`. Roasters in the UK get UK residency; everyone else gets EU residency. (Channel Islands and Isle of Man use 'uk'; Crown Dependencies are out of scope for v1.)
- For orgs in Northern Ireland (post-Brexit, dual VAT regime), `region` is set explicitly with a flag — see open question §11.
- **`eudr_settings.default_mode = 'opt_out_org'` is not a valid value at any time.** The product does not support an org-wide opt-out. The `default_mode` is a default applied to *new shipments* — it can be `enforce` (block shipment if DDS cannot be generated) or `flag_only` (warn but allow with per-shipment opt-out). The actual decision is made per shipment at ship time. See §6.5.

#### `User` & `Membership`
Standard auth model. `Membership(org_id, user_id, role)` with roles: `owner`, `head_roaster`, `packer`, `buyer`, `accountant`, `compliance_officer`, `readonly`.

The `compliance_officer` role is **net-new** for the UK/EU build. It has the same read scope as `readonly`, plus write access to: supplier due-diligence records, EUDR reference data, DDS drafts and submissions, and certification/audit-pack exports. It does **not** have write access to stock, recipes, or pricing. This separation matters because in many roasteries the person who handles compliance (often the owner themselves, or a part-time admin) should not be able to edit a roast event by accident — and conversely, the head roaster should not be able to edit a supplier's deforestation-risk status.

**Opt-out authorisation:** the per-shipment opt-out (§6.5) can only be performed by a user with one of the following roles: `owner`, `compliance_officer`, or `head_roaster`. The `packer` and `accountant` roles cannot opt a shipment out. The `readonly` role cannot opt a shipment out. The system records the *user_id* of the person who took the opt-out decision in the audit log. This is a separation-of-duties control: the person who physically packs the box is not the person who decides "this shipment doesn't need a DDS."

#### `Sku` (Stock Keeping Unit — the *saleable* thing)
The thing a customer orders. One green lot can produce many SKUs (e.g. 250g bag, 1kg bag). One SKU can come from many lots.

```
id, org_id, name, slug,
kind: 'whole_bean' | 'ground' | 'pod' | 'capsule' | 'subscription_unit' | 'other',
-- CANONICAL storage is always grams. UI display unit is a presentation choice.
unit_weight_g: int,                          -- canonical weight of one saleable unit, in grams
unit_weight_g_exact: numeric(10,3),          -- exact (e.g. 250.000); unit_weight_g is the rounded/practical value
display_unit: 'g' | 'kg' | 'lb' | 'oz',      -- primary unit shown in the shop; lb/oz allowed here only as a customer-facing display
display_unit_secondary?: 'g' | 'kg' | 'lb' | 'oz',  -- if set, shown alongside the primary (e.g. "1 kg (2.2 lb)")
packaged_lot_id?: uuid,                      -- points to current pack spec (see §5.5)
recipe_id?: uuid,                            -- points at a BOM (see §5.7) if blended
default_packaging_id?: uuid,
is_active: bool, channel_visibility: jsonb,
created_at, updated_at
```

**Invariants:**
- `unit_weight_g > 0` always; v1 sets a soft min of 50g (smallest realistic bag) and a soft max of 30kg (largest realistic case), enforced at admin-time only.
- `unit_weight_g_exact` must be within ±0.5% of `unit_weight_g / 1000 × 1000` — i.e. the rounded and exact values must be in agreement. This catches the "12oz bag stored as 340g but we rounded to 350g" error.
- `display_unit` is presentation only. **All internal calculations, allocations, count adjustments, and stock movements use `unit_weight_g`.** A 1kg SKU and a 2.2lb SKU with `unit_weight_g = 1000` are the same SKU in inventory terms; the lb display is just for the shop and the invoice.
- Pricing is stored in `PriceListEntry.unit_price_cents` per `display_unit` (so a 1kg SKU priced at £24 and a 2.2lb SKU priced at £53 are two entries on the same internal SKU — but in practice most roasters pick one display unit per SKU and stick with it).

#### `GreenLot` (green coffee, in warehouse)
The atomic unit of incoming supply.

```
id, org_id, supplier_id, supplier_lot_code, internal_lot_code,
origin_country, origin_region, farm?, process?, varietal?,
grade_score, harvest_year,
arrival_date, warehouse_location_id,
green_weight_kg: numeric(12,3),     -- authoritative; receipts/issuances derive from this
green_weight_remaining_kg: numeric(12,3),
landed_cost_total_cents: bigint,
landed_cost_per_kg_cents: bigint,  -- = landed_cost_total / green_weight
status: 'available' | 'reserved' | 'depleted' | 'quarantined',
created_at
```

**Invariants:**
- `green_weight_remaining_kg <= green_weight_kg` always.
- Once status is `depleted`, no further issuances.
- `landed_cost_per_kg_cents` is recomputed on every landed-cost event (see §5.8).

#### `RoastBatch` (a finished roast event)
The atomic unit of production.

```
id, org_id, planned_roast_id?: uuid,         -- link to planning event
roaster_user_id, machine_id?, started_at, completed_at,
green_lot_components: jsonb,                  -- [{green_lot_id, kg_used, cost_basis_per_kg_cents}]
green_weight_in_kg: numeric(12,3),
roasted_weight_out_kg: numeric(12,3),        -- loose roasted weight
yield_pct: numeric(5,3),                      -- = roasted_weight_out / green_weight_in × 100, stored for analysis
profile_ref?: text,                           -- free-text or external ID; v1 is not a profile logger
status: 'planned' | 'in_progress' | 'completed' | 'lost',
created_at
```

**Why JSONB for components:** blends need to support multiple green lots, each with its own cost basis. A relational child table is cleaner long-term but JSONB is fine for v1 with a generated column for querying.

#### `RoastedLot` (loose roasted coffee, post-roast pre-pack)
Created on `RoastBatch.completed`. This is the inventory that pack stations draw from.

```
id, org_id, roast_batch_id,
roasted_weight_kg, roasted_weight_remaining_kg,
cost_basis_per_kg_cents: bigint,              -- rolled up from green components + labour
status: 'available' | 'reserved' | 'depleted',
rest_until?: timestamp,                       -- enforced for some profiles
created_at
```

#### `PackagedLot` (finished bags/cases ready to ship)
The atomic unit of outbound inventory.

```
id, org_id, sku_id,
source_roasted_lot_components: jsonb,         -- [{roasted_lot_id, kg_consumed}]
quantity: int,                                -- number of units (bags)
unit_weight_g: int,                           -- weight of one unit
total_weight_kg: numeric(12,3),               -- = quantity × unit_weight_g / 1000
weight_remaining_kg: numeric(12,3),
cost_basis_per_unit_cents: bigint,            -- = (sum of roasted-lot cost consumed + packaging cost) / quantity
status: 'available' | 'reserved' | 'depleted',
packaged_at, expires_at,                      -- freshness window from SKU
created_at
```

#### `Order`, `OrderLine`
```
Order:
  id, org_id, channel: 'shopify' | 'woocommerce' | 'square' | 'wholesale_portal' | 'email_in' | 'manual',
  external_id?: text,                          -- upstream order id
  customer_id, status: 'received' | 'planned' | 'roasting' | 'packing' | 'shipped' | 'invoiced' | 'cancelled',
  promised_by, placed_at, notes, created_at

OrderLine:
  id, order_id, sku_id, quantity, unit_price_cents, discount_cents,
  status: 'open' | 'allocated' | 'packed' | 'shipped' | 'cancelled',
  allocated_packaged_lot_id?: uuid,            -- the packaged lot this line is being pulled from
```

### 5.2 Variable-weight conversion (the coffee-specific part)

This is the part that breaks generic inventory. The rule:

> **Inventory of truth is mass in grams. Saleable SKUs express mass in customer-friendly units, metric by default. Conversion is exact math, not a flag.**

Specifically:
- Every `Sku` has a canonical `unit_weight_g`. **All allocations, pack events, count adjustments, and stock movements are in grams internally** and reported as kg in the UI (1 kg = 1000 g exactly; no rounding).
- The `display_unit` is what the customer sees. The common UK/EU pattern: `display_unit = 'g'` for 200g/250g/340g/500g/750g/1kg bags, `'kg'` for 1kg+ formats. Roasters exporting to US/UK niche customers may use `display_unit = 'lb'` or `'oz'` — that is purely a customer-facing presentation.
- A bag of 250g is exactly 250g. The `unit_weight_g_exact` field exists for the rare cases where the bag is *declared* as 250g but the packer may be slightly off (e.g. EU pre-pack rules on average weight); this lets the system warn on variance.
- Allocations deduct `quantity × unit_weight_g / 1000` from `PackagedLot.weight_remaining_kg`.
- Counts and stock adjustments are in **kg**, not in bags — this is the most common point of error in competing tools.

**Edge cases the data model must handle explicitly:**

| Case | Behavior |
|---|---|
| Sell in g, weigh in kg | Internal canonical is g. Display layer converts. No precision drift. |
| 1kg bag vs 250g bag of the same coffee | Two SKUs (`bag_1kg`, `bag_250g`), same `RoastedLot` source. Pack events move weight from `RoastedLot` → multiple `PackagedLot`s. |
| 1kg bag priced as £24 (display) vs 2.2lb priced as $30 (display) | One SKU, two `PriceListEntry` rows on different price lists. Internal inventory is identical. |
| Bag marked as 250g but actual pack weight varies | Pack event records *actual* weight packed; variance is logged. If actual < declared by >2%, system warns the packer. EU pre-pack averaging rules (EU Directive 76/211/EEC, retained in UK law) require the average to be at or above nominal; a sub-2% warning threshold is a soft signal, not a regulatory check. |
| Loose roasted → split between two pack runs | Single `RoastedLot` with `weight_remaining_g` decrementing across multiple `PackagedLot`s created over time. |
| Blend (e.g. 70% Ethiopia / 30% Colombia) | `Sku.recipe_id` → `Recipe` → list of `RoastedLot` sources with weight %. Cost = weighted sum of source cost basis. |
| Customer lot assignment | A specific `GreenLot` is reserved for a specific customer (private label, espresso contract). Enforced via a `LotAllocation` from `Order` → `RoastBatch` plan, blocking the lot from other orders. |
| Returns / refunds | Creates a `StockMovement` (see §5.4) returning the packaged lot to `available` if seal intact, else to `quarantine`. |
| Display unit change after launch | Allowed. The system warns if the change would re-price the SKU on any active price list (since `unit_price_cents` is per display unit). |
| EU pre-pack averaging | Stored as a `Packaging.eumr_compliant: bool` flag. When set, pack events record every individual bag weight (in g) so the lot can be audited against EU/UK average-weight rules. (Out-of-scope flow for v1 launch — flag is captured, full audit UI is v1.5. The data is there from day one.) |

### 5.3 Genealogy graph

The graph is implicit in the foreign keys / JSONB references above, but we expose it as a queryable structure for the recall and audit pack features.

**Forward trace** (green → shipments): given a `GreenLot`, find all `RoastBatch`es using it → all `RoastedLot`s → all `PackagedLot`s → all `OrderLine`s allocated from them → all `Order`s.

**Reverse trace** (shipment → green): given an `OrderLine`, find its `PackagedLot` → its `RoastedLot` source(s) → the `RoastBatch` → its `green_lot_components`.

**Materialized view:** `lot_genealogy` is a denormalized table rebuilt on stock movements, optimized for "all shipments from this green lot" lookups in O(1).

### 5.4 Stock movements (the immutable ledger)

**Every** change to a lot's `*_weight_remaining_*` is recorded as a `StockMovement`:

```
id, org_id, lot_type: 'green' | 'roasted' | 'packaged',
lot_id, movement_type: 'receipt' | 'roast_consume' | 'roast_produce' | 'pack_consume' | 'pack_produce' | 'sale' | 'return' | 'count_adjust' | 'transfer' | 'destroy',
delta_weight_kg: numeric(12,3),  -- signed
reference_type?: text, reference_id?: uuid,  -- e.g. 'roast_batch', 'order_line'
user_id, occurred_at, created_at,
audit_hash_chain_prev?: text, audit_hash_chain_self?: text
```

**Invariants:**
- Movements are append-only. Corrections are new movements, not edits. (This is non-negotiable for audit defensibility.)
- `sum(delta_weight_kg)` for a lot across all its movements, plus the opening balance, must equal current `weight_remaining_kg`. A nightly job checks this; mismatches page the on-call.
- For `packaged` lots, the movements are also tracked in **units** as a secondary derived stream (units = weight_kg × 1000 / unit_weight_g) for reporting.

### 5.5 Packaging definitions

A `Packaging` is a bill-of-material-style spec for a SKU.

```
id, org_id, name, unit_weight_g, unit_weight_g_exact, units_per_case?: int,
component_costs: jsonb,  -- [{component: 'bag'|'label'|'box'|'ink', cost_cents, qty_per_unit}]
```

Links from `Sku.default_packaging_id`. The cost components on the packaging feed the per-unit cost basis of `PackagedLot`.

### 5.6 Compliance entities (EUDR) — **net-new for UK/EU build**

These are the entities that make the product a *compliance* product, not just an operations product. They are first-class in the data model from day one, not bolted on at the end. The shapes below are designed around the EUDR Information System's published schema (Article 9 due-diligence statement and geolocation requirements) plus the UK Forest Risk Commodities (Importer) due-diligence statement, which has a similar but not identical shape. Where the two regimes diverge, we capture both fields and let the system emit the correct DDS for the shipment's destination.

#### `Supplier`

The supplier of a green lot. EUDR-grade due diligence is stored here, not on the lot — because due diligence is fundamentally about the *supplier relationship* and is reusable across lots.

```
id, org_id, name, legal_name?, country_of_registration,
addresses: jsonb,                    -- [{type: 'hq'|'warehouse', lines, city, region, country, postal_code}]
contacts: jsonb,                     -- [{role, name, email, phone}]
eori?: text,                         -- UK EORI or EU EORI; required for customs/B2B
dds_reference?: text,                -- upstream DDS reference (if the supplier has filed in their own system)
risk_assessment: {
  country_risk: 'low' | 'standard' | 'high',
  producer_risk: 'low' | 'standard' | 'high',
  supply_chain_risk: 'low' | 'standard' | 'high',
  overall: 'low' | 'standard' | 'high',
  assessed_at, assessed_by_user_id,
  notes?
},
certifications: jsonb,              -- [{name, issuer, valid_from, valid_to, doc_id, doc_storage_key}]
deforestation_policy_url?: text,
created_at, updated_at
```

**Invariants:**
- A supplier must have a non-null `country_of_registration` and at least one address.
- `risk_assessment` is required to roast any green lot from this supplier (system blocks roasting if missing — see §6.4).

#### `Producer` (the farm or co-operative)

EUDR requires geolocation data for the *plot of land* where the coffee was grown. Producers are first-class entities because the same producer supplies across many lots and seasons.

```
id, org_id, name, producer_type: 'farm' | 'cooperative' | 'estate' | 'smallholder_group',
country: text,                       -- ISO 3166-1 alpha-2
region?: text, department?: text,
geolocation: {
  type: 'polygon',                   -- GeoJSON polygon
  coordinates: jsonb                 -- [[ [lon, lat], ... ]] (GeoJSON order: lon first)
},
area_hectares: numeric(10,4),
altitude_m?: int,
certifications: jsonb,              -- organic, Fairtrade, Rainforest Alliance, etc.
verification: {
  source: 'self_reported' | 'third_party_verified' | 'satellite_imagery' | 'ground_survey',
  verified_at?, verified_by?, evidence_doc_id?
},
created_at, updated_at
```

**Invariants:**
- `geolocation.coordinates` must be a valid closed polygon (first coordinate = last coordinate).
- A producer with `verification.source = 'self_reported'` cannot be used for any green lot destined for EU export (UK regimes accept self-reported at v1; EU does not — see open question §11 for the smallholder workaround).
- Polygon area is sanity-checked against `area_hectares` on save (warns if delta >20%).

#### `EudrReferenceData` (per green lot, the EUDR-specific record)

This is the entity that closes the loop between operations and compliance. Created when a green lot is received; required for the lot to be roasteable.

```
id, org_id, green_lot_id, supplier_id,
producer_id,                          -- the Producer entity
country_of_harvest: text,             -- ISO 3166-1 alpha-2, e.g. 'BR', 'ET', 'CO'
harvest_year: int,                    -- e.g. 2025
hs_code: text,                        -- default '0901' for green coffee
product_description: text,            -- free text, e.g. 'Green coffee, Arabica, washed, Brazil Cerrado'
net_mass_kg: numeric(12,3),           -- at receipt; never goes negative
geolocation_doc_id?: uuid,            -- file in storage; the actual polygon/KML/shapefile
verification_doc_ids: jsonb,          -- supporting documents (organic cert, producer statement, satellite screenshot, etc.)
producer_statement_doc_id?: uuid,     -- the EUDR producer statement (where available)
risk_status: 'pending' | 'low' | 'standard' | 'high',  -- rolled up from supplier.risk_assessment + producer
risk_status_set_at, risk_status_set_by_user_id,
dds_state: 'not_required' | 'pending' | 'drafted' | 'submitted' | 'acknowledged' | 'rejected',
notes?, created_at, updated_at
```

**Invariants:**
- One `EudrReferenceData` per `GreenLot`. (A green lot from a single producer has one record; a green lot blended at origin across multiple producers has one record per producer linked via a `LotProducer` join — see open question §11 for the in-v1 vs v1.5 decision.)
- `country_of_harvest` cannot be a high-risk country (per EUDR Annex I; in v1 we ship the EU's published list as a static reference table, refreshed quarterly by an internal job) without an explicit override by an `owner` user, recorded in the audit log.
- `risk_status` is **denormalised** from `supplier.risk_assessment` and `producer.verification` for fast queries; a trigger recomputes it on any of those changes.

#### `LotProducer` (the blend-origin case)

Used only when a green lot is sourced from multiple producers and the roaster needs to report the polygon for each. (See open question §11 for the v1 vs v1.5 decision.)

```
id, green_lot_id, producer_id, pct_of_lot: numeric(5,4)  -- 0.0–1.0
```

**Invariants:**
- For any `green_lot_id`, `sum(pct_of_lot)` over all `LotProducer` rows must be 1.0 ± 0.01.

#### `ShipmentEudrDecision` (per-shipment opt-out / opt-in decision)

This is the entity that captures the **per-shipment** EUDR decision — the alternative to a `DdsDraft` for shipments that the roaster has decided do not require one. Created at ship time, *not* at org creation, *not* at green receipt. The system records this for *every* shipment where EUDR is potentially applicable, with the actual decision and the user's reasoning.

```
id, org_id, shipment_id,
in_scope_determination: {
  destination_country: text,
  destination_is_eu_member: bool,    -- computed at decision time; cached for audit
  shipment_net_mass_kg: numeric(12,3),
  below_small_quantity_threshold: bool,  -- true if mass < org.eudr_settings.small_quantity_threshold_kg
  scope_decision: 'in_scope_requires_dds' | 'in_scope_opted_out' | 'out_of_scope_destination' | 'below_threshold' | 'opted_in_voluntary',
  determination_at, determination_logic_version: text,  -- for replay safety if scope rules change
},
decision: {
  mode: 'file_dds' | 'opt_out',  -- what the roaster chose
  reason_code?: 'not_for_resale' | 'sample' | 'gift' | 'personal_use' | 'returned_goods' | 'transit_only' | 'below_threshold' | 'pre_eudr_stock' | 'other',
  reason_text?: text,             -- free-text, max 500 chars, required if reason_code = 'other'
  destination_context: text,      -- auto-populated from Order; e.g. 'Berlin, DE — B2B wholesale'
  confirmation_phrase_typed?: text,  -- the exact phrase the user typed (see §6.5.4)
  confirmation_phrase_required: text, -- what the system asked for
  decided_at, decided_by_user_id,
  decided_by_user_role: text,     -- snapshot of the role at decision time
},
audit_pack_doc_id?: uuid,         -- signed bundle of the decision (in particular for opted-out shipments)
created_at
```

**Invariants:**
- Every shipment has **exactly one** `ShipmentEudrDecision`. This is non-negotiable. The system creates the record even for UK-UK shipments with `scope_decision = 'out_of_scope_destination'`, so the chain of decisions is complete and auditable.
- A `ShipmentEudrDecision` is **append-only** like all audit-relevant records. A correction is a *new* decision linking back to the prior one with a `supersedes_id` field; the original is preserved. *(See open question §11 for whether `supersedes_id` is in v1.0 or v1.1; my recommendation is v1.0.)*
- A decision of `mode = 'opt_out'` requires:
  - a non-null `reason_code` (and `reason_text` if `reason_code = 'other'`)
  - a `decided_by_user_role` in {`owner`, `compliance_officer`, `head_roster`}
  - a `confirmation_phrase_typed` that exactly matches the system-required phrase
  - a non-null `audit_pack_doc_id` (the system generates the opt-out audit pack at decision time)
- The `audit_pack_doc_id` for an opted-out shipment is a real, signed, downloadable PDF. It contains: the shipment record, the lot genealogy, the user's reason, the user's role, the timestamp, the destination country, the legal text of the opt-out acknowledgement, and the hash chain entry. **This is the document the roaster hands to a regulator if asked "why did this shipment not have a DDS?"**
- The system never silently defaults to `opt_out`. If the roaster does not make an active decision, the shipment is **blocked** (in `enforce` mode) or **flagged with a daily-board warning** (in `flag_only` mode). There is no "EUDR is off" silent path.

**Edge cases:**

| Case | Behavior |
|---|---|
| Shipment destination is GB only | Auto-creates `ShipmentEudrDecision` with `scope_decision = 'out_of_scope_destination'`, `mode = 'file_dds'` (vacuous), no DDS generated. Logged for completeness. |
| Shipment destination is GB + the roaster self-declares the lot is for personal use | Auto-creates with `scope_decision = 'out_of_scope_destination'`. If the roaster wants to file a DDS *voluntarily* (e.g. for customer reassurance), they can do so: `scope_decision = 'opted_in_voluntary'`, `mode = 'file_dds'`. |
| Shipment destination is DE and net mass is 0.8 kg (below 1 kg threshold) | Auto-creates with `scope_decision = 'below_threshold'`. No DDS required. Logged. (Threshold value is `Organization.eudr_settings.small_quantity_threshold_kg`; default 1.0 kg, EUDR's published threshold.) |
| Shipment destination is DE and net mass is 1.4 kg (above threshold) | Auto-creates with `scope_decision = 'in_scope_requires_dds'`. Roaster must either sign a DDS or take the opt-out path with full friction. |
| Shipment destination is CH (Switzerland) | CH is not in the EU; falls under `out_of_scope_destination`. UK FRC and Swiss TREES apply separately; we do not manage those in v1. Logged as `out_of_scope_destination` with a note. |
| Shipment destination is XI (Northern Ireland) | Windsor Framework rules apply. The system treats NI as GB for residency, but EU for goods — `scope_decision = 'in_scope_requires_dds'`. See open question §11 for the NI VAT edge case. |
| Roaster tries to opt out a shipment going to DE | Friction path (§6.5.4): reason required, double-confirm required, audit pack generated. Cannot be done by `packer` role. |
| Roaster tries to opt out a shipment going to FR (EU) but the green lot is from a country with no risk assessment | System **blocks** opt-out. The system says: "The lot you're shipping has no risk assessment; you cannot opt this shipment out. You must either (a) add a risk assessment, (b) choose a different lot for this shipment, or (c) hold the shipment." |
| Roaster tries to opt out a shipment where the green lot is on a published EU high-risk list | System **blocks** opt-out, same as above. The published EU high-risk country list is treated as a hard floor; opt-out is not a workaround for prohibited origins. |

#### `DdsDraft` (a Due Diligence Statement, in draft or submitted)

A draft is generated automatically by the system when a shipment is in scope. The roaster reviews and either signs (which transitions to `submitted` in v1, or transmits via API in v1.5) or sends back for changes.

```
id, org_id, shipment_id?,              -- the shipment this DDS is for (one DDS per shipment in v1)
green_lot_ids: uuid[],                 -- the in-scope green lots feeding the shipment
operator: {
  name, address_country, address_lines, vat_number, eori?
},                                     -- pulled from Organization at generation time
product: {
  description, hs_code,                -- default '0901'
  net_mass_kg,
  country_of_harvest,                  -- single value if all lots share origin; multi-value list otherwise
  geolocation_summary: jsonb,          -- list of polygons, possibly aggregated
},
supplier_references: jsonb,            -- upstream DDS references per supplier, if any
risk_assessment_summary: text,         -- auto-generated narrative; roaster can edit
risk_mitigation_summary: text,         -- auto-generated; roaster can edit
status: 'draft' | 'pending_review' | 'signed' | 'submitted' | 'acknowledged' | 'rejected',
generated_at, signed_at?, signed_by_user_id?, submitted_at?, submitted_via: 'manual' | 'traces_api',
destination_country: text,             -- EU member state code; required
destination_eori?: text,               -- consignee EORI if known
regulator_reference?: text,            -- assigned on submission (EU) or DEFRA/UK regime equivalent
audit_pack_doc_id?: uuid,              -- the bundled PDF/JSON for this DDS
created_at, updated_at
```

**Invariants:**
- A `DdsDraft` cannot transition to `signed` unless all `EudrReferenceData` rows for its `green_lot_ids` have `risk_status != 'pending'` and a valid `geolocation_doc_id`.
- Once `signed`, fields are immutable except for `regulator_reference` (assigned on submission) and the `status` field (which is updated via a submission-event webhook).
- One `DdsDraft` per outbound shipment in v1; if the same shipment contains two green lots from different countries, the DDS is generated with multi-origin product info, not split into multiple DDSs (matches the EU's "operator may consolidate" allowance).

#### `AuditPack`

The exportable, signed bundle that ties a compliance story to a shipment. Generated on demand.

```
id, org_id,
scope: 'shipment' | 'period' | 'supplier' | 'recall',
reference_type: text, reference_id: uuid,
contents: jsonb,                       -- the bundle's table of contents
storage_key: text,                     -- the signed PDF/JSON in object storage
hash_chain: text,                      -- merkle root of the bundled events
signed_at, signed_by_user_id,
expires_at?,                           -- for shareable read-only links
download_count: int
```

**Behavior:**
- Generated from a shipment → produces a single PDF containing: the DDS draft, the lot genealogy chart (green → shipment), the supplier due-diligence record, the producer geolocation, the chain-of-custody log, the relevant stock movements, and a signed manifest.
- Generated from a recall scope → produces a CSV/PDF of all affected shipments plus the upstream chain.
- Generated from a period scope → produces a compliance pack for a date range (e.g. "all Q4 2026 DDSs and their supporting evidence").
- Generated from a supplier scope → produces the supplier's full due-diligence file (used for onboarding reviews and for B2B customers asking "is this supplier verified?").

**Invariants:**
- `audit_pack_doc_id` is **never deleted or edited** once created. Audit packs are append-only artifacts.
- The PDF includes a cover page with the org name, generation timestamp, hash chain, and a QR code linking to a read-only verification URL.

### 5.7 Recipes (blends)

```
Recipe:
  id, org_id, name,
  components: jsonb,  -- [{sku_or_roasted_lot_ref, pct: 0.0-1.0, tolerance_pct: 0.0-0.05}]
  expected_yield_pct: numeric(5,3)
```

A SKU with a `recipe_id` cannot be packed from a single `RoastedLot`; its `PackagedLot` source components must sum to 100% ± tolerance.

### 5.8 Landed cost events (the money spine)

A `LandedCostEvent` is attached to a `GreenLot` and represents a cost that hits the lot at a specific point in time.

```
id, org_id, green_lot_id,
kind: 'purchase' | 'freight' | 'duty' | 'inspection' | 'insurance' | 'storage' | 'adjustment',
amount_cents: bigint, currency: text, fx_rate_to_base: numeric(12,6),
amount_base_cents: bigint,             -- denormalised: amount_cents × fx_rate_to_base, snapshotted at event time
vat_cents: bigint, vat_currency: text, -- VAT paid on this cost line (often reclaimable as input VAT for B2B roasters)
is_vat_recoverable: bool,              -- default true; false for exempt categories (e.g. some import duties)
occurred_at, document_ref?: text, notes?, created_at
```

**Behavior:**
- On event create, recompute `GreenLot.landed_cost_total_cents` and `landed_cost_per_kg_cents` in the org's base currency.
- On any `RoastBatch` using the lot, snapshot the lot's `landed_cost_per_kg_cents` into the `RoastBatch.green_lot_components[].cost_basis_per_kg_cents`. **This snapshot is immutable** even if later landed costs hit the lot — the rationale: those later costs are not the cost of the *coffee* already roasted, they're the cost of remaining green. Late-arriving costs create `LandedCostEvent`s with a `target_remaining_only` flag that only affects the unroasted portion.
- Cost basis cascades down: green lot → roast batch → roasted lot → packaged lot → order line.
- VAT handling: recoverable VAT is tracked separately and excluded from the cost basis used in margin (it is recovered via the VAT return, not against the cost of goods). Non-recoverable VAT is folded into the cost basis. The `is_vat_recoverable` flag is the roaster's accountant's call, not the system's; the UI surfaces the choice clearly.

### 5.9 Margin engine

**Realised margin per sale line:**
```
margin_cents = revenue_ex_vat_cents − allocated_green_cost_cents − allocated_packaging_cost_cents − allocated_labour_cents
```
Where:
- `revenue_ex_vat_cents` = unit price × quantity, **excluding VAT** (we always report margin ex-VAT in the UK/EU market because VAT is a pass-through for B2C and a recoverable input for B2B).
- `allocated_green_cost` = sum over the packaged lot's roasted-lot sources of (kg consumed × cost_basis_per_kg at time of roast) — already snapshotted, ex-VAT, in the org base currency.
- `allocated_packaging_cost` = `quantity × Packaging.component_costs sum`, ex-VAT.
- `allocated_labour` = derived from a per-org labour rate (cents per kg roasted) × kg of green that fed the sale line. Stored as a single org-level config, not per-roast, in v1.

**Margin views in v1:**
- By SKU (last 30 / 90 / 365 days), always ex-VAT
- By channel (group orders by `Order.channel`)
- By customer (group by `Order.customer_id`)
- Forward-looking: estimated margin on open orders, using the lot cost basis that *would* be allocated if the order shipped from current stock + currently-planned roasts.

**Pricing signals:**
- "Reprice candidates": SKUs whose trailing 30-day realised margin is < target margin, sorted by volume.
- "Stale prices": SKUs whose last `PriceList` entry is >N days old (configurable).
- "Lot expiry cost": if a `PackagedLot` is within 14 days of `expires_at` and unsold, the engine flags it as at-risk (does *not* auto-discount in v1).

### 5.10 Pricing

A `PriceList` model — simple, channel-aware, customer-tier-aware in v1.

```
PriceList:
  id, org_id, name, channel?: text, customer_tag?: text, currency: text, is_default: bool,
  is_vat_inclusive: bool               -- UK/EU default true (B2C display); B2B is often ex-VAT

PriceListEntry:
  id, price_list_id, sku_id,
  unit_price_cents,                     -- in the price list's currency, in the price list's VAT mode
  min_qty?: int, valid_from, valid_to?
```

**Behavior:**
- The system stores the price *as configured* (VAT-inclusive or ex-VAT) and converts to the comparison mode for the margin engine. This means a £12.50 VAT-inclusive entry and a £10.42 ex-VAT entry for the same SKU are recognised as the same price.
- When a `PriceListEntry` is updated, the system records a `PriceChangeEvent` for traceability. Margin engine recomputes realised margin on the next sale.
- **VAT rate resolution:** each entry implicitly inherits a VAT rate. For B2C, the roaster's standard rate (e.g. 20% UK, 21% NL). For B2B, the rate depends on the destination country (B2B cross-border is reverse-charge and zero-rated if the customer has a valid VAT number; domestic B2B is the standard rate). The system surfaces the inferred rate and lets the user override per entry.

---

## 6. Module specs

### 6.1 M1: Demand

**Purpose:** Turn the messy real-world order stream into a single ordered queue and a roast plan.

#### 6.1.1 Order ingestion

- **Channels (v1):** Shopify, WooCommerce, Square POS, wholesale portal (built-in), email-in (parsed via templates), manual entry.
- **Sync model:** webhook-first with a 15-min polling fallback. Each integration is a connector with its own `IntegrationConnection` row storing credentials, last sync cursor, and health.
- **Idempotency:** orders are matched on `(org_id, channel, external_id)`. Re-syncing the same order must be a no-op.
- **Normalization:** every incoming order becomes an `Order` + `OrderLine` records. Channel-specific quirks (Shopify discount codes, WooCommerce tax lines) map to first-class fields on the canonical model; raw payload is stored in `Order.raw_payload jsonb` for debugging.

**Edge cases (must handle in v1):**
- Partial payments / deposits (wholesale): order is `received` not `invoiced`; status doesn't block allocation.
- Subscription orders (Shopify Subscriptions, Woo Subscriptions): treated as future-dated orders with a configurable look-ahead window (default 7 days).
- Backorders: customer agrees to wait; line is `open` and feeds the net-requirements engine normally.
- Edited orders: the original is preserved; an `OrderEdit` row links new and old with a diff.
- Cancellations pre-ship: line goes `cancelled`; if it was allocated, the allocation is released and stock returns to `available`.
- Cancellations post-ship: creates a `Return` flow (see §6.2.6).

#### 6.1.2 Net-requirements engine

The "what do I need to roast today" function. Pure function, recomputed on every relevant event (order placed/edited/cancelled, roast completed, pack completed, count adjustment, lot destroyed).

```
For each (sku, date) in the planning horizon (default next 7 days):
  need_weight = sum(open_order_lines for sku with promised_by <= date)
  have_weight = sum(packaged_lot weight_remaining for sku with status='available', not allocated)
                + sum(loose_roasted_lot weight_remaining * SKU.yield_factor if packable from this lot)
                + sum(scheduled_roast_batch green_weight_in * expected_yield for batches planned to complete by date)
  deficit_weight = max(0, need_weight − have_weight)
  → rolls up to "roast need by date" by SKU, then to "roast need by green lot" using SKU recipe
```

Output is the **daily production board**: a list of `(roast date, green lot(s), kg to roast, expected SKU output)` rows.

**Edge cases:**
- Multi-lot blends: the engine picks lots by `FIFO` for green age and `FEFO` for roasted remaining, with a preference for lot ownership reservations (private-label customers).
- Minimum batch size: if deficit is below the roaster's min batch, the engine defers or merges with the next roast.
- Order promised-by vs roast-by: the engine warns (does not block) if the only way to fulfill is to roast tomorrow, given current machine capacity and queue.

#### 6.1.3 Daily production board

- Single screen, mobile and desktop. Three sections: **Roast today**, **Pack today**, **Ship today**.
- Each row is actionable in one tap (start roast / start pack / print label).
- The "what changed since yesterday" diff at the top of the screen (new orders, stock adjustments, recalled allocations).
- Drag-and-drop to defer a roast (with a confirm dialog showing the downstream order impact).

#### 6.1.4 Pack & ship

- Scan-or-tap workflow: scan a packaged-lot QR → system suggests SKUs in that lot → select order line → system reserves the quantity and prints the shipping label via ShipStation.
- Multi-line orders: pack one line, then the next; system tracks partial packs.
- "Pack from loose" shortcut: if no packaged lot exists, the system offers to pack from a `RoastedLot` and create a `PackagedLot` on the spot.

**Edge cases:**
- Pack error / wrong SKU scanned: must roll back the partial allocation cleanly.
- Out-of-stock at pack time: the order line goes on hold with a reason; the daily board surfaces the hold.
- Substitution: if a customer allows "any Ethiopia" and a different Ethiopia is on hand, the system suggests it (requires customer's substitution rule on the order).

### 6.2 M2: Supply

**Purpose:** Own the chain of custody from green receipt to outbound shipment, with counts and recall as first-class flows.

#### 6.2.1 Green receiving

- PO (purchase order) is optional in v1 (a `PurchaseOrder` model is in the schema but the UI ships in v1.5). Green lots can be created directly from a supplier invoice or weight ticket upload.
- Receiving screen: scan supplier lot code or enter manually → enter gross weight, bag count, moisture %, defect count → system creates `GreenLot` and a `StockMovement(receipt)`.
- A green lot cannot be roasted from until `status = 'available'` (blocks by default if a quarantine flag is set).
- Cost events on the same screen: enter purchase price, freight, duty as separate `LandedCostEvent` rows in one form.

#### 6.2.2 Roasting event (the bridge from M1 to M2)

- Started from the daily production board, or as an ad-hoc roast.
- Records `RoastBatch` with `green_lot_components`, `green_weight_in`, `roasted_weight_out` (entered by roaster or pulled from a scale via serial/Bluetooth — serial-only in v1, Bluetooth deferred).
- On completion: creates the `RoastedLot`, posts `StockMovement(roast_consume)` on the green lots and `StockMovement(roast_produce)` on the roasted lot, in a single transaction.
- If the roaster marks the batch `lost` (e.g. tipped the roaster): no `roasted_lot` is created; a single `StockMovement(roast_consume)` records the loss with reason.

#### 6.2.3 Variable-weight pack (the second bridge)

- Triggered from the pack flow (§6.1.4) or the daily board.
- Records: `PackagedLot` with `source_roasted_lot_components`, quantity, unit weight, packaging used.
- On completion: `StockMovement(pack_consume)` on the source `RoastedLot`, `StockMovement(pack_produce)` on the new `PackagedLot`.

#### 6.2.4 Counts & adjustments

- Cycle count: scanner-led; roaster scans a lot, enters actual weight, system reconciles vs `weight_remaining` and posts a `count_adjust` movement on the delta.
- Negative adjustments require a reason code (spillage, damage, training, theft, expired).
- Periodic full count: nightly job verifies the invariants in §5.4. Mismatches page on-call.

#### 6.2.5 Recall pack

- Input: a `GreenLot` ID (or a SKU + date range, or a customer).
- Output: a paginated, exportable list of every outbound shipment that contains coffee from that lot, with customer contact info, lot codes, shipment dates, and order IDs.
- "Recall simulation" mode (read-only): a dry run that shows what *would* be in the pack without actually generating customer notifications.
- One-click export to PDF and CSV, with a hash-chained audit log entry.

#### 6.2.6 Returns

- Return an order (or a line): creates a `ReturnEvent` linked to the original shipment.
- Stock disposition: restock to `available` (if unopened and within freshness window) or move to `quarantine` for inspection.
- Margin engine reverses the original sale's margin attribution.

#### 6.2.7 Transfers (v1: single warehouse only)

- Multi-warehouse is out of scope. The `warehouse_location_id` field is captured for forward compatibility.

### 6.3 M3: Money

**Purpose:** Be the place the roaster trusts for "what am I actually making on this product?"

#### 6.3.1 Landed cost engine

- Inherits from `LandedCostEvent` (§5.8).
- Late-arriving costs: split between the unroasted portion (decreases `landed_cost_per_kg` going forward) and the already-roasted portion (creates an `adjustment` `LandedCostEvent` with a `target_remaining_only: false` flag that does *not* rewrite history; instead it posts an explicit `cost_adjustment_cents` to the affected `RoastedLot`s and cascades to their `PackagedLot`s, surfaced as a memo line on the margin view).
- Currency: per-event currency with FX snapshot at event time. Base currency is org-level.

#### 6.3.2 Margin views

Six views, all exportable to CSV/Xero-compatible format:

1. **By SKU** — trailing 30 / 90 / 365 days, with landed cost, revenue, gross margin %, units sold, top customers.
2. **By channel** — DTC vs wholesale vs subscription vs café, with margin and volume.
3. **By customer** — top-N, with margin and order frequency.
4. **By order** — single-order profitability (often a "why is this order unprofitable?" drilldown).
5. **Forward-looking** — projected margin on open orders using current cost basis.
6. **Lot-level** — margin attributable to a specific green lot, useful for green buying decisions.

#### 6.3.3 Pricing signals

- **Reprice candidates:** SKUs with trailing-30d margin < target margin (per-org config) for >14 days. Sorted by revenue impact.
- **Stale prices:** price-list entries not updated in N days (configurable, default 90).
- **Green cost shock:** when the rolling 30-day average green cost for a SKU's source lots has moved >X% (configurable, default 10), surface a "consider repricing" note.
- **None of these auto-change prices** in v1. The roaster always confirms. Auto-pricing is a v2 conversation.

#### 6.3.4 Accounting sync

- Push: invoices (drafts) and credit notes to QuickBooks Online and Xero. Invoices are generated from shipped-but-not-yet-invoiced order lines on a configurable cadence (per order, daily, weekly).
- Pull: payments and chart-of-accounts mapping. Payment webhook reconciles the invoice.
- Idempotency: invoice numbers are org-scoped monotonic; re-push is a no-op.

#### 6.3.5 Edge cases in money

| Case | Behavior |
|---|---|
| Negative margin (selling below cost) | Margin view shows it red; pricing signal surfaces. Does not block. |
| Mixed-currency orders | Revenue in order currency; green cost in green currency; both FX-snapshotted. Margin view reports in org base currency. |
| Refund after price change | Original sale's margin is *not* restated; refund is a separate margin event. |
| Lot destroyed in fire | `StockMovement(destroy)` posts; margin engine attributes the cost to a "shrinkage" bucket, not to any specific SKU. |
| Cost basis snapshot timing | As described in §5.8: roast time snapshots, not sale time. This is the auditable choice. |

### 6.4 M4: Compliance — **net-new for UK/EU build**

**Purpose:** Make EUDR/UK FRC due diligence an *output* of normal operations, never a separate workstream. The roaster never has to re-enter data to be compliant. The system produces a signed, audit-ready Due Diligence Statement for any in-scope shipment in <2 minutes.

#### 6.4.1 What "in scope" means, and the per-shipment decision

- **EU scope:** any green coffee, roasted coffee, or packaged coffee placed on the EU market, sold within the EU, or exported from the EU. The first operator in the supply chain placing the product on the EU market is the **operator** of record and must file a DDS.
- **UK scope:** any UK-importer of green coffee is the **importer** of record and must file a UK FRC due-diligence statement. UK-domestic-only sales are generally not in scope (but roasters should still capture the data for customers who ask).
- **Detection:** every `Order` carries a `destination_country`. If the destination is an EU member state, the order is in EU scope; if it's GB and the org is not the importer, the order is not in UK scope (but the supplier's UK FRC data may still be required as supporting evidence). The system computes in-scope orders automatically and surfaces them in the daily board.
- **Per-shipment decision:** the scope determination is computed at ship time and recorded in a `ShipmentEudrDecision` (see §5.6). For every shipment, the system records one of five scope outcomes: `in_scope_requires_dds`, `in_scope_opted_out` (only via §6.5), `out_of_scope_destination`, `below_threshold`, or `opted_in_voluntary`. The system never silently defaults to "no DDS needed" for an in-scope shipment; the roaster must make the opt-out decision explicitly, with friction (§6.5).
- **What "in scope" is NOT:** the system does not treat EUDR as an *org-wide* obligation. A roaster who sells only to UK consumers is in scope for *zero* of those shipments; a roaster who takes a single wholesale order to Berlin is in scope for *that one* shipment. The product is designed to make this distinction real and auditable, not a binary "EUDR is on / EUDR is off" switch.

#### 6.4.2 Green receiving (compliance-aware)

The green receiving flow (§6.2.1) is extended with a mandatory compliance step:

1. **Supplier selection** — pick from the `Supplier` table. If the supplier has no `risk_assessment` on file, the system blocks the receipt and routes the operator to the supplier-onboarding flow.
2. **Producer selection** — pick or create a `Producer`. Upload the geolocation file (KML, GeoJSON, or shapefile); the system parses and previews the polygon on a map. Self-reported producers for EU-export lots are blocked unless the org owner overrides.
3. **Origin document upload** — at minimum: producer statement, organic/Fairtrade/RA certificate if applicable, phytosanitary certificate if any. The system stores all of these against the lot and surfaces them in any later audit pack.
4. **Risk review** — the system displays the supplier's risk profile and asks the operator to confirm or update. This becomes a `risk_status_set` event in the audit log.
5. **Receipt confirmed** — the green lot and its `EudrReferenceData` are created together; the lot cannot be roasted from until the `risk_status` is no longer `pending`.

**Edge cases:**
- The supplier is a co-operative or trader that does not know the farm-level origin. For v1, this is captured by linking the lot to a "blended" producer with a `geolocation` that is the cooperative's area and a `verification.source` of `self_reported`. The system warns that EU buyers may not accept this in a downstream DDS. (This is a known gap; the v1.5 plan is to integrate with the EU's "simplified due diligence" framework for smallholders, when it lands.)
- The supplier has already filed a DDS upstream (e.g. a large trader with their own EUDR filing). We capture the `dds_reference` on the `Supplier` and surface it in the downstream DDS — this is the "reference number of any prior DDS in the supply chain" field that EUDR Article 9(d) requires.
- The lot is organic but the supplier is not the certified entity. `Producer.certifications` carries the cert; the `Supplier` does not need to.

#### 6.4.3 Shipping (compliance-aware)

The pack & ship flow (§6.1.4) is extended with a compliance step that runs *before* the label prints:

1. **Destination check** — the system reads the order's `destination_country` and determines whether the shipment is in EU or UK scope.
2. **DDS draft generation** — if in scope, the system creates or updates a `DdsDraft` linked to the shipment, with all EUDR-required fields populated from the lot genealogy: operator details (from `Organization`), product description and HS code (from `EudrReferenceData`), country of harvest, net mass, geolocation summary, supplier DDS references, and auto-generated risk assessment and risk mitigation narratives.
3. **Operator review** — the system displays the draft for the operator to read, edit, and sign. A "ready to sign" green check appears only if all required fields are populated.
4. **Sign & submit** — the operator signs; in v1, this produces a signed PDF + JSON export. The operator submits via their existing TRACES-style workflow (the EU is still finalising the API; we do not pretend to file on their behalf in v1). In v1.5, we add a direct API submission with proper operator credentials.
5. **Audit pack generated** — a signed `AuditPack` is created, linking the DDS, the lot genealogy, and the shipment. The pack is downloadable, shareable via a read-only signed URL, and stored against the order.

**Edge cases:**
- **B2B customer in another EU country with a valid VAT number:** the invoice is reverse-charge (zero-rated) and the DDS still files. The system handles these cases from the same shipment flow.
- **Multi-lot shipment:** if the shipment draws from multiple green lots across multiple countries, the DDS is generated as a single document with multiple origin entries and multiple polygon references. This matches the EU's "consolidated DDS" allowance.
- **Customer is the EU importer of record** (the roaster exports, the customer imports): the system produces a "supplier-side" DDS for the customer's records. In v1 this is the same form, just with a different `destination_country` (the customer's member state) and a flag indicating the customer is the operator. In v1.5 we add a dedicated "exporter reference" form.
- **Cancelled shipment post-DDS:** the system marks the DDS as `rejected` (not deleted) and triggers a manual recall step in the operator's TRACES workflow. The system cannot auto-recall across the EU's API in v1; we surface the action.
- **Shipment of <1kg to a single consumer (B2C):** EUDR has a "negligible quantity" exception. The system tracks the de minimis threshold (in v1 we hardcode based on the EU's published guidance, with a quarterly review) and skips DDS generation for qualifying B2C orders. The system still captures the genealogy for the operator's records.

#### 6.4.4 The compliance dashboard

A dedicated screen for the `compliance_officer` and `owner` roles:

- **Open actions:** "3 suppliers need a risk assessment", "12 green lots missing producer statements", "1 DDS awaiting operator signature", "4 DDSs awaiting regulator acknowledgement".
- **DDS pipeline:** a list of recent DDSs with status (draft / signed / submitted / acknowledged / rejected), regulator reference, destination, and a one-click view of the audit pack.
- **Supplier risk register:** a list of suppliers with their current risk profile and the date of last review. Click a supplier to see their full due-diligence file and the lots they have supplied.
- **Producer register:** a map view of all `Producer` entities with their polygons. Click a producer to see their verification source, cert history, and the lots that draw from them.
- **Period exports:** generate a quarterly / annual compliance pack for the whole org (one PDF, ready to hand to an auditor).

#### 6.4.5 What the v1 product does *not* do (and what we tell the pilot customer)

To set expectations clearly during the pilot:

- We **generate** the DDS, the audit pack, and the compliance report. We do **not** auto-submit to the EU system in v1 — the EU is still finalising its API; the operator signs and submits manually. v1.5 adds API submission.
- We **store** the producer geolocation and supporting documents against each lot. We do **not** validate the geolocation is on non-deforested land. That is the operator's risk assessment. The system surfaces the EU's country-risk benchmarking as guidance.
- We **do not** replace the roaster's customs broker or freight forwarder. The DDS is one document in a shipment file; the operator continues to work with their broker for customs declarations, commercial invoices, and transport documents. (We do produce a customs-ready commercial invoice PDF as a v1.5 add-on.)
- We **do not** monitor the EU or UK regulatory environment for the operator. The system ships with a "what changed" page that the operator is responsible for checking; in v2 we add a regulator-update subscription.

#### 6.4.6 Edge cases the data model must handle explicitly (compliance)

| Case | Behavior |
|---|---|
| Lot blended at origin across multiple producers | `LotProducer` join with `pct_of_lot` summing to 1.0. DDS lists each producer's polygon. (v1 vs v1.5 split — see open question §11.) |
| Lot from a co-operative that doesn't know farm-level origin | `Producer` is the co-op; polygon is the co-op area; verification is `self_reported`. System warns: EU buyers may not accept. |
| Supplier has filed a DDS upstream | `Supplier.dds_reference` populated. Downstream DDS cites the reference per Article 9(d). |
| Lot destroyed before any shipment | `EudrReferenceData.dds_state` stays `not_required`; no DDS is generated. |
| Roast completed, no shipment yet | Lot is roasteable, can be packed, but the pack flow requires a `ShipmentEudrDecision` before shipment. The decision can be `file_dds` (DDS is generated), `opt_out` (§6.5), or auto-recorded as out-of-scope. |
| Order shipped before per-shipment EUDR decision is recorded | Blocked by the system. The pack-and-ship step requires a `ShipmentEudrDecision` in the appropriate state. |
| Order shipped before DDS is signed (in-scope, opted in to file) | Blocked. The system requires `DdsDraft.status = 'signed'` (or 'submitted' or 'acknowledged') for in-scope shipments with `decision.mode = 'file_dds'`. |
| DDS rejected by regulator | System surfaces the rejection; the lot is flagged for review; a new DDS can be drafted (does not overwrite the rejected one — the audit trail is preserved). |
| Producer verification source = self-reported for EU-export lot | System blocks the shipment unless the org owner signs an explicit override (recorded in the audit log). The override is on the *DDS*, not on the *opt-out*. You cannot opt-out of a requirement by self-attesting a producer's verification — that would defeat the whole regulation. |
| UK FRC vs EU EUDR dual shipment | Customer in GB, supplier in non-EU, origin in non-EU, sold into EU. The system files both an upstream UK FRC supplier-side record and a downstream EU operator DDS, with linked references. |
| Currency of DDS values | DDS itself is regulation-form, not money; product description and quantity are in kg (per EUDR). |
| Retention period | EUDR Article 9 requires records to be kept for **5 years**. The system never deletes `EudrReferenceData`, `DdsDraft`, `ShipmentEudrDecision`, or `AuditPack` records; the data retention policy enforces this. |
| **Per-shipment opt-out for an in-scope shipment** | See §6.5. Requires reason, double-confirm, authorised role, and generates a signed opt-out audit pack. **Not a workaround for missing data**: the system blocks opt-out if the green lot lacks a risk assessment or is from a published high-risk origin. |
| **Below-threshold shipment to EU** | Net mass < `Organization.eudr_settings.small_quantity_threshold_kg` (default 1.0 kg). Auto-creates `ShipmentEudrDecision` with `scope_decision = 'below_threshold'`. No DDS required. Logged. |
| **Voluntary DDS for an out-of-scope shipment** | The roaster may file a DDS *voluntarily* (e.g. for a UK-UK customer who is asking for proof of due diligence). `scope_decision = 'opted_in_voluntary'`, `mode = 'file_dds'`. Recorded in the audit log. |
| **Northern Ireland (XI) destination** | Windsor Framework: treated as GB for residency, but EU for goods. `scope_decision = 'in_scope_requires_dds'` for any green coffee shipped to XI. (See open question §11 for the VAT side.) |
| **Switzerland (CH) destination** | CH is not in the EU. `scope_decision = 'out_of_scope_destination'`. Swiss TREES applies separately; v1 does not manage it. Logged. |
| **Smallholder small-quantity relief** | Out of scope for v1; flagged for v1.5 once the EU's smallholder framework is finalised. The opt-out path is *not* a substitute for the smallholder framework — those are different regulatory paths. |

### 6.5 M4b: Per-shipment opt-out — *net-new for v1.2*

**Purpose:** Let a roaster ship coffee to the EU without a DDS **only** when they make a deliberate, recorded, authorised decision to do so. Make it possible to do; make it impossible to do by accident. Make the record auditable if a regulator asks "why?"

This is the section that answers: "what happens when a UK-UK roaster takes a one-off wholesale order to Berlin and doesn't have a producer statement on file yet?" Answer: the system lets them proceed *if* they go through the opt-out flow with full friction. The friction is not user-hostile — it is the difference between "we have a record that this happened" and "we don't know this happened."

#### 6.5.1 When the opt-out path is offered

The system offers the opt-out path *only* on a shipment that:

1. Has a destination in an EU member state (or NI), **and**
2. Has a net mass at or above `Organization.eudr_settings.small_quantity_threshold_kg` (default 1.0 kg), **and**
3. Has a `ShipmentEudrDecision.scope_decision` of `in_scope_requires_dds` (i.e. the system has determined EUDR applies), **and**
4. Either has an issue generating the DDS (e.g. one of the green lots lacks a complete `EudrReferenceData`) **OR** the roaster actively chooses opt-out over filing the DDS.

In other words: opt-out is *not* offered for shipments that are out of scope (no need), below threshold (auto-recorded as below-threshold), or have a clean DDS path (no need — just file the DDS).

The opt-out is **blocked** if the shipment contains a green lot from a published EU high-risk country list, or a lot with no risk assessment at all. The system says: "The lot you're shipping has no risk assessment; you cannot opt this shipment out." This is a hard floor.

#### 6.5.2 The opt-out screen (friction path)

The user sees this screen in the pack-and-ship flow, after the in-scope check (§6.4.3), when the system has either auto-detected a blocker or the roaster has clicked "I want to opt this shipment out":

> **This shipment is in scope for EUDR.** Destination: Berlin, DE. Net mass: 14.36 kg.
>
> To ship this without a Due Diligence Statement, we need you to confirm a few things. This will create a permanent, signed record in your audit log.
>
> **1. Why is this shipment not getting a DDS?** *(required, pick one or write your own)*
> - Not for resale (sample, gift, internal QC, internal use)
> - Returned goods
> - Transit only (passing through EU to a non-EU destination)
> - Personal use (this is *your* coffee, not a customer's)
> - Coffee from a pre-EUDR stock purchased before [date]
> - Other (please describe in up to 500 characters)
>
> **2. Who is making this decision?** *(system shows the current user)*
> Your role must be one of: Owner, Compliance Officer, Head Roaster. If you are a Packer or Accountant, ask your Owner or Head Roaster to take this decision.
>
> **3. Confirm:** *(required, type the phrase below exactly)*
> Type: **"I confirm this shipment does not require a Due Diligence Statement under EUDR. I am the operator of record."**
>
> [Cancel] [Take this decision]

The screen has a **clearly-stated legal frame** above the actions. The user cannot reach the "Take this decision" button unless all three conditions are met.

#### 6.5.3 What gets recorded

On confirmation, the system:

1. Creates a `ShipmentEudrDecision` row with `mode = 'opt_out'`, the chosen `reason_code`, the typed confirmation phrase, the user, the role, the timestamp, and the destination context.
2. Generates a signed `AuditPack` (the *opt-out audit pack*) containing:
   - The shipment record
   - The lot genealogy (green → shipment)
   - The user's opt-out reason
   - The user's role at decision time
   - The timestamp and a hash of the prior audit-log entry (to anchor it in the chain)
   - The exact text of the legal acknowledgement the user confirmed
   - A signature page with the org name, the user's name, the role, and a verification QR code
3. Writes an `AuditEvent` to the tamper-evident log.
4. Unblocks the shipment so the label can print and the box can leave.

#### 6.5.4 The confirmation phrase

The exact phrase the user must type is a legal acknowledgement — a kind of "I have read and understood" gate. The phrase is generated by the system and includes a per-shipment nonce so a screenshot of a previous shipment cannot be reused. The system logs both the *required* phrase and the *typed* phrase; if they match, the decision is valid; if they don't, the user sees an error and cannot proceed.

The phrase changes wording over time as the legal language settles (quarterly review of the EU's published guidance). v1 ships with the phrase: *"I confirm this shipment does not require a Due Diligence Statement under EUDR. I am the operator of record."* The phrase is the *system's* legal framing, not the roaster's; the roaster is the operator of record and is making the statement, but the system's wording is what the regulator would see.

#### 6.5.5 What the audit pack looks like (for a regulator)

If a regulator ever asks "show me why this shipment went to Berlin without a DDS", the roaster opens the compliance dashboard, finds the shipment, and downloads the opt-out audit pack. It is a single PDF, 2-3 pages, with:

- Cover page: org name, shipment ID, destination, date, the legal acknowledgement text, the signature, the QR code linking to a verification URL.
- Lot genealogy: green lot(s) → roast(s) → packaged lot(s) → shipment.
- Reason: the `reason_code` and `reason_text` (if any) as recorded.
- User record: who decided, what role, when.
- Hash chain: the prior audit-log entry's hash and the new entry's hash, demonstrating the chain of custody.

The PDF is the same format whether the roaster is in front of the regulator or not. It is **not** a custom-built document; it is the system's standard `AuditPack` rendering with a scope of `shipment_eudr_decision`.

#### 6.5.6 Edge cases

| Case | Behavior |
|---|---|
| Roaster tries to opt out a UK-UK shipment | Not offered. UK-UK is auto-recorded as `out_of_scope_destination`; no opt-out needed. |
| Roaster tries to opt out a below-threshold shipment | Not offered. Already auto-recorded as `below_threshold`. |
| Roaster tries to opt out a shipment containing a lot from a published EU high-risk country | **Blocked.** System says: "This lot is on the EU high-risk country list. Opt-out is not available for this shipment. You must either resolve the risk assessment, hold the shipment, or destroy the lot." |
| Roaster tries to opt out a shipment containing a lot with no risk assessment | **Blocked.** System says: "This lot has no risk assessment on file. Opt-out is not available. Add a risk assessment or hold the shipment." |
| `packer` user tries to take the opt-out decision | **Blocked at role check.** The button is disabled; the UI directs the user to ask the Owner, Compliance Officer, or Head Roaster. |
| User types the confirmation phrase with a typo | **Blocked.** The system shows the diff between the typed and required phrase, the user must re-type. |
| User dismisses the screen without deciding | Shipment remains blocked. The next time the user opens the shipment, the opt-out screen re-appears. |
| User wants to *change* a previously-recorded opt-out (e.g. they later decide to file the DDS after all) | A new `ShipmentEudrDecision` is created with `mode = 'file_dds'` and a `supersedes_id` linking to the prior decision. The original is preserved. The DDS flow runs as normal. The audit log shows both decisions. |
| User wants to opt out *many* shipments quickly (e.g. weekly Berlin order) | Per-shipment opt-out still applies, but the org's `default_mode` can be set to `flag_only` (warning) instead of `enforce` (blocking), reducing the friction for known-EU customers. The system still requires the per-shipment decision; the difference is whether the unaddressed shipment blocks the workflow. |
| Regulator later sends a request: "show me every shipment you've opted out in 2026" | One click in the compliance dashboard: list of all `ShipmentEudrDecision` records with `mode = 'opt_out'`, with one-click download of each audit pack. |

#### 6.5.7 What this is *not*

- **Not an org-wide opt-out.** That mode is not in the product (see §1.2 non-goals, §3 principle 11). Per-shipment only.
- **Not a workaround for missing data.** Opt-out is blocked when the lot lacks a risk assessment or is from a high-risk origin. The system is designed to make the roaster address the underlying data gap, not paper over it.
- **Not silent.** Every opt-out is recorded, every reason is captured, every audit pack is signed. The regulator never has to ask "why"; the record already exists.
- **Not a recommendation.** The system surfaces opt-out as an available path; it does not recommend it. The "Take this decision" button is the rightmost element of a two-step screen, after the user has read the legal framing. Most roasters who can file a DDS will file a DDS; opt-out is for the cases where they genuinely cannot.

---

## 7. System modules

### 7.1 S1: Integrations Hub

#### 7.1.1 Connector contract

Every connector (Shopify EU, WooCommerce EU, Square, Xero, Sage, QuickBooks EU, ShipStation, Stripe EU, Mollie, email-in) implements the same interface:

- `test(connection) → {ok, diagnostics}`
- `pull(cursor) → {events, next_cursor}` (orders / payments / products, depending on direction)
- `push(entity, idempotency_key) → {external_id, status}`
- `webhook(event) → enqueued for processing`

**Health:** connector reports `last_success_at`, `last_error_at`, `error_message`. The system shows a health badge on the org's integration settings page.

#### 7.1.2 UK/EU connector priorities

**Tier 1 (must ship in v1 Phase 1):**
- **Shopify EU** — most common UK/EU roastery ecommerce backend; supports the EU VAT MOSS scheme natively; subscriptions via Shopify Subscriptions app
- **Xero UK / Xero EU** — most common UK/EU roastery accounting tool; native multi-currency, native VAT return support; better fit than QBO for UK/EU VAT
- **Stripe EU** — most common UK/EU roastery payment processor; supports SEPA, iDEAL, Bancontact, Giropay out of the box; surface in invoices
- **ShipStation** — most common multi-carrier shipping tool; supports Royal Mail, DHL Express, DPD, Evri, PostNL, DHL Parcel, GLS

**Tier 2 (ship in v1 Phase 2):**
- **WooCommerce EU** — second-most-common UK/EU ecommerce; some roasters use WooCommerce + WordPress for content marketing
- **Sage** — significant UK market share, especially among roasteries with a long-established finance team
- **Mollie** — common EU payment processor; alternatives to Stripe in NL/BE/DE
- **Square POS** — common for roastery-café hybrid operations

**Tier 3 (ship in v1.5, post-MVP):**
- QuickBooks EU (low UK/EU market share; kept for the rare user)
- Lightspeed POS (café-heavy roasters)
- HubSpot (B2B CRM for wholesale)
- Fortnox (Sweden; regional importance)
- Datev (Germany; accounting export)

**Tier 4 (deferred, v2+):**
- WooCommerce Subscriptions (we can read orders but not manage subscription billing)
- Subbly, Stay AI, Loop Subscriptions (specialty subscription apps on Shopify)
- Mailchimp, Klaviyo (email marketing — out of scope for v1)

#### 7.1.3 Email-in (v1)

- Org configures a parse-inbox (e.g. `orders@acmecoffee.parse.app`); forwards from the roaster's real inbox land here.
- A simple template-matching parser extracts order lines (SKU + qty) from common formats, with awareness of UK/EU conventions: weight in g/kg, price in £/€, VAT-exclusive vs VAT-inclusive headers. Roaster can correct on a confirmation page; corrections train the parser per-org.
- This is intentionally low-tech in v1. AI-parsing is a v2 candidate.

#### 7.1.4 Wholesale portal

- Built-in: a hosted B2B page for the roaster's wholesale customers, with login, browse-by-SKU, recurring order templates, order history, and a "submit order" button.
- The portal **is** a channel in our data model (`channel = 'wholesale_portal'`).
- Per-customer price list binding.
- **VAT-aware pricing on the portal:** when a B2B customer logs in from an EU member state with a valid VAT number, they see **VAT-exclusive** prices and the invoice is issued as reverse-charge. When they log in from the UK (post-Brexit) or from an EU member state without a VAT number, they see **VAT-inclusive** prices. The system handles this with no manual intervention once the customer's VAT status is captured at onboarding.
- **EUDR pack link on the portal:** a wholesale customer can view the EUDR audit pack for any order they have placed, with a "share with my auditor" button. This is the most-requested feature in early-stage roaster interviews: wholesale customers want to be able to prove *their* compliance, and they want it from the roaster.

#### 7.1.5 Rate limits & retries

- All outbound API calls respect upstream rate limits (token bucket per connector).
- Retries with exponential backoff and jitter; max 5 attempts; on final failure, the event goes to a dead-letter queue with an operator-visible alert.
- **Regulatory-grade integrations are different:** the EUDR Information System (TRACES-style) integration in v1.5 will require signed operator credentials, mTLS or equivalent, and the system will treat submission failures as a hard block on the shipment, not a soft retry. (v1 does manual submission; v1.5 introduces this.)

### 7.2 S2: Identity & Tenancy

- Standard email/password + magic link in v1. SSO is v2.
- RBAC roles as in §5.1. The `readonly` role is required for the accountant persona — they get margin views but not stock edits. The `compliance_officer` role is required for the EUDR workflow — they get write access to supplier due diligence, EUDR reference data, DDS drafts, and audit packs, but no write access to stock, recipes, or pricing.
- **Data residency per org:** at signup, an org chooses **UK** or **EU**. The choice is encoded in the `Organization.data_residency` field and is enforced at the infrastructure layer (the org's data and compute resources are pinned to a region; cross-region reads/writes are blocked at the application layer). This is critical for wholesale customers' GDPR posture.
- **GDPR / UK GDPR posture:** every `User` and `Customer` record has the data-export and right-to-be-forgotten flows built in. The compliance officer can produce a full personal-data export and a deletion request packet on demand. Anonymisation rules: an order cannot be deleted (regulatory retention), but the customer's PII can be replaced with a pseudonymous ID, with the mapping stored in a secure, time-bounded lookup table.
- Audit log: every state-changing action writes a `AuditEvent(user_id, action, entity_type, entity_id, diff jsonb, occurred_at, hash_chain)`.
- The hash chain is the legally defensible bit: each event includes `hash(prev.hash || this.canonical_json)`. Tamper detection is a one-line check. The hash chain is preserved across backups; the chain is **the source of truth** for what happened, in what order, with what evidence.
- **EUDR retention enforcement:** `EudrReferenceData`, `DdsDraft`, and `AuditPack` records are subject to a 5-year retention floor (EUDR Article 9) and cannot be soft-deleted within that window. After 5 years, they can be archived (read-only, accessible) but not hard-deleted without an `owner` user action recorded in the audit log. This is a regulatory requirement, not a policy choice.

---

## 8. UX requirements (per flow)

### 8.1 Daily board (the home screen)

- One screen, fits on a 13" laptop, readable on a 10" tablet.
- Three sections: **Roast today** | **Pack today** | **Ship today**.
- Each section is a list of action cards. Each card has: SKU, qty, source lot, due time, "Start" button.
- "What changed" banner at top with a tap-through to the change log.
- An empty state ("Nothing to roast, but 4 orders ship today") is intentional — silence is a signal.

### 8.2 Receive green

- 5-step wizard, <2 minutes per lot end-to-end on tablet.
- Camera scan → form → cost entry → confirm. No free-text required beyond notes.

### 8.3 Pack & ship

- Scan → confirm → print. Three taps.
- An audible + visual "ok" on a clean scan. A loud, obvious error on a wrong scan.

### 8.4 Count

- Pick a location or lot → scan each item → system tallies → confirm variance.
- Variance >2% requires a reason; that reason is shown to the next person who looks at the lot.

### 8.5 Recall pack

- Input screen: "What are you recalling?" → SKU + date range, or green lot ID, or customer.
- Output screen: a list of affected shipments, with action buttons: "Notify all" (draft emails — does not auto-send in v1), "Export PDF", "Export CSV".
- Read-only export links that can be shared externally with expiry (signed URLs, 7-day default).

### 8.6 Margin view

- Default landing: last 30 days, by SKU, sorted by margin % ascending (worst first — what the operator needs to see).
- Drilldown: SKU → channel breakdown → customer breakdown → order list → single order with full cost stack.
- "Show me the math" toggle on every margin number — opens a panel listing every cost allocation that contributed.

---

## 9. Out-of-band / non-functional requirements

- **Performance targets:**
  - Daily board renders in <300ms p95 on 3G.
  - Net-requirements recompute: <2s p95 for 1,000 open order lines, 10,000 lots.
  - Recall pack generation: <5s p95 for any single green lot with up to 1,000 derived shipments.
- **Offline tolerance:** pack/ship, count, and receive flows must queue locally and sync on reconnection. Read-only screens can show stale data with a "last synced X minutes ago" badge.
- **Accessibility:** WCAG 2.1 AA. Floor staff may be wearing gloves and standing under fluorescents.
- **Data export:** full export (org dump as JSON + CSV per entity) available at all times, no support ticket required.
- **i18n:** English only at GA; strings externalized from day one.
- **Time zones:** org-level timezone for daily board "today". All timestamps stored UTC.

---

## 10. Phasing

The four product modules (M1 Demand, M2 Supply, M3 Money, M4 Compliance) do **not** ship as phases — the **spine ships as one product**, with feature flags gating some capabilities. **EUDR compliance is in Phase 1**, not deferred to Phase 3, because the EUDR enforcement deadline is **30 December 2026** and the pilot is the sales event for the whole product. The ordering is the same as before; we are simply adding the M4 work to the relevant phase. This is the sequence:

### Phase 0 — Foundations (Jul–Aug 2026, ~6 weeks)
- Data model in DB (all entities, **including the EUDR entities in §5.6** — Supplier, Producer, EudrReferenceData, LotProducer, DdsDraft, AuditPack)
- Stock-movement ledger with hash chain
- Auth + org + RBAC (**including the new `compliance_officer` role**)
- Admin UI for: SKUs, customers, suppliers, packagings, recipes, price lists, **EUDR producer register (with map view), supplier risk register**
- Manual order entry + manual stock movement UI (no integrations yet)
- Daily production board v0 (read-only, computed nightly)
- Compliance-aware green receiving flow v0 (mandatory producer + supplier fields)
- **UK + EU infrastructure provisioning** (data residency per org, GDPR posture)

**Exit criteria:** a roaster can manually enter 1 SKU, receive 1 green lot (with a producer, a polygon, and a supplier risk assessment), log 1 roast, pack 1 bag, sell 1 bag, and the genealogy is intact **and** the system can generate a DDS draft for the shipment.

### Phase 1 — Integrations + Daily Workflow + EUDR MVP (Sep–Nov 2026, ~10 weeks)
- Tier 1 connectors: **Shopify EU**, **Xero**, **Stripe EU**, **ShipStation**
- Email-in parser
- Wholesale portal v1 (**with VAT-aware pricing and EUDR pack sharing**)
- Net-requirements engine
- Live daily board (event-driven recompute)
- Pack & ship scan workflow (**with mandatory DDS generation for in-scope shipments**)
- Invoice generation (**VAT-correct by construction**)
- **EUDR MVP**: full green-receiving flow, full DDS generator (PDF + JSON), **per-shipment opt-out path with friction (§6.5) and signed opt-out audit pack**, full compliance dashboard, supplier risk review workflow
- **First pilot onboarding** at end of this phase

**Exit criteria:** §2.3 success criteria being measured in pilot, including the **EUDR DDS generation** and **EUDR data completeness** KPIs. Pilot is required to have filed at least one real DDS via manual TRACES-style submission by the end of Phase 1 to validate the data shapes, **and to have at least one opt-out taken with a real reason captured**, to validate the friction path.

### Phase 2 — Money & Insights + Tier 2 Integrations (Dec 2026–Feb 2027, ~10 weeks)
- Full landed cost engine (multi-event, late-arriving, FX, VAT-aware)
- All six margin views (ex-VAT)
- Pricing signals
- Accounting reconciliation polish
- Recall pack feature
- Cycle count workflows
- **EUDR API integration** with the EU Information System (v1.5 — this is the critical regulatory milestone; the manual DDS submission process must remain usable as a fallback for roasters who can't or don't want to use the API)
- Tier 2 connectors: **WooCommerce EU**, **Sage**, **Mollie**, **Square POS**
- **EUDR enforcement deadline is 30 December 2026.** All paying customers must be on Phase 1 functionality by this date. GA opens no later than mid-February 2027.

**Exit criteria:** 3 paid pilots with **all 7 KPIs** green (the 7th is the EUDR data completeness target).

### Phase 3 (post-MVP, roadmap)
- Roast profile capture (read-only)
- Multi-warehouse
- Tipping-point alerts (auto-reprice)
- Mobile native (if data justifies)
- US/Canada/AU/NZ market entry (v2 — will require US-USD support, imperial-by-default mode, and a different compliance regime)
- Subscription management (we currently receive subscription orders; we don't manage the billing)
- Customs broker / commercial-invoice integration for full export-document automation

---

## 11. Open questions for engineering review

These are the questions I'd like answered in PR before implementation starts:

1. **Database choice.** The doc assumes Postgres (RLS, jsonb, generated columns, postgis extension for geolocation polygons). Confirm. The PostGIS requirement is **new** for the EUDR build — it makes the `Producer.geolocation` polygon queries and the country-risk overlays much cleaner. If PostGIS is out, we can do GeoJSON validation in application code, but we lose spatial indexes and the map view will be slow.
2. **Hash chain library.** Do we use a third-party (e.g. something like a merkle-log library) or implement SHA-256 of canonical JSON ourselves? Audit defensibility hinges on this.
3. **Idempotency keys for outbound integrations.** Per-event ULID, or hash of canonical payload? Affects replay safety.
4. **Offline queue store on the client.** IndexedDB? Service worker? What happens if a packer packs 50 orders offline and the connection drops for 4 hours — what gets synced first? (Note: EUDR makes this harder — an offline pack must not advance a DDS state without server-side validation. See open question 12.)
5. **The cost-snapshot-at-roast vs cost-snapshot-at-sale decision** (§5.8). I have a strong recommendation (roast time), but I want at least one engineer to push back before we lock it. The tradeoff is between audit defensibility and "I want to see the current green price reflected in this open order."
6. **Lot ownership enforcement.** A private-label customer's lot must not be roasted for anyone else. The data model supports this via `LotAllocation`, but the engine needs to enforce it during the net-requirements recompute. Where does that check live?
7. **Multi-currency orders vs multi-currency green.** The model supports both. The UK/EU frame removes the dollar question for v1, but a UK roaster buying Brazilian coffee in USD with a BRL-denominated farm cost is still a real case. Is there a clean UX for "my Kenyan lot cost me €X, freight was $Y, I'm selling in £Z"? (My answer: yes, by treating each landed cost event as an independent FX snapshot, the margin engine just adds them up in the base currency. The display is straightforward but the *audit explanation* on a single margin number needs care — see question 11.)
8. **Read-only role scope.** Is the accountant `readonly` *role*, or do they get write access to pricing only? (Current draft: read everything, write pricing only. Confirm.)
9. **Wholesale portal's pricing model.** Free for all customers of the org? Or per-customer login bound to a specific account? I assumed the latter.
10. **Customer-master dedup.** When Shopify sends "John Smith" and Square sends "John Smith" with different IDs, is that the same customer? I assumed no automatic dedup in v1; the roaster merges manually.
11. **VAT number validation.** The system needs to validate EU VAT numbers (using VIES) and UK VAT numbers (using HMRC's check) at customer onboarding, and periodically re-validate. v1 implementation: do we call the public VIES/HMRC APIs on demand (free, but rate-limited and the UK one has changed endpoints several times), or do we subscribe to a paid validator service (e.g. Taxamo, Vatlayer) for reliability?
12. **EUDR + offline interaction.** If a packer takes the floor offline for 2 hours and packs 30 orders, including 5 in-scope EU shipments, the system must not advance those 5 DDSs to "drafted" or "signed" offline — that requires server-side authority. How do we present this to the user? ("Some of your in-scope shipments require a connection to generate the DDS; you'll see them as 'pending compliance' on the daily board until you reconnect.") This is a UX question as much as an engineering one.
13. **LotProducer model in v1 or v1.5.** The `LotProducer` entity is needed for green lots blended at origin. v1 minimum requires single-producer lots; multi-producer lots are a v1.5 candidate. Confirm — my recommendation is single-producer in v1 with a clear migration path to multi-producer when the smallholder framework settles.
14. **Northern Ireland VAT regime.** Post-Brexit, NI follows EU VAT rules for goods (with some UK specifics for B2B services). Roasters with an NI address need special handling: UK VAT registration for UK sales, EU VAT registration for EU sales, and the Windsor Framework's "goods not at risk" rules. v1 implementation: do we treat NI as UK (data residency `uk`, base currency GBP) with a `region = 'NI'` flag and a special VAT handling module, or do we treat NI as a hybrid that the roaster configures manually?
15. **EUDR smallholder small-quantity relief.** The EU's proposed smallholder framework was still being finalised as of 2026; the proposal in front of the Commission would allow simplified due diligence for lots below a certain size from registered smallholder groups. Do we ship the v1 model without this and add it in v1.5, or do we wait for the framework to settle and ship v1 with it? My recommendation: ship without; add as soon as the framework is finalised.
16. **Self-reported producer override audit.** When the org owner overrides a self-reported-producer block for an EU-export lot, what evidence do we require? A free-text reason, an uploaded PDF, both? My recommendation: both, with a checkbox confirming the operator understands the regulatory risk.
17. **Regulator update subscription.** The system will need to track EUDR amendments, UK FRC guidance updates, and country-risk-benchmarking changes. v1 is a static page; v2 is a proper subscription with email alerts. Confirm.
18. **Confirmation phrase wording (per-shipment opt-out, §6.5.4).** I have proposed *"I confirm this shipment does not require a Due Diligence Statement under EUDR. I am the operator of record."* This phrase is the *system's* legal framing and is the text the regulator would see in the audit pack. Should it be reviewed by an EU regulatory lawyer before v1 ships? My recommendation: yes, get a one-time legal review of the exact phrase wording and the "what the user is confirming" language. (Estimate: 2-4 hours of a specialist's time; ~£1,500.)
19. **`supersedes_id` field on `ShipmentEudrDecision`.** When a roaster changes their mind on a previously-recorded opt-out (e.g. they later decide to file the DDS after all), we need a way to link the new decision to the old. Adding a `supersedes_id` field is the cleanest. Confirm — is this in v1.0 (recommended) or v1.1?
20. **Per-shipment opt-out rate as a leading indicator.** Should we *track* the opt-out rate per org and surface it in the compliance dashboard? A high rate is a red flag ("this roaster is treating opt-out as a workaround, not as an exception"). A low rate is reassuring. I think yes, but I want to confirm we don't *judge* the roaster in the UI ("warning: you opted out 8 of your last 10 EU shipments"). My recommendation: show the rate, neutral framing, with a "want help reducing this?" link to the supplier-onboarding flow.
21. **Wording of the opt-out audit pack's legal text.** The audit pack is the document the roaster hands to a regulator. The pack should contain a paragraph of plain-English legal framing ("This shipment was placed on the EU market on [date] without a Due Diligence Statement. The operator of record, [name], has confirmed under [date] that the shipment does not require a DDS for the following reason: [reason]. This record is retained for 5 years in accordance with EUDR Article 9."). The exact wording is a legal call. Same as question 18: get a regulatory lawyer to review the v1 wording. (Combined engagement.)
22. **Below-threshold logic when a shipment has multiple parcels to the same EU customer.** EUDR applies per shipment, not per parcel. If a roaster ships 0.6 kg to a customer in DE on Monday and 0.6 kg on Wednesday, both individually below threshold — does that count as one shipment of 1.2 kg (above threshold) or two (both below)? The EU's published guidance says "shipment" is the unit; the system should aggregate shipments to the same customer in a 7-day window. Confirm; this is open question 22.

---

## 12. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pilot roaster churns because the daily board doesn't feel "their" workflow | High | High | Configurable columns; per-roastery views of the same underlying board; 2-week parallel run; daily check-ins for the first 30 days. |
| The variable-weight model is wrong about how roasters actually weigh coffee | Medium | Critical | Pre-build interviews (§13) specifically on this; build a "what would your pack station look like?" walkthrough with 3 roasters before locking the schema. UK/EU roasters are actually easier on this point — they are metric-native already, so the canonical-grams model is the natural fit. |
| We ship the spine but the UX feels like an ERP | Medium | High | Hire a product designer with a "small-team SaaS" background; do not let this product become "another Cropster." Daily board's exception-first principle is the test. |
| Accounting integration is harder than expected (Xero, Sage, and the UK/EU VAT landscape) | High | High | Phase 1 ships Xero invoice push only; Sage and full reconciliation in Phase 2. UK MTD (Making Tax Digital) compliance for the invoice push is a separate workstream — design the invoice payload to be MTD-compatible from day one. |
| We can't get the cost snapshot story right and roasters lose trust in margin numbers | Medium | Critical | Build a "what would your margin look like under cost-at-sale timing?" toggle in dev; show both side-by-side in pilot; decide with the pilot customer. |
| Founder runs out of money before Phase 2 | Medium | High | Pilot must convert to paid before Phase 2 starts; pricing of the pilot program must be designed accordingly. The EUDR deadline is a forcing function here — roasters who *must* be compliant by 30 Dec 2026 will pay for a working solution rather than build one. |
| Competitor (Cropster, RoasterTools) ships a competing feature | Medium | Medium | The data model is the moat; the integrations are not. Ship the spine first; integrations are replaceable. |
| EUDR pilot fails because the operator's suppliers can't provide geolocation data | High | High | Onboard a roaster with **already-mature supplier relationships** (e.g. a roaster who has been asking for polygons for a year). Build a "supplier geolocation request" email template and a smallholder cooperative data-import path for v1.5. |
| EUDR scope changes between v1 design and v1.5 API integration | Medium | High | The v1 design is anchored to the EU's *published* schema, not the API. If the API changes shape, the manual-submission fallback remains workable; only the v1.5 API integration needs to be re-engineered. |
| A pilot roaster's first DDS is rejected by the regulator and the roaster blames us | Medium | Critical | Set expectations explicitly: we generate the DDS, the operator signs and submits, the operator is the legal entity. Pilot contract must be clear on this division of responsibility. |
| The `compliance_officer` role is unused and the owner ends up doing all the work | Medium | Medium | Pilot interviews should test whether the roastery has or wants this role. If not, the system should let one user hold multiple roles and the workflow should still work. |
| **The per-shipment opt-out is treated as a workaround, not an exception** | High | High | Surface the opt-out *rate* in the compliance dashboard (open question 20). When rate exceeds a threshold (configurable, default 30% of EU shipments in last 90 days), surface a non-judgemental "Want help getting the supplier paperwork in place so you can file a DDS instead?" link to the supplier-onboarding flow. Pilot should test this carefully — we want a real signal, not a nag. |
| **A roaster opts out a shipment that they shouldn't have, and the regulator finds out** | Medium | Critical | The opt-out is *recorded* (with user, role, timestamp, reason, confirmation phrase) and *authorised* (only owner / compliance officer / head roaster can take it). The audit pack is the document the roaster hands to the regulator. The legal framing of the confirmation phrase is reviewed by an EU regulatory lawyer before v1 ships (open question 18). The opt-out cannot paper over missing risk assessments or high-risk origins — those are hard floors. |
| **The opt-out friction is so heavy that roasters abandon the workflow** | Medium | High | Pilot test: have each pilot roaster take at least one opt-out as part of onboarding. Time it. If it takes more than 3 minutes end-to-end, the friction is wrong. The friction should feel like "I'm making a deliberate decision" not like "the system is making me jump through hoops". |
| **A `packer` user is upset they can't take the opt-out themselves** | Low | Low | Pilot explanation: "the separation-of-duties is a regulatory control, not a UX choice. The person who decides 'this shipment doesn't need a DDS' is not the person who physically packs the box." If the pilot consistently pushes back on this, the role hierarchy may need to be relaxed — but only after we've understood the regulatory implications. |
| UK GDPR / EU GDPR data-residency region choice becomes a sales-blocker for a roaster with mixed-UK-and-EU operations | Medium | Medium | For v1, treat it as binding: UK roasters in UK, EU roasters in EU. For v1.5, support cross-region read-only mirrors for orgs that need both views (e.g. a UK roaster with an EU subsidiary). |

---

## 13. Validation plan (before code)

The deep research was qualitative. Before we write the data model into Postgres, run a 4-week validation cycle with 5 roasters. This is the script:

### 13.1 Recruitment

- **5 UK/EU roasters** in the 6–20 staff, 450–6,800 kg/mo range, multi-channel, currently using a spreadsheet for at least one of: order aggregation, inventory reconciliation, margin tracking, **EUDR/UK FRC due-diligence tracking**.
- **Geographic mix:** 2 UK, 1 NL, 1 DE, 1 FR. (IE/Nordics/BE/IT/ES roasters are on the priority list but not in the first pilot cohort — the first cohort should be in English-speaking or English-comfortable markets to keep validation friction low. We can validate Italian / French / German UI requirements in a separate cohort if needed.)
- **Channel mix:** 2 wholesale-heavy, 2 DTC-heavy, 1 café/private-label-heavy.
- **EUDR maturity mix:** at least 2 of the 5 should already be in active dialogue with their suppliers about geolocation. If we can't find 2 in 4 weeks of recruiting, that is itself a signal about market maturity that we should capture in the validation report.
- Paid pilot (€500/mo for the validation period, waived on conversion). Pilot contract must explicitly define: we generate the DDS, the operator signs and submits, the operator is the legal entity of record.

### 13.2 Activities

- **Week 1 — Diary study.** Each roaster records: hours/day on order entry, hours/week on inventory reconciliation, last time they lost money to a margin error, last time they couldn't trace a lot, **last time they had to produce a compliance document for a customer or regulator**, hours spent on EUDR prep so far.
- **Week 2 — Workflow mapping.** 90-min session per roaster. We walk yesterday's orders, current stock, and **the most recent green lot they received — what paperwork did they get, what do they keep, what do they throw away?** They tell us where the system of record is wrong and where compliance is leaking.
- **Week 3 — Prototype walkthrough.** Figma click-through of: receive green (with the producer/geolocation step), roast event, pack event, sell event, **DDS generation for a shipment**, recall pack, margin view. Capture: which screens they recognize, which they don't, which they would *delete*. Pay special attention to whether the geolocation step feels like bureaucracy or like a natural part of receiving coffee.
- **Week 4 — Pricing & commitment.** Show target pricing (€X/mo with Y integrations included, **explicitly price the EUDR module — should be included, not add-on, because splitting it dilutes the USP**). Capture willingness-to-pay, must-have vs nice-to-have. Roasters who are EUDR-exposed should be asked specifically: "what would you pay for a system that *generates your DDS in <2 minutes* vs. your current process of compiling one by hand?"

### 13.3 Decision criteria to proceed to build

At least 3 of 5 roasters must:
- Identify at least 3 of the 6 pain points from the deep research as "active, painful, in the last 30 days"
- Identify at least one of the 6 pain points as **EUDR-related and "active, painful, in the last 30 days"** (this is the market-fit signal for the USP)
- Say "yes I would pay €X/mo for this" at the proposed price
- Agree to a 90-day paid pilot starting Phase 1 ship

If 2 or fewer, the wedge is wrong; revisit the persona, the price point, or the EUDR module's placement (e.g. ship it as add-on rather than built-in).

### 13.4 Additional EUDR-specific validation

In addition to the above, run 2-3 standalone conversations with:
- **An EUDR consultant or trade body** (e.g. someone from the SCA EU Chapter, the European Coffee Federation, or an independent EUDR advisory firm) — to validate our interpretation of the regulation, our DDS schema, and the wording of the per-shipment opt-out confirmation phrase (§6.5.4)
- **A wholesale customer** of a roaster — to validate the "share your EUDR pack with my auditor" workflow from the buyer's side
- **A green importer / trader** who sells to multiple roasters — to validate our `Supplier.dds_reference` and upstream-DDS-citation model

If we can't get the consultant conversation in 4 weeks, we fall back to published EU guidance and document our interpretation in the audit pack — but the consultant conversation is a strong validation signal we should not skip.

### 13.5 Per-shipment opt-out validation scenario

The opt-out path (§6.5) is the most regulator-sensitive part of the product. Validate it as a separate scenario within each pilot interview, in addition to the standard 18 screens. The test takes about 10 minutes at the end of the call.

**Setup:** ask the roaster to imagine a real scenario:
> "Imagine a wholesale customer in Berlin you've been selling to for two years just placed an order for 12 bags of Yirgacheffe. You don't have a producer statement on file for the lot yet. The order is due to ship on Wednesday. Walk me through what you'd do today, then walk me through what you'd want a tool to do."

**Walk through the click-through opt-out screens (1.3a, 3.4a, 3.4b in the new numbering).** For each, ask:

- "What does this screen ask you to do? Is it clear what the consequences are?"
- "Is the friction proportionate, or is it more friction than you'd expect for a one-off situation?"
- "If you were the regulator reading this audit pack, would it be clear why you took this decision?"
- "Would you want a button to bypass this — say, 'just opt it out, I trust this customer'? Why or why not?"
- "What would you do if a wholesale customer asked you to opt out a shipment on their behalf — i.e. they want to claim the EUDR compliance themselves?"

**Success criteria for the opt-out path:**

- 3 of 5 roasters describe the opt-out as "makes sense" or "would use it" rather than "too much friction" or "would just ignore it"
- 3 of 5 roasters correctly identify *what* the opt-out does (records a decision, generates an audit pack) without prompting
- 0 of 5 roasters say "I would expect to be able to opt out the whole org" (we explicitly want this to not be the intuition)
- 0 of 5 roasters say "I'd want a `packer` to be able to take this decision" (we explicitly want this to be role-gated)

If 2 or fewer pass, revisit §6.5 — the friction is probably wrong, or the framing is unclear.

---

## 14. Success metrics (post-GA)

Once the product is generally available:

| Metric | Definition | Target @ 6mo post-GA | Target @ 12mo post-GA |
|---|---|---|---|
| Paying customers | Orgs on a paid plan | 30 | 150 |
| Net revenue retention | (Starting MRR + expansion − churn) / starting MRR | >110% | >120% |
| Time-to-first-roast-event | Onboarding to first `RoastBatch.completed` in the system | <7 days | <5 days |
| 90-day activation | Pilot met ≥4 of 6 KPIs in §2.3 | 60% | 75% |
| Daily active orgs | ≥1 user logged in on a business day / business days | 80% | 85% |
| Support load | Tickets per customer per month | <4 | <2 |
| Genealogy integrity | Stock-movement invariant violations per 10k movements | 0 | 0 |

---

## 15. Out of scope for v1 (explicit list)

To prevent scope creep, here is what we are *not* building in the MVP:

- Roast profile capture / control (Artisan / Cropster / RoastLog domain)
- Cupping / QC scoring linked to roast batches (deferred to Phase 3)
- Café-side wholesale telemetry (Cropster Café domain)
- Multi-roastery / multi-warehouse (single org, single warehouse in v1)
- Direct roaster hardware control
- Native mobile apps (responsive web only)
- SSO
- AI-driven email parsing (rule-based templates in v1)
- Auto-pricing
- Public API for third parties (we have a private API for our own integrations; a public one is v2)
- Subscriptions management (we *receive* subscription orders from Shopify/Woo; we don't *manage* subscription billing)
- Loyalty / CRM
- Equipment maintenance scheduling (mentioned in deep research; deferred — no signal in pilot interviews yet)
- **EUDR Information System API integration** (v1 generates the DDS as a signed PDF + JSON for manual submission; v1.5 adds the direct API integration)
- **EUDR smallholder small-quantity relief** (v1.5, once the EU's smallholder framework is finalised)
- **EU pre-pack average-weight auditing UI** (the data is captured; the regulatory audit dashboard is v1.5)
- **Cross-region data mirrors** (a UK roaster with an EU subsidiary cannot yet have both regions; v1.5)
- **Multi-producer green lots** (`LotProducer` entity is in the schema; the multi-producer UX is v1.5)
- **Customs broker / commercial-invoice integration** (we generate the DDS; the operator still works with their broker for the rest of the export file — v1.5)
- **US/Canada/AU/NZ market entry** (v2; UK/EU-only at launch)
- **Org-wide EUDR opt-out** (intentionally not in the product; EUDR is a per-shipment legal obligation — see §3 principle 11, §6.5. The product records per-shipment decisions, not org-wide settings)
- **Auto-detection / auto-skip of "obviously" out-of-scope shipments** (the system prompts at ship time so the roaster makes an active decision; we do not silently skip — see §6.5)
- **Below-threshold aggregation across shipments to the same customer** (open question 22; v1 treats each shipment independently; v1.5 adds the 7-day aggregation if the EU's published guidance settles on it)

---

## Appendix A — Glossary

- **Green coffee** — unroasted coffee, the raw material.
- **Roasted coffee (loose)** — coffee that has been roasted, before packaging.
- **Packaged coffee** — roasted coffee in a saleable unit (250g bag, 1kg bag, etc.). Bag sizes are in **grams/kilograms by default**; imperial display is opt-in for specific SKUs.
- **Lot** — a batch of coffee with a unique identifier. A green lot is the input; a roasted lot is the post-roast output; a packaged lot is a saleable batch.
- **Yield** — mass of roasted coffee out, divided by mass of green coffee in, expressed as a percentage.
- **Bag size** — the mass of one saleable unit (e.g. 250g, 1kg), stored canonically in grams and displayed in the customer's preferred unit.
- **FIFO / FEFO** — First In, First Out / First Expired, First Out — lot rotation rules.
- **Landed cost** — all-in cost of a green lot at the roaster's warehouse: purchase price + freight + duty + insurance + storage, in the org's base currency, **excluding recoverable VAT**.
- **Net requirements** — the gap between what customers have ordered and what is already (or will soon be) available; drives the roast plan.
- **Genealogy** — the chain of custody from green lot → roast batch → roasted lot → packaged lot → order line → shipment.
- **Recall pack** — a generated document showing every shipment that contains coffee from a given lot.
- **EUDR** — EU Deforestation Regulation (Regulation (EU) 2023/1115). Applies to coffee placed on the EU market, sold within the EU, or exported from the EU from **30 December 2026**. Requires a Due Diligence Statement (DDS) for every shipment, supported by geolocation data on the plot of land where the coffee was grown.
- **DDS (Due Diligence Statement)** — the EUDR-required document filed by the operator of record for every in-scope shipment. Contains product description, country of harvest, geolocation, supplier DDS reference, risk assessment, and risk mitigation measures.
- **Operator (EUDR sense)** — the first entity in the supply chain placing the product on the EU market. This is typically the roaster (or the EU importer of record if the roaster is not in the EU).
- **Geolocation (EUDR sense)** — the polygon coordinates of the plot of land where the coffee was grown, with sufficient precision to demonstrate the coffee was not produced on land deforested after 31 December 2020.
- **UK FRC** — UK Forest Risk Commodities regime, in force from late 2025 for forest-risk commodities including coffee. Requires a due-diligence statement from the UK importer of record. Similar in structure to EUDR with some UK-specific differences (e.g. DEFRA's country-risk methodology).
- **Audit pack** — a signed, exportable PDF/JSON bundle that ties a compliance story to a shipment, a period, or a supplier. Includes the DDS, the lot genealogy, the supplier due-diligence record, and the chain-of-custody log.
- **Data residency (UK / EU)** — the geographic region where an org's data and compute resources are stored. UK roasters default to UK residency (London); EU roasters default to EU residency (Frankfurt or Dublin). The choice is binding in v1 and is enforced at the infrastructure layer.
- **VAT (Value Added Tax)** — UK standard rate 20% (5% reduced, 0% zero); EU member-state rates vary (DE 19%, NL 21%, FR 20%, IE 23%, etc.). B2B cross-border within the EU with a valid VAT number is reverse-charge (zero-rated); B2C is charged at the destination rate.
- **MTD (Making Tax Digital)** — UK HMRC's framework requiring digital record-keeping and quarterly VAT return submission. Our invoice push to Xero is designed to be MTD-compatible from day one.
- **HS code (Harmonized System code)** — international trade classification code. Green coffee is **HS 0901**; roasted coffee is HS 0901.21. The DDS requires the relevant code.
- **VIES (VAT Information Exchange System)** — the EU's public VAT-number validation API. Used at customer onboarding to confirm a B2B customer has a valid VAT registration in their stated member state.
- **TRACES (EU)** — the EU's existing trade-document platform (used for CITES, organic, etc.). The EU's EUDR Information System is being built as a successor/extension. We integrate with whatever shape the final system takes (v1.5 workstream).
- **Per-shipment EUDR opt-out (§6.5)** — the *recorded* decision to ship coffee into the EU without a Due Diligence Statement, taken at ship time by an authorised user (owner, compliance officer, or head roaster), with a written reason, a typed confirmation phrase, and a signed opt-out audit pack. The opt-out is **not** an org-wide setting; it is a per-shipment decision, treated as an exception rather than a default, and generates the document the roaster would hand to a regulator if asked "why does this shipment not have a DDS?"
- **`ShipmentEudrDecision` (§5.6)** — the system record of the per-shipment EUDR decision. One per shipment, regardless of whether the shipment is in scope. Captures the scope determination, the user's decision (file_dds or opt_out), the reason (if opt_out), and the role / user / timestamp. Append-only; corrections are new decisions with a `supersedes_id` link.
- **Confirmation phrase (§6.5.4)** — the exact legal acknowledgement text the user must type to take a per-shipment opt-out. The v1 phrase is *"I confirm this shipment does not require a Due Diligence Statement under EUDR. I am the operator of record."* The wording is reviewed by an EU regulatory lawyer before v1 ships.
- **Opt-out audit pack (§6.5.5)** — a signed PDF generated automatically when a roaster takes a per-shipment opt-out. Contains the shipment record, the lot genealogy, the user's reason, the user's role, the timestamp, the legal acknowledgement text, and a hash-chain entry. The document the roaster hands to a regulator if asked "why?"

---

## Appendix B — Open decisions log

Decisions still to be made, with owner and target date:

- [ ] Pricing: subscription tier structure, overage model (€X/mo with the EUDR module **included**, not add-on — see §13) — Product + Finance — by end of Phase 0
- [ ] Brand: name, domain, visual identity — Product + Design — by end of Phase 0
- [ ] Data residency: **UK and EU at launch (both regions); cross-region migration is a v2 ops project.** Decision is per-org at signup. — Eng + Legal — by end of Phase 0
- [ ] Cloud provider: AWS London + AWS Frankfurt, or a UK/EU sovereign provider (Hetzner, OVHcloud) — Eng + Procurement — by end of Phase 0
- [ ] VAT validation: VIES/HMRC public APIs on demand vs paid service (Taxamo / Vatlayer) — Eng + Finance — by end of Phase 0
- [ ] Pilot contract: MSA, UK/EU GDPR-compliant data processing addendum, SLA, **explicit division of responsibility for EUDR DDS filing (we generate, operator signs and submits, operator is the legal entity)** — Legal — before pilot onboarding
- [ ] Insurance: E&O, cyber, **professional indemnity covering regulatory-advice exposure from the EUDR module** — Ops + Insurance broker — before pilot onboarding
- [ ] EUDR Information System integration partner: which consultant / law firm / industry body to engage for ongoing regulatory interpretation as the EU's API finalises — Founder + Legal — before v1.5
- [ ] Hiring: founding engineer, founding designer, founding CS, **founding compliance/product specialist with EUDR or food-safety background** — Founder — continuous
- [ ] Pilot cohort composition: 2 UK, 1 NL, 1 DE, 1 FR (see §13.1) — Founder + Sales — by start of validation cycle
- [ ] Northern Ireland: hybrid UK/EU treatment or single-region with VAT-handling flag — Product + Legal — by end of Phase 0 (see open question §11.14)
- [ ] Pricing for second-cohort / non-priority-country roasters: how to handle Italian / Spanish / Nordic / Polish pilots when the UI is not yet localised — Product — by end of Phase 1
- [ ] **EU regulatory legal review**: review the per-shipment opt-out confirmation phrase wording (§6.5.4) and the opt-out audit pack's legal text (§6.5.5) before v1 ships. Single engagement, ~2-4 hours of a specialist's time, ~£1,500. — Founder + Legal — by end of Phase 0

---

*End of PRD. Next step: validation interviews (§13) running concurrently with Phase 0 implementation. PRD will be revised after each validation cohort.*
