-- 0001_auth_bridge.sql
--
-- Card 0.5 — Supabase Auth bridge.
--
-- Wires the public.users mirror (created in 0000_pretty_karma.sql) to the
-- Supabase-managed auth.users table:
--
--   1. Foreign key: public.users.id → auth.users(id) ON DELETE CASCADE
--      (clean teardown when a user is deleted via the Supabase dashboard or
--      later via the GDPR right-to-erasure flow).
--
--   2. Sync trigger: AFTER INSERT ON auth.users → INSERT INTO public.users.
--      This is the standard Supabase pattern. We deliberately do NOT duplicate
--      auth state — the mirror is the minimum: id, email, created_at.
--
--   3. RLS on public.users with a self-select policy. Subsequent cards (0.7+)
--      add org-scoped read policies once org_memberships exists.
--
-- This is a CUSTOM migration (not Drizzle-generated) because:
--   - FKs across schemas (`public.* → auth.*`) are awkward to express via
--     Drizzle column references; hand-written SQL is more honest about the
--     dependency on Supabase's auth schema.
--   - Triggers are not first-class in drizzle-kit; the SQL is the source of
--     truth for trigger DDL.
--
-- Apply with: pnpm db:migrate (uses DATABASE_URL_DIRECT — port 5432, bypasses
-- pgBouncer transaction-mode so trigger creation works without prepared-stmt
-- quirks).

-- ── 1. Foreign key ────────────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD CONSTRAINT users_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── 2. Sync trigger (auth.users → public.users) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, created_at)
  VALUES (NEW.id, NEW.email, NEW.created_at);
  RETURN NEW;
END;
$$;

-- Trigger on the auth.users table. The trigger function lives in public schema
-- so it can be owned/managed alongside our schema, but its search_path is locked
-- to '' so it can't be subverted into reading a different `users` table.
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- ── 3. RLS + self-select policy ───────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can read their own row. Org-scoped reads are added in card 0.7.
CREATE POLICY users_self_select ON public.users
  FOR SELECT
  USING (auth.uid() = id);

-- Service-role bypass is automatic in Supabase: the service_role Postgres role
-- has BYPASSRLS, so server-side admin operations don't need a permissive
-- policy here. Application code that needs to write public.users does so via
-- the AFTER INSERT trigger — there is no client-facing INSERT/UPDATE/DELETE
-- policy, which is correct (auth state is owned by Supabase).
