// packages/db/src/rls.ts
//
// Card 0.6 / plan §7.2 — tenant-scoped query wrapper.
//
// API:
//   withTenant(orgId, async (txDb) => ...)
//     Opens a Postgres transaction, calls `public.set_tenant_context(orgId)`
//     inside it (which `SET LOCAL`s the `app.org_id` GUC), runs the
//     callback with a `txDb` handle bound to that transaction, then
//     commits. Every query in the callback sees the tenant; on commit
//     the GUC evaporates and the connection returns to the pool.
//
//   unscopedDb(sql, ...args)
//     Escape hatch — runs raw SQL as the BYPASSRLS `postgres` role with
//     no tenant scoping. Use ONLY for global lookups that legitimately
//     need to bypass RLS (e.g. reading the Organization row itself
//     before tenancy is known — added in card 0.7). Comments justifying
//     each call are mandatory; ESLint enforcement lands later.
//
// Why this shape (deviation from the card body):
//
//   The card body sketched a `connection-acquisition wrapper` using
//   AsyncLocalStorage so app code could write `db.query.users...` and
//   have the tenant bound automatically. That design assumes one
//   server-side Postgres connection per request, which is the
//   session-mode pooler contract.
//
//   Supabase's free-tier pooler runs in TRANSACTION mode — it reuses
//   a single backend Postgres connection across MANY requests to amortise
//   the connection cost. A session-scoped GUC set on connection
//   acquisition would leak the previous tenant's id into the next
//   request that picks up the connection (cross-org data exposure).
//
//   The only safe pattern with transaction-mode pooling is per-request
//   transactions with `SET LOCAL` (the GUC is scoped to the
//   transaction, dies on commit). `withTenant(orgId, fn)` is the
//   minimal wrapper: open tx → set_config('app.org_id', $1, true) →
//   run fn → commit.
//
//   The Drizzle `db` export from ./client.js remains available for
//   unscoped paths (migrations, scripts, the Organization lookup
//   before tenancy is known). App code in apps/web that queries
//   tenant-scoped tables MUST go through `withTenant` so the
//   transaction is in scope.

import postgres from 'postgres';

/**
 * Tagged-template query result type — `postgres-js` returns rows as
 * objects keyed by column name. The test asserts on `label` (string)
 * so a generic `Record<string, unknown>` is sufficient at this layer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * Handle passed to a `withTenant` callback. Wraps a postgres-js
 * `TransactionSql` with the two query shapes we actually use in app
 * code:
 *
 *   - `tx\`SELECT ${id} FROM x\`` — tagged-template form. Preferred for
 *     new code; the template tag gives automatic parameter binding and
 *     prevents SQL injection at the parameter boundary.
 *   - `tx.unsafe('SELECT $1', [id])` — raw SQL with positional params.
 *     Use for dynamic SQL built at runtime (e.g. conditional WHERE
 *     clauses) where a tagged template would be awkward.
 *
 * Drizzle's `db.transaction(async (tx) => ...)` API can be added on
 * top of this in a follow-up card once the first RLS-protected table
 * is wired (card 0.9+).
 */
export interface TenantDb {
  /** Tagged-template query. */
  <T extends Row = Row>(
    template: TemplateStringsArray,
    ...parameters: readonly unknown[]
  ): Promise<readonly T[]>;
  /**
   * Raw SQL with positional parameters.
   * Mirrors postgres-js's `sql.unsafe(query, params)` shape.
   */
  unsafe<T extends Row = Row>(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<readonly T[]>;
}

// Module-level pooler client. Single shared connection per Node process
// matches the `db` singleton in client.js — postgres-js's `max:1` per
// invocation is the Vercel-serverless sweet spot, but inside a single
// Node process (tests, scripts, a Vercel function's warm container) we
// want to amortise the TLS handshake + auth round-trip across requests.
//
// We don't expose this handle — every call goes through withTenant
// (tenant-scoped) or unscopedDb (admin), both of which wrap it in a
// transaction or `unsafe` call. That keeps the tenant invariant
// unmissable.
let _pooler: postgres.Sql | null = null;
function pooler(): postgres.Sql {
  if (_pooler) return _pooler;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill from ' +
        'Supabase → Settings → Database → Connection string → Transaction (pooler).',
    );
  }
  _pooler = postgres(url, { max: 1, prepare: false, ssl: 'require' });
  return _pooler;
}

/**
 * Run `fn` inside a transaction with `app.org_id` set to `orgId` via
 * `public.set_tenant_context(orgId)`.
 *
 * The transaction commits if `fn` resolves, rolls back if it throws
 * (postgres-js's `sql.begin` contract). The GUC `app.org_id` is bound
 * to this transaction because the migration uses
 * `set_config(..., true)` (LOCAL); it does NOT leak to subsequent
 * transactions on the same connection.
 *
 * @param orgId - The tenant id. Throws synchronously if it isn't a
 *   valid UUID string — matches the `uuid` type the migration
 *   signature requires.
 * @param fn - Async callback receiving the tenant-scoped handle.
 *   Throw from `fn` to roll the transaction back.
 */
export async function withTenant<T>(
  orgId: string,
  fn: (txDb: TenantDb) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(orgId)) {
    throw new Error(
      `withTenant: orgId must be a UUID string, got ${JSON.stringify(orgId)}`,
    );
  }
  return pooler().begin(async (tx) => {
    // Set the tenant GUC AND switch to a non-BYPASSRLS role so the
    // RLS policies we add in cards 0.9 / 0.10 / 0.11 actually filter
    // rows. Both `SET LOCAL ROLE` and `set_config(..., true)` are
    // transaction-scoped — they evaporate on COMMIT, so the next
    // request that picks up the same pooler connection starts fresh.
    //
    // Why `authenticated`, not `anon`: the auth-bridge migration
    // (0001) already grants `authenticated` access to `public.users`,
    // and every subsequent RLS policy will be written with the
    // assumption that an end-user request runs as `authenticated`.
    // `anon` is for unauthenticated traffic (public marketing pages)
    // and has different grants.
    await tx`SET LOCAL ROLE authenticated`;
    await tx`SELECT public.set_tenant_context(${orgId}::uuid)`;
    const result = await fn(tx as unknown as TenantDb);
    return result as unknown as undefined;
  }) as Promise<T>;
}

/**
 * Run raw SQL outside any tenant scope. Bypasses RLS because the
 * caller is still the BYPASSRLS `postgres` role from the pooler.
 *
 * ONLY use for global lookups (Organization row before tenancy is
 * known, admin scripts, etc). Each call MUST have a justifying
 * comment at the call site — the card body specifies ESLint
 * enforcement later.
 */
export async function unscopedDb<T extends Row = Row>(
  query: string,
  ...values: readonly unknown[]
): Promise<readonly T[]> {
  // postgres-js's `unsafe` types its second arg as
  // `ParameterOrJSON<never>[]`. The runtime accepts arbitrary serialisable
  // values; the cast is safe because the wire protocol serialises via
  // JSON for objects and a tagged-format string for primitives. The
  // runtime also doesn't mutate the array, so the ReadonlyArray →
  // mutable-array widening is safe at runtime.
  const rows = await pooler().unsafe(query, values as never);
  return rows as unknown as readonly T[];
}

// ── Internal helpers ────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;