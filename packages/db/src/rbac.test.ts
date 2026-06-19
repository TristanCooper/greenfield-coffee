// packages/db/src/rbac.test.ts
//
// Card 0.7 / plan §7.2 — integration test for the assertRole helper.
//
// THIS TEST REQUIRES A LIVE DATABASE.
//
// What we exercise (real Postgres, no mocks):
//
//   1. assertRole with a membership whose role IS in allowedRoles → resolves.
//   2. assertRole with a membership whose role is NOT in allowedRoles →
//      throws RbacError('FORBIDDEN').
//   3. assertRole with NO membership → throws RbacError('FORBIDDEN').
//   4. assertRole with a malformed UUID → throws RbacError('INTERNAL').
//   5. assertRole with empty allowedRoles → throws RbacError('INTERNAL').
//   6. RbacError is the right constructor (instanceof check).
//   7. getMembership / getFirstMembership return the right rows.
//
// Fixture strategy:
//   - Use two synthetic org ids + two synthetic user ids.
//   - The user/org rows don't need to exist in `organizations` /
//     `users` tables — the foreign key on `memberships.org_id` requires
//     the org to exist (FK violation otherwise), so we INSERT the org
//     rows too. The user FK is similarly required.
//   - Cleanup in afterEach drops all test fixture rows even if the test
//     crashes.
//
// WHY LIVE DB (NOT MOCKS):
//   The helper's whole contract is "look up the membership in
//   `public.memberships` and throw if the role doesn't match". Mocking
//   the database would test the dispatch logic, not the contract. The
//   pattern matches packages/db/src/rls.test.ts (live DB integration).
//
// WHY BYPASSRLS:
//   `unscopedDb` from src/rls.ts runs as the BYPASSRLS `postgres`
//   role — so the INSERTs in the fixture setup can run without
//   `app.org_id` being set. The membership read inside `assertRole`
//   is also unscoped (the comment in src/rbac.ts explains why: the
//   tenant scope isn't known until the role check itself has passed).

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import postgres from 'postgres';
import { unscopedDb } from './rls.js';
import {
  assertRole,
  getFirstMembership,
  getMembership,
  RbacError,
} from './rbac.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the rbac integration test. Copy .env.example to .env.',
  );
}

// Synthetic org + user ids (UUID v4 shape; never collide with real rows
// because we delete the fixture after each test).
const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_PACK_SHIP = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_COMPLIANCE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Admin client — BYPASSRLS so DDL/INSERTs work without `app.org_id`.
// Distinct from `db` (the typed Drizzle client) because the test
// deliberately exercises the unscoped path that the helper uses.
const adminSql = postgres(DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: 'require',
});

beforeAll(async () => {
  // Defensive cleanup — drop any leftover rows from a prior crashed run.
  await adminSql.unsafe(
    `DELETE FROM public.memberships WHERE org_id IN ('${ORG_A}', '${ORG_B}')`,
  );
  await adminSql.unsafe(
    `DELETE FROM public.organizations WHERE id IN ('${ORG_A}', '${ORG_B}')`,
  );
  await adminSql.unsafe(
    `DELETE FROM auth.users WHERE id IN ('${USER_OWNER}', '${USER_PACK_SHIP}', '${USER_COMPLIANCE}')`,
  );
});

afterEach(async () => {
  // Clean up after every test so the next test starts from a known state.
  // Order matters: memberships → organizations → auth.users (cascades to
  // public.users via the FK in 0001_auth_bridge.sql).
  await adminSql.unsafe(
    `DELETE FROM public.memberships WHERE org_id IN ('${ORG_A}', '${ORG_B}')`,
  );
  await adminSql.unsafe(
    `DELETE FROM public.organizations WHERE id IN ('${ORG_A}', '${ORG_B}')`,
  );
  await adminSql.unsafe(
    `DELETE FROM auth.users WHERE id IN ('${USER_OWNER}', '${USER_PACK_SHIP}', '${USER_COMPLIANCE}')`,
  );
});

afterAll(async () => {
  await adminSql.end();
});

/**
 * Seed the minimum fixture required by the rbac test: two orgs and
 * three auth.users rows (the trigger in 0001_auth_bridge.sql populates
 * public.users automatically when we insert into auth.users).
 *
 * We seed auth.users — NOT public.users directly — because public.users
 * has a FK to auth.users.id (added in 0001_auth_bridge.sql). The
 * `handle_new_auth_user` trigger then writes the mirror row. Membership
 * rows are seeded per-test so each test controls its own role.
 *
 * Required fields on auth.users come from Supabase's auth schema:
 *   instance_id, id, aud, role, email, raw_user_meta_data,
 *   raw_app_meta_data, created_at, updated_at.
 * Most are stable across Supabase versions; the bare minimum for an
 * INSERT is id + email + aud + role + created_at — the trigger reads
 * id, email, created_at.
 */
async function seedOrgs(): Promise<void> {
  await adminSql.unsafe(`
    INSERT INTO public.organizations (id, name, country_code, region, base_currency, data_residency)
    VALUES
      ('${ORG_A}', 'Test Org A', 'GB', 'GB', 'GBP', 'uk'),
      ('${ORG_B}', 'Test Org B', 'NL', 'NL', 'EUR', 'uk');
  `);
  // Seed auth.users — trigger populates public.users.
  await adminSql.unsafe(`
    INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
    VALUES
      ('00000000-0000-0000-0000-000000000000', '${USER_OWNER}', 'authenticated', 'authenticated', 'owner@test.example', '{}'::jsonb, '{"provider":"email"}'::jsonb, now(), now()),
      ('00000000-0000-0000-0000-000000000000', '${USER_PACK_SHIP}', 'authenticated', 'authenticated', 'pack@test.example', '{}'::jsonb, '{"provider":"email"}'::jsonb, now(), now()),
      ('00000000-0000-0000-0000-000000000000', '${USER_COMPLIANCE}', 'authenticated', 'authenticated', 'compliance@test.example', '{}'::jsonb, '{"provider":"email"}'::jsonb, now(), now());
  `);
}

async function seedMembership(
  orgId: string,
  userId: string,
  role: string,
): Promise<void> {
  await adminSql.unsafe(
    `INSERT INTO public.memberships (org_id, user_id, role) VALUES ('${orgId}', '${userId}', '${role}')`,
  );
}

describe('rbac — assertRole / getMembership / getFirstMembership', () => {
  it('passes when the user has a membership with a permitted role', async () => {
    await seedOrgs();
    await seedMembership(ORG_A, USER_COMPLIANCE, 'compliance_officer');

    await expect(
      assertRole(USER_COMPLIANCE, ORG_A, ['compliance_officer']),
    ).resolves.toBeUndefined();
  });

  it('passes when the role matches any entry in a multi-role allowlist', async () => {
    await seedOrgs();
    await seedMembership(ORG_A, USER_OWNER, 'owner');

    await expect(
      assertRole(USER_OWNER, ORG_A, ['compliance_officer', 'owner']),
    ).resolves.toBeUndefined();
  });

  it("throws RbacError('FORBIDDEN') when the user's role is not in the allowlist", async () => {
    await seedOrgs();
    // pack_ship user — allowedRoles requires compliance_officer.
    await seedMembership(ORG_A, USER_PACK_SHIP, 'pack_ship');

    // Acceptance criterion (card body):
    //   "user with role='pack_ship' calling a procedure guarded by
    //    ['compliance_officer'] gets a FORBIDDEN error"
    let caught: unknown;
    try {
      await assertRole(USER_PACK_SHIP, ORG_A, ['compliance_officer']);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RbacError);
    expect((caught as RbacError).code).toBe('FORBIDDEN');
  });

  it("throws RbacError('FORBIDDEN') when the user has no membership at all", async () => {
    await seedOrgs();
    // No membership row for USER_OWNER.

    let caught: unknown;
    try {
      await assertRole(USER_OWNER, ORG_A, ['owner']);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RbacError);
    expect((caught as RbacError).code).toBe('FORBIDDEN');
  });

  it("throws RbacError('INTERNAL') on malformed userId", async () => {
    await expect(
      assertRole('not-a-uuid', ORG_A, ['owner']),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it("throws RbacError('INTERNAL') on malformed orgId", async () => {
    await expect(
      assertRole(USER_OWNER, 'definitely-not-a-uuid', ['owner']),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it("throws RbacError('INTERNAL') on empty allowedRoles", async () => {
    await expect(
      assertRole(USER_OWNER, ORG_A, []),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('getMembership returns the row when present', async () => {
    await seedOrgs();
    await seedMembership(ORG_A, USER_COMPLIANCE, 'compliance_officer');

    const m = await getMembership(USER_COMPLIANCE, ORG_A);
    expect(m).not.toBeNull();
    expect(m?.role).toBe('compliance_officer');
    expect(m?.org_id).toBe(ORG_A);
    expect(m?.user_id).toBe(USER_COMPLIANCE);
  });

  it('getMembership returns null when no membership exists', async () => {
    await seedOrgs();
    expect(await getMembership(USER_OWNER, ORG_A)).toBeNull();
  });

  it('getFirstMembership returns the oldest membership across orgs', async () => {
    await seedOrgs();
    // Two memberships for USER_OWNER — one in each org.
    await seedMembership(ORG_A, USER_OWNER, 'owner');
    // Force a different created_at on the second membership by sleeping
    // a millisecond. Postgres timestamptz precision is microseconds, so
    // a 2ms gap is safely distinguishable.
    await new Promise((r) => setTimeout(r, 5));
    await seedMembership(ORG_B, USER_OWNER, 'readonly');

    const first = await getFirstMembership(USER_OWNER);
    expect(first?.org_id).toBe(ORG_A);
    expect(first?.role).toBe('owner');
  });

  it("verifies the compliance_officer enum value is assignable (smoke)", async () => {
    // The card body acceptance criterion:
    //   "'compliance_officer' role exists in the enum and can be
    //    assigned (smoke: insert a Membership with role='compliance_officer')"
    // The seedMembership call above already exercises this; we make
    // it explicit here for the test report.
    await seedOrgs();
    await seedMembership(ORG_A, USER_COMPLIANCE, 'compliance_officer');
    const m = await getMembership(USER_COMPLIANCE, ORG_A);
    expect(m?.role).toBe('compliance_officer');
  });

  it('RbacError is thrown by reference (not by string match)', async () => {
    // Belt-and-braces: the error type is the contract. Test it.
    await seedOrgs();
    await seedMembership(ORG_A, USER_PACK_SHIP, 'pack_ship');
    try {
      await assertRole(USER_PACK_SHIP, ORG_A, ['compliance_officer']);
      throw new Error('assertRole should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RbacError);
      expect((e as RbacError).name).toBe('RbacError');
      expect((e as RbacError).code).toBe('FORBIDDEN');
      expect((e as RbacError).message).toContain(USER_PACK_SHIP);
    }
  });

  it('CHECK constraint blocks data_residency values outside the allowlist', async () => {
    // Sanity check on the DDL generated by drizzle-kit for card 0.7.
    // Direct INSERT with a bad data_residency should be rejected by
    // the CHECK constraint, not silently coerced.
    await expect(
      unscopedDb(
        `INSERT INTO public.organizations (id, name, country_code, region, base_currency, data_residency)
         VALUES ('33333333-3333-4333-8333-333333333333', 'bad', 'FR', 'FR', 'EUR', 'eu')`,
      ),
    ).rejects.toThrow(/data_residency_check|check constraint/i);
  });

  it('CHECK constraint blocks base_currency outside the EUR/GBP allowlist', async () => {
    await expect(
      unscopedDb(
        `INSERT INTO public.organizations (id, name, country_code, region, base_currency, data_residency)
         VALUES ('44444444-4444-4444-8444-444444444444', 'bad', 'US', 'FR', 'USD', 'uk')`,
      ),
    ).rejects.toThrow(/base_currency_check|check constraint/i);
  });

  it('CHECK constraint blocks region outside the 16 UK/EU codes', async () => {
    await expect(
      unscopedDb(
        `INSERT INTO public.organizations (id, name, country_code, region, base_currency, data_residency)
         VALUES ('55555555-5555-4555-8555-555555555555', 'bad', 'JP', 'JP', 'EUR', 'uk')`,
      ),
    ).rejects.toThrow(/region_check|check constraint/i);
  });
});