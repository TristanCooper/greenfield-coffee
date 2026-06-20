// packages/db/src/compliance.test.ts
//
// Card 0.20 / plan §7.4 — integration tests for computeShipmentCompliance.
//
// THIS TEST REQUIRES A LIVE DATABASE.
//
// What we exercise (real Postgres, no mocks):
//
//   1. clear case: well-formed packaged_lot with complete EUDR data,
//      producer in a non-high-risk country.
//   2. warning case: producer in a high-risk country with complete
//      EUDR data (DDS still required, but the data is there).
//   3. blocked case: missing EudrReferenceData row.
//   4. blocked case: producer in a high-risk country with incomplete
//      EUDR data.
//   5. blocked case: eudr_reference_data exists but risk_status = NULL
//      (the recompute trigger hasn't run; this is the "supplier
//      unassessed" state in our schema — see the function comments).
//   6. blocked case: producer has no geolocation (so
//      eudr_reference_data.geolocation_verified is false).
//   7. blocked case: eudr_reference_data.harvest_year is not set.
//
// Fixture strategy:
//
//   Each test creates its own packaged_lot (and the upstream
//   chain: packaged_lot → roast_batch → roast_batch_component →
//   green_lot → eudr_reference_data / producer / supplier). The
//   `seedShipmentChain` helper builds the chain with overridable
//   flags for the seven permutations. We track every created id
//   in cleanup arrays and DELETE in reverse order after each
//   test. The test prefix is `compliance-test-` so an operator
//   can find and clean up leftovers if a crash escapes the
//   afterEach hook.
//
// WHY LIVE DB (NOT MOCKS):
//
//   The function's contract is "issue SQL, return a verdict based
//   on the data". Mocking the driver would test the call
//   sequence, not the contract. The lineage CTE walks five
//   tables with `LEFT JOIN`s and a `unnest` on a uuid[] column;
//   only a real Postgres can exercise the joins, the recursion
//   guard, and the `now()` semantics on
//   `eudr_high_risk_country.effective_from`. Matches the
//   pattern in rbac.test.ts / rls.test.ts / organizations.test.ts.
//
// SCHEMA DRIFT NOTE:
//
//   The repo's migration files (eudr.ts, 0006_compliance.sql)
//   describe a different schema than the live DB. The live DB
//   has `producer.country_of_origin` (not `country_code`),
//   `eudr_reference_data.green_lot_id` (not `lot_id`), and the
//   `eudr_risk_level` enum (`low`/`standard`/`high`, no
//   `unassessed`). The function targets the LIVE shape so tests
//   run. Reconciling the TS schema with the live DB is its own
//   card; out of scope for 0.20.

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
  computeShipmentCompliance,
  listHighRiskCountries,
  verdictFromRows,
} from './compliance.js';
import type { TenantDb } from './rls.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for the compliance integration test. ' +
      'Copy .env.example to .env.',
  );
}

// Admin client — BYPASSRLS so DDL/INSERTs work without `app.org_id`.
// The TS type is the un-typed postgres-js Sql (which has `.unsafe`
// and `.end()` natively); we cast to `TenantDb` only at the
// call sites of computeShipmentCompliance / listHighRiskCountries.
// The runtime contract matches (postgres-js's `Helper` is callable
// and has `.unsafe(query, params)`); the TS mismatch is because
// postgres-js returns `Array<Row>` (mutable) where TenantDb promises
// `readonly Row[]`. The function never mutates the rows.
const adminSql = postgres(DATABASE_URL, {
  max: 1,
  prepare: false,
  ssl: 'require',
});

// Typed view used at the function call sites — `computeShipmentCompliance`
// and `listHighRiskCountries` take a TenantDb.
const txDb = adminSql as unknown as TenantDb;

// Synthetic ids — never collide with real rows because we
// delete them after each test. Each test prefixes its fixtures
// with a unique string so concurrent runs don't trample.
const ORG_ID = '00000000-0000-4000-8000-000000000020';
const ROASTER_USER_ID = '00000000-0000-4000-8000-000000000021';

// Tracks every fixture id we create so afterEach can clean up
// even if a test crashes mid-flight.
interface CleanupRow {
  packaged_lot_ids: string[];
  roast_batch_ids: string[];
  roast_batch_component_ids: string[];
  green_lot_ids: string[];
  eudr_reference_data_ids: string[];
  producer_ids: string[];
  supplier_ids: string[];
}
const cleanup: CleanupRow = {
  packaged_lot_ids: [],
  roast_batch_ids: [],
  roast_batch_component_ids: [],
  green_lot_ids: [],
  eudr_reference_data_ids: [],
  producer_ids: [],
  supplier_ids: [],
};

beforeAll(async () => {
  // Defensive cleanup — drop any leftover rows from a prior
  // crashed run. We do this by querying for fixture prefixes
  // the test uses.
  await adminSql.unsafe(`
    DELETE FROM public.eudr_reference_data
    WHERE notes LIKE 'compliance-test-%' OR green_lot_id IN (
      SELECT id FROM public.green_lot WHERE code LIKE 'compliance-test-%'
    )
  `);
  await adminSql.unsafe(
    `DELETE FROM public.roast_batch_component WHERE org_id = '${ORG_ID}'`,
  );
  await adminSql.unsafe(
    `DELETE FROM public.roast_batch WHERE org_id = '${ORG_ID}'`,
  );
  await adminSql.unsafe(
    `DELETE FROM public.packaged_lot WHERE org_id = '${ORG_ID}'`,
  );
  await adminSql.unsafe(
    `DELETE FROM public.green_lot WHERE org_id = '${ORG_ID}'`,
  );
  await adminSql.unsafe(
    `DELETE FROM public.producer WHERE org_id = '${ORG_ID}'`,
  );
  await adminSql.unsafe(
    `DELETE FROM public.supplier WHERE org_id = '${ORG_ID}'`,
  );
  await adminSql.unsafe(
    `DELETE FROM public.memberships WHERE org_id = '${ORG_ID}'`,
  );
  await adminSql.unsafe(
    `DELETE FROM auth.users WHERE id = '${ROASTER_USER_ID}'`,
  );
  await adminSql.unsafe(
    `DELETE FROM public.organizations WHERE id = '${ORG_ID}'`,
  );

  // Seed the minimum required infra: an org + a roaster auth
  // user (the trigger populates public.users from auth.users).
  // The org is needed for every FK on every domain table; the
  // roaster is needed because roast_batch.roaster_user_id is
  // NOT NULL with a FK to public.users.
  await adminSql.unsafe(`
    INSERT INTO public.organizations (id, name, country_code, region, base_currency, data_residency)
    VALUES ('${ORG_ID}', 'Compliance Test Roastery', 'GB', 'GB', 'GBP', 'uk')
  `);
  await adminSql.unsafe(`
    INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000000', '${ROASTER_USER_ID}',
            'authenticated', 'authenticated', 'compliance-roaster@test.example',
            '{}'::jsonb, '{"provider":"email"}'::jsonb, now(), now())
  `);
  // Insert a membership so the roaster can be referenced (some
  // RLS policies check membership even with BYPASSRLS bypassed).
  await adminSql.unsafe(`
    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES ('${ORG_ID}', '${ROASTER_USER_ID}', 'owner')
  `);
});

afterEach(async () => {
  // Delete in FK-safe order: child rows first.
  // eudr_reference_data → green_lot → producer → supplier
  // roast_batch_component → roast_batch → packaged_lot → green_lot
  // We pass the id list as a Postgres array literal via
  // postgres-js's parameter binding (`$1::uuid[]`) — safer than
  // string interpolation for sql injection / escaping concerns.
  if (cleanup.eudr_reference_data_ids.length > 0) {
    await adminSql.unsafe(
      `DELETE FROM public.eudr_reference_data WHERE id = ANY($1::uuid[])`,
      [cleanup.eudr_reference_data_ids],
    );
    cleanup.eudr_reference_data_ids.length = 0;
  }
  if (cleanup.roast_batch_component_ids.length > 0) {
    await adminSql.unsafe(
      `DELETE FROM public.roast_batch_component WHERE id = ANY($1::uuid[])`,
      [cleanup.roast_batch_component_ids],
    );
    cleanup.roast_batch_component_ids.length = 0;
  }
  if (cleanup.roast_batch_ids.length > 0) {
    await adminSql.unsafe(
      `DELETE FROM public.roast_batch WHERE id = ANY($1::uuid[])`,
      [cleanup.roast_batch_ids],
    );
    cleanup.roast_batch_ids.length = 0;
  }
  if (cleanup.packaged_lot_ids.length > 0) {
    await adminSql.unsafe(
      `DELETE FROM public.packaged_lot WHERE id = ANY($1::uuid[])`,
      [cleanup.packaged_lot_ids],
    );
    cleanup.packaged_lot_ids.length = 0;
  }
  if (cleanup.green_lot_ids.length > 0) {
    await adminSql.unsafe(
      `DELETE FROM public.green_lot WHERE id = ANY($1::uuid[])`,
      [cleanup.green_lot_ids],
    );
    cleanup.green_lot_ids.length = 0;
  }
  if (cleanup.producer_ids.length > 0) {
    await adminSql.unsafe(
      `DELETE FROM public.producer WHERE id = ANY($1::uuid[])`,
      [cleanup.producer_ids],
    );
    cleanup.producer_ids.length = 0;
  }
  if (cleanup.supplier_ids.length > 0) {
    await adminSql.unsafe(
      `DELETE FROM public.supplier WHERE id = ANY($1::uuid[])`,
      [cleanup.supplier_ids],
    );
    cleanup.supplier_ids.length = 0;
  }
});

afterAll(async () => {
  await adminSql.end();
});

// ── fixture helper ───────────────────────────────────────────────────────

interface ShipmentChainOpts {
  producerCountry: string;
  producerGeolocation: string | null;
  eudrRow:
    | null  // skip eudr_reference_data insert (test 3)
    | 'complete'
    | 'missing_harvest_year'
    | 'unassessed' // risk_status = NULL
    | 'high'; // risk_status = 'high'
  // Suppress the producer verification_source CHECK
  // (producer_geolocation_implication_check) by setting it
  // to something other than 'self_reported' when geolocation
  // is null. Default 'third_party_verified' lets the row
  // pass the CHECK.
  producerVerificationSource?: string;
}

async function seedShipmentChain(
  opts: ShipmentChainOpts,
): Promise<string> {
  const supplierId = crypto.randomUUID();
  const producerId = crypto.randomUUID();
  const greenLotId = crypto.randomUUID();
  const eudrId = crypto.randomUUID();
  const roastBatchId = crypto.randomUUID();
  const roastBatchComponentId = crypto.randomUUID();
  const packagedLotId = crypto.randomUUID();

  // ── supplier ───────────────────────────────────────────────────────
  await adminSql.unsafe(`
    INSERT INTO public.supplier (id, org_id, name, country_of_origin, risk_assessment, contact_email, certifications)
    VALUES ('${supplierId}', '${ORG_ID}', 'compliance-test-${supplierId.slice(0, 8)}', 'GB',
            '{"last_reviewed_at": "2025-01-01T00:00:00Z", "dds_filed_by_supplier": true, "notes": "test"}'::jsonb,
            'test@example.com', '{}'::text[])
  `);
  cleanup.supplier_ids.push(supplierId);

  // ── producer ───────────────────────────────────────────────────────
  const verifSource = opts.producerVerificationSource ?? 'third_party_verified';
  const geolocationSql = opts.producerGeolocation
    ? `'${opts.producerGeolocation}'::geography`
    : 'NULL';
  await adminSql.unsafe(`
    INSERT INTO public.producer (id, org_id, name, country_of_origin, region, geolocation, area_hectares, verification_source, verification_ref, verification_date, notes)
    VALUES ('${producerId}', '${ORG_ID}', 'compliance-test-${producerId.slice(0, 8)}', '${opts.producerCountry}', NULL,
            ${geolocationSql}, 10.0, '${verifSource}'::producer_verification_source, 'ref-123', '2025-01-01', 'test')
  `);
  cleanup.producer_ids.push(producerId);

  // ── green_lot ──────────────────────────────────────────────────────
  // The green_lot.country_of_origin CHECK restricts to EU
  // countries; we use 'BR' as a stand-in for "non-EU origin"
  // but that's not in the allowlist. We use 'GB' here for the
  // green_lot row's country_of_origin (the roastery is in
  // London — EU-side). The producer's country_of_origin
  // (which is what the compliance check uses) is what
  // determines the high-risk status. This is intentional —
  // green_lot.country_of_origin is the lot's shipping origin
  // (where the roastery received it), producer.country_of_origin
  // is where it was grown. For a Brazilian lot received at a
  // London roastery, green_lot.country_of_origin = 'GB' and
  // producer.country_of_origin = 'BR'.
  await adminSql.unsafe(`
    INSERT INTO public.green_lot (id, org_id, supplier_id, producer_id, code, country_of_origin, harvest_year, weight_kg, received_at, status, lineage)
    VALUES ('${greenLotId}', '${ORG_ID}', '${supplierId}', '${producerId}',
            'compliance-test-${greenLotId.slice(0, 8)}', 'GB', 2024, '100.000', now(),
            'available'::green_lot_status, '{"green_lot_id": "${greenLotId}"}'::jsonb)
  `);
  cleanup.green_lot_ids.push(greenLotId);

  // ── eudr_reference_data (conditional) ─────────────────────────────
  if (opts.eudrRow !== null) {
    let harvestYearSql: string;
    let riskStatusSql: string;
    switch (opts.eudrRow) {
      case 'complete':
        harvestYearSql = '2024';
        riskStatusSql = "'low'::eudr_risk_level";
        break;
      case 'missing_harvest_year':
        harvestYearSql = 'NULL';
        riskStatusSql = "'low'::eudr_risk_level";
        break;
      case 'unassessed':
        harvestYearSql = '2024';
        riskStatusSql = 'NULL';
        break;
      case 'high':
        harvestYearSql = '2024';
        riskStatusSql = "'high'::eudr_risk_level";
        break;
    }
    // geolocation_verified = true unless the producer had no
    // geolocation (then we set false to reflect the actual
    // state). The CTE surfaces geolocation_verified directly.
    const geolocationVerified = opts.producerGeolocation ? 'true' : 'false';
    await adminSql.unsafe(`
      INSERT INTO public.eudr_reference_data (id, org_id, green_lot_id, supplier_id, producer_id,
                                              country_of_harvest, harvest_year, country_risk, producer_risk,
                                              risk_status, geolocation_verified, small_producer, notes)
      VALUES ('${eudrId}', '${ORG_ID}', '${greenLotId}', '${supplierId}', '${producerId}',
              '${opts.producerCountry}', ${harvestYearSql},
              'standard'::eudr_risk_level, 'standard'::eudr_risk_level,
              ${riskStatusSql}, ${geolocationVerified}, false, 'compliance-test fixture')
    `);
    cleanup.eudr_reference_data_ids.push(eudrId);
  }

  // ── roast_batch + component + packaged_lot ─────────────────────────
  await adminSql.unsafe(`
    INSERT INTO public.roast_batch (id, org_id, started_at, completed_at, green_weight_in_kg, roasted_weight_out_kg, yield_pct, roaster_user_id, status, notes)
    VALUES ('${roastBatchId}', '${ORG_ID}', now() - interval '1 hour', now(),
            '120.000', '100.000', '83.33', '${ROASTER_USER_ID}',
            'completed'::roast_batch_status, 'compliance-test')
  `);
  cleanup.roast_batch_ids.push(roastBatchId);

  await adminSql.unsafe(`
    INSERT INTO public.roast_batch_component (id, org_id, roast_batch_id, green_lot_id, weight_kg)
    VALUES ('${roastBatchComponentId}', '${ORG_ID}', '${roastBatchId}', '${greenLotId}', '120.000')
  `);
  cleanup.roast_batch_component_ids.push(roastBatchComponentId);

  await adminSql.unsafe(`
    INSERT INTO public.packaged_lot (id, org_id, code, roast_batch_ids, weight_kg, count, unit_weight_g, status)
    VALUES ('${packagedLotId}', '${ORG_ID}', 'compliance-test-${packagedLotId.slice(0, 8)}',
            ARRAY['${roastBatchId}']::uuid[], '100.000', 200, '500.000',
            'available'::packaged_lot_status)
  `);
  cleanup.packaged_lot_ids.push(packagedLotId);

  return packagedLotId;
}

// ── tests ────────────────────────────────────────────────────────────────

describe('computeShipmentCompliance — card 0.20 acceptance criteria', () => {
  it("1. clear case: well-formed packaged_lot with complete EUDR data, producer in a non-high-risk country", async () => {
    const packagedLotId = await seedShipmentChain({
      producerCountry: 'ET', // Ethiopia — not on the high-risk list
      producerGeolocation: 'MULTIPOLYGON(((0 0, 0 1, 1 1, 1 0, 0 0)))',
      eudrRow: 'complete',
    });
    const result = await computeShipmentCompliance(packagedLotId, txDb);
    expect(result.status).toBe('clear');
    expect(result.reasons).toEqual([]);
    expect(result.lotsNeedingAttention).toEqual([]);
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("2. warning case: producer in a high-risk country with complete EUDR data", async () => {
    const packagedLotId = await seedShipmentChain({
      producerCountry: 'BR', // Brazil — on the high-risk list (Dec 2024)
      producerGeolocation: 'MULTIPOLYGON(((0 0, 0 1, 1 1, 1 0, 0 0)))',
      eudrRow: 'complete',
    });
    const result = await computeShipmentCompliance(packagedLotId, txDb);
    expect(result.status).toBe('warning');
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.includes('BR'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('high-risk'))).toBe(true);
    expect(result.lotsNeedingAttention.length).toBe(1);
  });

  it('3. blocked case: missing EudrReferenceData row', async () => {
    const packagedLotId = await seedShipmentChain({
      producerCountry: 'CO', // Colombia — non-high-risk, but data missing
      producerGeolocation: 'MULTIPOLYGON(((0 0, 0 1, 1 1, 1 0, 0 0)))',
      eudrRow: null, // ← no row
    });
    const result = await computeShipmentCompliance(packagedLotId, txDb);
    expect(result.status).toBe('blocked');
    expect(result.reasons.some((r) => r.includes('missing EudrReferenceData'))).toBe(true);
    expect(result.lotsNeedingAttention.length).toBe(1);
  });

  it('4. blocked case: producer in a high-risk country with INCOMPLETE EUDR data', () => {
    // The live DB has `eudr_reference_data.harvest_year numeric NOT NULL`,
    // so we can't INSERT a row with NULL harvest_year — the
    // physical schema prevents the bad state. But the function
    // must still handle the case if the schema drifts or if the
    // row was loaded from a different source. Exercise the
    // verdict logic directly via verdictFromRows.
    const result = verdictFromRows(
      [
        {
          green_lot_id: 'lot-1',
          eudr_reference_data_id: 'erd-1',
          erd_country_of_harvest: 'VN',
          erd_harvest_year: null, // ← the "missing" state
          erd_risk_status: 'low',
          erd_geolocation_verified: true,
          erd_country_risk: 'high',
          erd_producer_risk: 'low',
          producer_id: 'p-1',
          producer_country_of_origin: 'VN',
          producer_geolocation_set: true,
          producer_verification_source: 'third_party_verified',
          is_high_risk_country: true,
          high_risk_effective_from: '2024-12-05',
        },
      ],
      '2026-06-20T00:00:00.000Z',
    );
    expect(result.status).toBe('blocked');
    expect(
      result.reasons.some((r) => r.includes('harvest_year')),
    ).toBe(true);
  });

  it("5. blocked case: EudrReferenceData exists but risk_status is NULL (supplier unassessed)", () => {
    // The live DB has `eudr_reference_data.risk_status NOT NULL`,
    // so the physical row can't have NULL risk_status. Exercise
    // the verdict logic directly with a synthetic row that
    // mirrors what the recompute trigger would produce on a
    // green_lot whose supplier/producer hasn't been
    // finalised yet.
    const result = verdictFromRows(
      [
        {
          green_lot_id: 'lot-1',
          eudr_reference_data_id: 'erd-1',
          erd_country_of_harvest: 'KE',
          erd_harvest_year: '2024',
          erd_risk_status: null, // ← supplier unassessed
          erd_geolocation_verified: true,
          erd_country_risk: 'standard',
          erd_producer_risk: 'standard',
          producer_id: 'p-1',
          producer_country_of_origin: 'KE',
          producer_geolocation_set: true,
          producer_verification_source: 'third_party_verified',
          is_high_risk_country: false,
          high_risk_effective_from: null,
        },
      ],
      '2026-06-20T00:00:00.000Z',
    );
    expect(result.status).toBe('blocked');
    expect(result.lotsNeedingAttention.length).toBe(1);
  });

  it('6. blocked case: producer has no geolocation (geolocation_verified=false)', async () => {
    const packagedLotId = await seedShipmentChain({
      producerCountry: 'PE', // Peru — non-high-risk
      producerGeolocation: null, // ← no polygon
      eudrRow: 'complete',
      // When geolocation is NULL the producer CHECK requires
      // verification_source = 'self_reported'. This is the
      // pre-0.17 form's "self-reported producer without
      // override" case in v1 — the recompute trigger flags it
      // 'high' in production; here we just need the producer
      // row to satisfy the constraint.
      producerVerificationSource: 'self_reported',
    });
    const result = await computeShipmentCompliance(packagedLotId, txDb);
    expect(result.status).toBe('blocked');
    expect(
      result.reasons.some((r) => r.includes('geolocation')),
    ).toBe(true);
  });

  it('7. blocked case: EudrReferenceData.harvest_year is NULL', () => {
    // Same constraint as test 4 — exercise via verdictFromRows.
    const result = verdictFromRows(
      [
        {
          green_lot_id: 'lot-1',
          eudr_reference_data_id: 'erd-1',
          erd_country_of_harvest: 'GT',
          erd_harvest_year: null, // ← missing
          erd_risk_status: 'low',
          erd_geolocation_verified: true,
          erd_country_risk: 'low',
          erd_producer_risk: 'low',
          producer_id: 'p-1',
          producer_country_of_origin: 'GT',
          producer_geolocation_set: true,
          producer_verification_source: 'third_party_verified',
          is_high_risk_country: false,
          high_risk_effective_from: null,
        },
      ],
      '2026-06-20T00:00:00.000Z',
    );
    expect(result.status).toBe('blocked');
    expect(
      result.reasons.some((r) => r.includes('harvest_year')),
    ).toBe(true);
  });
});

describe('listHighRiskCountries', () => {
  it('returns the v1 baseline (December 2024 European Commission benchmarking)', async () => {
    const countries = await listHighRiskCountries(txDb);
    // The v1 baseline seeded by 0009_eudr_high_risk_country.sql
    // is BR, VN, CI, GH, CM, CD. We check subset rather than
    // equality because future updates could add rows with
    // later effective_from dates (and the test would then
    // also include them).
    expect(countries).toContain('BR');
    expect(countries).toContain('VN');
    expect(countries).toContain('CI');
    expect(countries).toContain('GH');
    expect(countries).toContain('CM');
    expect(countries).toContain('CD');
    // Sorted alphabetically (per the SQL).
    expect(countries).toEqual([...countries].sort());
  });
});
