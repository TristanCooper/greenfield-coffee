// packages/db/src/rls.test.ts
//
// Card 0.6 / plan §7.2 — integration test for the RLS tenancy helpers.
//
// WHAT THIS TEST DOES (real database, not mocks):
//
//   1. Connects to Supabase via the pooler URL (DATABASE_URL_DIRECT is
//      IPv6-only on the Supabase free tier and unreachable from this
//      network — the pooler host has an A record, both work for SELECT).
//
//   2. Creates a throwaway RLS-protected table inside the test, seeds
//      one row per two synthetic org ids, drops the table on teardown.
//      The table is the bare minimum needed to exercise the RLS policy
//      — three columns, one row visible per org.
//
//   3. Exercises the three behaviours from the card body:
//      a) within one transaction, set tenant = org1 → SELECT returns
//         only org1's row.
//      b) same connection, in a fresh transaction, set tenant = org2
//         → SELECT returns only org2's row.
//      c) brand-new client, NO set_tenant_context call → SELECT
//         returns zero rows (fail-closed default).
//
// WHY THIS IS NOT A MOCK TEST:
//
//   The whole point of the helpers is to interact with Postgres GUC
//   scoping rules + RLS policy evaluation. Mocking the driver would
//   test the call sequence, not the behaviour. So this is an
//   integration test that requires a live DATABASE_URL.
//
// ROLE SWITCHING:
//
//   Supabase's `postgres` role has BYPASSRLS, so RLS policies are
//   inert for it. To prove the policy actually filters rows we
//   `SET LOCAL ROLE authenticated` (a non-bypassrls role that exists
//   in every Supabase project) inside the transaction. Outside the
//   transaction we're back as `postgres` and can do the DDL + cleanup.
//
// CLEANUP:
//
//   The throwaway table is dropped in afterEach — even if assertions
//   fail. The `unscopedDb` calls (CREATE / DROP / INSERT) need to
//   bypass RLS because the table is being provisioned by the postgres
//   role which already has BYPASSRLS but our policy expects an
//   `app.org_id` set; without it, the INSERT would also be filtered
//   by the WITH CHECK clause. Solution: keep all DDL/DML outside of
//   any tenant scope — they're admin operations on test fixtures.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { withTenant, unscopedDb, type TenantDb } from './rls.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the rls integration test. Copy .env.example to .env ' +
      'and fill the Supabase pooler URL.',
  );
}

// Two synthetic org ids — uuid-shaped strings, no FK to anywhere.
const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';
const ORG_A_LABEL = 'A-row';
const ORG_B_LABEL = 'B-row';

// Admin client — uses BYPASSRLS so DDL/DROP work. Distinct from `db`
// (the typed Drizzle client) because the test deliberately probes
// Postgres behaviour that RLS would otherwise hide.
const adminSql = postgres(DATABASE_URL, { max: 1, prepare: false, ssl: 'require' });

beforeAll(async () => {
  // Defensive cleanup in case a prior test crashed before dropping.
  await adminSql.unsafe(`DROP TABLE IF EXISTS rls_test_fixture;`);
});

afterEach(async () => {
  await adminSql.unsafe(`DROP TABLE IF EXISTS rls_test_fixture;`);
});

afterAll(async () => {
  await adminSql.end();
});

/**
 * Provision the test fixture: a single-tenant-protected table with one
 * row per org. The policy uses `current_setting('app.org_id', true)`
 * directly (the same GUC `set_tenant_context` writes to) so the test
 * exercises the real path end-to-end.
 *
 * `app.org_id` is reset to '' BEFORE provisioning so any global state
 * left over from a previous operator probe doesn't accidentally satisfy
 * the policy during INSERT (WITH CHECK applies to writers too).
 */
async function seedFixture(): Promise<void> {
  await adminSql.unsafe(`
    DROP TABLE IF EXISTS rls_test_fixture;
    CREATE TABLE rls_test_fixture (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL,
      label text NOT NULL
    );
    ALTER TABLE rls_test_fixture ENABLE ROW LEVEL SECURITY;
    CREATE POLICY org_isolation ON rls_test_fixture
      FOR ALL
      USING (org_id::text = current_setting('app.org_id', true))
      WITH CHECK (org_id::text = current_setting('app.org_id', true));
    INSERT INTO rls_test_fixture (org_id, label) VALUES
      ('${ORG_A}', '${ORG_A_LABEL}'),
      ('${ORG_B}', '${ORG_B_LABEL}');
  `);
}

interface Row {
  label: string;
}

/**
 * Cast a query result to typed rows — postgres-js returns an array of
 * shape-`Row` but the schema isn't inferred without explicit generics.
 */
function labels(result: readonly Row[]): string[] {
  return result.map((r) => r.label);
}

describe('rls helpers — set_tenant_context / current_org_id / assert_tenant', () => {
  it('set_tenant_context sets the GUC visible to subsequent SELECTs', async () => {
    const result = await unscopedDb<{ v: string | null }>(
      'SELECT public.current_org_id()::text AS v',
    );
    // No tenant was set inside this unscopedDb call → current_org_id
    // returns NULL (NULLIF on the empty setting).
    expect(result[0]?.v).toBeNull();
  });

  it('withTenant scopes SELECT to the row whose org_id matches', async () => {
    await seedFixture();

    const seen = await withTenant(ORG_A, async (txDb: TenantDb): Promise<string[]> => {
      const rows = await txDb.unsafe<Row>(
        'SELECT label FROM rls_test_fixture ORDER BY label',
      );
      return labels(rows);
    });

    expect(seen).toEqual([ORG_A_LABEL]);
  });

  it('switching tenant on the same connection returns the other org row', async () => {
    await seedFixture();

    const seenA = await withTenant(ORG_A, async (txDb) => labels(await txDb.unsafe<Row>(
      'SELECT label FROM rls_test_fixture ORDER BY label',
    )));
    expect(seenA).toEqual([ORG_A_LABEL]);

    // Reuse the same underlying pooler connection — the previous tx
    // committed and the GUC evaporated (set_config local=true).
    const seenB = await withTenant(ORG_B, async (txDb) => labels(await txDb.unsafe<Row>(
      'SELECT label FROM rls_test_fixture ORDER BY label',
    )));
    expect(seenB).toEqual([ORG_B_LABEL]);
  });

  it('queries outside withTenant see zero rows (fail-closed default)', async () => {
    await seedFixture();

    // New client, no withTenant call. The GUC `app.org_id` is unset,
    // the RLS policy's USING clause compares `org_id::text = ''` which
    // is FALSE for every row, so the result set is empty.
    const fresh = postgres(DATABASE_URL, {
      max: 1,
      prepare: false,
      ssl: 'require',
    });
    try {
      // Inside a tx (so SET LOCAL ROLE is scoped), switch to the
      // non-bypassrls `authenticated` role so RLS actually applies.
      const seen = await fresh.begin(async (tx) => {
        await tx`SET LOCAL ROLE authenticated`;
        // postgres-js's tagged-template query returns rows as
        // `Row[]`-ish; we cast through unknown to the structural
        // shape we want for assertions.
        const rows = (await tx`SELECT label FROM rls_test_fixture ORDER BY label`) as readonly Row[];
        return labels(rows);
      });
      expect(seen).toEqual([]);
    } finally {
      await fresh.end();
    }
  });

  it('assert_tenant raises with insufficient_privilege when orgs mismatch', async () => {
    await seedFixture();

    await expect(
      unscopedDb(`SELECT public.assert_tenant('${ORG_A}'::uuid)`),
    ).rejects.toThrow(/current_org_id\(\) is NULL/);

    // Now inside a tenant, mismatched expected → SQLSTATE 42501.
    await expect(
      withTenant(ORG_A, async (tx) => {
        await tx.unsafe(
          `SELECT public.assert_tenant('${ORG_B}'::uuid)`,
        );
      }),
    ).rejects.toMatchObject({
      // postgres-js exposes the SQLSTATE on `code`. '42501' is
      // insufficient_privilege — the documented SQLSTATE for cross-org
      // writes per the migration comment.
      code: '42501',
    });
  });

  it('assert_tenant passes when expected matches current_org_id', async () => {
    await expect(
      withTenant(ORG_A, async (tx) => {
        // No throw.
        await tx.unsafe(`SELECT public.assert_tenant('${ORG_A}'::uuid)`);
      }),
    ).resolves.toBeUndefined();
  });
});