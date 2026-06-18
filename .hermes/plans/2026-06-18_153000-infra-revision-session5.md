# Infra revision — Vercel + Supabase consolidation (Session 5)

> **Status:** Draft 0.1 — for engineering review
> **Date:** 2026-06-18
> **Supersedes:** `2026-06-17_185000-architecture-v1.archived.md` + sessions 2 & 3
> **Frozen baseline:** tag `freeze-pre-revision` (commit `0bc4200`)
> **PRD scope:** unchanged — see `2026-06-17_165800-coffee-ops-mvp-prd.md` v1.2

> **For the team:** The pre-revision architecture (8-vendor stack: Vercel + Neon ×2 + Fly.io + Logflare + Grafana Cloud + S3 ×2 + Slack) was correct on paper but had too much surface area for a solo founder to operate. This revision collapses the same PRD scope onto **3 vendors** (Vercel + Supabase + Slack) on free tiers, with explicit deferral of the three load-bearing complexity multipliers (per-region routing, hash-chain audit, dedicated worker runtime).

---

## 1. Goal of this revision

Ship the same product (PRD v1.2: 4 modules, UK/EU, EUDR as pillar, Nov 2026 pilot) on infrastructure one person can operate, on free tiers, with a clear upgrade path when pilots convert to paid.

The pre-revision architecture decisions that caused the most operational drag:

| Pre-revision decision | Revision |
|---|---|
| Managed Postgres + PostGIS + RLS on **Neon** (×2 for region split) | **Supabase Postgres + PostGIS + RLS**, single region (eu-west-2 London) |
| Auth.js self-hosted with Lucia/Auth.js + Drizzle adapter (card 0.6, M=3d) | **Supabase Auth** (GoTrue) with Drizzle adapter — drop-in, no JWT plumbing |
| S3 ×2 (UK + EU buckets) for file storage | **Supabase Storage** (1 project, RLS-aware buckets) |
| BullMQ worker on **Fly.io** as second deploy target | **pg_cron** (inside Supabase) + **Vercel Cron** for time-based jobs |
| **Logflare** for structured logs | **Supabase Logs** + Vercel function logs (7-day retention, free) |
| **Grafana Cloud** for metrics + dashboards | **Supabase dashboard** + Vercel Analytics (one user, 90-day window) |
| Slack incoming webhook for alerts | Slack incoming webhook (unchanged) |
| Per-region routing (card 0.10, L=5d) | **Deferred** to post-pilot — single region only |
| Hash-chain audit trigger (card 0.14, M=3d) + nightly validator (0.25, M=3d) | **Deferred** — keep append-only `audit_event` table, defer cryptographic chain |
| Modular monolith on Next.js 15 + tRPC + Drizzle | **Unchanged** — same shape, different hosting |

**Vendor count: 8 → 3** (Vercel + Supabase + Slack). Plus GitHub (already there).

---

## 2. The new stack

### 2.1 Vercel (hobby tier, free)

| Use | Notes |
|---|---|
| Next.js 15 App Router host | Same as before |
| Server Actions + tRPC v11 + REST webhooks | Same as before |
| Edge + Node runtimes | Same as before |
| Cron jobs (vercel.json `crons` field) | Replaces BullMQ worker for any schedule-based job |
| Function logs (built-in) | Replaces Logflare for app-side logs |
| Analytics (built-in, hobby tier) | Replaces Grafana for app-side metrics |
| Region | `lhr1` (London) — confirmed single-region for pilot |

Limits: 100 GB bandwidth/mo, 1000 serverless invocations/day on hobby, 100s max execution per function. Fine for pilot; upgrade to Pro ($20/mo) when bandwidth or invocations exceed.

### 2.2 Supabase (free tier)

| Use | Notes |
|---|---|
| Postgres 15 with **PostGIS** | One extension enable in dashboard, free-tier-eligible |
| **Auth** (GoTrue) | Email + magic link, JWT in httpOnly cookie, RLS-aware |
| **Storage** (S3-compatible) | 1 GB free; per-row RLS via Postgres policies |
| **Realtime** (WebSocket) | Free; useful for daily board + pack/ship UI later |
| **pg_cron** (inside the DB) | Schedule SQL jobs without a second runtime |
| **Dashboard** | Built-in table editor, SQL editor, logs, metrics |
| Region | `eu-west-2` (London) — matches Vercel, ~10ms between them |

Limits to watch:
- **500 MB database size** — fine for 0–3 pilots, will hit cap before 5+ customers with order history
- **1 GB storage** — fine for ~10K lot photos / DDS PDFs
- **5 GB egress/mo** — fine for pilot, watch when serving pack/ship photos
- **Project pauses after 1 week of no activity** on free tier — solvable with a 7-day keepalive ping via Vercel Cron, or upgrade to Pro ($25/mo) when you have a paying pilot
- **7-day log retention** on free tier — adequate for pilot

### 2.3 Slack incoming webhook (free)

Alerting only. Wired to pg_cron health checks + Vercel deploy notifications.

### 2.4 GitHub (unchanged)

Source control, GitHub Actions for CI (lint + typecheck + test on PR).

---

## 3. Architecture (revised)

### 3.1 Module map (unchanged from PRD v1.2 §4.1)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Demand        Inventory / Trace       Money         Compliance      │
│  ────────      ─────────────────       ──────        ───────────     │
│  Orders        Lots (green /            Landed costs  EUDR ref data  │
│   ↓              roasted / packaged)    BOMs          Supplier due   │
│  Net           Stock ledger              Allocations   diligence      │
│  requirements  Variable-weight          Margin engine  Geolocation   │
│                 conversion                            plots          │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  all four share one data spine
        ┌─────────────────────────────────────────────────────┐
        │         Supabase Postgres + PostGIS + RLS            │
        │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────┐ │
        │  │  Auth    │  │ Storage  │  │ pg_cron  │  │Logs │ │
        │  │  GoTrue  │  │  (S3)    │  │          │  │     │ │
        │  └──────────┘  └──────────┘  └──────────┘  └─────┘ │
        └─────────────────────────────────────────────────────┘
                              ▲
                              │
                ┌─────────────┴─────────────┐
                │   Vercel (Next.js 15)     │
                │   lhr1                    │
                │   + Vercel Cron           │
                │   + Vercel Analytics      │
                └───────────────────────────┘
                              │
                              ▼
                          Slack alerts
```

### 3.2 Data residency — explicit deferral

All orgs in v1 live in `eu-west-2` (London) on a single Supabase project. **There is no per-org data residency in v1.**

Why this is OK for the pilot:
- Pilot customers are UK/EU roasters; `eu-west-2` is in the UK and acceptable for both UK GDPR and EU GDPR (UK adequacy decision in force since 2021)
- PRD §2.1 says the founder is targeting growth-stage roasters; data residency is not in the §2.3 success criteria
- The architecture stays "ready for" per-region — a future revision splits Supabase projects per region, Vercel adds `fra1`, the application reads `Organization.data_residency` at request time

When to revisit: when the first EU customer asks for proof of EU-only hosting in writing (likely a German wholesale account mid-pilot). At that point, add a second Supabase project in `eu-central-1` (Frankfurt) and the 5-day per-region routing task from the archived backlog.

### 3.3 Audit log — explicit deferral of the hash chain

The PRD §3 principle 10 says every state-changing action leaves a tamper-evident audit trail. The pre-revision implementation (custom `BEFORE INSERT` trigger computing `prev_hash` + `hash_chain_self` per org, nightly validation worker) is correct but expensive: ~6 founder-days and a recurring nightly job to operate.

**Revision:** ship the append-only `audit_event` table on day 1. Defer the cryptographic hash chain + nightly validator to a v1.5 card.

What "append-only" means in practice on Supabase:
- No `UPDATE` or `DELETE` RLS policies on `audit_event` (RLS-as-permission-model trick)
- A `BEFORE UPDATE` / `BEFORE DELETE` trigger that raises `EXCEPTION` (no hash needed, just refusal)
- All state-changing tRPC procedures insert one `audit_event` row in the same transaction

This gives the roaster the audit pack (PRD §3 principle 10's "hand an auditor a complete record") without the operational cost of a hash chain. The hash chain is a *defense in depth* layer on top, not a replacement.

When to revisit: when the first pilot customer asks "what stops a rogue admin from editing an old audit row?" — the answer today is "RLS + trigger refuse", which is sufficient for most pilots but weaker than the hash chain for a hostile-insider scenario.

### 3.4 Background jobs — pg_cron + Vercel Cron

Two flavours of background work, two free-tier schedulers:

| Type | Where | Example |
|---|---|---|
| DB-side jobs (SQL-only) | **pg_cron** inside Supabase | Hash chain validator (when added), EUDR `country_risk` table refresh, audit pack generation kickoff |
| App-side jobs (need app logic) | **Vercel Cron** (vercel.json `crons` field) | Daily board recompute, order sync from Shopify/WooCommerce, DDS draft generation |

No BullMQ. No Fly.io. No Redis. The queue model collapses to "DB row + pg_cron tick" for SQL jobs and "Vercel function on schedule" for app jobs.

Limits: Vercel Cron hobby tier = 2 cron jobs max, 1 execution/day each. Fine for pilot; if you need more, upgrade or consolidate. pg_cron free tier has no documented job-count limit; one extension enable, unlimited cron schedules.

---

## 4. Revised tech backlog (Phase 0, restructured)

Sized in **founder-days** as before. Each task is one unit of work; tasks within a phase can run in any order unless dependencies say otherwise.

### Phase 0.1 — Repo, CI, deploy skeleton (~5 founder-days)

| # | Task | Size | Deps | Acceptance |
|---|---|---|---|---|
| **0.1** | Initialize the monorepo: Next.js 15 + TS strict + ESLint + Prettier + `apps/web` + `packages/db` + `packages/money` | S | — | `pnpm dev` starts; `pnpm build` succeeds; lint clean |
| **0.2** | GitHub Actions: lint + typecheck + test on PR; build on merge to main | S | 0.1 | PR shows green checks; merge triggers Vercel preview |
| **0.3** | Create Supabase project (eu-west-2), enable PostGIS extension, configure `DATABASE_URL` + service role key in Vercel | S | — | Supabase dashboard shows project + PostGIS; Vercel env vars set; `psql` round-trip works |
| **0.4** | Drizzle schema: empty starter + first migration + `pnpm db:migrate` against Supabase | S | 0.1, 0.3 | Migration applies; `pnpm db:studio` opens against Supabase |

**Subtotal: 1 + 1 + 1 + 1 = 4 founder-days**

### Phase 0.2 — Auth, tenancy, RLS (~8 founder-days)

| # | Task | Size | Deps | Acceptance |
|---|---|---|---|---|
| **0.5** | Supabase Auth: magic-link email sign-in, JWT in httpOnly cookie via `@supabase/ssr` | S | 0.3 | User clicks magic link, lands in app, cookie set |
| **0.6** | RLS helpers: `set_tenant_context(org_id)` SQL function + Drizzle middleware that calls it per request | M | 0.3, 0.5 | Cross-org query returns zero rows; tests pass |
| **0.7** | Organization entity + signup flow: user signs up, creates org with `base_currency` (EUR/GBP), `region` (UK/EU list), `eudr_settings` | M | 0.5, 0.6 | Org row exists; founder is `owner`; RLS scoped correctly |
| **0.8** | Vercel Cron health check: 7-day keepalive ping to Supabase so free-tier project doesn't pause | XS | 0.3 | Cron visible in Vercel dashboard; Supabase project stays active |

**Subtotal: 1 + 3 + 3 + 0.5 = 7.5 founder-days**

### Phase 0.3 — Data spine (~15 founder-days)

| # | Task | Size | Deps | Acceptance |
|---|---|---|---|---|
| **0.9** | Drizzle schema: operational entities — `Organization`, `User`, `Membership`, `Sku`, `PriceList`, `PriceListEntry`, `Packaging`, `Recipe`, `LandedCostEvent`, `Order`, `OrderLine` | L | 0.4 | Tables exist; migrations apply; CRUD procedures in tRPC |
| **0.10** | Drizzle schema: lot entities — `GreenLot`, `RoastBatch`, `RoastedLot`, `PackagedLot`, `StockMovement` | L | 0.9 | Tables exist; `audit_event` append-only trigger in place |
| **0.11** | Drizzle schema: compliance entities — `Supplier`, `Producer`, `EudrReferenceData`, `LotProducer`, `DdsDraft`, `ShipmentEudrDecision`, `AuditPack` + PostGIS `geography(MultiPolygon, 4326)` on `Producer.geolocation` | L | 0.10 | Tables exist; high-risk check query (Session 2 §1.3) tested |
| **0.12** | `audit_event` table: append-only via RLS-as-permission + `BEFORE UPDATE/DELETE` trigger (no hash chain yet) | S | 0.9 | UPDATE/DELETE raises exception; every state-changing procedure inserts one row in the same tx |
| **0.13** | Money spine: `LandedCostEvent` with VAT tracking (UK 20%, DE 19%, NL 21%, etc.), `PriceList` with VAT-inclusive/ex-VAT modes | M | 0.9 | Landed cost recorded with recoverable flag; cost cascade computes correctly |
| **0.14** | Seed data: `pnpm dev:seed` populates one org, SKUs, supplier, producer, green lots, roast, pack, order. Smoke test reuses it. | S | 0.9, 0.10, 0.11, 0.12, 0.13 | Seed runs cleanly; smoke test passes against it |
| **0.15** | pg_cron: schedule the audit-pack freshness check (placeholder job — runs nightly, no-op until v1.5) | XS | 0.4 | Job visible in `cron.job` table; manual run succeeds |

**Subtotal: 5 + 5 + 5 + 1 + 3 + 1 + 0.5 = 20.5 founder-days**

### Phase 0.4 — Admin UI v0 + smoke (~10 founder-days)

| # | Task | Size | Deps | Acceptance |
|---|---|---|---|---|
| **0.16** | Admin UI: SKUs, customers, suppliers, packagings, recipes, price lists (read + write) | L | 0.9 | Forms CRUD each entity; validation works; permission-aware |
| **0.17** | Manual green-receiving flow: supplier, producer, geolocation (GeoJSON map picker), lot details, costs, risk review | L | 0.11 | Founder can receive a green lot end-to-end; EUDR risk warning surfaces |
| **0.18** | Daily board v0: read-only screen, computed via Vercel Cron at 03:00 UTC, shows "what needs me today" | M | 0.10 | Board renders; cron visible in vercel.json; refresh works |
| **0.19** | Manual pack + sell: form-based pack event and sell event (no scan workflow yet) | M | 0.10 | Founder can pack a bag and sell it; stock ledger updates |
| **0.20** | Compliance-aware green receiving: warning at receipt if `country_risk = high`, block at EU shipment if any lot lacks `EudrReferenceData` | M | 0.11 | Warning blocks ship; bypass requires explicit reason logged to `audit_event` |
| **0.21** | Smoke test: end-to-end script — create org → receive green lot → log roast → pack bag → sell bag → produce DDS draft | M | 0.14, 0.16, 0.17, 0.19, 0.20 | Script runs clean against seeded data; output matches expected |
| **0.22** | Test suite: high-risk check (Session 2 §1.3) + area-validation check (§1.4) | M | 0.11 | Unit + integration tests pass; CI green |

**Subtotal: 5 + 5 + 3 + 3 + 3 + 3 + 3 = 25 founder-days**

### Phase 0 total: ~57 founder-days

That's **larger than the pre-revision ~30 days** for Phase 0. Here's why that's fine:

1. The pre-revision sizing under-counted: cards 0.10 (per-region routing, 5d), 0.14 (hash chain trigger, 3d), 0.25 (nightly validator, 3d) added 11 days that this revision **removes**
2. The pre-revision sizing also missed the **operational tax** of running 8 vendors — vendor onboarding, credential rotation, cross-vendor debugging, region-split logic. The revision has 3 vendors and no region split.
3. **Auth is faster** in this revision: Supabase Auth saves ~2 days vs Auth.js self-hosted.
4. **Background jobs are faster**: pg_cron + Vercel Cron replace ~3 days of BullMQ + Fly.io + Redis setup.
5. The added ~27 days buys: real EUDR risk UI (0.20), GeoJSON map picker (0.17), higher-quality admin UI work. Stuff that actually ships value.

### Phase 1 + Phase 2 (unchanged in scope, only infra names change)

The same Phase 1 (integrations + EUDR MVP, ~80 founder-days) and Phase 2 (money + insights + tier 2, ~70 founder-days) from the archived Session 3 doc carry forward, with these name swaps:

| Pre-revision reference | Revision |
|---|---|
| Neon ×2 | Supabase single project |
| BullMQ on Fly.io | pg_cron + Vercel Cron |
| Logflare + Grafana Cloud | Supabase Logs + Vercel Analytics |
| S3 ×2 | Supabase Storage |
| Per-region routing (any card that referenced it) | Single region; revisit per-customer |
| Hash chain + nightly validator | Deferred to v1.5 |

---

## 5. The 7-day keepalive — concrete

Supabase free tier pauses a project after 7 days of no activity. Pilot has gaps (weekends, holidays) where no one logs in. Solution: a Vercel Cron job that pings Supabase once every 6 days.

```json
// vercel.json (addition)
{
  "crons": [
    { "path": "/api/cron/keepalive", "schedule": "0 9 */6 * *" }
  ]
}
```

```ts
// app/api/cron/keepalive/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  // Lightweight query that touches the DB so Supabase sees activity
  await supabase.from('Organization').select('id').limit(1)
  return NextResponse.json({ ok: true })
}
```

When to remove: upgrade to Supabase Pro ($25/mo) at first paying pilot. The keepalive is a free-tier tax, not a permanent feature.

---

## 6. Free-tier upgrade ladder

The "when do I pay?" decision tree:

| Trigger | Upgrade | Cost |
|---|---|---|
| Bandwidth or function invocations exceed Vercel hobby | Vercel Pro | $20/mo |
| Pilot signs (any paying org) | Supabase Pro (kills pause risk + raises DB cap to 8 GB) | $25/mo |
| 5+ paying orgs OR pilot needs EU-only data residency | Second Supabase project in `eu-central-1` + per-region routing | +$25/mo |
| Order history grows past 500 MB | Supabase Pro (8 GB cap) → then evaluate migration or DB pruning | covered |
| First EU customer asks for hash-chain audit | Add `pgcrypto` trigger + nightly validator | dev cost, no infra |
| Background work exceeds 2 cron jobs | Consolidate crons OR upgrade to Vercel Pro | $20/mo |

**Pre-pilot monthly infra cost target: $0.** Post-first-paid-pilot: ~$45/mo (Vercel Pro + Supabase Pro + Slack free). Compare to pre-revision: ~$100-200/mo before pilot (Fly.io + Logflare + Grafana Cloud + S3 + Neon ×2, even on free tiers you pay for one or two of these).

---

## 7. What I am NOT changing

1. **PRD scope** — 4 modules, UK/EU only, EUDR as pillar, Nov 2026 pilot. The product is the product.
2. **Data model** — the same PRD §5 entity list (Organization, User, Membership, Sku, PriceList, PriceListEntry, Packaging, Recipe, LandedCostEvent, Order, OrderLine, GreenLot, RoastBatch, RoastedLot, PackagedLot, StockMovement, Supplier, Producer, EudrReferenceData, LotProducer, DdsDraft, ShipmentEudrDecision, AuditPack, audit_event). Schema is the spine; infra is the bones.
3. **Coffee-native principles** — metric, EUR/GBP-native, VAT-aware, append-only audit, compliance-is-operational. All 11 PRD §3 principles still apply.
4. **Clickthroughs** — `.hermes/plans/clickthrough/` is the UX spec. Nothing in this revision changes the user-facing flows.
5. **Deep research** — `deep-research-report(2)(1).md` is the market input. No changes.

---

## 8. Open questions for the next session

1. **Vercel Cron limits (hobby: 2 jobs, 1/day each)** — does the Phase 0 daily board + the keepalive + any audit pack freshness check fit in 2 jobs? If not, do we (a) consolidate, (b) upgrade to Pro, or (c) move the keepalive to a GitHub Action schedule? *Lean: (a) consolidate; daily board and keepalive can share a single cron if we move the board compute to a Supabase function and have Vercel just trigger it.*
2. **Supabase Auth vs. Auth.js** — do we lose anything meaningful by going to GoTrue instead of Auth.js? Email magic links, JWT in httpOnly cookie, RLS-aware — all present. Lost: custom JWT claims without a server round-trip (we add org_id + role as Postgres claims instead, looked up in `set_tenant_context`). *Lean: acceptable trade; document the lookup pattern.*
3. **EU residency on Supabase free** — can we pick `eu-west-2` on free tier, or only on Pro? *To confirm in Supabase docs before session 6.*
4. **VAT on Supabase** — no infra change needed, just data model. Carries over from pre-revision.
5. **The 27-day Phase 0 growth** — is it real or am I sandbagging? *Will re-baseline at end of session 6 once 0.1–0.4 are actually in flight.*

---

## 9. What to flag for the next session

1. **Tag `freeze-pre-revision` exists** on commit `0bc4200`. All architecture v1 docs are renamed `*.archived.md` with a superseded banner. The kanban DB is backed up to `kanban.db.bak-prerevision-1781796704` and all non-terminal cards are marked archived.
2. **Code is wiped** — `code/` is gone. The repo on GitHub still has the old history (tag is the anchor). New code starts from `freeze-pre-revision` forward.
3. **No more Fly.io, Logflare, Grafana Cloud, S3, Neon, or per-region routing in this stack.** If a card in a future session names any of them, that's a bug — flag it.
4. **The PRD is unchanged.** If we change the data model later, we change it via PRD amendment + a new schema migration, not by editing this doc.
5. **The free-tier cliff is real.** 500 MB + 1-week pause + 5 GB egress + 7-day log retention are the constraints that shape every Phase 1+ decision. When in doubt, design for the upgrade, not the workaround.

---

*This doc is the working baseline. Subsequent sessions should patch it (small surgical edits, see `hermes-agent` skill) rather than rewriting it.*