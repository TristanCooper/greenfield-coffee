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

## When to use the pooler vs direct

| Operation                        | Use             |
| -------------------------------- | --------------- |
| `select` / `insert` / `update`   | `DATABASE_URL`  |
| Drizzle Studio                   | `DATABASE_URL_DIRECT` |
| `drizzle-kit migrate` / `push`   | `DATABASE_URL_DIRECT` |
| One-off psql scripts             | `DATABASE_URL_DIRECT` |
