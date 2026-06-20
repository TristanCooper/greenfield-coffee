// apps/web/playwright/global-setup.ts
//
// Card 13 / Playwright E2E global setup.
//
// WHAT THIS DOES
//
//   1. Verifies the required env vars (URL, publishable key,
//      service role key, DATABASE_URL). Fails loud with a
//      clear message if any are missing.
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
//   `globalTeardown` is the symmetric cleanup hook; not
//   used in v1 (we don't drop the test org after the run).
//
// TEST FIXTURES
//
//   The test user / org IDs are exported so the spec files
//   and the auth helper can read them. They're written to
//   `playwright/.test-fixtures.json` so subsequent test
//   processes (e.g. parallel test workers) can read them.
//   (Currently workers: 1, so this is overkill — but the
//   pattern is in place for when workers > 1.)
//
// WHY A REAL SUPABASE PROJECT
//
//   The card body says "a real Supabase emulator (or a real
//   staging project via secrets)". Emulating Supabase auth
//   (the magic-link flow) is non-trivial and the project
//   doesn't have a staging env yet, so v1 hits the live
//   `greenfield-prod` project's auth API and uses a
//   dedicated test org within it. The test org is named
//   "Greenfield Test" and is filtered out of any "list my
//   orgs" UI. v1.5 should split the test data into a
//   dedicated Supabase project.

import { sql } from 'drizzle-orm';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';
import { unscopedDb } from '@greenfield/db';

// ── Env validation ─────────────────────────────────────────────────────

const REQUIRED_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
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

const SUPABASE_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

// ── Test fixtures (hard-coded) ─────────────────────────────────────────

const TEST_USER_EMAIL = 'playwright-test@greenfield.example';
const TEST_USER_PASSWORD =
  process.env.PLAYWRIGHT_TEST_USER_PASSWORD ?? 'test-password-do-not-use-in-prod';
const TEST_ORG_NAME = 'Greenfield Test';

interface TestFixtures {
  userId: string;
  orgId: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

function adminSb() {
  return createSbClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function ensureTestUser(): Promise<string> {
  const sb = adminSb();
  // createUser is idempotent: it errors with `email_exists`
  // (or "already registered") if the user already exists;
  // we catch and continue.
  const { data, error } = await sb.auth.admin.createUser({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD,
    email_confirm: true,
    user_metadata: { test: true },
  });
  if (data?.user) {
    return data.user.id;
  }
  if (!error) {
    throw new Error('createUser returned no user and no error');
  }
  // Fall through to the lookup branch below.
  void error;
  const { data: listData, error: listError } =
    await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listError) {
    throw new Error(`Failed to look up test user: ${listError.message}`);
  }
  const user = listData?.users?.find((u) => u.email === TEST_USER_EMAIL);
  if (!user) {
    throw new Error(
      `Test user ${TEST_USER_EMAIL} not found after create error`,
    );
  }
  return user.id;
}

async function ensureTestOrg(userId: string): Promise<string> {
  // Look up by name first.
  const existing = await unscopedDb(
    `SELECT id FROM public.organizations WHERE name = $1 LIMIT 1`,
    TEST_ORG_NAME,
  );
  if (existing[0]) {
    return (existing[0] as { id: string }).id;
  }

  // Insert the org.
  const inserted = await unscopedDb(
    `INSERT INTO public.organizations
       (name, country_code, region, base_currency, data_residency)
     VALUES ($1, 'GB', 'GB', 'GBP', 'uk')
     RETURNING id`,
    TEST_ORG_NAME,
  );
  const orgId = (inserted[0] as { id: string } | undefined)?.id;
  if (!orgId) {
    throw new Error('Failed to insert test org');
  }

  // Mirror the user into public.users (the auth-bridge
  // trigger does this in production, but we're using the
  // admin API which doesn't fire that trigger).
  await unscopedDb(
    `INSERT INTO public.users (id, email) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    userId,
    TEST_USER_EMAIL,
  );

  // Insert the membership (org owner).
  await unscopedDb(
    `INSERT INTO public.memberships (org_id, user_id, role)
     VALUES ($1, $2, 'owner'::membership_role)
     ON CONFLICT (org_id, user_id) DO NOTHING`,
    orgId,
    userId,
  );

  return orgId;
}

async function resetTransactionalData(orgId: string): Promise<void> {
  // Card 0.14 (seed) hasn't shipped yet, so we truncate
  // manually. Order matters: child tables first.
  //
  // The table list is whitelisted — we never DELETE from an
  // unscoped (global) table. The 'fx_rate' row is global so
  // we DON'T delete it; the test org has no fx_rate writes
  // and the rate is treated as a static reference.
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
      // A table that doesn't exist yet (e.g. card 0.16 not
      // yet shipped) is silently ignored. The reset is
      // best-effort per table.
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
};

// ── Entry point ────────────────────────────────────────────────────────

export default async function globalSetup(): Promise<void> {
  console.log('[global-setup] Verifying env vars…');
  for (const name of REQUIRED_ENV) requireEnv(name);

  console.log('[global-setup] Ensuring test user…');
  const userId = await ensureTestUser();

  console.log('[global-setup] Ensuring test org + membership…');
  const orgId = await ensureTestOrg(userId);

  console.log('[global-setup] Resetting transactional data…');
  await resetTransactionalData(orgId);

  // Persist the IDs so spec files can read them.
  const fixtures: TestFixtures = { userId, orgId };
  const outDir = join(__dirname, '.tmp');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'fixtures.json'),
    JSON.stringify(fixtures, null, 2),
  );

  console.log(`[global-setup] Ready. userId=${userId} orgId=${orgId}`);
}
