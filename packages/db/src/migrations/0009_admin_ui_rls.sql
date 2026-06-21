-- 0009_admin_ui_rls.sql
--
-- Card 0.16 — RLS policies for the new tables in 0009_admin_ui.sql
-- and any policy gaps surfaced by the admin UI.
--
-- Pattern mirrors 0007_operational_rls.sql: org-scoping via
-- `app.org_id` setting, role-aware checks live in the application
-- layer (apps/web/src/lib/rbac.ts), not in RLS.

-- ── customer ──────────────────────────────────────────────────────────────
ALTER TABLE public.customer ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY customer_org_isolation ON public.customer
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── recipe_component ──────────────────────────────────────────────────────
ALTER TABLE public.recipe_component ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY recipe_component_org_isolation ON public.recipe_component
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── price_list_entry.vat_rate_bps ────────────────────────────────────────
-- The new column inherits RLS from the existing price_list_entry policy
-- (added in 0007_operational_rls.sql). No new policy needed; column
-- updates are constrained by the same FOR ALL policy as the rest of the
-- row.
