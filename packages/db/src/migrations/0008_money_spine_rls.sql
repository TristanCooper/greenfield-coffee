-- 0008_money_spine_rls.sql
--
-- Card 0.13 / plan §7.3 — RLS policies for the recreated
-- landed_cost_event + fx_rate tables.
--
-- The 0.7 card's 0007_operational_rls.sql enabled RLS and
-- added policies for both tables. The 0.13 card DROPS +
-- RECREATEs the tables (per 0008_money_spine.sql), and the
-- DROP … CASCADE wipes the policies. This file re-adds the
-- policies.
--
-- WHY A SEPARATE FILE
--
--   Same rationale as 0005/0006/0007 — Drizzle-kit doesn't
--   model RLS, and per-table policies always arrive as a
--   CUSTOM migration alongside the tables.
--
-- FX_RATE — SPECIAL CASE
--
--   The 0.13 spec removes the org_id FK: "No FK to anything —
--   pure reference data." The RLS model for fx_rate is
--   therefore GLOBAL: the authenticated role can SELECT any
--   row (the rate applies across orgs — it's a market
--   observation). The service_role (BYPASSRLS) is the only
--   writer; the application layer uses a tRPC procedure with
--   role checks for INSERT/UPDATE/DELETE.
--
--   The "FOR SELECT TO authenticated" policy is permissive;
--   no INSERT/UPDATE/DELETE policies for authenticated. This
--   means: authenticated can read but not write. service_role
--   bypasses RLS entirely.

-- ── 1. landed_cost_event ─────────────────────────────────────────────────
ALTER TABLE public.landed_cost_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY landed_cost_event_org_isolation ON public.landed_cost_event
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 2. fx_rate ───────────────────────────────────────────────────────────
-- Global read for authenticated; write blocked (service_role
-- bypasses RLS for the daily fx-refresh job — v1.5).
ALTER TABLE public.fx_rate ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fx_rate_authenticated_read ON public.fx_rate
  FOR SELECT
  TO authenticated
  USING (true);
