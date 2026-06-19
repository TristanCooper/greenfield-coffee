// packages/db/src/organizations.test.ts
//
// Card 0.7 / plan §7.2 — integration test for createOrganization.
//
// THIS TEST REQUIRES A LIVE DATABASE.
//
// What we exercise:
//
//   1. createOrganization succeeds with valid input → returns { orgId, membershipId,
//      organization, auditRecorded: false } (audit table doesn't exist yet
//      in card 0.7).
//   2. createOrganization creates exactly one Organization row + one
//      Membership row with role='owner'.
//   3. createOrganization rejects invalid input with CreateOrganizationError.
//   4. createOrganization rejects missing user with CreateOrganizationError.
//   5. CHECK constraint rejects invalid base_currency / region /
//      data_residency values at the DB layer.
//   6. The audit_event fallback path (table doesn't exist) does NOT
//      block the org + membership creation — it logs and continues.
//
// Fixture strategy:
//   - Insert an auth.users row per test (the trigger in
//     0001_auth_bridge.sql populates public.users). Cleanup deletes
//     auth.users → cascades to public.users → memberships → org.
//   - Each test uses a fresh uuid suffix so parallel test runs and
//     leftover rows don't collide.
//
// WHAT THIS TEST DOES NOT DO:
//   - Mock the database — createOrganization is a Postgres-backed
//     function and the contract is the SQL behaviour. Mocks would test
//     the dispatch logic, not the contract.
//   - Test the audit_event INSERT success path — card 0.12 ships the
//     audit table; the best-effort fallback is what 0.7 exercises.

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import postgres from 'postgres';
import {
  createOrganization,
} from './organizations.js';
import { getFirstMembership } from './rbac.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the organizations integration test. Copy .env.example to .env.',
  );
}

// Admin client — BYPASSRLS so DDL/INSERTs work without `app.org_id`.
const adminSql = postgres(DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: 'require',
});

// Track user_ids we create so afterEach can clean them up.
const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

beforeAll(async () => {
  // Defensive cleanup of any stragglers from a prior crash.
  await adminSql.unsafe(
    `DELETE FROM public.memberships WHERE user_id IN (SELECT id FROM public.users WHERE email LIKE 'orgtest-%')`,
  );
  await adminSql.unsafe(`DELETE FROM public.users WHERE email LIKE 'orgtest-%'`);
});

afterEach(async () => {
  for (const orgId of createdOrgIds.splice(0)) {
    await adminSql.unsafe(`DELETE FROM public.organizations WHERE id = '${orgId}'`);
  }
  for (const userId of createdUserIds.splice(0)) {
    await adminSql.unsafe(`DELETE FROM auth.users WHERE id = '${userId}'`);
  }
});

afterAll(async () => {
  await adminSql.end();
});

/**
 * Create an auth.users row (trigger populates public.users). Returns
 * the new user_id. The email is suffixed with the timestamp so
 * concurrent runs don't collide on the auth.users.email UNIQUE.
 */
async function seedUser(): Promise<string> {
  const id = crypto.randomUUID();
  const email = `orgtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.example`;
  await adminSql.unsafe(
    `INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
     VALUES ('00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
             '${email}', '{}'::jsonb, '{"provider":"email"}'::jsonb, now(), now())`,
  );
  createdUserIds.push(id);
  return id;
}

const validInput = {
  name: 'Test Roastery Ltd',
  countryCode: 'GB' as const,
  region: 'GB' as const,
  baseCurrency: 'GBP' as const,
};

describe('createOrganization — happy path', () => {
  it('returns orgId, membershipId, organization, auditRecorded=false (pre-0.12)', async () => {
    const userId = await seedUser();
    const result = await createOrganization(validInput, { userId });

    expect(result.orgId).toMatch(UUID_RE);
    expect(result.membershipId).toMatch(UUID_RE);
    expect(result.organization.name).toBe('Test Roastery Ltd');
    expect(result.organization.countryCode).toBe('GB');
    expect(result.organization.region).toBe('GB');
    expect(result.organization.baseCurrency).toBe('GBP');
    expect(result.organization.dataResidency).toBe('uk');
    // audit_event table doesn't exist yet (card 0.12); the
    // best-effort INSERT swallows the 42P01 and we record
    // auditRecorded=false so the route handler can surface a
    // warning to the operator (and to the audit-event dashboard
    // when it lands).
    expect(result.auditRecorded).toBe(false);

    createdOrgIds.push(result.orgId);
  });

  it('persists one Organization row + one Membership row with role=owner', async () => {
    const userId = await seedUser();
    const result = await createOrganization(validInput, { userId });
    createdOrgIds.push(result.orgId);

    const orgs = await adminSql.unsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM public.organizations WHERE id = '${result.orgId}'`,
    );
    expect(orgs).toHaveLength(1);

    const members = await adminSql.unsafe<{ role: string }[]>(
      `SELECT role::text FROM public.memberships WHERE org_id = '${result.orgId}' AND user_id = '${userId}'`,
    );
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe('owner');
  });

  it('getFirstMembership returns the new owner membership', async () => {
    const userId = await seedUser();
    const result = await createOrganization(validInput, { userId });
    createdOrgIds.push(result.orgId);

    const first = await getFirstMembership(userId);
    expect(first).not.toBeNull();
    expect(first?.org_id).toBe(result.orgId);
    expect(first?.role).toBe('owner');
  });

  it('accepts EUR base_currency with an EU country_code', async () => {
    const userId = await seedUser();
    const result = await createOrganization(
      {
        name: 'Amsterdam Roastery',
        countryCode: 'NL',
        region: 'NL',
        baseCurrency: 'EUR',
      },
      { userId },
    );
    createdOrgIds.push(result.orgId);

    expect(result.organization.baseCurrency).toBe('EUR');
    expect(result.organization.region).toBe('NL');
  });

  it('honours a custom eudr_settings override', async () => {
    const userId = await seedUser();
    const result = await createOrganization(
      {
        ...validInput,
        eudrSettings: {
          small_quantity_threshold_kg: 2.5,
          default_mode: 'flag_only',
          country_risk_list: 'static_v1',
        },
      },
      { userId },
    );
    createdOrgIds.push(result.orgId);

    // The TS shape mirrors the JSON keys (snake_case) — same as the
    // PRD §5.2 and the card body.
    expect(result.organization.eudrSettings.small_quantity_threshold_kg).toBe(2.5);
    expect(result.organization.eudrSettings.default_mode).toBe('flag_only');
  });
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('createOrganization — input validation', () => {
  it("rejects empty name with CreateOrganizationError('INVALID_INPUT')", async () => {
    const userId = await seedUser();
    await expect(
      createOrganization({ ...validInput, name: '   ' }, { userId }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects name longer than 200 characters', async () => {
    const userId = await seedUser();
    await expect(
      createOrganization(
        { ...validInput, name: 'a'.repeat(201) },
        { userId },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it("rejects unsupported country_code with CreateOrganizationError('INVALID_INPUT')", async () => {
    const userId = await seedUser();
    // Cast to bypass TS — we're testing the runtime guard.
    await expect(
      createOrganization(
        { ...validInput, countryCode: 'US' as never, region: 'US' as never },
        { userId },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects region/country_code mismatch', async () => {
    const userId = await seedUser();
    await expect(
      createOrganization(
        { ...validInput, countryCode: 'NL', region: 'GB' },
        { userId },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it("rejects USD base_currency with CreateOrganizationError('INVALID_INPUT')", async () => {
    const userId = await seedUser();
    await expect(
      createOrganization(
        { ...validInput, baseCurrency: 'USD' as never },
        { userId },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it("rejects missing user with CreateOrganizationError('USER_NOT_FOUND')", async () => {
    const ghostUserId = crypto.randomUUID();
    // Don't seed the user — assertRole-style verification fires.
    await expect(
      createOrganization(validInput, { userId: ghostUserId }),
    ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it("rejects malformed userId with CreateOrganizationError('INVALID_INPUT')", async () => {
    await expect(
      createOrganization(validInput, { userId: 'not-a-uuid' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('createOrganization — CHECK constraints (defence in depth)', () => {
  // Even if the input validator were bypassed, the DB CHECK
  // constraints must reject bad values. This is the "invalid states
  // are unrepresentable" guarantee (plan §3).
  it('rejects base_currency=USD at the DB layer', async () => {
    const orgId = crypto.randomUUID();
    await expect(
      adminSql.unsafe(
        `INSERT INTO public.organizations (id, name, country_code, region, base_currency)
         VALUES ('${orgId}', 'bad', 'FR', 'FR', 'USD')`,
      ),
    ).rejects.toThrow(/base_currency_check|check constraint/i);
  });

  it('rejects data_residency=eu at the DB layer (v1 constraint)', async () => {
    const orgId = crypto.randomUUID();
    await expect(
      adminSql.unsafe(
        `INSERT INTO public.organizations (id, name, country_code, region, base_currency, data_residency)
         VALUES ('${orgId}', 'bad', 'FR', 'FR', 'EUR', 'eu')`,
      ),
    ).rejects.toThrow(/data_residency_check|check constraint/i);
  });
});