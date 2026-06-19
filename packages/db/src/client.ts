// @greenfield/db — runtime client
//
// Card 0.4. Wires the postgres-js driver + drizzle wrapper. The exported `db`
// is what `apps/web` (and future packages) import for typed queries.
//
// Runtime (Next.js on Vercel): DATABASE_URL — pooler, port 6543.
//   Serverless functions get many short-lived connections; the pooler amortises
//   the postgres-side cost. Transaction mode is fine for SELECT/INSERT/UPDATE.
//
// Migrations / scripts: use drizzle-kit directly (drizzle.config.ts reads
// DATABASE_URL_DIRECT — port 5432, bypasses pgBouncer so DDL + prepared
// statements don't trip transaction-mode quirks).
//
// Driver choice: postgres-js over node-postgres because:
//   1. Smaller cold-start on Vercel hobby tier (the original reason in the
//      card body).
//   2. Native tagged-template-literal query API pairs cleanly with Drizzle's
//      `sql` template — no pg-format translation layer.
//   3. Built-in connection pooling with sensible defaults for serverless
//      (`max: 1` per invocation + `idle_timeout: 20` is what Vercel wants).
//
// Both env vars are operator-loaded; this module does NOT read .env at runtime
// (Vercel injects process.env directly). drizzle.config.ts DOES read .env
// because drizzle-kit runs from the operator shell.
//
// RLS / tenancy (card 0.6):
//
//   `db` is connected as the `postgres` role, which has BYPASSRLS. Reading or
//   writing tenant-scoped tables through this handle will return / mutate ALL
//   rows regardless of the requesting user — that's the wrong behaviour for
//   app code. For tenant-scoped queries use `withTenant(orgId, async (tx) =>
//   ...)` from ./rls.js, which opens a transaction, sets the `app.org_id`
//   GUC, and switches to the `authenticated` role so RLS policies apply.
//
//   Reach for `db` directly only for:
//     - migrations and `db:generate` (these have their own connection)
//     - global lookups that legitimately pre-date tenancy (card 0.7's
//       Organisation lookup)
//     - tests against an unscoped fixture

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and fill from ' +
      'Supabase → Settings → Database → Connection string → Transaction (pooler).',
  );
}

// `max: 1` is the serverless rule — each Vercel function invocation gets one
// connection. Higher numbers exhaust Supabase free-tier connection limits fast.
// `prepare: false` is the second pgBouncer rule for transaction-mode poolers:
// prepared statements need session affinity, which transaction-mode can't give.
const client = postgres(url, { max: 1, prepare: false });

export const db: PostgresJsDatabase<typeof schema> = drizzle(client, { schema });
export type Db = typeof db;
