-- 0004_pg_cron_audit_freshness.sql
--
-- Card 0.15 / plan §7.3 — pg_cron placeholder for audit-pack freshness.
--
-- GOAL
-- A pg_cron job is scheduled inside the Supabase project. v1: the job
-- is a NO-OP (returns 1). v1.5 work replaces the body with the real
-- audit_pack freshness logic. The infrastructure is in place NOW so
-- v1.5 is a code change, not a schema/infra change.
--
-- WHY pg_cron (not Vercel Cron)
-- Vercel Hobby tier caps at 2 cron jobs (plan §3.1). Card 0.8 used
-- one of them (keepalive). pg_cron runs inside Postgres and doesn't
-- count against Vercel limits.
--
-- IDEMPOTENCY
-- The DO block below checks `cron.job` for an existing row with the
-- same jobname. If present, it returns the existing jobid (no-op).
-- If absent, it calls `cron.schedule(...)` which returns the new
-- jobid. Either way the result is the integer jobid — re-running
-- this migration is safe.
--
-- We use this DO-block pattern instead of `cron.unschedule(...)` +
-- `cron.schedule(...)` because unschedule is destructive and would
-- wipe the run history on every re-apply.
--
-- EXTENSION
-- pg_cron is NOT auto-installed. Operator must enable it once in the
-- Supabase dashboard: Database → Extensions → search "pg_cron" →
-- enable. Until then this migration fails at the `CREATE EXTENSION`
-- line below — which is the right failure mode (we want to know the
-- infra is wired, not silently skip).

-- ── 1. Extension ──────────────────────────────────────────────────────────────
-- Idempotent: the IF NOT EXISTS guards against re-runs after the
-- extension has been manually enabled in the dashboard.
CREATE EXTENSION IF NOT EXISTS pg_cron;--> statement-breakpoint

-- ── 2. Schedule the audit-pack-freshness-check job ────────────────────────────
-- Schedule: 04:00 UTC daily. Chosen to land in the quiet window between
-- the Vercel keepalive ping (card 0.8) and the start of the operator's
-- workday; cheap to run against a small v1 dataset.
--
-- Body: `SELECT 1` is a deliberate no-op. v1.5 will replace the body
-- with a real freshness check (e.g. compare last audit_pack.created_at
-- against a SLO threshold and post to a Slack webhook via pg_net or
-- raise a NOTICE for log scraping).
--
-- The DO block is the idempotency guard: second application returns
-- the existing jobid instead of failing with "duplicate key" from
-- cron.schedule's internal unique index on jobname.
--
-- Dollar-quote nesting: the OUTER `$$ ... $$` belongs to the DO
-- block, so the schedule-body string uses a tagged delimiter
-- `$body$ ... $body$` — Postgres requires the inner delimiter to
-- differ from the outer, and `$body$` is the conventional name.
DO $$
DECLARE
  existing_jobid integer;
BEGIN
  SELECT jobid INTO existing_jobid
  FROM cron.job
  WHERE jobname = 'audit-pack-freshness-check';

  IF existing_jobid IS NULL THEN
    PERFORM cron.schedule(
      'audit-pack-freshness-check',   -- jobname
      '0 4 * * *',                    -- schedule: 04:00 UTC daily
      $body$SELECT 1 -- stub; v1.5 replaces body with audit_pack freshness logic$body$
    );
  END IF;
END;
$$;--> statement-breakpoint

-- ── 3. Verify (read-only, not a hard assertion) ───────────────────────────────
-- The migration does NOT `ASSERT` the job exists — that would make
-- re-running noisy. Operators can verify manually:
--   SELECT * FROM cron.job WHERE jobname = 'audit-pack-freshness-check';
--   SELECT cron.run_job('audit-pack-freshness-check');
--   SELECT * FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job
--                    WHERE jobname = 'audit-pack-freshness-check')
--     ORDER BY start_time DESC LIMIT 5;
