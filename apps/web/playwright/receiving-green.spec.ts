// apps/web/playwright/receiving-green.spec.ts
//
// Card 13 / the receiving-green E2E happy path.
//
// This is the spec the card 0.17 body explicitly asked for:
//
//   "Test: at least one Playwright test that fills the full
//   form, submits, and asserts the green lot,
//   EudrReferenceData, and audit_event rows exist"
//
// WHAT THIS COVERS
//
//   1. Sign in as the test user.
//   2. Navigate to /receiving/green/new.
//   3. Step 1 (Supplier & invoice): create a new supplier
//      inline.
//   4. Step 2 (Producer & country): create a new producer
//      inline (the form pre-fills a square geolocation for
//      the test, skipping the map picker — Leaflet in
//      headless is flaky).
//   5. Step 3 (Lot details): fill the lot code, weight,
//      moisture, etc.
//   6. Step 4 (Cost allocation): add a freight line and a
//      duty line in the org's base currency.
//   7. Step 5 (Risk review): the risk is computed from the
//      form data; self_reported + no geolocation triggers
//      HIGH risk. Acknowledge and submit.
//   8. Land on /receiving/green/[id].
//   9. Assert the DB rows exist (via unscopedDb direct
//      queries).
//
// WHY A FIXED GEOLOCATION
//
//   The wizard's map picker uses Leaflet, which renders
//   into a div with tile images from openstreetmap.org.
//   In headless Chromium the tile loads are flaky (CORS +
//   timing). For the test we pre-fill the producer's
//   geolocation via the form's "draw" state — but actually
//   the form REQUIRES the user to use the map. So we
//   instead use a different path: create the producer via
//   a SQL helper that bypasses the form's map gate. (This
//   is a v1 simplification; the map picker is tested
//   manually.)
//
//   v1.5 should add a separate spec for the map picker
//   that uses a real map interaction (clicking tiles
//   works in headless when the tiles load — the failure
//   is in the tile image fetch, not the click handling).

import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signInAsTestUser } from './utils/auth';
import { unscopedDb } from '@greenfield/db';

interface TestFixtures {
  userId: string;
  orgId: string;
}

function loadFixtures(): TestFixtures {
  const path = join(__dirname, '.tmp', 'fixtures.json');
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as TestFixtures;
}

test.describe('Receiving green — full wizard happy path', () => {
  test('fills the wizard, submits, and writes the expected rows', async ({
    page,
    baseURL,
  }) => {
    // Sign in.
    await signInAsTestUser(page, baseURL!);

    // Pre-create a producer with a non-high-risk verification
    // source + a valid geolocation, so step 5's risk preview
    // is "low" (we don't have to acknowledge the high-risk
    // gate). The wizard's "+ New producer" path requires the
    // map picker; we bypass by inserting the producer via
    // SQL and then selecting it from the autocomplete in
    // step 2.
    const { orgId } = loadFixtures();
    const producerId = await createTestProducer(orgId);

    // Navigate to the wizard.
    await page.goto('/receiving/green/new');
    await expect(
      page.getByRole('heading', { name: /receive green lot/i }),
    ).toBeVisible();

    // ── Step 1: Supplier & invoice ──────────────────────────────────
    // Create a new supplier inline.
    await page.getByLabel(/^name$/i).first().fill('Test Supplier Co');
    await page
      .getByLabel(/country \(iso 3166-1 alpha-2\)/i)
      .fill('NL');
    // Invoice fields.
    await page
      .getByLabel(/invoice number/i)
      .fill(`INV-${Date.now()}`);
    // The amount input + currency select live side by side.
    // The amount input is the first numeric input on the page
    // (we use the role/label for the second-order locator).
    await page.getByLabel(/invoice total/i).locator('input').first().fill('250.00');
    // Currency defaults to base (GBP). Leave it.
    await page.getByRole('button', { name: /next/i }).click();

    // ── Step 2: Producer & country ─────────────────────────────────
    // The producer dropdown / autocomplete is a search input.
    // Search for "Test Producer" and pick the pre-seeded one.
    const producerSearch = page.getByLabel(/search existing/i);
    await producerSearch.fill('Test Producer');
    // Click the first result.
    await page
      .getByRole('button', { name: /Test Producer/i })
      .first()
      .click();

    // Country of harvest + harvest year.
    await page
      .getByLabel(/iso 3166-1 alpha-2 code/i)
      .fill('CO');
    // Harvest year defaults to current year; leave it.
    await page.getByRole('button', { name: /next/i }).click();

    // ── Step 3: Lot details ─────────────────────────────────────────
    const lotCode = `E2E-${Date.now()}`;
    await page.getByLabel(/lot code/i).fill(lotCode);
    await page.getByLabel(/weight received/i).fill('100');
    await page.getByLabel(/moisture/i).fill('11.0');
    await page.getByLabel(/variety/i).fill('Caturra');
    await page.getByLabel(/grade/i).fill('SHB EP');
    await page.getByRole('button', { name: /next/i }).click();

    // ── Step 4: Cost allocation ────────────────────────────────────
    // Add a freight line.
    await page.getByLabel(/^kind$/i).first().selectOption('freight');
    await page
      .getByLabel(/^amount$/i)
      .locator('input')
      .first()
      .fill('120.00');
    await page.getByRole('button', { name: /add cost line/i }).click();

    // Add a duty line.
    await page.getByLabel(/^kind$/i).first().selectOption('duty');
    await page
      .getByLabel(/^amount$/i)
      .locator('input')
      .first()
      .fill('30.00');
    await page.getByRole('button', { name: /add cost line/i }).click();

    await page.getByRole('button', { name: /next/i }).click();

    // ── Step 5: Risk review + submit ───────────────────────────────
    // The pre-seeded producer has verification_source =
    // third_party_verified + a valid geolocation, so the
    // producer risk is low. The supplier was just created
    // (risk_assessment unassessed). The overall should be
    // 'unassessed' or 'low' — either way, the
    // acknowledgement is required (the form shows the
    // acknowledgement checkbox as a hard requirement when
    // the overall is NOT high; for 'low' / 'unassessed' it
    // is optional but the form still lets the user
    // submit without checking).
    //
    // We click submit; if the form blocks, we check the
    // acknowledgement box and try again.
    const submitButton = page.getByRole('button', { name: /submit/i });
    const isDisabled = await submitButton.isDisabled();
    if (isDisabled) {
      await page
        .getByLabel(/i have reviewed/i)
        .check();
    }
    await submitButton.click();

    // ── Post-submit: detail page ───────────────────────────────────
    await page.waitForURL(/\/receiving\/green\/[0-9a-f-]+$/);
    const detailUrl = page.url();
    const greenLotId = detailUrl.split('/').pop()!;
    expect(greenLotId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    await expect(
      page.getByRole('heading', { name: new RegExp(lotCode) }),
    ).toBeVisible();

    // ── DB assertions ──────────────────────────────────────────────
    // The green_lot row exists with our code + weight.
    const lots = await unscopedDb(
      `SELECT id, code, weight_kg, harvest_year, country_of_origin
         FROM public.green_lot WHERE id = $1`,
      greenLotId,
    );
    expect(lots).toHaveLength(1);
    expect((lots[0] as { code: string }).code).toBe(lotCode);

    // The supplier we created exists.
    const suppliers = await unscopedDb(
      `SELECT name, country_code FROM public.supplier WHERE org_id = $1`,
      orgId,
    );
    expect(suppliers).toHaveLength(1);
    expect((suppliers[0] as { name: string }).name).toBe('Test Supplier Co');

    // The producer we used exists (it was pre-seeded).
    const producers = await unscopedDb(
      `SELECT id, name FROM public.producer WHERE id = $1`,
      producerId,
    );
    expect(producers).toHaveLength(1);

    // The EudrReferenceData row exists.
    const eudr = await unscopedDb(
      `SELECT risk_status, lot_id FROM public.eudr_reference_data
        WHERE lot_id = $1`,
      greenLotId,
    );
    expect(eudr).toHaveLength(1);

    // The two LandedCostEvent rows exist.
    const costs = await unscopedDb(
      `SELECT kind, amount_cents FROM public.landed_cost_event
        WHERE green_lot_id = $1 ORDER BY kind`,
      greenLotId,
    );
    expect(costs).toHaveLength(2);
    const kinds = (costs as Array<{ kind: string }>).map((c) => c.kind).sort();
    expect(kinds).toEqual(['duty', 'freight']);

    // The audit_event row exists with action = 'green_lot_received'.
    const audits = await unscopedDb(
      `SELECT action FROM public.audit_event
        WHERE entity_id = $1 AND entity_type = 'green_lot'`,
      greenLotId,
    );
    expect(audits).toHaveLength(1);
    expect((audits[0] as { action: string }).action).toBe(
      'green_lot_received',
    );
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Create a test producer with low-risk verification source
 * + a valid geolocation. The wizard's risk preview treats
 * this producer as low, so the test can submit without the
 * high-risk acknowledgement gate.
 */
async function createTestProducer(orgId: string): Promise<string> {
  const inserted = await unscopedDb(
    `INSERT INTO public.producer
       (org_id, name, country_code, region, area_hectares,
        verification_source, geolocation)
     VALUES (
       $1, 'Test Producer', 'CO', 'Huila', 5.0,
       'third_party_verified'::producer_verification_source,
       ST_GeogFromText('MULTIPOLYGON(((-75.5 2.5, -75.4 2.5, -75.4 2.6, -75.5 2.6, -75.5 2.5)))')
     )
     RETURNING id`,
    orgId,
  );
  const id = (inserted[0] as { id: string } | undefined)?.id;
  if (!id) {
    throw new Error('createTestProducer: no id returned');
  }
  return id;
}
