-- 0005_lots_rls.sql
--
-- Card 0.10 / plan §7.3 — RLS policies for the lot spine + audit_event.
--
-- WHY A SEPARATE FILE
--
-- The Drizzle-generated 0005_lots.sql creates tables, indexes, FKs,
-- and CHECK constraints. It does NOT create RLS policies — drizzle-kit
-- doesn't model RLS, and per-table policies always arrive as a
-- CUSTOM migration alongside the tables. The split mirrors how card
-- 0.7 ships 0003_organizations.sql (Drizzle) plus the 0003 RLS in a
-- later file (here, bundled for simplicity into the same 0005 batch
-- because the tables are interdependent).
--
-- ENFORCEMENT MODEL
--
-- Every table except `audit_event` is org-scoped: rows are visible
-- to a session iff `org_id = public.current_org_id()`. The pattern
-- mirrors the throwaway `rls_test_fixture` policy in rls.test.ts
-- (USE `current_setting('app.org_id', true)` directly so the index
-- helper recognises the comparison).
--
-- service_role (the BYPASSRLS postgres role used by migrations and
-- admin scripts) bypasses every policy automatically. Application
-- code uses `withTenant(orgId, fn)` which `SET LOCAL ROLE
-- authenticated` and `SELECT set_tenant_context(orgId)` so RLS
-- applies.
--
-- audit_event has a DIFFERENT policy model — see the dedicated
-- block below. No SELECT policy means the authenticated role can't
-- read; only service_role can.
--
-- STATEMENT ORDER
--
--   1. ENABLE RLS on each table.
--   2. CREATE POLICY for each table. A single `FOR ALL` policy is
--      sufficient when the USING and WITH_CHECK clauses are the
--      same org-equality expression — this matches the throwaway
--      fixture's pattern. For audit_event we need separate INSERT
--      and SELECT policies (or absence thereof).
--   3. The helper functions (`current_org_id`, `set_tenant_context`)
--      were created in 0002_rls_helpers.sql and are unchanged here.

-- ── 1. green_lot ─────────────────────────────────────────────────────────────
ALTER TABLE public.green_lot ENABLE ROW LEVEL SECURITY;
CREATE POLICY green_lot_org_isolation ON public.green_lot
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));

-- ── 2. roast_batch ────────────────────────────────────────────────────────────
ALTER TABLE public.roast_batch ENABLE ROW LEVEL SECURITY;
CREATE POLICY roast_batch_org_isolation ON public.roast_batch
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));

-- ── 3. roast_batch_component ──────────────────────────────────────────────────
ALTER TABLE public.roast_batch_component ENABLE ROW LEVEL SECURITY;
CREATE POLICY roast_batch_component_org_isolation
  ON public.roast_batch_component
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));

-- ── 4. roasted_lot ───────────────────────────────────────────────────────────
ALTER TABLE public.roasted_lot ENABLE ROW LEVEL SECURITY;
CREATE POLICY roasted_lot_org_isolation ON public.roasted_lot
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));

-- ── 5. packaged_lot ──────────────────────────────────────────────────────────
ALTER TABLE public.packaged_lot ENABLE ROW LEVEL SECURITY;
CREATE POLICY packaged_lot_org_isolation ON public.packaged_lot
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));

-- ── 6. stock_movement ────────────────────────────────────────────────────────
-- Org-scoped reads/writes (same model as the other lot tables).
-- The append-only enforcement is via the trigger in
-- 0005_audit_event_triggers.sql (shared `audit_event_block_mutation`
-- function reused on stock_movement for the UPDATE/DELETE ban).
ALTER TABLE public.stock_movement ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_movement_org_isolation ON public.stock_movement
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));

-- ── 7. lot_allocation ────────────────────────────────────────────────────────
ALTER TABLE public.lot_allocation ENABLE ROW LEVEL SECURITY;
CREATE POLICY lot_allocation_org_isolation ON public.lot_allocation
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));

-- ── 8. return_event ──────────────────────────────────────────────────────────
ALTER TABLE public.return_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY return_event_org_isolation ON public.return_event
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));

-- ── 9. audit_event ───────────────────────────────────────────────────────────
-- Distinct policy model: INSERT-allowed-with-tenant-match, no SELECT,
-- no UPDATE, no DELETE.
--
--   INSERT  — WITH CHECK allows writes from authenticated sessions
--            whose current_org_id() matches the row's org_id. The
--            app code is expected to set `org_id = current_org_id()`
--            explicitly; RLS rejects mismatches so a bug in one
--            procedure can't write to another tenant's audit log.
--
--   SELECT  — No policy. The authenticated role can SELECT rows but
--            RLS-without-a-policy denies by default (USING expression
--            is FALSE for every row when no SELECT policy is created).
--            The service_role (BYPASSRLS) reads audit_event for the
--            audit pack renderer and the operator dashboard.
--            Per the card body, if a UI feature for compliance_officer
--            to read audit_event is needed, add a SELECT policy in a
--            later card; we explicitly do NOT add one here.
--
--   UPDATE / DELETE — No policies AND a BEFORE UPDATE/DELETE trigger
--            raises EXCEPTION (see 0005_audit_event_triggers.sql).
--            The trigger is the load-bearing guard; the policy is
--            belt-and-braces for defence in depth.
ALTER TABLE public.audit_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_event_insert ON public.audit_event
  FOR INSERT
  TO authenticated
  WITH CHECK (org_id::text = current_setting('app.org_id', true));

-- Belt-and-braces: a SELECT policy that explicitly denies, so a
-- future contributor who sees "no SELECT policy" and tries to add
-- one without `current_org_id` matching sees the DENY and asks why.
-- This is the "RLS-as-permission" model the card body calls out:
-- SELECT is by design NOT granted to authenticated. Comment header
-- explains; if the founder wants compliance_officer to read in UI,
-- drop this and add a role-scoped SELECT policy in a separate card.
-- We DO NOT add a SELECT policy — the absence IS the policy.
