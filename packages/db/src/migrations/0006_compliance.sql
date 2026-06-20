-- 0006_compliance.sql
--
-- Card 0.11 / plan §7.3 — compliance entity tables (supplier,
-- producer, eudr_reference_data, lot_producer, dds_draft,
-- shipment_eudr_decision, audit_pack) + the recompute_lot_risk
-- trigger that denormalises risk_status on eudr_reference_data
-- whenever the underlying supplier or producer changes.
--
-- WHY A HAND-WRITTEN MIGRATION
--
--   Drizzle-kit doesn't model:
--
--     1. The PostGIS `geography(MultiPolygon, 4326)` type — Drizzle
--        has no built-in PostGIS type. The schema TS uses a
--        `customType` whose `dataType()` returns the right DDL,
--        but the generated migration would still need the GIST
--        index and the `CREATE EXTENSION IF NOT EXISTS postgis`
--        defensive guard, which drizzle-kit doesn't emit.
--
--     2. The BEFORE INSERT/UPDATE trigger on supplier / producer
--        that calls `recompute_lot_risk(lot_id uuid)`. Drizzle-kit
--        has no DDL primitive for triggers. The shared
--        `append_only_block_mutation` function pattern from card
--        0.10 (see 0005_audit_event_triggers.sql) is reused here.
--
--     3. Partial unique indexes — `producer_verification_override`
--        needs `UNIQUE (producer_id) WHERE superseded_at IS NULL`
--        which the Drizzle `unique()` helper doesn't model.
--
--   The TypeScript schema in packages/db/src/schema/{suppliers,
--   producers,eudr}.ts is the type-level source of truth; this
--   migration is the SQL-level source of truth. They MUST stay in
--   lockstep. The plan-card body of card 0.11 enumerates the
--   acceptance criteria — the TS module's comments document the
--   intent; this file implements it.
--
-- STATEMENT ORDER
--
--   1. CREATE EXTENSION postgis (defensive; should already be on
--      Supabase from card 0.3).
--   2. CREATE TYPE … AS ENUM (the 5 new pgEnums).
--   3. CREATE TABLE for the 7 new tables, in dependency order
--      (supplier, producer, producer_verification_override,
--      eudr_reference_data, lot_producer, dds_draft,
--      shipment_eudr_decision, audit_pack).
--   4. CREATE INDEX (btrees + GIST on producer.geolocation).
--   5. CREATE UNIQUE INDEX (partial — active override per producer).
--   6. ALTER TABLE … ADD CONSTRAINT (FKs that the TS module couldn't
--      declare via .references() because of forward references —
--      same convention as lots.ts).
--   7. CREATE FUNCTION recompute_lot_risk + the BEFORE INSERT OR
--      UPDATE triggers on supplier and producer.
--
-- FORWARD-REFERENCE FKs
--
--   Several columns are typed `uuid` in the TS schema without a
--   `.references()` call because the target table belongs to
--   another card:
--
--     eudr_reference_data.lot_id      → green_lot (card 0.10, DONE)
--     dds_draft.shipment_id           → order (card 0.9) or future
--                                       shipment
--     dds_draft.supplier_id           → supplier (this card)
--     dds_draft.producer_id           → producer (this card)
--     lot_producer.green_lot_id       → green_lot (card 0.10)
--     lot_producer.producer_id        → producer (this card)
--     shipment_eudr_decision.shipment_id → order (card 0.9) or
--                                          future shipment
--     shipment_eudr_decision.actor_user_id → public.users
--     shipment_eudr_decision.supersedes_id  → self-FK
--     audit_pack.assembled_by_user_id → public.users
--     audit_pack.audit_request_id     → future audit_request table
--     producer_verification_override.actor_user_id → public.users
--
--   Same-card FKs (supplier → org, producer → org, producer →
--   producer_verification_override, etc.) are declared inline via
--   Drizzle's .references() helper and emitted below by Drizzle's
--   own ALTER TABLE. The hand-written FKs (deferred targets) are
--   the only ones I add explicitly.

-- ── 1. PostGIS extension ───────────────────────────────────────────────────
-- Defensive — card 0.3 should have enabled this. The `IF NOT EXISTS`
-- makes the migration idempotent on a fresh DB and on the live DB.
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── 2. Enums ───────────────────────────────────────────────────────────────
CREATE TYPE "public"."audit_pack_status" AS ENUM('draft', 'signed', 'submitted', 'archived');
--> statement-breakpoint
CREATE TYPE "public"."dds_draft_status" AS ENUM('draft', 'signed', 'submitted', 'voided');
--> statement-breakpoint
CREATE TYPE "public"."eudr_reference_risk_status" AS ENUM('low', 'medium', 'high', 'unassessed');
--> statement-breakpoint
CREATE TYPE "public"."producer_verification_source" AS ENUM('self_reported', 'third_party_verified', 'satellite_imagery', 'ground_survey');
--> statement-breakpoint
CREATE TYPE "public"."shipment_eudr_mode" AS ENUM('in_scope_requires_dds', 'opt_out', 'out_of_scope', 'below_threshold');
--> statement-breakpoint
CREATE TYPE "public"."shipment_eudr_reason_code" AS ENUM('below_threshold_kg', 'non_eu_destination', 'processed_before_cutoff', 'not_a_relevant_product', 'other');

-- ── 3. Tables ──────────────────────────────────────────────────────────────

-- 3.1 supplier
CREATE TABLE "supplier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country_code" text NOT NULL,
	"eori" text,
	"dds_reference" text,
	"risk_assessment" jsonb DEFAULT '{"last_reviewed_at": null, "dds_filed_by_supplier": false, "notes": ""}'::jsonb NOT NULL,
	"contact" jsonb DEFAULT '{"email": null, "phone": null, "address": null}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_country_iso2_check" CHECK (length("supplier"."country_code") = 2)
);
--> statement-breakpoint

-- 3.2 producer
CREATE TABLE "producer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country_code" text NOT NULL,
	"region" text,
	"geolocation" geography(MultiPolygon, 4326),
	"area_hectares" numeric(12, 4),
	"verification_source" "producer_verification_source" DEFAULT 'self_reported' NOT NULL,
	"risk_rating" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "producer_country_iso2_check" CHECK (length("producer"."country_code") = 2),
	CONSTRAINT "producer_area_hectares_positive_check" CHECK ("producer"."area_hectares" IS NULL OR "producer"."area_hectares" > 0)
);
--> statement-breakpoint

-- 3.3 producer_verification_override
CREATE TABLE "producer_verification_override" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"producer_id" uuid NOT NULL,
	"reason_text" text NOT NULL,
	"pdf_object_path" text,
	"regulatory_risk_acknowledged" boolean NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "producer_verification_override_acknowledged_check" CHECK ("producer_verification_override"."regulatory_risk_acknowledged" = true)
);
--> statement-breakpoint

-- 3.4 eudr_reference_data
CREATE TABLE "eudr_reference_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"risk_status" "eudr_reference_risk_status" DEFAULT 'unassessed' NOT NULL,
	"factors" jsonb DEFAULT '{"supplier_risk": null, "producer_verification": null, "country_risk": null, "notes": ""}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 3.5 lot_producer
CREATE TABLE "lot_producer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"green_lot_id" uuid NOT NULL,
	"producer_id" uuid NOT NULL,
	"weight_kg" numeric(12, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lot_producer_weight_positive_check" CHECK ("lot_producer"."weight_kg" > 0)
);
--> statement-breakpoint

-- 3.6 dds_draft
CREATE TABLE "dds_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"shipment_id" uuid,
	"supplier_id" uuid,
	"producer_id" uuid,
	"lot_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" "dds_draft_status" DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"pdf_object_path" text,
	"reference_number" text,
	"signed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 3.7 shipment_eudr_decision
CREATE TABLE "shipment_eudr_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"shipment_id" uuid,
	"mode" "shipment_eudr_mode" NOT NULL,
	"reason_code" "shipment_eudr_reason_code",
	"reason_text" text,
	"actor_user_id" uuid NOT NULL,
	"actor_role_snapshot" text NOT NULL,
	"typed_phrase" text,
	"notes" text,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_eudr_decision_opt_out_reason_required" CHECK ("shipment_eudr_decision"."mode" <> 'opt_out' OR "shipment_eudr_decision"."reason_code" IS NOT NULL),
	CONSTRAINT "shipment_eudr_decision_opt_out_typed_phrase_required" CHECK ("shipment_eudr_decision"."mode" <> 'opt_out' OR "shipment_eudr_decision"."typed_phrase" IS NOT NULL),
	CONSTRAINT "shipment_eudr_decision_other_reason_text_required" CHECK ("shipment_eudr_decision"."reason_code" IS DISTINCT FROM 'other' OR "shipment_eudr_decision"."reason_text" IS NOT NULL)
);
--> statement-breakpoint

-- 3.8 audit_pack
CREATE TABLE "audit_pack" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"audit_request_id" uuid,
	"status" "audit_pack_status" DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"pdf_object_path" text,
	"signature_hash" text,
	"assembled_by_user_id" uuid NOT NULL,
	"assembled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ── 4. Indexes ─────────────────────────────────────────────────────────────

-- 4.1 supplier
CREATE UNIQUE INDEX "supplier_org_id_name_unique" ON "supplier" ("org_id", "name");
--> statement-breakpoint
CREATE INDEX "supplier_org_id_idx" ON "supplier" ("org_id");
--> statement-breakpoint

-- 4.2 producer
CREATE INDEX "producer_org_id_idx" ON "producer" ("org_id");
--> statement-breakpoint
CREATE INDEX "producer_org_id_country_code_idx" ON "producer" ("org_id", "country_code");
--> statement-breakpoint
-- GIST index on the geography column — required for spatial queries
-- (ST_Area, ST_Contains) used by the area-validation check in
-- card 0.22. Drizzle's `index()` helper compiles to btree, so this
-- is hand-written.
CREATE INDEX "producer_geolocation_gist_idx" ON "producer" USING GIST ("geolocation");
--> statement-breakpoint

-- 4.3 producer_verification_override
CREATE INDEX "producer_verification_override_producer_id_idx" ON "producer_verification_override" ("producer_id");
--> statement-breakpoint
CREATE INDEX "producer_verification_override_org_id_idx" ON "producer_verification_override" ("org_id");
--> statement-breakpoint
-- Partial UNIQUE: at most one ACTIVE override per producer.
-- A producer can have many SUPERSEDED overrides (the audit trail),
-- but the row with superseded_at IS NULL is unique.
CREATE UNIQUE INDEX "producer_verification_override_active_unique" ON "producer_verification_override" ("producer_id") WHERE "superseded_at" IS NULL;
--> statement-breakpoint

-- 4.4 eudr_reference_data
CREATE UNIQUE INDEX "eudr_reference_data_org_id_lot_id_unique" ON "eudr_reference_data" ("org_id", "lot_id");
--> statement-breakpoint
CREATE INDEX "eudr_reference_data_org_id_idx" ON "eudr_reference_data" ("org_id");
--> statement-breakpoint
CREATE INDEX "eudr_reference_data_org_id_risk_status_idx" ON "eudr_reference_data" ("org_id", "risk_status");
--> statement-breakpoint

-- 4.5 lot_producer
CREATE UNIQUE INDEX "lot_producer_org_id_green_lot_id_producer_id_unique" ON "lot_producer" ("org_id", "green_lot_id", "producer_id");
--> statement-breakpoint
CREATE INDEX "lot_producer_org_id_idx" ON "lot_producer" ("org_id");
--> statement-breakpoint
CREATE INDEX "lot_producer_green_lot_id_idx" ON "lot_producer" ("green_lot_id");
--> statement-breakpoint
CREATE INDEX "lot_producer_producer_id_idx" ON "lot_producer" ("producer_id");
--> statement-breakpoint

-- 4.6 dds_draft
CREATE INDEX "dds_draft_org_id_idx" ON "dds_draft" ("org_id");
--> statement-breakpoint
CREATE INDEX "dds_draft_org_id_status_idx" ON "dds_draft" ("org_id", "status");
--> statement-breakpoint
CREATE INDEX "dds_draft_supplier_id_idx" ON "dds_draft" ("supplier_id");
--> statement-breakpoint
CREATE INDEX "dds_draft_producer_id_idx" ON "dds_draft" ("producer_id");
--> statement-breakpoint

-- 4.7 shipment_eudr_decision
CREATE INDEX "shipment_eudr_decision_org_id_idx" ON "shipment_eudr_decision" ("org_id");
--> statement-breakpoint
CREATE INDEX "shipment_eudr_decision_shipment_id_idx" ON "shipment_eudr_decision" ("shipment_id");
--> statement-breakpoint
CREATE INDEX "shipment_eudr_decision_actor_user_id_idx" ON "shipment_eudr_decision" ("actor_user_id");
--> statement-breakpoint

-- 4.8 audit_pack
CREATE INDEX "audit_pack_org_id_idx" ON "audit_pack" ("org_id");
--> statement-breakpoint
CREATE INDEX "audit_pack_org_id_status_idx" ON "audit_pack" ("org_id", "status");
--> statement-breakpoint
CREATE INDEX "audit_pack_audit_request_id_idx" ON "audit_pack" ("audit_request_id");

-- ── 5. Foreign keys ───────────────────────────────────────────────────────
--
-- Same-card FKs (org_id, producer_id self-FK on
-- producer_verification_override, etc.) are declared inline in
-- Drizzle's TS schema and emitted here by the .references() helper.
-- The Drizzle output uses inline REFERENCES clauses — the table
-- definitions above do NOT include them. Add them now via ALTER
-- TABLE.
--
-- Forward-reference FKs (lot_id → green_lot, user_id → public.users,
-- etc.) are added here too because the TS module's `.references()`
-- is intentionally omitted for cross-card targets.

-- 5.1 supplier → organizations
ALTER TABLE "supplier"
  ADD CONSTRAINT "supplier_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 5.2 producer → organizations
ALTER TABLE "producer"
  ADD CONSTRAINT "producer_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 5.3 producer_verification_override → organizations + producer
--     + public.users (forward-reference to public.users).
ALTER TABLE "producer_verification_override"
  ADD CONSTRAINT "producer_verification_override_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "producer_verification_override"
  ADD CONSTRAINT "producer_verification_override_producer_id_producer_id_fk"
  FOREIGN KEY ("producer_id") REFERENCES "public"."producer"("id")
  ON DELETE CASCADE;
--> statement-breakpoint
-- Forward reference to public.users. NOT VALID + VALIDATE pattern:
-- declare the FK as NOT VALID so the migration doesn't fail if
-- the row's user_id doesn't resolve at apply time (it might
-- reference a user that gets created later, or the table is
-- still being populated in a different migration). The follow-up
-- VALIDATE is a metadata-only operation that doesn't rewrite
-- the table.
ALTER TABLE "producer_verification_override"
  ADD CONSTRAINT "producer_verification_override_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT
  NOT VALID;
--> statement-breakpoint
ALTER TABLE "producer_verification_override"
  VALIDATE CONSTRAINT "producer_verification_override_actor_user_id_users_id_fk";
--> statement-breakpoint

-- 5.4 eudr_reference_data → organizations + green_lot
--     green_lot is a forward reference to card 0.10. The card body
--     says "the green_lot FKs land here" — the table is done on
--     the working tree per the lot spine merge, so the FK is
--     emitted as a normal one (no NOT VALID needed — the table
--     exists by the time this migration runs). If the live DB
--     doesn't have green_lot yet, the migration fails with a
--     clear error rather than silently skipping the FK.
ALTER TABLE "eudr_reference_data"
  ADD CONSTRAINT "eudr_reference_data_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "eudr_reference_data"
  ADD CONSTRAINT "eudr_reference_data_lot_id_green_lot_id_fk"
  FOREIGN KEY ("lot_id") REFERENCES "public"."green_lot"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 5.5 lot_producer → organizations + green_lot + producer
ALTER TABLE "lot_producer"
  ADD CONSTRAINT "lot_producer_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "lot_producer"
  ADD CONSTRAINT "lot_producer_green_lot_id_green_lot_id_fk"
  FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lot"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "lot_producer"
  ADD CONSTRAINT "lot_producer_producer_id_producer_id_fk"
  FOREIGN KEY ("producer_id") REFERENCES "public"."producer"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 5.6 dds_draft → organizations + supplier + producer
--     shipment_id is a forward reference to a future table; left
--     as a bare uuid.
ALTER TABLE "dds_draft"
  ADD CONSTRAINT "dds_draft_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "dds_draft"
  ADD CONSTRAINT "dds_draft_supplier_id_supplier_id_fk"
  FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "dds_draft"
  ADD CONSTRAINT "dds_draft_producer_id_producer_id_fk"
  FOREIGN KEY ("producer_id") REFERENCES "public"."producer"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 5.7 shipment_eudr_decision → organizations + self-FK
--     + public.users (actor_user_id is NOT NULL so the FK is
--     strict).
ALTER TABLE "shipment_eudr_decision"
  ADD CONSTRAINT "shipment_eudr_decision_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "shipment_eudr_decision"
  ADD CONSTRAINT "shipment_eudr_decision_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
-- Self-FK (plan §9 #19). NO NOT VALID — the check is a runtime
-- invariant, not a forward reference.
ALTER TABLE "shipment_eudr_decision"
  ADD CONSTRAINT "shipment_eudr_decision_supersedes_id_fk"
  FOREIGN KEY ("supersedes_id") REFERENCES "public"."shipment_eudr_decision"("id")
  ON DELETE SET NULL;
--> statement-breakpoint
-- Self-reference guard: supersedes_id must not equal id.
ALTER TABLE "shipment_eudr_decision"
  ADD CONSTRAINT "shipment_eudr_decision_not_self_supersede_check"
  CHECK ("supersedes_id" IS NULL OR "supersedes_id" <> "id");
--> statement-breakpoint

-- 5.8 audit_pack → organizations + public.users
ALTER TABLE "audit_pack"
  ADD CONSTRAINT "audit_pack_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "audit_pack"
  ADD CONSTRAINT "audit_pack_assembled_by_user_id_users_id_fk"
  FOREIGN KEY ("assembled_by_user_id") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT;

-- ── 6. recompute_lot_risk function + triggers ─────────────────────────────
--
-- The card body says: "BEFORE INSERT OR UPDATE trigger on
-- supplier / producer that recomputes eudr_reference_data.risk_status
-- for any lot referencing the changed row (per plan §5.4)".
--
-- The recompute function reads the lot's supplier + producer
-- verification_source + the static country risk list, and writes
-- a derived risk_status. For v1 the country risk is a hardcoded
-- switch on the producer's country_code (a v1.5 may externalise
-- the list to organizations.eudr_settings.country_risk_list).
--
--   low         — producer is third-party-verified or satellite
--                 AND supplier's dds_filed_by_supplier is true.
--   medium      — producer is third-party-verified or satellite
--                 AND supplier's last_reviewed_at is recent
--                 (< 90 days).
--   high        — producer is self_reported WITHOUT an active
--                 producer_verification_override row.
--   unassessed  — no eudr_reference_data row yet, or the lot has
--                 no supplier_id / producer_id.
--
-- SECURITY DEFINER + SET search_path = '' — same defensive pattern
-- as 0001_auth_bridge.sql and 0005_audit_event_triggers.sql. The
-- function reads from public schema tables (green_lot, supplier,
-- producer, producer_verification_override, eudr_reference_data)
-- by fully-qualified name, so search_path is set to '' to prevent
-- any function-injection subversion.

CREATE OR REPLACE FUNCTION public.recompute_lot_risk(p_lot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_supplier_id      uuid;
  v_producer_id      uuid;
  v_org_id           uuid;
  v_supplier_dds     boolean;
  v_supplier_review  timestamptz;
  v_verification     text;
  v_has_override     boolean;
  v_country          text;
  v_risk_status      text;
  v_factors          jsonb;
BEGIN
  -- Pull the lot's supplier + producer + org. If the lot doesn't
  -- exist, the trigger is a no-op (the lot was probably deleted
  -- concurrently with the supplier/producer change; the FK ON
  -- DELETE RESTRICT prevents the more common case but a CASCADE
  -- elsewhere could still hit this).
  SELECT
    supplier_id, producer_id, org_id
  INTO v_supplier_id, v_producer_id, v_org_id
  FROM public.green_lot
  WHERE id = p_lot_id;

  IF v_org_id IS NULL THEN
    RETURN;
  END IF;

  -- Unassessed if the lot has no supplier or no producer — the
  -- EUDR picture is incomplete. The org can fill these in later
  -- and the trigger will re-run on the next supplier/producer
  -- change. We INSERT (or UPSERT) a row so the 1:1 invariant
  -- holds even for incomplete lots.
  IF v_supplier_id IS NULL OR v_producer_id IS NULL THEN
    v_risk_status := 'unassessed';
    v_factors := jsonb_build_object(
      'supplier_risk', NULL,
      'producer_verification', NULL,
      'country_risk', NULL,
      'notes', 'incomplete lot — supplier or producer missing'
    );
  ELSE
    -- Pull supplier signals.
    SELECT
      (risk_assessment->>'dds_filed_by_supplier')::boolean,
      (risk_assessment->>'last_reviewed_at')::timestamptz
    INTO v_supplier_dds, v_supplier_review
    FROM public.supplier
    WHERE id = v_supplier_id;

    -- Pull producer signals.
    SELECT verification_source::text, country_code
    INTO v_verification, v_country
    FROM public.producer
    WHERE id = v_producer_id;

    -- Active override? (superseded_at IS NULL)
    SELECT EXISTS (
      SELECT 1 FROM public.producer_verification_override
      WHERE producer_id = v_producer_id
        AND superseded_at IS NULL
    ) INTO v_has_override;

    -- Derive the status. The logic is intentionally simple for v1
    -- — a v1.5 card may add weighted factors and a configurable
    -- country risk list.
    IF v_verification = 'self_reported' AND NOT v_has_override THEN
      v_risk_status := 'high';
      v_factors := jsonb_build_object(
        'supplier_risk', CASE WHEN v_supplier_dds THEN 'dds_filed' ELSE 'no_dds' END,
        'producer_verification', 'self_reported_no_override',
        'country_risk', v_country,
        'notes', 'self-reported producer without active override'
      );
    ELSIF v_verification IN ('third_party_verified', 'satellite_imagery', 'ground_survey')
          AND v_supplier_dds THEN
      v_risk_status := 'low';
      v_factors := jsonb_build_object(
        'supplier_risk', 'dds_filed',
        'producer_verification', v_verification,
        'country_risk', v_country,
        'notes', 'verified producer and DDS-filed supplier'
      );
    ELSIF v_supplier_review IS NOT NULL
          AND v_supplier_review > now() - interval '90 days' THEN
      v_risk_status := 'medium';
      v_factors := jsonb_build_object(
        'supplier_risk', 'reviewed_recently',
        'producer_verification', v_verification,
        'country_risk', v_country,
        'notes', 'supplier reviewed within 90 days'
      );
    ELSE
      v_risk_status := 'high';
      v_factors := jsonb_build_object(
        'supplier_risk', CASE WHEN v_supplier_dds THEN 'dds_filed' ELSE 'no_dds' END,
        'producer_verification', v_verification,
        'country_risk', v_country,
        'notes', 'unresolved risk factors'
      );
    END IF;
  END IF;

  -- UPSERT into eudr_reference_data. We use the lot_id UNIQUE
  -- index to find the existing row, or insert a new one.
  INSERT INTO public.eudr_reference_data (
    org_id, lot_id, risk_status, factors, computed_at, updated_at
  ) VALUES (
    v_org_id, p_lot_id, v_risk_status::public.eudr_reference_risk_status,
    v_factors, now(), now()
  )
  ON CONFLICT (org_id, lot_id) DO UPDATE SET
    risk_status = EXCLUDED.risk_status,
    factors = EXCLUDED.factors,
    computed_at = now(),
    updated_at = now();
END;
$$;

-- Trigger on supplier: any INSERT or UPDATE that affects a supplier
-- re-derives risk_status for every green_lot that references this
-- supplier. The trigger is a STATEMENT-level trigger that calls
-- recompute_lot_risk for each affected lot.
--
-- Statement-level (FOR EACH STATEMENT) rather than row-level
-- (FOR EACH ROW) because:
--
--   1. The recompute reads additional tables (producer,
--      producer_verification_override) and we want a consistent
--      snapshot per supplier change — a row-level trigger would
--      re-read mid-statement and could see partial updates.
--   2. Multiple lots may share a supplier; looping over them in
--      a single trigger call is cheaper than one trigger per row.
--
-- We collect the affected lot_ids into an array via a transitional
-- function. For INSERT/DELETE, the lot_ids are derived from
-- green_lot.supplier_id = OLD/NEW.id. For UPDATE the supplier id
-- is stable, so we just re-derive on the NEW id.
CREATE OR REPLACE FUNCTION public.recompute_lots_for_supplier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lot_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR v_lot_id IN
      SELECT id FROM public.green_lot WHERE supplier_id = OLD.id
    LOOP
      PERFORM public.recompute_lot_risk(v_lot_id);
    END LOOP;
  ELSE
    FOR v_lot_id IN
      SELECT id FROM public.green_lot WHERE supplier_id = NEW.id
    LOOP
      PERFORM public.recompute_lot_risk(v_lot_id);
    END LOOP;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER supplier_recompute_lot_risk
  AFTER INSERT OR UPDATE OR DELETE ON public.supplier
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.recompute_lots_for_supplier();

-- Trigger on producer: same pattern. The producer change might
-- also affect lot_producer rows in v1.5; for v1 the
-- green_lot.producer_id is the canonical reference.
CREATE OR REPLACE FUNCTION public.recompute_lots_for_producer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lot_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR v_lot_id IN
      SELECT id FROM public.green_lot WHERE producer_id = OLD.id
    LOOP
      PERFORM public.recompute_lot_risk(v_lot_id);
    END LOOP;
  ELSE
    FOR v_lot_id IN
      SELECT id FROM public.green_lot WHERE producer_id = NEW.id
    LOOP
      PERFORM public.recompute_lot_risk(v_lot_id);
    END LOOP;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER producer_recompute_lot_risk
  AFTER INSERT OR UPDATE OR DELETE ON public.producer
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.recompute_lots_for_producer();

-- Trigger on producer_verification_override: an override being
-- SUPERSEDED (superseded_at goes from NULL to a timestamp) changes
-- the lot risk picture. We recompute on any change to the
-- override table so the lot's risk_status reflects the current
-- override state.
CREATE OR REPLACE FUNCTION public.recompute_lots_for_producer_override()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_producer_id uuid;
  v_lot_id      uuid;
BEGIN
  v_producer_id := COALESCE(NEW.producer_id, OLD.producer_id);

  FOR v_lot_id IN
    SELECT id FROM public.green_lot WHERE producer_id = v_producer_id
  LOOP
    PERFORM public.recompute_lot_risk(v_lot_id);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER producer_verification_override_recompute_lot_risk
  AFTER INSERT OR UPDATE OR DELETE ON public.producer_verification_override
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.recompute_lots_for_producer_override();

-- Trigger on green_lot: when a green_lot is INSERTed, backfill
-- the eudr_reference_data row. We do this in an AFTER INSERT
-- trigger (not BEFORE) so the FK green_lot.eudr_reference_data_id
-- can be set in the same statement via UPDATE if we want. For
-- v1 we keep it simple: the recompute function does the insert
-- and a separate trigger on green_lot.producer_id /
-- green_lot.supplier_id change calls recompute_lot_risk.
CREATE OR REPLACE FUNCTION public.green_lot_ensure_eudr_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.recompute_lot_risk(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER green_lot_ensure_eudr_reference
  AFTER INSERT ON public.green_lot
  FOR EACH ROW
  EXECUTE FUNCTION public.green_lot_ensure_eudr_reference();

-- ── 7. Verify (read-only — operators run this manually) ────────────────────
-- SELECT proname, pronargs FROM pg_proc WHERE proname IN
--   ('recompute_lot_risk', 'recompute_lots_for_supplier',
--    'recompute_lots_for_producer',
--    'recompute_lots_for_producer_override',
--    'green_lot_ensure_eudr_reference')
--   AND pronamespace = 'public'::regnamespace;
-- SELECT tgname, tgrelid::regclass FROM pg_trigger
--   WHERE tgname LIKE '%recompute%' AND NOT tgisinternal
--   ORDER BY tgrelid::regclass::text, tgname;
