-- 0007_operational_rls.sql
--
-- Card 0.9 / plan §7.3 — RLS policies for the 11 new tables
-- (sku, packaging, recipe, price_list, price_list_entry,
-- fx_rate, landed_cost_event, order, order_line, order_edit,
-- integration_connection).
--
-- WHY A SEPARATE FILE
--
--   Same rationale as 0005_lots_rls.sql and 0006_compliance_rls.sql:
--   Drizzle-kit doesn't model RLS, and per-table policies always
--   arrive as a CUSTOM migration alongside the tables. The split
--   keeps 0007_operational.sql focused on schema and this file
--   focused on access control.
--
-- ENFORCEMENT MODEL
--
--   Every table is org-scoped: rows are visible to a session iff
--   `org_id = public.current_org_id()`. The pattern mirrors
--   0005_lots_rls.sql / 0006_compliance_rls.sql.
--
-- ORDER_EDIT — APPEND-ONLY
--
--   order_edit is an event log (the per-order audit trail). It
--   carries the append-only trigger in 0007_operational.sql, so
--   RLS just enforces tenant isolation. The trigger blocks
--   UPDATE/DELETE; RLS-with-FOR-ALL does the tenant scoping.

-- ── 1. sku ────────────────────────────────────────────────────────────────
ALTER TABLE public.sku ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sku_org_isolation ON public.sku
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 2. packaging ─────────────────────────────────────────────────────────
ALTER TABLE public.packaging ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY packaging_org_isolation ON public.packaging
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 3. recipe ─────────────────────────────────────────────────────────────
ALTER TABLE public.recipe ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recipe_org_isolation ON public.recipe
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 4. price_list ────────────────────────────────────────────────────────
ALTER TABLE public.price_list ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY price_list_org_isolation ON public.price_list
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 5. price_list_entry ─────────────────────────────────────────────────
ALTER TABLE public.price_list_entry ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY price_list_entry_org_isolation ON public.price_list_entry
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 6. fx_rate ───────────────────────────────────────────────────────────
ALTER TABLE public.fx_rate ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fx_rate_org_isolation ON public.fx_rate
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 7. landed_cost_event ─────────────────────────────────────────────────
ALTER TABLE public.landed_cost_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY landed_cost_event_org_isolation ON public.landed_cost_event
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 8. order ─────────────────────────────────────────────────────────────
ALTER TABLE public.order ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY order_org_isolation ON public.order
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 9. order_line ────────────────────────────────────────────────────────
ALTER TABLE public.order_line ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY order_line_org_isolation ON public.order_line
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 10. order_edit ──────────────────────────────────────────────────────
-- Append-only is enforced by the trigger in 0007_operational.sql.
-- RLS enforces tenant isolation; the trigger blocks UPDATE/DELETE.
ALTER TABLE public.order_edit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY order_edit_org_isolation ON public.order_edit
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 11. integration_connection ──────────────────────────────────────────
-- Same model as supplier / producer in 0006_compliance_rls.sql:
-- tenant-scoped, the credentials column is opaque to the RLS
-- layer. The app code applies application-layer checks for
-- which roles can read the credentials (none for v1).
ALTER TABLE public.integration_connection ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_connection_org_isolation
  ON public.integration_connection
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
