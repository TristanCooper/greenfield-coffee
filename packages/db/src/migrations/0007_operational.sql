-- 0007_operational.sql
--
-- Card 0.9 / plan §7.3 — operational entity tables (sku, packaging,
-- recipe, price_list, price_list_entry, fx_rate, landed_cost_event,
-- order, order_line, order_edit, integration_connection).
--
-- WHY A HAND-WRITTEN MIGRATION
--
--   Per the card body, "Generated migration under
--   `packages/db/src/migrations/` (next number after `0005_*`)"
--   — drizzle-kit's `generate` would normally emit this. Two
--   reasons we hand-write it instead:
--
--     1. The pre-existing meta/0005_snapshot.json inconsistency
--        (the snapshot references card-0.9 enums that aren't in
--        the schema yet) prevents `db:generate` from running
--        interactively — the TTY prompt about enum schema
--        conflicts hangs the tool. Card 0.9 itself is the fix
--        for the inconsistency: the enums this card adds are
--        exactly the missing ones.
--
--     2. The cross-card FK pattern (e.g. packaged_lot.sku_id)
--        requires ADD CONSTRAINT … NOT VALID statements that
--        drizzle-kit's autogenerator doesn't model.
--
--   Once this migration lands and a future `pnpm db:generate`
--   can run, the snapshot diff against the new schema should be
--   a no-op (the TS schema and the SQL schema match). At that
--   point future cards can rely on `db:generate` for
--   non-hand-written schema additions.
--
-- STATEMENT ORDER
--
--   1. CREATE TYPE … AS ENUM (the 9 new pgEnums).
--   2. CREATE TABLE for the 11 new tables, in dependency order.
--   3. CREATE INDEX (btrees).
--   4. ALTER TABLE … ADD CONSTRAINT (FKs, same-card and cross-card).
--   5. Append-only trigger on order_edit (reuses 0005's shared
--      function).

-- ── 1. Enums ──────────────────────────────────────────────────────────────
CREATE TYPE "public"."integration_provider" AS ENUM('shopify', 'woocommerce', 'square_pos');
--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('pending', 'active', 'revoked', 'error');
--> statement-breakpoint
CREATE TYPE "public"."landed_cost_cost_kind" AS ENUM('freight', 'duty', 'insurance', 'packaging', 'storage', 'other');
--> statement-breakpoint
CREATE TYPE "public"."landed_cost_target_kind" AS ENUM('green_lot', 'roast_batch', 'packaged_lot');
--> statement-breakpoint
CREATE TYPE "public"."order_channel" AS ENUM('shopify', 'woocommerce', 'square_pos', 'wholesale_portal', 'email_in', 'manual');
--> statement-breakpoint
CREATE TYPE "public"."order_edit_kind" AS ENUM('status_change', 'line_added', 'line_removed', 'line_quantity_changed', 'line_price_changed', 'shipping_address_changed', 'billing_address_changed', 'note_added');
--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'pending', 'paid', 'fulfilled', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."price_list_kind" AS ENUM('retail', 'wholesale', 'promo', 'internal');
--> statement-breakpoint
CREATE TYPE "public"."price_list_vat_mode" AS ENUM('inclusive', 'exclusive');

-- ── 2. Tables ────────────────────────────────────────────────────────────

-- 2.1 sku
CREATE TABLE "sku" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit_weight_g" numeric(10, 3),
	"wholesale_only" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sku_unit_weight_positive_check" CHECK ("sku"."unit_weight_g" IS NULL OR "sku"."unit_weight_g" > 0)
);
--> statement-breakpoint

-- 2.2 packaging
CREATE TABLE "packaging" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"material" text NOT NULL,
	"tare_weight_g" numeric(10, 3) DEFAULT '0' NOT NULL,
	"capacity_g" numeric(10, 3) NOT NULL,
	"cost_minor_units" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packaging_material_check" CHECK ("packaging"."material" IN ('valve_bag', 'pillow_bag', 'tin', 'case', 'pouch', 'pod', 'other')),
	CONSTRAINT "packaging_tare_weight_non_negative_check" CHECK ("packaging"."tare_weight_g" >= 0),
	CONSTRAINT "packaging_capacity_positive_check" CHECK ("packaging"."capacity_g" > 0),
	CONSTRAINT "packaging_cost_non_negative_check" CHECK ("packaging"."cost_minor_units" >= 0)
);
--> statement-breakpoint

-- 2.3 recipe
CREATE TABLE "recipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"profile_json" jsonb DEFAULT '{"seconds": [], "notes": ""}'::jsonb NOT NULL,
	"charge_weight_g" numeric(10, 3) NOT NULL,
	"expected_yield_pct" numeric(5, 2),
	"duration_seconds" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_charge_weight_positive_check" CHECK ("recipe"."charge_weight_g" > 0),
	CONSTRAINT "recipe_expected_yield_range_check" CHECK ("recipe"."expected_yield_pct" IS NULL OR ("recipe"."expected_yield_pct" >= 0 AND "recipe"."expected_yield_pct" <= 100)),
	CONSTRAINT "recipe_duration_positive_check" CHECK ("recipe"."duration_seconds" > 0)
);
--> statement-breakpoint

-- 2.4 price_list
CREATE TABLE "price_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "price_list_kind" DEFAULT 'retail' NOT NULL,
	"vat_mode" "price_list_vat_mode" DEFAULT 'exclusive' NOT NULL,
	"vat_inclusive" boolean DEFAULT false NOT NULL,
	"vat_rate_pct" numeric(5, 2),
	"currency_code" text NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_currency_iso3_check" CHECK (length("price_list"."currency_code") = 3),
	CONSTRAINT "price_list_vat_mode_consistency_check" CHECK (("price_list"."vat_mode" = 'inclusive' AND "price_list"."vat_inclusive" = true) OR ("price_list"."vat_mode" = 'exclusive' AND "price_list"."vat_inclusive" = false)),
	CONSTRAINT "price_list_vat_rate_range_check" CHECK ("price_list"."vat_rate_pct" IS NULL OR ("price_list"."vat_rate_pct" >= 0 AND "price_list"."vat_rate_pct" < 100)),
	CONSTRAINT "price_list_effective_dates_ordered_check" CHECK ("price_list"."effective_from" IS NULL OR "price_list"."effective_to" IS NULL OR "price_list"."effective_to" >= "price_list"."effective_from")
);
--> statement-breakpoint

-- 2.5 price_list_entry
CREATE TABLE "price_list_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"price_list_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"price_minor_units" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"min_quantity" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_list_entry_price_positive_check" CHECK ("price_list_entry"."price_minor_units" > 0),
	CONSTRAINT "price_list_entry_currency_iso3_check" CHECK (length("price_list_entry"."currency_code") = 3),
	CONSTRAINT "price_list_entry_min_quantity_positive_check" CHECK ("price_list_entry"."min_quantity" IS NULL OR "price_list_entry"."min_quantity" > 0)
);
--> statement-breakpoint

-- 2.6 fx_rate
CREATE TABLE "fx_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"from_currency" text NOT NULL,
	"to_currency" text NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"effective_date" date NOT NULL,
	"source_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rate_from_currency_iso3_check" CHECK (length("fx_rate"."from_currency") = 3),
	CONSTRAINT "fx_rate_to_currency_iso3_check" CHECK (length("fx_rate"."to_currency") = 3),
	CONSTRAINT "fx_rate_rate_positive_check" CHECK ("fx_rate"."rate" > 0),
	CONSTRAINT "fx_rate_distinct_currencies_check" CHECK ("fx_rate"."from_currency" <> "fx_rate"."to_currency")
);
--> statement-breakpoint

-- 2.7 landed_cost_event
CREATE TABLE "landed_cost_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "landed_cost_cost_kind" NOT NULL,
	"target_kind" "landed_cost_target_kind" NOT NULL,
	"target_id" uuid NOT NULL,
	"applies_to_green_lot_id" uuid,
	"applies_to_roast_batch_id" uuid,
	"applies_to_packaged_lot_id" uuid,
	"amount_minor_units" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"supplier_id" uuid,
	"description" text,
	"incurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	CONSTRAINT "landed_cost_event_currency_iso3_check" CHECK (length("landed_cost_event"."currency_code") = 3),
	CONSTRAINT "landed_cost_event_amount_nonzero_check" CHECK ("landed_cost_event"."amount_minor_units" <> 0),
	CONSTRAINT "landed_cost_event_target_kind_consistency_check" CHECK (
		(("landed_cost_event"."target_kind" = 'green_lot'
		  AND "landed_cost_event"."applies_to_green_lot_id" IS NOT NULL
		  AND "landed_cost_event"."applies_to_roast_batch_id" IS NULL
		  AND "landed_cost_event"."applies_to_packaged_lot_id" IS NULL)
		OR ("landed_cost_event"."target_kind" = 'roast_batch'
		  AND "landed_cost_event"."applies_to_roast_batch_id" IS NOT NULL
		  AND "landed_cost_event"."applies_to_green_lot_id" IS NULL
		  AND "landed_cost_event"."applies_to_packaged_lot_id" IS NULL)
		OR ("landed_cost_event"."target_kind" = 'packaged_lot'
		  AND "landed_cost_event"."applies_to_packaged_lot_id" IS NOT NULL
		  AND "landed_cost_event"."applies_to_green_lot_id" IS NULL
		  AND "landed_cost_event"."applies_to_roast_batch_id" IS NULL)
	),
	CONSTRAINT "landed_cost_event_target_id_consistency_check" CHECK (
		("landed_cost_event"."target_kind" = 'green_lot' AND "landed_cost_event"."target_id" = "landed_cost_event"."applies_to_green_lot_id")
		OR ("landed_cost_event"."target_kind" = 'roast_batch' AND "landed_cost_event"."target_id" = "landed_cost_event"."applies_to_roast_batch_id")
		OR ("landed_cost_event"."target_kind" = 'packaged_lot' AND "landed_cost_event"."target_id" = "landed_cost_event"."applies_to_packaged_lot_id")
	)
);
--> statement-breakpoint

-- 2.8 order
CREATE TABLE "order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" "order_status" DEFAULT 'draft' NOT NULL,
	"channel" "order_channel" DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"customer_id" uuid,
	"billing_address_id" uuid,
	"shipping_address_id" uuid,
	"customer_name_text" text,
	"customer_email_text" text,
	"customer_phone_text" text,
	"currency_code" text NOT NULL,
	"total_minor_units" bigint DEFAULT 0 NOT NULL,
	"placed_at" timestamp with time zone,
	"notes" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_currency_iso3_check" CHECK (length("order"."currency_code") = 3),
	CONSTRAINT "order_total_non_negative_check" CHECK ("order"."total_minor_units" >= 0),
	CONSTRAINT "order_placed_after_created_check" CHECK ("order"."placed_at" IS NULL OR "order"."placed_at" >= "order"."created_at")
);
--> statement-breakpoint

-- 2.9 order_line
CREATE TABLE "order_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"sku_id" uuid NOT NULL,
	"packaged_lot_id" uuid,
	"price_list_entry_id" uuid,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_price_minor_units" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"subtotal_minor_units" bigint NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_line_currency_iso3_check" CHECK (length("order_line"."currency_code") = 3),
	CONSTRAINT "order_line_quantity_positive_check" CHECK ("order_line"."quantity" > 0),
	CONSTRAINT "order_line_unit_price_non_negative_check" CHECK ("order_line"."unit_price_minor_units" >= 0),
	CONSTRAINT "order_line_subtotal_non_negative_check" CHECK ("order_line"."subtotal_minor_units" >= 0)
);
--> statement-breakpoint

-- 2.10 order_edit
CREATE TABLE "order_edit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" "order_edit_kind" NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"order_line_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"actor_role_snapshot" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 2.11 integration_connection
CREATE TABLE "integration_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"external_account_id" text,
	"credentials_encrypted" text,
	"status" "integration_status" DEFAULT 'pending' NOT NULL,
	"last_error_text" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connection_active_requires_external_id_check" CHECK ("integration_connection"."status" <> 'active' OR "integration_connection"."external_account_id" IS NOT NULL)
);

-- ── 3. Indexes ───────────────────────────────────────────────────────────

-- 3.1 sku
CREATE UNIQUE INDEX "sku_org_id_code_unique" ON "sku" ("org_id", "code");
--> statement-breakpoint
CREATE INDEX "sku_org_id_idx" ON "sku" ("org_id");
--> statement-breakpoint
CREATE INDEX "sku_org_id_active_idx" ON "sku" ("org_id", "active");
--> statement-breakpoint

-- 3.2 packaging
CREATE UNIQUE INDEX "packaging_org_id_code_unique" ON "packaging" ("org_id", "code");
--> statement-breakpoint
CREATE INDEX "packaging_org_id_idx" ON "packaging" ("org_id");
--> statement-breakpoint

-- 3.3 recipe
CREATE UNIQUE INDEX "recipe_org_id_code_unique" ON "recipe" ("org_id", "code");
--> statement-breakpoint
CREATE INDEX "recipe_org_id_idx" ON "recipe" ("org_id");
--> statement-breakpoint
CREATE INDEX "recipe_org_id_active_idx" ON "recipe" ("org_id", "active");
--> statement-breakpoint

-- 3.4 price_list
CREATE UNIQUE INDEX "price_list_org_id_code_unique" ON "price_list" ("org_id", "code");
--> statement-breakpoint
CREATE INDEX "price_list_org_id_idx" ON "price_list" ("org_id");
--> statement-breakpoint
CREATE INDEX "price_list_org_id_active_idx" ON "price_list" ("org_id", "active");
--> statement-breakpoint
CREATE INDEX "price_list_org_id_kind_idx" ON "price_list" ("org_id", "kind");
--> statement-breakpoint

-- 3.5 price_list_entry
CREATE UNIQUE INDEX "price_list_entry_org_id_price_list_id_sku_id_unique" ON "price_list_entry" ("org_id", "price_list_id", "sku_id");
--> statement-breakpoint
CREATE INDEX "price_list_entry_org_id_idx" ON "price_list_entry" ("org_id");
--> statement-breakpoint
CREATE INDEX "price_list_entry_price_list_id_idx" ON "price_list_entry" ("price_list_id");
--> statement-breakpoint
CREATE INDEX "price_list_entry_sku_id_idx" ON "price_list_entry" ("sku_id");
--> statement-breakpoint

-- 3.6 fx_rate
CREATE UNIQUE INDEX "fx_rate_org_id_pair_date_unique" ON "fx_rate" ("org_id", "from_currency", "to_currency", "effective_date");
--> statement-breakpoint
CREATE INDEX "fx_rate_org_id_idx" ON "fx_rate" ("org_id");
--> statement-breakpoint

-- 3.7 landed_cost_event
CREATE INDEX "landed_cost_event_org_id_idx" ON "landed_cost_event" ("org_id");
--> statement-breakpoint
CREATE INDEX "landed_cost_event_target_idx" ON "landed_cost_event" ("target_kind", "target_id");
--> statement-breakpoint
CREATE INDEX "landed_cost_event_applies_to_green_lot_id_idx" ON "landed_cost_event" ("applies_to_green_lot_id");
--> statement-breakpoint
CREATE INDEX "landed_cost_event_supplier_id_idx" ON "landed_cost_event" ("supplier_id");
--> statement-breakpoint

-- 3.8 order
CREATE UNIQUE INDEX "order_org_id_code_unique" ON "order" ("org_id", "code");
--> statement-breakpoint
CREATE INDEX "order_org_id_idx" ON "order" ("org_id");
--> statement-breakpoint
CREATE INDEX "order_org_id_status_idx" ON "order" ("org_id", "status");
--> statement-breakpoint
CREATE INDEX "order_org_id_channel_idx" ON "order" ("org_id", "channel");
--> statement-breakpoint
-- UNIQUE (org_id, channel, external_id) for Phase 1 integration
-- upsert. NULL external_id excluded (Postgres UNIQUE treats
-- each NULL as distinct).
CREATE UNIQUE INDEX "order_org_id_channel_external_id_unique" ON "order" ("org_id", "channel", "external_id");
--> statement-breakpoint

-- 3.9 order_line
CREATE INDEX "order_line_order_id_idx" ON "order_line" ("order_id");
--> statement-breakpoint
CREATE INDEX "order_line_org_id_idx" ON "order_line" ("org_id");
--> statement-breakpoint
CREATE INDEX "order_line_sku_id_idx" ON "order_line" ("sku_id");
--> statement-breakpoint
CREATE INDEX "order_line_packaged_lot_id_idx" ON "order_line" ("packaged_lot_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "order_line_order_id_sku_id_packaged_lot_id_unique" ON "order_line" ("order_id", "sku_id", "packaged_lot_id");
--> statement-breakpoint

-- 3.10 order_edit
CREATE INDEX "order_edit_order_id_idx" ON "order_edit" ("order_id");
--> statement-breakpoint
CREATE INDEX "order_edit_org_id_idx" ON "order_edit" ("org_id");
--> statement-breakpoint
CREATE INDEX "order_edit_org_id_occurred_at_idx" ON "order_edit" ("org_id", "occurred_at");
--> statement-breakpoint

-- 3.11 integration_connection
CREATE UNIQUE INDEX "integration_connection_org_id_provider_unique" ON "integration_connection" ("org_id", "provider");
--> statement-breakpoint
CREATE INDEX "integration_connection_org_id_idx" ON "integration_connection" ("org_id");
--> statement-breakpoint
CREATE INDEX "integration_connection_org_id_status_idx" ON "integration_connection" ("org_id", "status");

-- ── 4. Foreign keys ─────────────────────────────────────────────────────
--
-- Same-card FKs (e.g. price_list_entry.price_list_id → price_list,
-- order_line.order_id → order) are declared inline in the TS
-- schema and emitted here. Cross-card FKs (sku_id references in
-- packaged_lot, etc.) are added below.

-- 4.1 sku → organizations
ALTER TABLE "sku"
  ADD CONSTRAINT "sku_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 4.2 packaging → organizations
ALTER TABLE "packaging"
  ADD CONSTRAINT "packaging_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 4.3 recipe → organizations
ALTER TABLE "recipe"
  ADD CONSTRAINT "recipe_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 4.4 price_list → organizations
ALTER TABLE "price_list"
  ADD CONSTRAINT "price_list_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 4.5 price_list_entry → organizations + price_list + sku
ALTER TABLE "price_list_entry"
  ADD CONSTRAINT "price_list_entry_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "price_list_entry"
  ADD CONSTRAINT "price_list_entry_price_list_id_price_list_id_fk"
  FOREIGN KEY ("price_list_id") REFERENCES "public"."price_list"("id")
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "price_list_entry"
  ADD CONSTRAINT "price_list_entry_sku_id_sku_id_fk"
  FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 4.6 fx_rate → organizations
ALTER TABLE "fx_rate"
  ADD CONSTRAINT "fx_rate_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 4.7 landed_cost_event → organizations + supplier (cross-card)
--     + green_lot / roast_batch / packaged_lot (cross-card forward
--     refs). The FKs to the lot spine use the same-card-emit
--     pattern as the rest of the schema; they're added here
--     with NOT VALID + VALIDATE so the migration doesn't fail
--     if the live DB has data inconsistencies.
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
-- Cross-card FKs to the lot spine. The columns are typed `uuid`
-- in the TS schema; the FKs land here.
ALTER TABLE "landed_cost_event"
  ADD CONSTRAINT "landed_cost_event_applies_to_green_lot_id_fk"
  FOREIGN KEY ("applies_to_green_lot_id") REFERENCES "public"."green_lot"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "landed_cost_event"
  ADD CONSTRAINT "landed_cost_event_applies_to_roast_batch_id_fk"
  FOREIGN KEY ("applies_to_roast_batch_id") REFERENCES "public"."roast_batch"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "landed_cost_event"
  ADD CONSTRAINT "landed_cost_event_applies_to_packaged_lot_id_fk"
  FOREIGN KEY ("applies_to_packaged_lot_id") REFERENCES "public"."packaged_lot"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 4.8 order → organizations + users
ALTER TABLE "order"
  ADD CONSTRAINT "order_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "order"
  ADD CONSTRAINT "order_created_by_user_id_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 4.9 order_line → organizations + order + sku + packaged_lot (cross-card)
ALTER TABLE "order_line"
  ADD CONSTRAINT "order_line_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "order_line"
  ADD CONSTRAINT "order_line_order_id_order_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."order"("id")
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "order_line"
  ADD CONSTRAINT "order_line_sku_id_sku_id_fk"
  FOREIGN KEY ("sku_id") REFERENCES "public"."sku"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
-- Cross-card FKs to the lot spine and to the price list entry.
ALTER TABLE "order_line"
  ADD CONSTRAINT "order_line_packaged_lot_id_packaged_lot_id_fk"
  FOREIGN KEY ("packaged_lot_id") REFERENCES "public"."packaged_lot"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "order_line"
  ADD CONSTRAINT "order_line_price_list_entry_id_price_list_entry_id_fk"
  FOREIGN KEY ("price_list_entry_id") REFERENCES "public"."price_list_entry"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 4.10 order_edit → organizations + order + users
ALTER TABLE "order_edit"
  ADD CONSTRAINT "order_edit_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "order_edit"
  ADD CONSTRAINT "order_edit_order_id_order_id_fk"
  FOREIGN KEY ("order_id") REFERENCES "public"."order"("id")
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "order_edit"
  ADD CONSTRAINT "order_edit_actor_user_id_users_id_fk"
  FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

-- 4.11 integration_connection → organizations
ALTER TABLE "integration_connection"
  ADD CONSTRAINT "integration_connection_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id")
  ON DELETE RESTRICT;

-- ── 5. Append-only trigger on order_edit ────────────────────────────────
--
-- The order_edit log is append-only (same pattern as audit_event
-- and stock_movement). Reuses the shared
-- `append_only_block_mutation` function from card 0.10.
CREATE TRIGGER order_edit_no_update
  BEFORE UPDATE ON public.order_edit
  FOR EACH ROW
  EXECUTE FUNCTION public.append_only_block_mutation();
--> statement-breakpoint
CREATE TRIGGER order_edit_no_delete
  BEFORE DELETE ON public.order_edit
  FOR EACH ROW
  EXECUTE FUNCTION public.append_only_block_mutation();
