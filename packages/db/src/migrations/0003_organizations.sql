CREATE TYPE "public"."membership_role" AS ENUM('owner', 'head_roaster', 'pack_ship', 'buyer_receiving', 'accountant', 'compliance_officer', 'readonly');--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country_code" text NOT NULL,
	"region" text NOT NULL,
	"base_currency" text NOT NULL,
	"data_residency" text DEFAULT 'uk' NOT NULL,
	"eudr_settings" jsonb DEFAULT '{"small_quantity_threshold_kg":1,"default_mode":"enforce","country_risk_list":"static_v1"}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_base_currency_check" CHECK ("organizations"."base_currency" IN ('EUR', 'GBP')),
	CONSTRAINT "organizations_region_check" CHECK ("organizations"."region" IN ('GB', 'IE', 'NL', 'DE', 'FR', 'BE', 'IT', 'ES', 'SE', 'DK', 'FI', 'NO', 'AT', 'PL', 'PT', 'CH')),
	CONSTRAINT "organizations_data_residency_check" CHECK ("organizations"."data_residency" IN ('uk'))
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_id_user_id_unique" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");