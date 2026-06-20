CREATE TYPE "public"."green_lot_status" AS ENUM('available', 'quarantined', 'depleted');--> statement-breakpoint
-- NOTE: The following 5 enum types (landed_cost_cost_kind,
-- landed_cost_target_kind, order_channel, order_status,
-- price_list_vat_mode) belong to card 0.9 (operational entities).
-- They are declared in schema/enums.ts and emitted here because
-- schema/lots.ts imports from schema/enums.ts — drizzle-kit
-- emits CREATE TYPE for every pgEnum referenced by the schema.
--
-- When card 0.9 ships its operational tables, its migration must
-- NOT redeclare these enums (Postgres has no `CREATE TYPE IF NOT
-- EXISTS`). Two safe options for 0.9's migration author:
--   (a) skip enums.ts from the schema set during 0.9's generate, OR
--   (b) wrap the CREATE TYPE in a DO block that checks
--       pg_type for the typename first.
--
-- We document this in cards README rather than hand-rewriting the
-- generated SQL — option (b) is a 1-block DO check that 0.9's author
-- can copy from this comment.
CREATE TYPE "public"."landed_cost_cost_kind" AS ENUM('freight', 'duty', 'insurance', 'packaging', 'storage', 'other');--> statement-breakpoint
CREATE TYPE "public"."landed_cost_target_kind" AS ENUM('green_lot', 'roast_batch', 'packaged_lot');--> statement-breakpoint
CREATE TYPE "public"."order_channel" AS ENUM('shopify', 'woocommerce', 'square_pos', 'wholesale_portal', 'email_in', 'manual');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'pending', 'paid', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."packaged_lot_status" AS ENUM('available', 'reserved', 'sold', 'depleted');--> statement-breakpoint
CREATE TYPE "public"."price_list_vat_mode" AS ENUM('inclusive', 'exclusive');--> statement-breakpoint
CREATE TYPE "public"."roast_batch_status" AS ENUM('completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."roasted_lot_status" AS ENUM('available', 'reserved', 'depleted');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_kind" AS ENUM('receipt', 'roast_consume', 'roast_produce', 'pack_consume', 'pack_produce', 'count_adjust', 'sale_consume', 'return_receive', 'destruction');--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"diff" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_action_nonempty_check" CHECK (length("audit_event"."action") > 0),
	CONSTRAINT "audit_event_entity_type_nonempty_check" CHECK (length("audit_event"."entity_type") > 0)
);
--> statement-breakpoint
CREATE TABLE "green_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"supplier_id" uuid,
	"producer_id" uuid,
	"eudr_reference_data_id" uuid,
	"code" text NOT NULL,
	"country_of_origin" text NOT NULL,
	"harvest_year" text NOT NULL,
	"weight_kg" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"moisture_pct" text,
	"process" text,
	"notes" text,
	"status" "green_lot_status" DEFAULT 'available' NOT NULL,
	"lineage" jsonb DEFAULT '{"green_lot_id": null}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "green_lot_country_check" CHECK ("green_lot"."country_of_origin" IN ('GB', 'IE', 'NL', 'DE', 'FR', 'BE', 'IT', 'ES', 'SE', 'DK', 'FI', 'NO', 'AT', 'PL', 'PT', 'CH')),
	CONSTRAINT "green_lot_weight_positive_check" CHECK ("green_lot"."weight_kg"::numeric > 0),
	CONSTRAINT "green_lot_moisture_range_check" CHECK ("green_lot"."moisture_pct" IS NULL OR ("green_lot"."moisture_pct"::numeric >= 0 AND "green_lot"."moisture_pct"::numeric <= 100))
);
--> statement-breakpoint
CREATE TABLE "lot_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"packaged_lot_id" uuid NOT NULL,
	"customer_id" uuid,
	"qty" text NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lot_allocation_qty_positive_check" CHECK ("lot_allocation"."qty"::numeric > 0)
);
--> statement-breakpoint
CREATE TABLE "packaged_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"sku_id" uuid,
	"packaging_id" uuid,
	"roast_batch_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"weight_kg" text NOT NULL,
	"count" text NOT NULL,
	"unit_weight_g" text NOT NULL,
	"status" "packaged_lot_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "packaged_lot_weight_positive_check" CHECK ("packaged_lot"."weight_kg"::numeric > 0),
	CONSTRAINT "packaged_lot_count_positive_check" CHECK ("packaged_lot"."count"::numeric > 0),
	CONSTRAINT "packaged_lot_unit_weight_positive_check" CHECK ("packaged_lot"."unit_weight_g"::numeric > 0)
);
--> statement-breakpoint
CREATE TABLE "return_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_line_id" uuid,
	"packaged_lot_id" uuid,
	"qty" text NOT NULL,
	"reason_code" text NOT NULL,
	"restock" text DEFAULT 'false' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_event_qty_positive_check" CHECK ("return_event"."qty"::numeric > 0)
);
--> statement-breakpoint
CREATE TABLE "roast_batch_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"roast_batch_id" uuid NOT NULL,
	"green_lot_id" uuid NOT NULL,
	"weight_kg" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roast_batch_component_weight_positive_check" CHECK ("roast_batch_component"."weight_kg"::numeric > 0)
);
--> statement-breakpoint
CREATE TABLE "roast_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"recipe_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"green_weight_in_kg" text NOT NULL,
	"roasted_weight_out_kg" text,
	"yield_pct" text,
	"roaster_user_id" uuid NOT NULL,
	"roast_profile_ref" text,
	"notes" text,
	"status" "roast_batch_status",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roast_batch_green_weight_positive_check" CHECK ("roast_batch"."green_weight_in_kg"::numeric > 0),
	CONSTRAINT "roast_batch_roasted_weight_positive_check" CHECK ("roast_batch"."roasted_weight_out_kg" IS NULL OR "roast_batch"."roasted_weight_out_kg"::numeric > 0),
	CONSTRAINT "roast_batch_yield_range_check" CHECK ("roast_batch"."yield_pct" IS NULL OR ("roast_batch"."yield_pct"::numeric >= 0 AND "roast_batch"."yield_pct"::numeric <= 100)),
	CONSTRAINT "roast_batch_completed_after_started_check" CHECK ("roast_batch"."completed_at" IS NULL OR "roast_batch"."completed_at" >= "roast_batch"."started_at"),
	CONSTRAINT "roast_batch_completed_status_consistency_check" CHECK ("roast_batch"."status" IS DISTINCT FROM 'completed' OR "roast_batch"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "roasted_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"roast_batch_id" uuid NOT NULL,
	"weight_kg" text NOT NULL,
	"status" "roasted_lot_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roasted_lot_weight_positive_check" CHECK ("roasted_lot"."weight_kg"::numeric > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "stock_movement_kind" NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"weight_kg" text NOT NULL,
	"count" text,
	"source_kind" text,
	"source_id" uuid,
	"ref_kind" text,
	"ref_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movement_weight_nonzero_check" CHECK ("stock_movement"."weight_kg"::numeric <> 0),
	CONSTRAINT "stock_movement_target_kind_nonempty_check" CHECK (length("stock_movement"."target_kind") > 0)
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_lot" ADD CONSTRAINT "green_lot_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_allocation" ADD CONSTRAINT "lot_allocation_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_allocation" ADD CONSTRAINT "lot_allocation_packaged_lot_id_packaged_lot_id_fk" FOREIGN KEY ("packaged_lot_id") REFERENCES "public"."packaged_lot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packaged_lot" ADD CONSTRAINT "packaged_lot_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_event" ADD CONSTRAINT "return_event_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_event" ADD CONSTRAINT "return_event_packaged_lot_id_packaged_lot_id_fk" FOREIGN KEY ("packaged_lot_id") REFERENCES "public"."packaged_lot"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_event" ADD CONSTRAINT "return_event_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batch_component" ADD CONSTRAINT "roast_batch_component_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batch_component" ADD CONSTRAINT "roast_batch_component_roast_batch_id_roast_batch_id_fk" FOREIGN KEY ("roast_batch_id") REFERENCES "public"."roast_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batch_component" ADD CONSTRAINT "roast_batch_component_green_lot_id_green_lot_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batch" ADD CONSTRAINT "roast_batch_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batch" ADD CONSTRAINT "roast_batch_roaster_user_id_users_id_fk" FOREIGN KEY ("roaster_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roasted_lot" ADD CONSTRAINT "roasted_lot_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roasted_lot" ADD CONSTRAINT "roasted_lot_roast_batch_id_roast_batch_id_fk" FOREIGN KEY ("roast_batch_id") REFERENCES "public"."roast_batch"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_org_id_idx" ON "audit_event" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_event_entity_idx" ON "audit_event" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_event_occurred_at_idx" ON "audit_event" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "green_lot_org_id_code_unique" ON "green_lot" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "green_lot_org_id_idx" ON "green_lot" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "green_lot_status_idx" ON "green_lot" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "lot_allocation_org_id_idx" ON "lot_allocation" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "lot_allocation_packaged_lot_id_idx" ON "lot_allocation" USING btree ("packaged_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "packaged_lot_org_id_code_unique" ON "packaged_lot" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "packaged_lot_org_id_idx" ON "packaged_lot" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "packaged_lot_status_idx" ON "packaged_lot" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "return_event_org_id_idx" ON "return_event" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "return_event_packaged_lot_id_idx" ON "return_event" USING btree ("packaged_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roast_batch_component_batch_lot_unique" ON "roast_batch_component" USING btree ("roast_batch_id","green_lot_id");--> statement-breakpoint
CREATE INDEX "roast_batch_component_org_id_idx" ON "roast_batch_component" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "roast_batch_component_green_lot_id_idx" ON "roast_batch_component" USING btree ("green_lot_id");--> statement-breakpoint
CREATE INDEX "roast_batch_org_id_idx" ON "roast_batch" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "roast_batch_completed_at_idx" ON "roast_batch" USING btree ("org_id","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roasted_lot_org_id_code_unique" ON "roasted_lot" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "roasted_lot_org_id_roast_batch_id_unique" ON "roasted_lot" USING btree ("org_id","roast_batch_id");--> statement-breakpoint
CREATE INDEX "roasted_lot_org_id_idx" ON "roasted_lot" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "roasted_lot_status_idx" ON "roasted_lot" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "stock_movement_org_id_idx" ON "stock_movement" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "stock_movement_occurred_at_idx" ON "stock_movement" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "stock_movement_target_idx" ON "stock_movement" USING btree ("org_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "stock_movement_kind_idx" ON "stock_movement" USING btree ("org_id","kind");