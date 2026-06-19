# @greenfield/db

Database access layer for Greenfield. Drizzle ORM over postgres-js, pointed
at the Supabase Postgres (eu-west-2) provisioned in card 0.3.

## Two ways to query

| Path | Role | RLS | Use for |
| ---- | ---- | --- | ------- |
| `withTenant(orgId, fn)`     | `authenticated` | enforced | All tenant-scoped reads / writes (the only safe path for app code). |
| `db` (Drizzle, from `./client.js`) | `postgres` (BYPASSRLS) | bypassed | Migrations, scripts, global lookups (Organisation row before tenancy is known — card 0.7). |
| `unscopedDb(sql, params)`   | `postgres` (BYPASSRLS) | bypassed | One-off admin SQL with the same caveats as `db`. |

`withTenant` opens an explicit transaction, calls `public.set_tenant_context(orgId)`
(which `SET LOCAL`s `app.org_id`), and runs the callback with a transaction-bound
`TenantDb` handle. The setting evaporates on commit — safe across the Supabase
pooler's transaction-mode connection reuse.

```ts
import { withTenant } from '@greenfield/db';

const orgUsers = await withTenant(orgId, async (tx) => {
  return tx.unsafe<User>(
    'SELECT id, email FROM users WHERE org_id = $1 ORDER BY created_at',
    [orgId],
  );
});
```

## How to add a table + migrate

1. **Define the entity** in `src/schema/<name>.ts` using `pgTable(...)` from
   `drizzle-orm/pg-core`. PostGIS / pgcrypto opaque types land in
   `src/schema/_custom-types.ts` (card 0.5 introduces them).
2. **Re-export** the entity from `src/schema/index.ts` so the runtime `db`
   picks it up for type inference (`PostgresJsDatabase<typeof schema>`).
3. **Add RLS policies** in the same migration that creates the table. Card
   0.6 ships the `app.org_id` plumbing; the per-table policies arrive in
   cards 0.9 / 0.10 / 0.11.
4. **Generate the migration** from the repo root:
   ```bash
   pnpm db:generate
   ```
   This writes a new `NNNN_<name>.sql` to `src/migrations/`. Commit the SQL
   alongside any changes to the schema TS files — the SQL diff is what PRs
   review.
5. **Apply** from the operator shell (uses `DATABASE_URL_DIRECT`, port 5432
   — bypasses pgBouncer so prepared statements and DDL don't trip
   transaction-mode quirks):
   ```bash
   pnpm db:migrate
   ```
6. **Inspect** in the browser-based Drizzle Studio (opens on a local port,
   talks to Supabase over the direct URL):
   ```bash
   pnpm db:studio
   ```

## Env

`src/client.ts` reads `DATABASE_URL` (pooler) at runtime — Vercel injects
it. `drizzle.config.ts` reads `DATABASE_URL_DIRECT` — the operator loads
it via `.env` (see `../../SUPABASE.md` for the loading step) or CI injects
it directly.

## pg_cron jobs

Supabase ships the `pg_cron` extension (free-tier-eligible) which runs
scheduled SQL inside Postgres. We use it for jobs that would otherwise
burn a Vercel Cron slot (Hobby tier caps at 2 — card 0.8 uses one for
keepalive). Operator enables pg_cron once in the Dashboard:
**Database → Extensions → "pg_cron" → Enable**. After that, migrations
under `src/migrations/0004_*` schedule jobs idempotently.

| Jobname                       | Schedule (UTC) | Body                                              | Migration | Status                  |
| ----------------------------- | -------------- | ------------------------------------------------- | --------- | ----------------------- |
| `audit-pack-freshness-check`  | `0 4 * * *`    | `SELECT 1` (no-op; v1.5 replaces body)            | `0004`    | stub — audit logic in v1.5 |

Inspect / run from psql:

```sql
-- List all jobs
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobid;

-- Run a job immediately (returns the same jobid; logged in cron.job_run_details)
-- NOTE: Supabase's pinned pg_cron build does NOT ship cron.run_job().
-- The available API is `cron.alter_job(jobid, schedule := '* * * * *')`
-- to bump the schedule to "every minute", then revert. The job will
-- fire on the next cron tick and land in cron.job_run_details.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'audit-pack-freshness-check'),
  schedule := '* * * * *'
);
-- ...wait ~60s, then verify:
-- SELECT cron.alter_job(
--   (SELECT jobid FROM cron.job WHERE jobname = 'audit-pack-freshness-check'),
--   schedule := '0 4 * * *'
-- );

-- Recent run history (last 5)
SELECT start_time, end_time, status, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job
               WHERE jobname = 'audit-pack-freshness-check')
ORDER BY start_time DESC LIMIT 5;
```

## When to use the pooler vs direct

| Operation                        | Use             |
| -------------------------------- | --------------- |
| `select` / `insert` / `update`   | `DATABASE_URL`  |
| Drizzle Studio                   | `DATABASE_URL_DIRECT` |
| `drizzle-kit migrate` / `push`   | `DATABASE_URL_DIRECT` |
| One-off psql scripts             | `DATABASE_URL_DIRECT` |
