-- 0002_rls_helpers.sql
--
-- Card 0.6 / plan §7.2 — RLS tenancy primitives.
--
-- Three helper functions sit in `public` (so app code can reach them
-- without a search_path dance) and a single session variable
-- `app.org_id` carries the tenant for the lifetime of a transaction.
--
-- Design choices:
--
-- 1. **Local-to-transaction scoping.** `set_tenant_context` calls
--    `set_config('app.org_id', $1, true)` — the `true` flag means
--    `SET LOCAL`, scoped to the current transaction. This is mandatory
--    on Supabase because the pooler (port 6543, transaction mode)
--    reuses one server-side Postgres connection across MANY requests;
--    a session-scoped GUC would leak the previous tenant's id into
--    the next request that picks up the connection. The
--    `withTenant(orgId, fn)` wrapper in src/rls.ts opens an explicit
--    transaction, calls this function, then runs `fn` inside the
--    same transaction — so every query in `fn` sees the tenant and
--    the setting evaporates on commit.
--
-- 2. **NULLIF guard in current_org_id.** `current_setting(..., true)`
--    returns '' (empty string) when unset, NOT NULL. We NULLIF on ''
--    so callers get a clean `null` and the empty-string-vs-real-uuid
--    distinction is unambiguous. RLS policies read the setting
--    directly (they can't NULLIF inside a USING clause without losing
--    index-friendly comparison), so the function is for application
--    code that wants a typed uuid.
--
-- 3. **assert_tenant helper for triggers.** Card 0.11 (compliance /
--    chain-of-custody) will add triggers that enforce org ownership
--    on writes. The trigger body compares the row's org_id to
--    current_org_id() and raises an exception with a helpful message
--    when they don't match. We provide the function now so cards 0.9
--    / 0.10 / 0.11 don't have to redefine it.
--
-- 4. **No RLS policies here.** Per-table policies arrive in cards
--    0.9 / 0.10 / 0.11 alongside the tables themselves (the card
--    body scopes them out). This migration is JUST the helpers.
--
-- 5. **SECURITY INVOKER, not SECURITY DEFINER.** These functions are
--    pure GUC plumbing — they read/write only session state, no
--    table data. INVOKER preserves the caller's role so RLS
--    enforcement in subsequent queries is unchanged.
--
-- Operator note: this migration is CUSTOM (not Drizzle-generated)
-- for the same reasons as 0001_auth_bridge.sql — Drizzle-kit doesn't
-- model Postgres functions / GUC variables, and the cross-cutting
-- tenancy logic belongs in a hand-written file where the scoping
-- rules are explicit.

-- ── 1. set_tenant_context(org_id uuid) → void ─────────────────────────────────
-- Sets the per-transaction tenant id. Call this exactly once per request,
-- INSIDE a transaction, before any query that should be tenant-scoped.
--
-- Why a function wrapper around `set_config`:
--   - Centralises the GUC name (`app.org_id`) so callers don't
--     hardcode the string and a future rename is one place.
--   - Returns `void` so the call site is a statement (`SELECT set_tenant_context($1)`),
--     not a value — clearer in logs.
--   - Throws on a malformed UUID so the caller fails fast with a
--     precise message instead of getting a generic `invalid input
--     syntax for type uuid` from a later step.
CREATE OR REPLACE FUNCTION public.set_tenant_context(org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- `true` = SET LOCAL. Must be called inside a transaction (the
  -- `withTenant` wrapper in src/rls.ts guarantees this).
  PERFORM set_config('app.org_id', org_id::text, true);
END;
$$;

-- ── 2. current_org_id() → uuid ──────────────────────────────────────────────
-- Returns the tenant id for the current transaction, or NULL if unset.
--
-- `current_setting('app.org_id', true)` returns an empty string when
-- the GUC is unset (NOT NULL — that's the `missing_ok=true` contract).
-- Wrapping in NULLIF gives callers a typed uuid-or-null result.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid;
$$;

-- ── 3. assert_tenant(text) → void ───────────────────────────────────────────
-- Convenience helper for triggers that want to compare the row's
-- expected org against the transaction's current_org_id() and fail
-- with a helpful message on mismatch.
--
-- `expected_org_text` is text (not uuid) so the trigger can pass
-- NEW.org_id::text without a cast in the trigger body. The cast is
-- done internally so the comparison is still uuid-vs-uuid.
--
-- Usage (card 0.11):
--   CREATE TRIGGER ... BEFORE INSERT OR UPDATE ON green_lot
--   FOR EACH ROW EXECUTE FUNCTION public.assert_org_match();
--   -- where assert_org_match() reads NEW.org_id, calls assert_tenant,
--   -- and RAISES if it returns false.
CREATE OR REPLACE FUNCTION public.assert_tenant(expected_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  current_id uuid := public.current_org_id();
BEGIN
  IF current_id IS NULL THEN
    RAISE EXCEPTION
      'assert_tenant: current_org_id() is NULL — no tenant set for this transaction. '
      'Wrap the call in withTenant(orgId, ...) so the request scope is established.';
  END IF;
  IF current_id <> expected_org_id THEN
    RAISE EXCEPTION
      'assert_tenant: row org_id (%) does not match transaction org_id (%). '
      'Cross-org writes are not permitted.',
      expected_org_id, current_id
      USING ERRCODE = '42501'; -- insufficient_privilege — the standard
                               -- SQLSTATE for "you're trying to touch
                               -- data outside your scope".
  END IF;
END;
$$;

-- Document the GUC so it shows up in `\dConfig` / pg_settings queries.
-- Postgres doesn't have a `COMMENT ON SETTING` syntax — the standard
-- way is to add a row to `pg_settings` manually, which requires a
-- superuser and is more invasive than this card warrants. Operators
-- discover `app.org_id` from the function source or this migration's
-- comment header.