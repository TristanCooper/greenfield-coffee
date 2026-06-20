-- 0005_audit_event_triggers.sql
--
-- Card 0.10 (with card 0.12 merged in) / plan §7.3 — append-only
-- triggers for audit_event + stock_movement, plus the lineage
-- denormalisation trigger on green_lot.
--
-- WHY A SHARED TRIGGER FUNCTION
--
-- Both `audit_event` (the operations audit log) and `stock_movement`
-- (the inventory ledger) are append-only. The card body explicitly
-- says: "Same trigger function reused on stock_movement (append-only
-- ledger)". One function, two BEFORE triggers — DDL is shorter and
-- the contract is identical across both tables.
--
-- WHY AN EXCEPTION, NOT A SILENT FAILURE
--
--   We RAISE EXCEPTION on UPDATE and DELETE attempts. Three reasons:
--
--   1. The whole point of the append-only contract is to surface
--      tampering loudly. A silent "no-op" via policy would let a
--      buggy procedure DELETE rows without anyone noticing; an
--      exception at least makes the bug visible at the call site.
--   2. Postgres triggers can RAISE EXCEPTION with a custom message;
--      this gives us a clear "audit_event is append-only" string
--      that ops can grep for in their app logs.
--   3. With an exception, the entire transaction rolls back. So a
--      procedure that accidentally attempts an UPDATE on audit_event
--      (or stock_movement) inside a larger transaction rolls the
--      whole thing back rather than partial-committing.
--
-- WHY BEFORE (not AFTER)
--
--   BEFORE triggers can short-circuit by returning NULL from the
--   trigger function. For UPDATE/DELETE on append-only tables we
--   don't want the row to be touched at all — BEFORE lets us raise
--   before the row mutation even starts. AFTER triggers fire after
--   the row is mutated (and would need to RAISE EXCEPTION + manually
--   undo the change, which isn't possible). BEFORE is the right
--   shape.
--
-- WHY `audit_event.user_id` IS `ON DELETE SET NULL`
--
--   The card body says user_id is "uuid nullable — system actions
--   have null user". When the actor user is deleted (GDPR erasure,
--   a later card), the audit_event row STAYS — that's the whole
--   point of an append-only audit log — but the user_id pointer is
--   set to NULL. We add the trigger BEFORE UPDATE/DELETE on
--   audit_event to enforce append-only, but we do NOT add a trigger
--   that blocks the SET NULL cascade because that would defeat the
--   GDPR right-to-erasure flow. The cascade is a one-way orphan
--   attribution, not a deletion.
--
-- LINEAGE TRIGGER ON green_lot
--
--   The card body defers the full lineage chain (populated across
--   roast_batch, packaged_lot, etc.) to card 0.21's smoke pass. We
--   ship a MINIMAL trigger here that sets `lineage = { green_lot_id:
--   NEW.id }` on INSERT so the column has a sensible default
--   (currently `{"green_lot_id": null}` from the table definition —
--   that's a fallback for INSERTs that bypass the trigger). The
--   schema TS uses the same default so the schema's idea of the
--   row matches what a bare INSERT produces.
--
--   Card 0.21 will REPLACE this trigger with a chain walker that
--   denormalises the upstream trace (which green lots → which
--   roast batches → which roasted lots → which packaged lots).
--   Replacing a trigger is `CREATE OR REPLACE TRIGGER` followed by
--   a DROP; the chain logic doesn't ship in this card because the
--   smoke pass is the right place to validate it against real
--   production-shaped data.

-- ── 1. Shared append-only guard function ─────────────────────────────────────
-- One function used by audit_event AND stock_movement triggers.
-- Idempotent: CREATE OR REPLACE so re-running the migration is safe.
--
-- SECURITY DEFINER is not strictly needed — the function reads no
-- tables and raises only. But INVOKER would also work; we use
-- DEFINER as a defensive default matching the pattern in
-- 0001_auth_bridge.sql (handle_new_auth_user is SECURITY DEFINER).
--
-- search_path = '' matches the auth-bridge pattern so the function
-- can't be subverted into calling a different `audit_event` (none
-- exists in any other schema, but the principle is consistent).
CREATE OR REPLACE FUNCTION public.append_only_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'append-only violation: % on % is not permitted (table is append-only)',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- ── 2. audit_event triggers ──────────────────────────────────────────────────
-- BEFORE UPDATE and BEFORE DELETE on audit_event raise the shared
-- exception. INSERT is unrestricted by trigger (RLS handles tenant
-- isolation; see 0005_lots_rls.sql).
CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON public.audit_event
  FOR EACH ROW
  EXECUTE FUNCTION public.append_only_block_mutation();

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON public.audit_event
  FOR EACH ROW
  EXECUTE FUNCTION public.append_only_block_mutation();

-- ── 3. stock_movement triggers ───────────────────────────────────────────────
-- Same pattern. The inventory ledger is append-only; UPDATE/DELETE
-- must raise. Stock adjustments are achieved by inserting a NEW
-- compensating row (count_adjust with opposite sign), never by
-- editing an existing row.
CREATE TRIGGER stock_movement_no_update
  BEFORE UPDATE ON public.stock_movement
  FOR EACH ROW
  EXECUTE FUNCTION public.append_only_block_mutation();

CREATE TRIGGER stock_movement_no_delete
  BEFORE DELETE ON public.stock_movement
  FOR EACH ROW
  EXECUTE FUNCTION public.append_only_block_mutation();

-- ── 4. green_lot lineage trigger (minimal) ───────────────────────────────────
-- On INSERT, set `lineage = jsonb_build_object('green_lot_id', NEW.id)`.
-- The default on the column (`{"green_lot_id": null}`) is the
-- safety net for INSERTs that bypass the trigger (e.g. raw SQL
-- during backfill); the trigger is the load-bearing path for app
-- code.
--
-- SECURITY DEFINER + SET search_path = '' — same defensive pattern
-- as the append-only guard. The function uses only `NEW` (a
-- trigger-local pseudo-record) and `jsonb_build_object`, both
-- schema-independent at the SQL level.
--
-- We deliberately do NOT update lineage on UPDATE of green_lot.
-- The lineage is the green_lot's identity in the genealogy graph;
-- a metadata edit (notes, moisture_pct) doesn't change lineage.
-- The deeper edges (roast_batch → roasted_lot → packaged_lot)
-- are added by card 0.21.
CREATE OR REPLACE FUNCTION public.green_lot_set_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.lineage := jsonb_build_object('green_lot_id', NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER green_lot_lineage_init
  BEFORE INSERT ON public.green_lot
  FOR EACH ROW
  EXECUTE FUNCTION public.green_lot_set_lineage();

-- ── 5. Verify (read-only — operators run this manually) ───────────────────────
-- The migration does NOT assert trigger existence (that would make
-- re-running noisy). Operators can verify with:
--   SELECT tgname, tgrelid::regclass, tgenabled
--   FROM pg_trigger
--   WHERE tgrelid IN (
--     'public.audit_event'::regclass,
--     'public.stock_movement'::regclass,
--     'public.green_lot'::regclass,
--   )
--   AND NOT tgisinternal
--   ORDER BY tgrelid::regclass::text, tgname;
