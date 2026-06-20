-- 0006_compliance_rls.sql
--
-- Card 0.11 / plan §7.3 — RLS policies for the 8 new tables
-- (supplier, producer, producer_verification_override,
-- eudr_reference_data, lot_producer, dds_draft,
-- shipment_eudr_decision, audit_pack).
--
-- WHY A SEPARATE FILE
--
--   Same rationale as 0005_lots_rls.sql: Drizzle-kit doesn't model
--   RLS, and per-table policies always arrive as a CUSTOM migration
--   alongside the tables. The split keeps the 0006_compliance.sql
--   table DDL focused on schema and this file focused on access
--   control.
--
-- ENFORCEMENT MODEL
--
--   Every table is org-scoped: rows are visible to a session iff
--   `org_id = public.current_org_id()`. The pattern mirrors
--   0005_lots_rls.sql (USE `current_setting('app.org_id', true)`
--   directly so the index helper recognises the comparison).
--
--   service_role (the BYPASSRLS postgres role used by migrations
--   and admin scripts) bypasses every policy automatically.
--   Application code uses `withTenant(orgId, fn)` which `SET LOCAL
--   ROLE authenticated` and `SELECT set_tenant_context(orgId)` so
--   RLS applies.
--
-- AUDIT_PACK
--
--   audit_pack follows the same model as audit_event: INSERT-
--   allowed-with-tenant-match, no SELECT for the authenticated
--   role, no UPDATE, no DELETE. The pack renderer (Phase 1) and
--   the operator dashboard (Phase 1) read audit_pack via the
--   service_role. The compliance_officer UI in v1 is the
--   "trigger an audit pack" flow only — they don't read existing
--   packs directly. (Per the card body, if a future card needs
--   compliance_officer read access, add a role-scoped SELECT
--   policy in a separate migration; do NOT add one here.)
--
-- SHIPMENT_EUDR_DECISION — IMMUTABILITY
--
--   Decisions are append-only — a new decision supersedes a
--   previous one (the `supersedes_id` self-FK), never UPDATEs
--   the prior row. The card body doesn't explicitly require a
--   trigger here (the trigger pattern is reused from card 0.10's
--   audit_event / stock_movement trigger), but we ship one for
--   the same load-bearing reason: tampering with a recorded
--   opt-out decision invalidates the audit trail. DELETE is
--   similarly blocked. INSERT is unrestricted by trigger (RLS
--   handles tenant isolation).
--
--   Note: an UPDATE that changes only `supersedes_id` on a NEW
--   row is legitimate (the row is being created and then linked
--   to the prior decision in a follow-up statement). The
--   append-only trigger blocks UPDATEs on already-committed
--   rows — by the time a second transaction is opening the row
--   is frozen.

-- ── 1. supplier ────────────────────────────────────────────────────────────
ALTER TABLE public.supplier ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY supplier_org_isolation ON public.supplier
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 2. producer ────────────────────────────────────────────────────────────
ALTER TABLE public.producer ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY producer_org_isolation ON public.producer
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 3. producer_verification_override ─────────────────────────────────────
ALTER TABLE public.producer_verification_override ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY producer_verification_override_org_isolation
  ON public.producer_verification_override
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 4. eudr_reference_data ─────────────────────────────────────────────────
ALTER TABLE public.eudr_reference_data ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY eudr_reference_data_org_isolation
  ON public.eudr_reference_data
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 5. lot_producer ────────────────────────────────────────────────────────
ALTER TABLE public.lot_producer ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lot_producer_org_isolation ON public.lot_producer
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 6. dds_draft ───────────────────────────────────────────────────────────
ALTER TABLE public.dds_draft ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY dds_draft_org_isolation ON public.dds_draft
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint

-- ── 7. shipment_eudr_decision ──────────────────────────────────────────────
-- Append-only on top of the tenant isolation policy. Reuses the
-- shared `append_only_block_mutation` function from card 0.10
-- (0005_audit_event_triggers.sql).
ALTER TABLE public.shipment_eudr_decision ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipment_eudr_decision_org_isolation
  ON public.shipment_eudr_decision
  FOR ALL
  TO authenticated
  USING (org_id::text = current_setting('app.org_id', true))
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint
CREATE TRIGGER shipment_eudr_decision_no_update
  BEFORE UPDATE ON public.shipment_eudr_decision
  FOR EACH ROW
  EXECUTE FUNCTION public.append_only_block_mutation();
--> statement-breakpoint
CREATE TRIGGER shipment_eudr_decision_no_delete
  BEFORE DELETE ON public.shipment_eudr_decision
  FOR EACH ROW
  EXECUTE FUNCTION public.append_only_block_mutation();
--> statement-breakpoint

-- ── 8. audit_pack ──────────────────────────────────────────────────────────
-- Distinct policy model: INSERT-allowed-with-tenant-match, no
-- SELECT for authenticated, no UPDATE, no DELETE. Same shape as
-- audit_event in 0005_lots_rls.sql.
ALTER TABLE public.audit_pack ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_pack_insert ON public.audit_pack
  FOR INSERT
  TO authenticated
  WITH CHECK (org_id::text = current_setting('app.org_id', true));
--> statement-breakpoint
-- Belt-and-braces append-only triggers — same pattern as
-- audit_event. UPDATE/DELETE must raise; corrections are a NEW
-- compensating row (with status = 'archived' on the original).
CREATE TRIGGER audit_pack_no_update
  BEFORE UPDATE ON public.audit_pack
  FOR EACH ROW
  EXECUTE FUNCTION public.append_only_block_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_pack_no_delete
  BEFORE DELETE ON public.audit_pack
  FOR EACH ROW
  EXECUTE FUNCTION public.append_only_block_mutation();

-- ── 9. Verify (read-only — operators run this manually) ────────────────────
-- SELECT tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'supplier', 'producer', 'producer_verification_override',
--       'eudr_reference_data', 'lot_producer', 'dds_draft',
--       'shipment_eudr_decision', 'audit_pack'
--     )
--   ORDER BY tablename;
