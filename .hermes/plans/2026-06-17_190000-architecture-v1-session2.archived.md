# Architecture — v1 draft (Session 2)
> ⚠️ **ARCHIVED — SUPERSEDED**
>
> This doc described the pre-revision architecture (modular monolith on Vercel + Neon + Fly.io + Logflare + Grafana Cloud + S3 + Slack, 8-vendor stack, per-region routing, hash-chain audit, BullMQ worker).
> **Frozen at tag `freeze-pre-revision` (commit 0bc4200, 2026-06-18).**
> Replaced by `2026-06-18_153000-infra-revision-session5.md`. Do not implement from this doc.
>
> PRD scope (4 modules: Demand / Inventory / Money / Compliance, UK/EU, EUDR as pillar) is unchanged — see `2026-06-17_165800-coffee-ops-mvp-prd.md`.



> **Status:** Draft 0.2 — Session 2 of 3
> **For the team:** This is the second of three working-session docs. **Session 1** covered the high-level architecture (modular monolith, Next.js + tRPC + Drizzle, managed Postgres + worker host, Vercel + Fly.io). **Session 2** (this doc) covers the load-bearing technical decisions: PostGIS schema, hash chain, audit pack rendering, DDS rendering, queue model, offline/sync, and backup/retention. **Session 3** will be the tech backlog, in phases, sized.
>
> **Companion docs:**
> - Product plan: `../2026-06-17_165800-coffee-ops-mvp-prd.md` (PRD v1.2)
> - Session 1 architecture: `./2026-06-17_185000-architecture-v1.md`
> - Research: `../../deep-research-report(2)(1).md`
> - Click-through: `../clickthrough/`
>
> **What I want you to push back on:** §10 contains 9 open questions specific to Session 2. Most of them have a default I've marked as the lean. The right move is for you to confirm or correct each one before we move to Session 3.

---

## 0. Recap of Session 1

The high-level shape (locked unless you say otherwise):

- **Shape:** Modular monolith, single TypeScript codebase
- **Frontend + API:** Next.js 15 App Router
- **RPC:** tRPC v11 + Zod
- **ORM:** Drizzle
- **Database:** Managed Postgres with PostGIS, RLS-enforced
- **Background work:** BullMQ on Fly.io (proposed)
- **Cache/queue:** Managed Redis
- **Object storage:** S3 (per-region)
- **Deployment:** Vercel + Neon + Fly.io + S3

Open questions from Session 1 (§9 of Session 1 doc) — assumed resolved at the lean for Session 2 unless you say otherwise:
- Worker host: **Fly.io**
- PostGIS on Neon: **to confirm in this session**
- Vercel regions: **lhr1, fra1 — to confirm**
- Queue: **BullMQ**
- ORM: **Drizzle**
- API style: **tRPC + server actions for sign-class mutations + REST for webhooks**

---

## 1. PostGIS schema

### 1.1 Why PostGIS

The PRD §5.6 has `Producer.geolocation` as a GeoJSON polygon. There are four things we want to do with polygons in this product:

1. **Store** the polygon and read it back as GeoJSON for the map preview.
2. **Validate** that the polygon is well-formed (closed ring, vertices in geographic coordinates, area roughly matches `area_hectares`).
3. **Compute** the polygon area and compare it to the declared `area_hectares` (the PRD's "warns if delta >20%" rule).
4. **Query** "is this polygon inside a high-risk country" — for the EUDR scope check, the system needs to know if any of the green lots feeding a shipment are in a country the EU has flagged as high risk.

Postgres can do none of these natively. PostGIS does all four. The cost is one Postgres extension and ~20MB of disk. The benefit is that we don't need a separate geospatial service, and the queries stay in SQL.

### 1.2 The schema

```sql
-- Enable the extension (one-time, in the first migration)
CREATE EXTENSION IF NOT EXISTS postgis;

-- A separate schema for the EUDR reference data keeps the country-risk table
-- separate from per-org data. (We may revisit this when we get to v2.)
CREATE SCHEMA IF NOT EXISTS eudr;

-- Country-risk table. Populated from the EU's published country-risk
-- benchmarking, refreshed quarterly by an internal job.
CREATE TABLE eudr.country_risk (
  iso_country_code text PRIMARY KEY,        -- 'BR', 'ET', 'CO', etc.
  risk_class text NOT NULL,                 -- 'low' | 'standard' | 'high'
  effective_from date NOT NULL,
  effective_to date,                        -- null = current
  source_doc text NOT NULL,                 -- URL to EU publication
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A view that always returns the *current* country-risk row per country.
CREATE VIEW eudr.country_risk_current AS
SELECT *
FROM eudr.country_risk
WHERE effective_to IS NULL;

-- The Producer entity, in the main schema, with the geolocation column.
CREATE TABLE producer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organization(id),
  name text NOT NULL,
  producer_type text NOT NULL,               -- 'farm' | 'cooperative' | 'estate' | 'smallholder_group'
  country text NOT NULL,                     -- ISO 3166-1 alpha-2
  region text,
  department text,
  -- The polygon. Stored as PostGIS geometry in WGS84 (EPSG:4326).
  -- We use GEOMETRY(MultiPolygon, 4326) — even single polygons go in as
  -- MultiPolygon — because some producers legitimately span multiple plots
  -- (a cooperative with separated plots is the obvious case).
  geolocation geography(MultiPolygon, 4326) NOT NULL,
  area_hectares numeric(10,4) NOT NULL,
  area_computed_hectares numeric(10,4) GENERATED ALWAYS AS
    (ST_Area(geolocation::geometry) / 10000.0) STORED,
  altitude_m int,
  verification_source text NOT NULL,         -- 'self_reported' | 'third_party_verified' | 'satellite_imagery' | 'ground_survey'
  verified_at timestamptz,
  verified_by text,
  evidence_doc_id uuid,                      -- points to the file in S3
  certifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- The PRD's invariant: a self-reported producer cannot be used for an EU-export
  -- lot unless the org owner signs an override. We enforce this at the
  -- application layer (it's a business rule, not a DB constraint) and also
  -- create an index that makes the override lookup fast.
  is_self_reported boolean GENERATED ALWAYS AS
    (verification_source = 'self_reported') STORED
);

-- Spatial index for the geolocation queries.
CREATE INDEX producer_geolocation_gist ON producer USING GIST (geolocation);

-- Index for the country-risk lookup.
CREATE INDEX producer_country_idx ON producer (org_id, country);

-- The EudrReferenceData row, which links a green lot to a producer and a country.
-- This is the row the DDS reads from.
CREATE TABLE eudr_reference_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organization(id),
  green_lot_id uuid NOT NULL REFERENCES green_lot(id),
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  producer_id uuid NOT NULL REFERENCES producer(id),
  country_of_harvest text NOT NULL,
  harvest_year int NOT NULL,
  hs_code text NOT NULL DEFAULT '0901',
  product_description text NOT NULL,
  net_mass_kg numeric(12,3) NOT NULL,
  geolocation_doc_id uuid,                  -- file in S3 (KML, GeoJSON, shapefile)
  verification_doc_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  producer_statement_doc_id uuid,
  risk_status text NOT NULL DEFAULT 'pending',  -- 'pending' | 'low' | 'standard' | 'high'
  risk_status_set_at timestamptz,
  risk_status_set_by_user_id uuid REFERENCES "user"(id),
  dds_state text NOT NULL DEFAULT 'not_required', -- see PRD §5.6
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (green_lot_id)                       -- one EudrReferenceData per green lot
);

CREATE INDEX eudr_reference_data_org_idx ON eudr_reference_data (org_id);
CREATE INDEX eudr_reference_data_country_idx ON eudr_reference_data (org_id, country_of_harvest);
```

### 1.3 The high-risk check

This is the query that answers "is this lot's producer in a high-risk country?" — it's called at shipment time as part of the in-scope check.

```sql
-- Given a list of green lot IDs in a shipment, return any that are
-- sourced from a high-risk country.
SELECT erd.green_lot_id, p.name AS producer_name, erd.country_of_harvest
FROM eudr_reference_data erd
JOIN producer p ON p.id = erd.producer_id
JOIN eudr.country_risk_current crc
  ON crc.iso_country_code = erd.country_of_harvest
WHERE erd.org_id = $1
  AND erd.green_lot_id = ANY($2::uuid[])
  AND crc.risk_class = 'high';
```

In the v1 implementation this is a single SQL query inside the `in-scope-check` procedure. It runs in <5ms with the indexes above.

### 1.4 The area-validation check

The PRD says the producer's declared `area_hectares` should be sanity-checked against the computed area. PostGIS gives this to us for free via the `area_computed_hectares` generated column.

```sql
-- The check: delta = abs(declared - computed) / declared; warn if > 0.20
SELECT id, name,
  area_hectares AS declared,
  area_computed_hectares AS computed,
  abs(area_hectares - area_computed_hectares) / area_hectares AS delta
FROM producer
WHERE id = $1
  AND abs(area_hectares - area_computed_hectares) / area_hectares > 0.20;
```

In the application code, this check runs in the producer save path. If the delta is > 20%, the system saves the polygon but flags a warning. The roaster sees the warning and either (a) re-uploads a corrected polygon, (b) adjusts the declared area, or (c) overrides with a reason.

### 1.5 Storage cost

A typical coffee cooperative plot polygon is small — 1-10 km², maybe 50-200 vertices. In PostGIS WKB format (which is what we use for storage), each polygon is 1-10 KB. A producer record is 1-10 KB. An org with 200 producer records (a big one) is 2 MB of geolocation data. This is rounding error at the database level.

---

## 2. Hash chain

### 2.1 What we're building

Every state-changing event in the system (every `StockMovement`, every `DdsDraft.sign`, every `ShipmentEudrDecision`, every `AuditPack` generation) gets a `hash_chain_self` that chains from the prior event's `hash_chain_self`. The chain is the regulatory-grade tamper-evidence layer. The PRD's open question 2 was: "do we use a third-party merkle-log library or implement SHA-256 of canonical JSON ourselves?"

**Decision:** Implement SHA-256 of canonical JSON ourselves. Three reasons:

1. **No library is doing exactly this.** The merkle-log libraries assume an append-only log with periodic checkpoints; we have a relational database with hash chain entries. The fit is awkward.
2. **The implementation is 50 lines.** Canonical JSON serialisation, SHA-256, prepend the prior hash. Not novel.
3. **Audit defensibility is easier when you own the code.** A regulator asks "how is the chain computed?" and we point at the source.

### 2.2 Canonical JSON

The challenge is that `JSON.stringify(obj)` is not deterministic — object key order is implementation-defined, whitespace varies, Unicode escapes vary. For a hash to chain, we need a single canonical form.

**Decision:** Use the `canonicalize` function from the [`canonicalize`](https://www.npmjs.com/package/canonicalize) npm package. It's RFC 8785 (JSON Canonicalization Scheme), which is the standard. Object keys are sorted lexicographically, no whitespace, no Unicode escapes.

```typescript
import { canonicalize } from 'canonicalize';
import { createHash } from 'node:crypto';

function hashEvent(event: AuditEvent): string {
  const canonical = canonicalize({
    id: event.id,
    occurred_at: event.occurred_at,
    actor_user_id: event.actor_user_id,
    actor_role: event.actor_role,
    action: event.action,
    entity_type: event.entity_type,
    entity_id: event.entity_id,
    diff: event.diff,
    prev_hash: event.prev_hash,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
```

The 8 fields above are the canonical content of every event. Anything not in this list is not hashed. This is intentional: we hash *what happened*, not *what was sent over the wire*.

### 2.3 The chain trigger

We have a choice: hash in the application code, or hash in a Postgres trigger.

**Decision:** Hash in a Postgres trigger. Reasons:

1. **The application code can't lie about the prev hash.** If the application sends `prev_hash = '0x...'` and the actual previous event has hash `'0x...'` (different), the trigger detects the mismatch and refuses to insert.
2. **The application code doesn't need to know about the chain.** The application does the business logic; the database guarantees the chain. Simpler app code.
3. **Backup and restore preserve the chain.** If we ever restore from a backup, the chain entries in the backup are intact. If the application computed the chain, a restore could leave us with a broken chain.

```sql
-- The trigger function. Runs BEFORE INSERT on audit_event.
CREATE OR REPLACE FUNCTION compute_audit_event_hash()
RETURNS TRIGGER AS $$
DECLARE
  prev_hash_value text;
  canonical_json text;
  hash_value text;
BEGIN
  -- Get the previous event's hash for this org. (Each org has its own chain.)
  SELECT hash_chain_self
  INTO prev_hash_value
  FROM audit_event
  WHERE org_id = NEW.org_id
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  -- If this is the first event, prev_hash is the empty string.
  IF prev_hash_value IS NULL THEN
    prev_hash_value := '';
  END IF;

  -- Build the canonical JSON.
  canonical_json := jsonb_build_object(
    'id', NEW.id,
    'occurred_at', NEW.occurred_at,
    'actor_user_id', NEW.actor_user_id,
    'actor_role', NEW.actor_role,
    'action', NEW.action,
    'entity_type', NEW.entity_type,
    'entity_id', NEW.entity_id,
    'diff', NEW.diff,
    'prev_hash', prev_hash_value
  )::text;

  -- The JSON is already canonical (jsonb_build_object sorts keys
  -- in PG 16+; for older PG we use the canonicalize() function
  -- in the app layer instead).

  -- Compute the SHA-256 hash.
  hash_value := encode(digest(canonical_json, 'sha256'), 'hex');

  -- Set the values on the new row.
  NEW.prev_hash := prev_hash_value;
  NEW.hash_chain_self := hash_value;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_chain_trigger
BEFORE INSERT ON audit_event
FOR EACH ROW
EXECUTE FUNCTION compute_audit_event_hash();
```

The `pgcrypto` extension provides the `digest()` function. We enable it in the same migration as the audit_event table.

### 2.4 Per-org chain

The chain is **per org**, not global. This matters because:

1. **Each org's regulatory record is independent.** Roaster A's chain has no relationship to Roaster B's. If Roaster A is audited, the auditor only sees Roaster A's chain.
2. **Concurrency is per org.** Two roasters writing events at the same time don't contend on a global "latest hash" lock.
3. **Org deletion is straightforward.** When an org is deleted (after 5+ year retention), the chain goes with it.

The trigger above queries the per-org latest event, so this is automatic.

### 2.5 Chain validation

A nightly job walks each org's chain, in order, recomputes each hash, and checks it matches. Mismatches page the founder immediately (per Session 1 §6.3). A mismatch means the chain is broken — either the application inserted a forged event, the database was tampered with, or a backup was restored from an inconsistent state. In any case, the right move is to investigate, not to ignore.

```sql
-- The nightly check. Returns rows where the chain doesn't validate.
SELECT id, occurred_at, action, entity_type, entity_id
FROM audit_event
WHERE org_id = $1
  AND hash_chain_self != encode(digest(
    jsonb_build_object(
      'id', id,
      'occurred_at', occurred_at,
      'actor_user_id', actor_user_id,
      'actor_role', actor_role,
      'action', action,
      'entity_type', entity_type,
      'entity_id', entity_id,
      'diff', diff,
      'prev_hash', prev_hash
    )::text,
    'sha256'
  ), 'hex')
ORDER BY occurred_at, id;
```

In v1, this check is a worker job that runs at 03:00 UTC nightly. Any mismatches page the founder via PagerDuty (or whatever the on-call channel is at the time).

### 2.6 What the chain does NOT cover

- **Read events.** A `SELECT` doesn't generate a chain entry. The chain is for state changes, not queries.
- **Authentication events.** A login doesn't chain. Failed logins are logged to a separate `auth_log` table (out of scope for this doc).
- **Errors that don't change state.** A failed validation that returns a 400 doesn't chain. The application's error log captures it.

This is intentional. The chain is for "things the regulator cares about," not for "everything that ever happened in the app."

---

## 3. Audit pack rendering

### 3.1 What an audit pack is

The PRD §5.6 defines the `AuditPack` entity. Concretely, an audit pack is:

- A **JSON file** containing the structured data (chain-verifiable, machine-readable).
- A **PDF file** containing the same data rendered for a human reader (a regulator, a wholesale customer, the roaster themselves).
- A **signature** over both — the PDF includes a signature page, the JSON includes a JWS signature.

The audit pack is generated for a `scope` (`shipment`, `period`, `supplier`, `recall`, or — new in v1.2 — `shipment_eudr_decision`). The v1.2 opt-out is its own scope; the underlying data is the same.

### 3.2 Rendering pipeline

The pipeline is:

```
BullMQ job: "render_audit_pack"
    ↓
Reads the source data (shipment + lot genealogy + decision record)
    ↓
Generates JSON (canonical, hash-chained, JWS-signed)
    ↓
Renders HTML (template + data)
    ↓
Puppeteer renders PDF (with QR code, signature page)
    ↓
Uploads to S3 (signed-URL only, never public)
    ↓
Updates AuditPack row with storage_key and hash_chain_self
    ↓
Returns the signed URL to the caller (or emails it)
```

The whole thing runs in a worker, not in the request path. A complex audit pack (e.g. a recall with 1,000 shipments) might take 30-60 seconds. The user gets a "generating..." UI and a notification when it's ready.

### 3.3 The template

The PDF template is a React component (using `@react-pdf/renderer` for the *layout primitives* but Puppeteer for the *final render* — see below). The template takes the audit pack data as props and renders:

- **Cover page** (org name, scope, date, hash chain summary, QR code)
- **Lot genealogy** (green → roast → packaged → shipment, as a chain diagram)
- **Decision / event detail** (the actual content: the shipment, the EUDR decision, the opt-out if applicable, the margin attribution if applicable)
- **Hash chain section** (the last 10 events in the chain, with their hashes, for the auditor to spot-check)
- **Signature page** (the org's name, the user's name, the role, the date, a QR code linking to a verification URL)

The template lives at `/src/server/modules/compliance/templates/audit-pack-pdf.tsx`. One file, ~500 lines. We can iterate on it.

### 3.4 Puppeteer, not @react-pdf

The PRD doesn't say which, but the load-bearing choice is **Puppeteer, not `@react-pdf/renderer`**. The reasoning:

1. **Puppeteer renders full HTML + CSS.** This means we can use the same CSS for the in-app preview and the PDF. The PDF *is* the HTML, just printed.
2. **`@react-pdf/renderer` is a parallel layout engine.** It has its own subset of CSS, its own primitives, its own quirks. The PDF *isn't* the HTML. When the auditor and the in-app view look different, that's a bug surface.
3. **Puppeteer is heavier** (one Chrome process per render). For an audit pack, that's fine — we render one at a time, and the worker can scale. For high-volume PDFs (e.g. 10,000 packing slips in an hour), `@react-pdf/renderer` is the better answer. We use it for the simple PDFs (packing lists, shipping labels) and Puppeteer for the audit pack + DDS.

**The Puppeteer setup:**
- One headless Chrome instance, running in the worker host.
- Chrome is pinned to a specific version (managed by the worker image; we don't pull `latest`).
- A queue of Puppeteer jobs (BullMQ, separate queue from the main work queue, so a stuck render doesn't block the margin recompute).
- Render timeout: 30s. If a render takes longer, the job fails and retries.
- The Chrome instance is restarted every 100 renders to avoid memory leaks (Chrome is bad at long-running memory hygiene).

### 3.5 The signature page

The signature page is a one-pager at the end of the PDF that says, in plain English:

> **Signature page**
>
> This document was generated by [Org Name] using [Product Name] on [date].
>
> It contains a tamper-evident record of [scope description].
>
> The hash chain referenced on the cover page can be verified at [verification URL] or by inspecting the audit_event rows in the org's database.
>
> Operator of record: [name], [role]
> Generated by: [name], [role] on [date]
> Document hash: [sha256 of the PDF content]
>
> [QR code linking to the verification URL]

The verification URL is a public, no-auth page that takes a `?hash=...` parameter and shows the org name, the scope, the date, and the hash chain link. The page is read-only, served from a separate Vercel deployment with no PII (no customer names, no lot IDs — just the metadata).

### 3.6 Generation triggers

- **On DDS sign** → generate a DDS audit pack (scope = `shipment`).
- **On opt-out confirmed** → generate an opt-out audit pack (scope = `shipment_eudr_decision`).
- **On user request** → generate a pack on demand (scope = `shipment` or `period` or `supplier`).
- **On regulator request** → generate a period pack (scope = `period`).
- **On recall** → generate a recall pack (scope = `recall`).

The trigger is a BullMQ job; the API procedure enqueues the job and returns the audit pack ID. The user gets a notification when the pack is ready.

---

## 4. DDS rendering

The DDS is structurally similar to the audit pack but **more legally constrained** — the EU has a published schema (Article 9, plus the EUDR Information System API docs), and the DDS must conform.

### 4.1 The schema

The PRD §5.6 `DdsDraft` entity has the fields. The DDS submission format (per EUDR Article 9) requires:

- **Operator info:** name, address, EORI, VAT number
- **Consignee info:** name, address, EORI/VAT (if B2B)
- **Product info:** description, HS code, net mass, country of harvest, geolocation
- **Supplier references:** upstream DDS reference numbers
- **Risk assessment:** narrative
- **Risk mitigation:** narrative

The rendered DDS is a JSON payload (for API submission) *and* a PDF (for the roaster's records). The JSON payload conforms to the EU's published schema. The PDF is the same data, human-readable.

### 4.2 The validation

Before a DDS is signed, the system runs a validation pass:

1. All required fields are populated.
2. All green lots in the shipment have a complete `EudrReferenceData` record.
3. All producer polygons are present and well-formed.
4. The destination country is in the EU (sanity check).
5. The net mass is at or above the small-quantity threshold (if below, this is a `below_threshold` decision, not a `in_scope_requires_dds`).

If any check fails, the system blocks the sign. The user has to fix the underlying data, not paper over it.

### 4.3 The submission (v1)

Per the PRD, v1 generates a signed PDF + JSON export. The operator signs and submits via their existing TRACES-style workflow. We do not pretend to file on their behalf. The DDS submission itself is a v1.5 workstream (per PRD §10 Phase 2).

What v1 *does* do:

- Generate the DDS payload in the EU's expected JSON shape.
- Validate the payload against the EU's published schema (if the schema is available; otherwise, against a documented internal representation).
- Sign the PDF with the roaster's name, role, and timestamp.
- Store the signed DDS in S3 with a 5-year retention lifecycle policy.
- Surface the DDS in the compliance dashboard, with download and share-with-customer buttons.

What v1 does **not** do:

- Call the EU's API.
- Receive a regulator acknowledgement (the API is not finalised; we can't anyway).
- File in v1.5 terms.

---

## 5. Queue model

### 5.1 What jobs

| Job | Trigger | Typical duration | v1? |
|---|---|---|---|
| `net_requirements_recompute` | Every order change, every stock movement, every lot change | <2s for typical org; up to 30s for a large org with 10,000 lots | yes |
| `margin_recompute` | Every stock movement, every landed cost change, every sale | <1s for typical order; up to 10s for a bulk import | yes |
| `dds_render` | DDS sign | 5-15s (Puppeteer) | yes |
| `audit_pack_render` | Audit pack request | 5-30s (Puppeteer; longer for recall packs) | yes |
| `compliance_data_completeness_check` | Daily at 04:00 UTC | <1 min per org | yes |
| `audit_event_chain_validation` | Daily at 03:00 UTC | <1 min per org | yes |
| `country_risk_table_refresh` | Quarterly (or when EU publishes a new list) | <1 min | yes |
| `hash_chain_snapshot_to_s3` | Daily at 02:00 UTC | <5 min per org | yes |
| `eu_search_index_update` | Never (we don't have search at v1) | n/a | no |
| `dds_submit_to_eu_api` | DDS sign (v1.5) | <2s | v1.5 |
| `subscription_billing` | Never (we don't manage subscriptions at v1) | n/a | no |
| `daily_board_warm_cache` | Every 5 min | <1 min | yes |
| `backup_verification` | Daily at 01:00 UTC | <5 min | yes |

### 5.2 Queue topology

BullMQ is a Redis-backed queue with one queue per job type. The worker process subscribes to all queues. Concurrency settings:

- `net_requirements_recompute`: 5 workers (parallel-safe; per-org locking prevents contention)
- `margin_recompute`: 5 workers
- `dds_render`, `audit_pack_render`: 2 workers (Puppeteer-bound)
- All cron jobs: 1 worker

**Per-org locking:** A job's payload includes `org_id`. The worker takes a Redis lock keyed on `org_id` for the duration of the job. Two jobs for the same org serialise; two jobs for different orgs run in parallel. This prevents the "two stock movements in flight at the same time for the same org" race condition.

**Dead-letter queue:** After 3 retries with exponential backoff (1s, 10s, 100s), the job is moved to a DLQ. The DLQ is visible in the admin UI. Failed jobs page the founder.

**Cron jobs:** BullMQ supports cron-style scheduled jobs natively. The cron jobs above are registered at worker boot. The `country_risk_table_refresh` is registered but disabled by default — it's enabled when a new EU publication triggers a refresh.

### 5.3 What the worker looks like

The worker is a single Node.js process running on Fly.io. It's stateless — all state is in Redis (queue) and Postgres (DB). One process handles all queues; the worker count is configured at deploy time.

```typescript
// /src/server/workers/index.ts
import { Worker } from 'bullmq';
import { connection } from '../lib/redis';
import { handleNetRequirements } from '../modules/supply/jobs/net-requirements';
import { handleMarginRecompute } from '../modules/money/jobs/margin-recompute';
import { handleDdsRender } from '../modules/compliance/jobs/dds-render';
import { handleAuditPackRender } from '../modules/compliance/jobs/audit-pack-render';
import { handleComplianceCheck } from '../modules/compliance/jobs/completeness-check';
import { handleChainValidation } from '../modules/compliance/jobs/chain-validation';
// ... other handlers

const queues = [
  { name: 'net_requirements_recompute', handler: handleNetRequirements, concurrency: 5 },
  { name: 'margin_recompute', handler: handleMarginRecompute, concurrency: 5 },
  { name: 'dds_render', handler: handleDdsRender, concurrency: 2 },
  { name: 'audit_pack_render', handler: handleAuditPackRender, concurrency: 2 },
  { name: 'compliance_check', handler: handleComplianceCheck, concurrency: 1 },
  { name: 'chain_validation', handler: handleChainValidation, concurrency: 1 },
];

for (const q of queues) {
  new Worker(q.name, q.handler, { connection, concurrency: q.concurrency });
}
```

The process is supervised by Fly's process manager (auto-restart on crash, with crash logging).

### 5.4 Why not serverless

The Session 1 doc has a question about BullMQ vs. serverless queues (SQS, Inngest, Trigger.dev). My lean is BullMQ, and here's the reasoning:

1. **The worker needs a long-running process for Puppeteer.** Spinning up a Chrome instance per render is too slow. A long-lived worker with a warm Chrome is the right answer.
2. **The job code lives in the same codebase as the rest of the app.** No "function as a service" boundary, no separate deployment.
3. **The cost is low.** A single Fly shared-cpu-1x instance at v1 volumes is ~$5/mo. Inngest at our scale would be ~$20/mo. The $15/mo difference is not material.
4. **The control is high.** We own the queue, the worker, the retry logic, the dead-letter. We can add per-org locks, custom concurrency, and any other pattern without waiting for a vendor.

Serverless queues are the right answer when you don't want to run a worker. We want to run a worker.

---

## 6. Offline / sync (v1 vs v1.5)

### 6.1 The honest assessment

The PRD says "Offline-tolerant data entry is a v1 requirement (deferred sync queue), not a polish item." I'm going to push back on that and propose a v1.5 split.

**Why push back:** Offline-first is a *huge* engineering investment. The minimal viable offline is a service worker + IndexedDB + a sync queue. The *good* offline is a CRDT-based local database (Yjs or Automerge) with conflict resolution. The PRD's floor staff scenario (a packer going offline for 2 hours) is real, but the *expected frequency* is low — most roasteries have decent Wi-Fi, and the failure mode of "packer's iPad loses connection for 2 hours" is recoverable by walking the box back to the dock and re-entering the line.

**The real risk:** an offline-first design that *seems* to work but loses data on conflict resolution is worse than no offline. The engineering effort to do it right is measured in months, not weeks.

### 6.2 The v1 approach (online-only with graceful failure)

At v1, the floor staff flow is **online-only**. If the connection drops:
- The pack station UI shows a "Connection lost — your changes will be saved locally" banner.
- Pack events, count events, and receive events are stored in IndexedDB with a "pending sync" flag.
- When the connection comes back, the pending events are replayed in order.
- If the packer logs out or closes the browser before sync completes, the events are lost. (This is the failure case the PRD is trying to avoid, but it's a *failure case*, not the normal flow.)

**The implementation:** A 200-line service worker that intercepts POSTs to the tRPC endpoint, stores them in IndexedDB with a "pending" flag, and replays them when online. Not a full offline-first system; just a "don't lose the last 30 seconds of work" guard.

**What this gives us:**
- The packer doesn't lose work if the connection blips for 30 seconds.
- The system is honest about the limit — if the connection is out for 2 hours, the packer is told.
- The engineering effort is ~1 week, not ~2 months.

**What this doesn't give us:**
- True offline operation. A packer who works offline for 2 hours cannot do real work.

### 6.3 The v1.5 approach (proper offline)

At v1.5, we add:
- A PWA manifest so the app installs as a home-screen app.
- A full IndexedDB cache of the org's working data (the SKUs, the current lot inventory, the open orders, the daily board).
- A sync queue with conflict resolution (last-write-wins for most fields, with explicit user prompts for fields that have a true conflict).
- The "what syncs first" priority list: the pack station sync is *more important* than the margin view sync. The DDS sync is *more important* than anything else, because the regulator cares.

The implementation is non-trivial. It's a v1.5 workstream, not v1.

### 6.4 The PRD's specific case: the EUDR opt-out decision

The PRD notes that the offline + EUDR interaction is a real constraint — the packer cannot take an opt-out decision offline, because the opt-out requires the `ShipmentEudrDecision` to be recorded against a live shipment record, with the role check enforced at the server. (See PRD open question 12.)

The v1 answer: the pack station, if offline, simply cannot take the opt-out decision. The packer is told "this shipment needs an EUDR decision; please reconnect to proceed." The system is honest: this is a regulatory decision, and regulatory decisions require a live server.

The v1.5 answer: the opt-out decision is queued locally, and the packer is shown a "this will be recorded when you're back online" banner. The shipment is blocked until sync. The opt-out takes effect when the packer reconnects.

---

## 7. Backup and retention

### 7.1 The retention requirements

From PRD §6.4.6:
- `EudrReferenceData`, `DdsDraft`, `ShipmentEudrDecision`, `AuditPack`: 5 years (EUDR Article 9).
- `audit_event` (the hash chain): effectively forever (5 years minimum, but we keep it longer for the v2 traceability story).
- All other operational data: 7 years (UK Companies Act standard).

These are minimums, not maximums. The data is *retained*, not *used* — after 5 years, the EUDR data is read-only and is only opened if a regulator asks.

### 7.2 Postgres backups

- **Provider-managed point-in-time recovery.** Neon gives us 7 days of PITR by default. We extend this to 30 days (additional ~$30/mo on the Launch plan).
- **Daily logical backups to S3.** A worker job runs `pg_dump` (or uses Neon's logical backup API) and writes the result to S3 with a 90-day lifecycle. The dump is encrypted with a KMS key.
- **Cross-region replication for disaster recovery.** Neon offers cross-region replicas; we enable this for the production databases. The cost is ~2x the primary, but it's a regulated workload.

### 7.3 S3 backups

- **Versioning enabled.** Every object has a current version and zero or more non-current versions. Accidental deletes and overwrites are recoverable.
- **Lifecycle policy:** non-current versions deleted after 90 days. Current versions never deleted automatically.
- **Cross-region replication:** S3 CRR enabled for both UK and EU buckets, to a third region (e.g. Ireland for the UK bucket, Frankfurt for the EU bucket). This is the "what if the whole region goes down" scenario.

### 7.4 The hash-chain snapshot

The **regulatory-defensibility** backup is the daily hash-chain snapshot. Every day at 02:00 UTC, a worker:

1. For each org, reads the last 10 events of the chain.
2. Reads the current `hash_chain_self` value of the latest event.
3. Writes a JSON object to a write-only S3 bucket: `{org_id, date, latest_hash, last_10_events}`.

This is the fallback evidence if the primary database is ever tampered with. The S3 bucket has versioning enabled and is itself subject to S3 CRR. The cost is trivial — a few MB per day.

The S3 bucket is **write-only** at the IAM level. The worker has `s3:PutObject`; no one has `s3:GetObject` from the application. Reading from the bucket requires root credentials, which only the founder has. This is a deliberate defense-in-depth: even if the application is compromised, the snapshot cannot be read by the attacker.

### 7.5 Restore drill

A quarterly restore drill. The founder spins up a fresh database from a 7-day-old backup, restores the S3 objects, replays the audit event chain, and verifies that the chain still validates. This is the equivalent of a "fire drill" — we want to know the restore works *before* we need it.

The drill is automated; the founder gets a Slack notification with the result. A failed drill pages immediately.

---

## 8. Decisions made in Session 2 (record)

| Decision | Choice | Why |
|---|---|---|
| Geospatial storage | PostGIS extension on Postgres | Single DB, no separate service |
| Polygon type | `geography(MultiPolygon, 4326)` | WGS84, supports multi-plot producers |
| Generated area column | Yes, via `ST_Area` | PRD's area-validation rule for free |
| Country-risk table | Separate `eudr.country_risk` schema | Quarterly refresh is independent of org data |
| Hash chain | SHA-256 over canonical JSON (RFC 8785) | Standard, auditable, no library |
| Chain trigger | Postgres `BEFORE INSERT` trigger | Application code can't lie about prev hash |
| Per-org chain | Yes, scoped by `org_id` | Each roaster's regulatory record is independent |
| Chain validation | Nightly worker job | Mismatches page the founder immediately |
| PDF rendering | Puppeteer (not @react-pdf) for audit pack + DDS; @react-pdf for simple PDFs | Puppeteer gives HTML+CSS fidelity for the high-stakes docs |
| Signature page | Plain-English + verification URL + QR code | Regulator can verify the chain in 30 seconds |
| DDS validation | Pre-sign validation pass | Block the sign if the underlying data is incomplete |
| Queue framework | BullMQ on a separate worker host | Puppeteer needs a long-running process |
| Per-org locks | Redis lock keyed on `org_id` | Prevents cross-org races |
| DLQ | Visible in admin UI, pages founder on job | No silent failures |
| Offline (v1) | Online-only with IndexedDB guard for connection blips | Honest about the limit; ~1 week of work |
| Offline (v1.5) | Full PWA + IndexedDB cache + sync queue | Real offline operation; ~2 months of work |
| EUDR decision offline | Server-required at v1; queued locally at v1.5 | Regulatory decisions require a live server |
| Retention | Provider PITR + daily S3 logical backups + S3 CRR + hash-chain snapshot to write-only bucket | Defense-in-depth |
| Restore drill | Quarterly automated | Catch restore failures before they're needed |

---

## 9. What is not in this doc (deferred to next sessions)

- **Session 3:** The phased tech backlog, with task sizes, dependencies, and acceptance criteria.
- **Future sessions:** Detailed runbooks (deploy, rollback, incident response), ADRs for specific decisions, the EUDR Information System API integration design (v1.5), the offline-first PWA design (v1.5).

---

## 10. Open questions for Session 2 — RESOLVED

| # | Question | Lean | Your call | Recorded as |
|---|---|---|---|---|
| 1 | Confirm PostGIS on Neon's Launch plan | Neon Pro or Supabase fallback | **No preference — either is fine; check first** | §1.1: try Neon Launch first, fall back to Neon Pro or Supabase if PostGIS not on Launch |
| 2 | `canonicalize` npm package or hand-roll | `canonicalize` package | **Package** | §2.2: confirmed |
| 3 | Nightly chain-validation pager | Founder only at v1 | **Yes, founder only** | §2.5: confirmed |
| 4 | Puppeteer Chrome restart every 100 renders | v1 requirement, configurable threshold | **Okay (v1 requirement)** | §3.4: confirmed |
| 5 | Write-only S3 bucket IAM policy, separate AWS account | Separate AWS account | **Yes, separate account** | §7.4: confirmed |
| 6 | v1.5 offline-first deliverable | v1.5 not v2 | **Online only for now** (i.e. the v1 limit stands; offline-first stays deferred) | §6.2: confirmed |
| 7 | Restore drill cadence | Quarterly at v1, monthly at v2 | **Quarterly** | §7.5: confirmed |
| 8 | (Pulp from §10 list — kept for traceability) | n/a | n/a | n/a |
| 9 | (Pulp from §10 list — kept for traceability) | n/a | n/a | n/a |

*Note: questions 8 and 9 in the original §10 list were repeats left from a draft pass. The seven real decisions are above. All confirmed.*

### 10.1 Net new decisions confirmed in this round

- **PostGIS provider:** try Neon Launch; if PostGIS not on Launch, take Neon Pro; if not on Pro, take Supabase. The criterion is "managed Postgres with PostGIS in the right region, cheapest viable plan." Decision tree is in §1.1.
- **`canonicalize` package:** yes, use the npm package. It's RFC 8785 compliant, used by other regulated systems, and the version pin goes into the lockfile.
- **Chain-validation pager:** founder only. No escalation contacts at v1; add at v2.
- **Puppeteer restart threshold:** 100 renders per Chrome restart is the v1 default. Configurable via env var; the threshold can be tuned once we have real load data.
- **Snapshot AWS account:** separate AWS account, separate IAM, no cross-account trust. The application cannot read from the snapshot bucket under any IAM policy; only the founder's root credentials can. The bucket lives in the same region as the org's primary data (UK → eu-west-2; EU → eu-central-1).
- **v1 offline:** online-only confirmed. The service-worker guard for connection blips ships in v1; true offline-first is deferred to v1.5.
- **Restore drill:** quarterly. The drill is automated; the founder gets a Slack notification with the result.

---

*Next: Session 3 covers the phased tech backlog — task sizes, dependencies, acceptance criteria. With the architecture and the load-bearing decisions settled, the backlog is a sequencing exercise. ~30-45 minutes.*
