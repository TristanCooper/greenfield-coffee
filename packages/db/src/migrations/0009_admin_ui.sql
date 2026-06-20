-- 0009_admin_ui.sql
--
-- Card 0.16 / plan §7.4 — schema additions the Admin UI v0 needs
-- but that previous cards didn't ship.
--
-- WHY A SINGLE MIGRATION
--
--   Three small schema gaps block the admin UI in this card:
--
--     1. customer table does not exist. The order table currently
--        stores customer name/email/phone as free-text columns
--        (see schema/orders.ts, card 0.9). The card body asks for
--        a Customers admin screen — that screen needs a real
--        customer row to CRUD. We add a minimal `customer` table
--        now so the admin UI can land; order → customer FK
--        migration lands in a later card (the order columns stay
--        as a back-compat snapshot).
--
--     2. price_list_entry.vat_rate_bps. The card body requires
--        per-SKU VAT rate override ("per-SKU `vat_rate_bps`"). The
--        current schema only has per-list `vat_rate_pct`. We add
--        `vat_rate_bps` (integer NULL) — nullable because the
--        default behaviour (use the list's rate) is the common
--        case; a non-null value means "this SKU overrides the
--        list's rate". CHECK in [0, 10000) basis points (0% to
--        <100%) matches the price_list_vat_rate_range_check.
--
--     3. recipe_component. The card body requires the Recipe
--        admin to "list of green-lot components with % of blend;
--        validates total = 100%". The current `recipe` table has
--        no blend lines. We add `recipe_component` (recipe_id,
--        green_lot_id, percent_bps) — same shape as
--        `roast_batch_component` but for the recipe spec rather
--        than an executed batch. UNIQUE (recipe_id, green_lot_id).
--
-- RISK ASSESSMENT (card body sub-criterion)
--
--   The card body wants `supplier.risk_assessment` to expose a
--   structured shape (country_risk / producer_risk /
--   supply_chain_risk / overall_risk, each low/medium/high/
--   unassessed). The existing column is jsonb with a free-form
--   default `{last_reviewed_at, dds_filed_by_supplier, notes}`
--   (see 0006_compliance.sql). We DO NOT change the column type
--   or add a CHECK constraint — that's a backwards-incompatible
--   schema change for any org with existing supplier rows. The
--   admin form (apps/web/src/app/(authenticated)/admin/...) writes
--   the structured shape into the same jsonb; old data still
--   reads back as the legacy shape and the form migrates it
--   in-place on next edit. A v1.5 card may tighten the CHECK.
--
--   This card's behaviour is intentionally non-destructive —
--   the only structural changes are additive (new table, new
--   nullable column, new table).
--
-- RBAC
--
--   RBAC for these tables is role-based (plan §5.7) enforced in
--   the application layer (apps/web/src/lib/rbac.ts). Postgres
--   RLS on these tables continues to enforce org-scoping only.
--   Role-aware policies (e.g. "accountant may UPDATE price_list
--   but not DELETE supplier") belong in a later card — the
--   number of role × entity × action combinations is too large
--   to encode as RLS policies cleanly.

-- ── 1. customer ───────────────────────────────────────────────────────────
CREATE TABLE "customer" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "email" text,
  "phone" text,
  "address_line1" text,
  "address_line2" text,
  "city" text,
  "postal_code" text,
  "country_code" text,
  "tax_id" text,
  "notes" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_country_iso2_check" CHECK (
    "customer"."country_code" IS NULL OR length("customer"."country_code") = 2
  )
);
--> statement-breakpoint

CREATE UNIQUE INDEX "customer_org_id_code_unique"
  ON "customer" USING btree ("org_id","code");
--> statement-breakpoint

CREATE INDEX "customer_org_id_idx"
  ON "customer" USING btree ("org_id");
--> statement-breakpoint

CREATE INDEX "customer_org_id_active_idx"
  ON "customer" USING btree ("org_id","active");
--> statement-breakpoint

-- ── 2. price_list_entry.vat_rate_bps ──────────────────────────────────────
-- Per-SKU VAT rate override in basis points (1 bps = 0.01%).
-- NULL = use the price_list.vat_rate_pct (the common case).
-- Range [0, 10000) matches the price_list_vat_rate_range_check.
ALTER TABLE "price_list_entry"
  ADD COLUMN "vat_rate_bps" integer;
--> statement-breakpoint

ALTER TABLE "price_list_entry"
  ADD CONSTRAINT "price_list_entry_vat_rate_bps_range_check" CHECK (
    "price_list_entry"."vat_rate_bps" IS NULL
    OR ("price_list_entry"."vat_rate_bps" >= 0 AND "price_list_entry"."vat_rate_bps" < 10000)
  );
--> statement-breakpoint

-- ── 3. recipe_component ──────────────────────────────────────────────────
-- A recipe's blend: which green lots and at what percentage.
-- percent_bps is integer basis points (1 bps = 0.01%); 10000 bps = 100%.
-- The form validates the sum equals 10000 within rounding tolerance.
CREATE TABLE "recipe_component" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "recipe_id" uuid NOT NULL,
  "green_lot_id" uuid NOT NULL,
  "percent_bps" integer NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recipe_component_percent_bps_range_check" CHECK (
    "recipe_component"."percent_bps" >= 0 AND "recipe_component"."percent_bps" <= 10000
  )
);
--> statement-breakpoint

CREATE UNIQUE INDEX "recipe_component_recipe_lot_unique"
  ON "recipe_component" USING btree ("recipe_id","green_lot_id");
--> statement-breakpoint

CREATE INDEX "recipe_component_org_id_idx"
  ON "recipe_component" USING btree ("org_id");
--> statement-breakpoint

CREATE INDEX "recipe_component_green_lot_id_idx"
  ON "recipe_component" USING btree ("green_lot_id");
--> statement-breakpoint

-- ── FKs (deferred until the FK targets exist) ─────────────────────────────
ALTER TABLE "customer"
  ADD CONSTRAINT "customer_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "recipe_component"
  ADD CONSTRAINT "recipe_component_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "recipe_component"
  ADD CONSTRAINT "recipe_component_recipe_id_recipe_id_fk"
  FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

ALTER TABLE "recipe_component"
  ADD CONSTRAINT "recipe_component_green_lot_id_green_lot_id_fk"
  FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lot"("id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
