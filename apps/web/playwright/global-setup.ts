// apps/web/playwright/global-setup.ts
//
// Card 13 / Playwright E2E global setup.
//
// WHAT THIS DOES
//
//   1. Verifies the required env vars (URL, publishable key,
//      DATABASE_URL). Fails loud with a clear message if
//      any are missing.
//   2. Ensures the test org + test user + membership exist.
//      The test org is named "Greenfield Test" and the user
//      is "playwright-test@greenfield.example". Both are
//      hard-coded fixtures — every test run uses the same
//      ones so tests can read state left by prior runs.
//   3. Truncates the test org's transactional data
//      (green_lot, landed_cost_event, audit_event, etc.) so
//      each run starts clean. The seed from card 0.14 isn't
//      implemented yet, so the helper just truncates — the
//      test files that NEED seed data pre-create it (e.g.
//      the receiving-green test creates a supplier and
//      producer via the form).
//
// RUN ORDER
//
//   Playwright runs global-setup once per `playwright test`
//   invocation (NOT per test file). It runs in a separate
//   Node process; the test files run AFTER it completes.
//
// WHY NO SERVICE-ROLE KEY
//
//   Earlier versions of this file used the Supabase admin
//   API (createUser, generateLink) which required the
//   service-role key. That key is a long-lived bearer
//   token with full DB access — a "legacy" way of doing
//   test user setup. The modern pattern is to do it via
//   direct SQL on the BYPASSRLS postgres role, which only
//   needs DATABASE_URL.
//
//   Concretely:
//     - Test user creation: INSERT INTO auth.users with
//       crypt($password, gen_salt('bf')) for the password
//       hash. The card 0.5 trigger creates the public.users
//       mirror row automatically.
//     - Test auth (in utils/auth.ts): signInWithPassword
//       against the publishable key (no admin key needed).
//
// TEST FIXTURES
//
//   The test user / org IDs are written to
//   `playwright/.tmp/fixtures.json` so the spec files can
//   read them. Currently workers: 1, so the file is the
//   simplest coordination mechanism.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { unscopedDb } from '@greenfield/db';

// ── Env validation ─────────────────────────────────────────────────────

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'DATABASE_URL',
] as const;

function requireEnv(name: (typeof REQUIRED_ENV)[number]): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. ` +
        `See apps/web/playwright/README.md for the setup.`,
    );
  }
  return value;
}

// ── Test fixtures (hard-coded) ─────────────────────────────────────────

const TEST_USER_EMAIL = 'playwright-test@greenfield.example';
const TEST_USER_PASSWORD =
  process.env.PLAYWRIGHT_TEST_USER_PASSWORD ?? 'test-password-do-not-use-in-prod';
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_ORG_NAME = 'Greenfield Test';
const TEST_ORG_ID = '22222222-2222-2222-2222-222222222222';
// The Supabase auth schema's `instance_id` column is a UUID
// that groups users in a Supabase project. For hosted
// Supabase projects this is the project's own UUID; the
// all-zeros value is the convention for self-hosted
// instances. Using all-zeros here works against any
// Supabase instance (hosted or self-hosted) because the
// column isn't foreign-keyed.
const SUPABASE_AUTH_INSTANCE_ID = '00000000-0000-0000-0000-000000000000';

interface TestFixtures {
  userId: string;
  orgId: string;
  userEmail: string;
  userPassword: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Ensure the test user exists with a known password. The
 * `INSERT ... ON CONFLICT (email) DO NOTHING` is idempotent —
 * re-runs don't error if the user already exists. The
 * `encrypted_password` uses `crypt($password, gen_salt('bf'))`
 * which is Supabase's bcrypt-hashed password format; the
 * auth.users row this produces is identical to one created
 * via the production signup flow.
 *
 * The card 0.5 trigger on auth.users (0001_auth_bridge.sql)
 * creates the public.users mirror row automatically — we
 * don't insert it here.
 *
 * The user has a fixed UUID (TEST_USER_ID) so the spec files
 * and the fixtures.json can read a stable identifier.
 */
async function ensureTestUser(): Promise<string> {
  await unscopedDb(
    `INSERT INTO auth.users
       (instance_id, id, aud, role, email,
        encrypted_password, email_confirmed_at,
        raw_user_meta_data, raw_app_meta_data,
        created_at, updated_at, confirmation_token,
        recovery_token, email_change_token_new,
        email_change, is_super_admin)
     VALUES (
       $1, $2, 'authenticated', 'authenticated', $3,
       crypt($4, gen_salt('bf')), now(),
       '{"test": true}'::jsonb, '{"provider":"email"}'::jsonb,
       now(), now(), '', '', '', '', false
     )
     ON CONFLICT (id) DO NOTHING`,
    SUPABASE_AUTH_INSTANCE_ID,
    TEST_USER_ID,
    TEST_USER_EMAIL,
    TEST_USER_PASSWORD,
  );

  // Confirm email idempotently (the ON CONFLICT above
  // doesn't update existing rows; if the user existed
  // before this run with an unconfirmed email, this
  // updates it so signInWithPassword works).
  await unscopedDb(
    `UPDATE auth.users
        SET email_confirmed_at = now(),
            encrypted_password = crypt($2, gen_salt('bf')),
            updated_at = now()
      WHERE id = $1
        AND (email_confirmed_at IS NULL
             OR encrypted_password IS DISTINCT FROM crypt($2, gen_salt('bf')))`,
    TEST_USER_ID,
    TEST_USER_PASSWORD,
  );

  return TEST_USER_ID;
}

async function ensureTestOrg(): Promise<string> {
  // Look up by name first (idempotent).
  const existing = await unscopedDb(
    `SELECT id FROM public.organizations WHERE name = $1 LIMIT 1`,
    TEST_ORG_NAME,
  );
  if (existing[0]) {
    return (existing[0] as { id: string }).id;
  }

  // Insert the org.
  await unscopedDb(
    `INSERT INTO public.organizations
       (id, name, country_code, region, base_currency, data_residency)
     VALUES ($1, $2, 'GB', 'GB', 'GBP', 'uk')
     ON CONFLICT (id) DO NOTHING`,
    TEST_ORG_ID,
    TEST_ORG_NAME,
  );

  return TEST_ORG_ID;
}

async function ensureMembership(userId: string, orgId: string): Promise<void> {
  await unscopedDb(
    `INSERT INTO public.memberships (org_id, user_id, role)
     VALUES ($1, $2, 'owner'::membership_role)
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    orgId,
    userId,
  );
}

async function resetTransactionalData(orgId: string): Promise<void> {
  // Card 0.14 (seed) hasn't shipped yet, so we truncate
  // manually. Order matters: child tables first.
  //
  // The table list is whitelisted — we never DELETE from an
  // unscoped (global) table. The 'fx_rate' row is global so
  // we DON'T delete it.
  const tablesWithOrg: string[] = [
    'public.audit_event',
    'public.landed_cost_event',
    'public.eudr_reference_data',
    'public.green_lot',
    'public.order_edit',
    'public.order_line',
    'public.order',
    'public.price_list_entry',
    'public.price_list',
    'public.recipe',
    'public.packaging',
    'public.sku',
    'public.integration_connection',
    'public.lot_producer',
    'public.dds_draft',
    'public.audit_pack',
    'public.shipment_eudr_decision',
    'public.producer_verification_override',
    'public.producer',
    'public.supplier',
  ];
  for (const table of tablesWithOrg) {
    try {
      await unscopedDb(
        `DELETE FROM ${table} WHERE org_id = $1`,
        orgId,
      );
    } catch (e) {
      // A table that doesn't exist yet is silently ignored.
      console.warn(
        `[global-setup] Skipped reset of ${table}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  // Also clear org-level memberships beyond the test user.
  await unscopedDb(
    `DELETE FROM public.memberships
      WHERE org_id = $1
        AND user_id != (SELECT id FROM public.users WHERE email = $2)`,
    orgId,
    TEST_USER_EMAIL,
  );
}

// ── Public exports used by the spec files ─────────────────────────────

export const TEST_USER = {
  email: TEST_USER_EMAIL,
  password: TEST_USER_PASSWORD,
  id: TEST_USER_ID,
};

// ── Entry point ────────────────────────────────────────────────────────

export default async function globalSetup(): Promise<void> {
  console.log('[global-setup] Verifying env vars…');
  for (const name of REQUIRED_ENV) requireEnv(name);

  console.log('[global-setup] Ensuring test user…');
  const userId = await ensureTestUser();

  console.log('[global-setup] Ensuring test org + membership…');
  const orgId = await ensureTestOrg();
  await ensureMembership(userId, orgId);

  console.log('[global-setup] Resetting transactional data…');
  await resetTransactionalData(orgId);

  // Persist the IDs so spec files can read them.
  const fixtures: TestFixtures = {
    userId,
    orgId,
    userEmail: TEST_USER_EMAIL,
    userPassword: TEST_USER_PASSWORD,
  };
  const outDir = join(__dirname, '.tmp');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'fixtures.json'),
    JSON.stringify(fixtures, null, 2),
  );

  console.log(`[global-setup] Ready. userId=${userId} orgId=${orgId}`);
}
