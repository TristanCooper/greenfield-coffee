-- 0008_money_spine.sql
--
-- Card 0.13 / plan §7.3 — money spine: refines the 0.9
-- LandedCostEvent and FxRate tables per the 0.13 spec, and
-- adds the per-SKU VAT rate column.
--
-- WHY A DROP-AND-RECREATE MIGRATION
--
--   The 0.9 card shipped a MINIMAL version of these tables
--   ("Just enough columns for 0.9 to compile and migrate" —
--   0.9 card body). The 0.13 spec is materially different:
--
--     - LandedCostEvent: 0.9 used a polymorphic target pattern
--       (target_kind enum + target_id + applies_to_*_id). 0.13
--       uses three direct FK columns (green_lot_id,
--       roasted_lot_id, packaged_lot_id) with a CHECK
--       enforcing exactly-one-non-null.
--
--     - FxRate: 0.9 had `org_id` (FK to organizations) +
--       `rate numeric(18,8)` + `effective_date date` +
--       `source_text`. 0.13 says "No FK to anything" and
--       `rate_cents_per_unit bigint` + `as_of timestamptz` +
--       `source`.
--
--     - LandedCostEvent gained two new columns:
--       `fx_snapshot_cents_per_base` (the rate observed at
--       event time) and `vat_recoverable` (B2B reverse-charge
--       flag).
--
--     - landed_cost_cost_kind enum gained 'broker_fee' and
--       'fx_adjustment'. The 0.9 value 'storage' is retained
--       (warehouse storage IS a legitimate landed cost).
--
--     - landed_cost_target_kind enum is REMOVED (the new
--       direct-FK pattern doesn't need it).
--
--   The tables have no production data (card 0.14 seeds them;
--   0.14 lands after 0.13). On a fresh DB, DROP + CREATE is
--   straightforward. On the live DB, this migration fails if
--   the tables have rows — the operator must `TRUNCATE
--   landed_cost_event CASCADE; TRUNCATE fx_rate CASCADE;` first.
--   That's documented in the card body as a pre-0.14 prerequisite.
--
-- STATEMENT ORDER
--
--   1. ALTER TYPE landed_cost_cost_kind ADD VALUE (the two
--      new enum values; PG 12+ allows this in a transaction).
--   2. DROP TABLE landed_cost_event, fx_rate (cascade handles
--      dependent policies + indexes).
--   3. DROP TYPE landed_cost_target_kind (no longer needed).
--   4. ALTER TABLE price_list_entry ADD COLUMN vat_rate_bps
--      (additive; the old table survives intact).
--   5. CREATE TABLE fx_rate (new shape).
--   6. CREATE TABLE landed_cost_event (new shape).
--   7. CREATE INDEX (btrees for the new tables).
--   8. ALTER TABLE … ADD CONSTRAINT (FKs).

-- ── 1. Enum extension ────────────────────────────────────────────────────
--
-- PG 12+ supports ALTER TYPE … ADD VALUE in a transaction
-- block. Supabase is on PG 15, so this is safe. IF NOT EXISTS
-- makes the statement idempotent (no-op on a re-run).
ALTER TYPE "public"."landed_cost_cost_kind" ADD VALUE IF NOT EXISTS 'broker_fee';
--> statement-breakpoint
ALTER TYPE "public"."landed_cost_cost_kind" ADD VALUE IF NOT EXISTS 'fx_adjustment';
--> statement-breakpoint

-- ── 2. Drop old tables ──────────────────────────────────────────────────
--
-- CASCADE drops the dependent RLS policies and indexes. The
-- policies are re-added in 0008_money_spine_rls.sql (sibling
-- file). The indexes are re-created below.
DROP TABLE IF EXISTS "public"."landed_cost_event" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "public"."fx_rate" CASCADE;
--> statement-breakpoint

-- ── 3. Drop the now-unused enum ──────────────────────────────────────────
DROP TYPE IF EXISTS "public"."landed_cost_target_kind";
--> statement-breakpoint

-- ── 4. Add the per-entry VAT rate column ────────────────────────────────
--
-- price_list_entry gains `vat_rate_bps` (basis points). The
-- old table is untouched otherwise; this is an additive
-- change.
ALTER TABLE "public"."price_list_entry"
  ADD COLUMN "vat_rate_bps" integer
  CHECK ("price_list_entry"."vat_rate_bps" IS NULL OR ("price_list_entry"."vat_rate_bps" >= 0 AND "price_list_entry"."vat_rate_bps" < 10000));
--> statement-breakpoint

-- ── 5. Create fx_rate (new shape) ───────────────────────────────────────
--
-- Per the 0.13 spec: "No FK to anything — pure reference
-- data." Rate is bigint pence-per-unit (e.g. EUR→GBP at 0.85
-- = 85). as_of is timestamptz (not a calendar date).
CREATE TABLE "fx_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate_cents_per_unit" bigint NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rate_base_currency_iso3_check" CHECK (length("fx_rate"."base_currency") = 3),
	CONSTRAINT "fx_rate_quote_currency_iso3_check" CHECK (length("fx_rate"."quote_currency") = 3),
	CONSTRAINT "fx_rate_rate_cents_per_unit_positive_check" CHECK ("fx_rate"."rate_cents_per_unit" > 0),
	CONSTRAINT "fx_rate_distinct_currencies_check" CHECK ("fx_rate"."base_currency" <> "fx_rate"."quote_currency")
);
--> statement-breakpoint

-- ── 6. Create landed_cost_event (new shape) ─────────────────────────────
--
-- Three direct FK columns (green_lot_id, roasted_lot_id,
-- packaged_lot_id), all nullable, with a CHECK enforcing
-- exactly-one-non-null. New columns: fx_snapshot_cents_per_base
-- and vat_recoverable.
--
-- Forward references to green_lot / roasted_lot / packaged_lot
-- (card 0.10) and supplier (card 0.11) — the FKs land via
-- ALTER TABLE below.
CREATE TABLE "landed_cost_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"green_lot_id" uuid,
	"roasted_lot_id" uuid,
	"packaged_lot_id" uuid,
	"kind" "landed_cost_cost_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"fx_snapshot_cents_per_base" bigint,
	"vat_recoverable" boolean DEFAULT false NOT NULL,
	"supplier_id" uuid,
	"description" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	CONSTRAINT "landed_cost_event_currency_iso3_check" CHECK (length("landed_cost_event"."currency_code") = 3),
	CONSTRAINT "landed_cost_event_amount_nonzero_check" CHECK ("landed_cost_event"."amount_cents" <> 0),
	CONSTRAINT "landed_cost_event_exactly_one_target_check" CHECK (
		((CASE WHEN "landed_cost_event"."green_lot_id" IS NOT NULL THEN 1 ELSE 0 END)
		 + (CASE WHEN "landed_cost_event"."roasted_lot_id" IS NOT NULL THEN 1 ELSE 0 END)
		 + (CASE WHEN "landed_cost_event"."packaged_lot_id" IS NOT NULL THEN 1 ELSE 0 END)) = 1
	),
	CONSTRAINT "landed_cost_event_fx_snapshot_positive_check" CHECK ("landed_cost_event"."fx_snapshot_cents_per_base" IS NULL OR "landed_cost_event"."fx_snapshot_cents_per_base" > 0)
);
--> statement-breakpoint

-- ── 7. Indexes ──────────────────────────────────────────────────────────

-- 7.1 fx_rate
CREATE UNIQUE INDEX "fx_rate_pair_as_of_unique" ON "fx_rate" ("base_currency", "quote_currency", "as_of");
--> statement-breakpoint
CREATE INDEX "fx_rate_base_quote_idx" ON "fx_rate" ("base_currency", "quote_currency");
--> statement-breakpoint
CREATE INDEX "fx_rate_as_of_idx" ON "fx_rate" ("as_of");
--> statement-breakpoint

-- 7.2 landed_cost_event
CREATE INDEX "landed_cost_event_org_id_idx" ON "landed_cost_event" ("org_id");
--> statement-breakpoint
CREATE INDEX "landed_cost_event_green_lot_id_idx" ON "landed_cost_event" ("green_lot_id");
--> statement-breakpoint
CREATE INDEX "landed_cost_event_roasted_lot_id_idx" ON "landed_cost_event" ("roasted_lot_id");
--> statement-breakpoint
CREATE INDEX "landed_cost_event_packaged_lot_id_idx" ON "landed_cost_event" ("packaged_lot_id");
--> statement-breakpoint
CREATE INDEX "landed_cost_event_supplier_id_idx" ON "landed_cost_event" ("supplier_id");
--> statement-breakpoint
CREATE INDEX "landed_cost_event_org_id_occurred_at_idx" ON "landed_cost_event" ("org_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "landed_cost_event_org_id_kind_idx" ON "landed_cost_event" ("org_id", "kind");
--> statement-breakpoint

-- ── 8. Foreign keys ─────────────────────────────────────────────────────

-- 8.1 fx_rate has no FKs (per the 0.13 spec — "pure reference data")

-- 8.2 landed_cost_event
ALTER TABLE "landed_cost_event"
  ADD CONSTRAINT "landed_cost_event_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "landed_cost_event"
  ADD CONSTRAINT "landed_cost_event_supplier_id_supplier_id_fk"
  FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
-- Cross-card FKs to the lot spine. The columns are typed
-- `uuid` in the TS schema; the FKs land here.
ALTER TABLE "landed_cost_event"
  ADD CONSTRAINT "landed_cost_event_green_lot_id_green_lot_id_fk"
  FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lot"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "landed_cost_event"
  ADD CONSTRAINT "landed_cost_event_roasted_lot_id_roasted_lot_id_fk"
  FOREIGN KEY ("roasted_lot_id") REFERENCES "public"."roasted_lot"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "landed_cost_event"
  ADD CONSTRAINT "landed_cost_event_packaged_lot_id_packaged_lot_id_fk"
  FOREIGN KEY ("packaged_lot_id") REFERENCES "public"."packaged_lot"("id")
  ON DELETE RESTRICT;
