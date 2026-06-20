// packages/db/src/compliance.ts
//
// Card 0.20 / plan §7.4 — EUDR compliance check at shipment time.
//
// THIS MODULE IS A PURE FUNCTION WITH A DATABASE HANDLE.
//
//   `computeShipmentCompliance(shipmentId, db)` reads the lineage
//   graph and the EUDR reference data, then returns a
//   `ComplianceResult` object. It does NO writes — no audit_event
//   rows, no eudr_reference_data UPSERTs. The card body says
//   explicitly: "The function is pure given the inputs — no IO,
//   no side effects. The tRPC procedure reads the data, calls
//   the function, and decides what to do."
//
//   Side effects (audit_event on operator acknowledgement, the
//   per-shipment opt-out) land in Phase 1 (plan §5.5) — the
//   bypass lands there, not here.
//
// WHAT IT CHECKS
//
//   For every green lot feeding the packaged lot (via the
//   lineage chain packaged_lot.roast_batch_ids[] → roast_batch
//   → roast_batch_component → green_lot):
//
//     - The green lot has an EudrReferenceData row (eudr_reference_data.green_lot_id IS NOT NULL).
//     - The EudrReferenceData row has country_of_harvest set.
//     - The EudrReferenceData row has harvest_year set.
//     - The EudrReferenceData row has geolocation_verified = true
//       (the EUDR geolocation check; the underlying
//       producer.geolocation is the canonical polygon, but the
//       "verified" flag is what blocks at EU shipment — a
//       producer polygon without a verified reference is
//       `unassessed` per plan §5.4).
//     - The EudrReferenceData row's risk_status is NOT 'high'
//       (or rather, the high case is `warning`, not `blocked` —
//       the actual blocking rules are completeness checks).
//     - The green lot's producer's country is NOT on the EU
//       high-risk country list (eudr_high_risk_country table).
//
// DECISION RULE (matches the card body verbatim)
//
//   blocked  if any lot is missing EudrReferenceData OR any lot's
//            country is on the EU high-risk list with incomplete
//            data OR any supplier/producer has unassessed risk.
//
//   warning  if any lot's country is on the high-risk list but
//            EUDR data is complete (DDS still required but the
//            roaster can dispatch) OR any supplier has
//            risk_status = 'high' with complete data.
//
//   clear    otherwise.
//
// LINEAGE TRAVERSAL
//
//   v1 ships without a separate `shipment` or `order` table —
//   the live DB has only `packaged_lot` at the ship boundary.
//   `computeShipmentCompliance(packagedLotId, db)` therefore
//   walks the lineage starting at the packaged_lot:
//
//     packaged_lot
//       → roast_batch (UNNEST packaged_lot.roast_batch_ids[])
//         → roast_batch_component (one row per green lot)
//           → green_lot
//             → eudr_reference_data (LEFT JOIN — may be absent)
//             → producer (LEFT JOIN — may be absent)
//               → eudr_high_risk_country (LEFT JOIN — may be
//                 absent)
//
//   When card 0.9 (order / order_line) lands, a sibling
//   `computeOrderCompliance(orderId, db)` can wrap the same
//   traversal starting at order → order_line → packaged_lot.
//   The card body uses `shipmentId`; v1 maps that to
//   `packaged_lot.id` because that's the only ship-boundary
//   table we have. A future card may rename to
//   `computePackagedLotCompliance` or add an order-side wrapper.
//
// HIGH-RISK COUNTRY REFERENCE
//
//   `eudr_high_risk_country` is a static table seeded by
//   migration 0009_eudr_high_risk_country.sql. The v1 list is
//   the December 2024 European Commission benchmarking — Brazil,
//   Vietnam, Côte d'Ivoire, Ghana, Cameroon, DRC. Future updates
//   add rows with later effective_from dates; the active list
//   is `effective_from <= now()`.

import type { TenantDb } from './rls.js';

// ── public types ─────────────────────────────────────────────────────────

/**
 * The compliance verdict for a packaged lot (v1's "shipment").
 *
 * - `clear`   — every green lot feeding the packaged lot has
 *               complete EUDR data and is not on the high-risk
 *               country list. The ship form can dispatch without
 *               a confirmation.
 * - `warning` — at least one green lot's country is on the
 *               high-risk list, but all EUDR data is complete. The
 *               ship form shows a confirmation modal but allows
 *               dispatch.
 * - `blocked` — at least one green lot is missing EUDR data,
 *               has unassessed fields, or is on the high-risk
 *               list with incomplete data. The ship form disables
 *               dispatch; the operator must add the missing
 *               reference data or wait for the Phase 1 opt-out
 *               path.
 */
export type ComplianceStatus = 'clear' | 'warning' | 'blocked';

/**
 * The result returned by `computeShipmentCompliance`.
 *
 * `reasons` is a list of human-readable strings, one per
 * failing/amber condition the function found. The ship form
 * joins them into the disabled-submit tooltip or the
 * confirmation modal body.
 *
 * `lotsNeedingAttention` is the list of GreenLot ids that
 * contributed to the verdict — UI uses this to highlight which
 * rows in the packed-lot table are problematic.
 *
 * `checkedAt` is `now()` (ISO 8601 string) — the function's
 * read-only nature means a re-call returns the same verdict,
 * but the timestamp helps the UI distinguish "checked at 10:01"
 * from "stale data, re-check".
 */
export interface ComplianceResult {
  status: ComplianceStatus;
  reasons: string[];
  lotsNeedingAttention: string[];
  checkedAt: string;
}

/**
 * A typed row returned by the lineage CTE. Used internally by
 * the function; exposed for testing.
 */
export interface LineageRow {
  packaged_lot_id: string;
  roast_batch_id: string;
  green_lot_id: string;
  green_lot_org_id: string;
  eudr_reference_data_id: string | null;
  erd_country_of_harvest: string | null;
  erd_harvest_year: string | null;
  erd_risk_status: string | null;
  erd_geolocation_verified: boolean | null;
  erd_country_risk: string | null;
  erd_producer_risk: string | null;
  producer_id: string | null;
  producer_country_of_origin: string | null;
  producer_geolocation_set: boolean;
  producer_verification_source: string | null;
  is_high_risk_country: boolean;
  high_risk_effective_from: string | null;
}

/**
 * The same shape as `LineageRow` but partial — for unit tests
 * that construct synthetic rows. Production code never uses
 * this; the SQL query produces fully-populated rows.
 */
export type LineageRowLike = Partial<LineageRow> &
  Pick<LineageRow, 'green_lot_id' | 'producer_country_of_origin' | 'is_high_risk_country'>;

// ── SQL CTE ──────────────────────────────────────────────────────────────

/**
 * The single CTE that walks the lineage chain and assembles
 * every EUDR signal we need. Designed against the LIVE DB
 * shape (different from the migration files in the repo —
 * schema drift documented in the migration runner's logs).
 *
 * The `producer_verification_source` column is surfaced so
 * the verdict can warn when a self-reported producer without
 * an override is feeding the shipment (the recompute trigger
 * in 0006_compliance.sql flags this as 'high' risk).
 *
 * The `erd_country_risk` and `erd_producer_risk` columns are
 * the EUDR-specific risk enums on the eudr_reference_data
 * row (vs. the derived `risk_status` which is the higher of
 * the two). v1 surfaces both for diagnostic reasons.
 */
const LINEAGE_CTE_SQL = `
  WITH RECURSIVE shipment_lineage AS (
    -- Base case: green lots feeding the packaged lot.
    SELECT
      pl.id            AS packaged_lot_id,
      rb.id            AS roast_batch_id,
      gl.id            AS green_lot_id,
      gl.org_id        AS green_lot_org_id
    FROM public.packaged_lot pl
    CROSS JOIN LATERAL unnest(pl.roast_batch_ids) AS rb_id(id)
    JOIN public.roast_batch rb ON rb.id = rb_id.id
    JOIN public.roast_batch_component rbc ON rbc.roast_batch_id = rb.id
    JOIN public.green_lot gl ON gl.id = rbc.green_lot_id
    WHERE pl.id = $1
  )
  SELECT
    sl.packaged_lot_id,
    sl.roast_batch_id,
    sl.green_lot_id,
    sl.green_lot_org_id,
    erd.id            AS eudr_reference_data_id,
    erd.country_of_harvest AS erd_country_of_harvest,
    erd.harvest_year::text AS erd_harvest_year,
    erd.risk_status::text AS erd_risk_status,
    erd.geolocation_verified AS erd_geolocation_verified,
    erd.country_risk::text AS erd_country_risk,
    erd.producer_risk::text AS erd_producer_risk,
    p.id              AS producer_id,
    p.country_of_origin AS producer_country_of_origin,
    (p.geolocation IS NOT NULL) AS producer_geolocation_set,
    p.verification_source::text AS producer_verification_source,
    hrc.country_code IS NOT NULL AS is_high_risk_country,
    hrc.effective_from AS high_risk_effective_from
  FROM shipment_lineage sl
  LEFT JOIN public.eudr_reference_data erd
    ON erd.green_lot_id = sl.green_lot_id
   AND erd.org_id = sl.green_lot_org_id
  LEFT JOIN public.producer p
    ON p.id = (SELECT producer_id FROM public.green_lot WHERE id = sl.green_lot_id)
  LEFT JOIN public.eudr_high_risk_country hrc
    ON hrc.country_code = p.country_of_origin
   AND hrc.effective_from <= now()
`;

// ── computeShipmentCompliance ────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Walk the lineage graph for a packaged lot (v1's "shipment")
 * and return a `ComplianceResult`.
 *
 * This function issues SQL but does NOT write. The caller (a
 * tRPC procedure, the receiving form's prefetch, or a test) is
 * responsible for any audit_event writes; this function is the
 * load-bearing decision engine.
 *
 * @param shipmentId - UUID of the packaged lot that will ship
 *   (v1 uses `packaged_lot.id` as the shipment identifier —
 *   there is no separate `shipment` or `order` table yet).
 *   When card 0.9 lands, this can be wrapped by a sibling
 *   `computeOrderCompliance(orderId)` that walks
 *   order → order_line → packaged_lot.
 * @param db - Tenant-scoped DB handle from `./rls.js`. Pass
 *   `withTenant(orgId, async (tx) => …)` to bind org context.
 *   The function does NOT open its own transaction.
 *
 * @returns `ComplianceResult` with `status`, `reasons`, and the
 *   list of green_lot ids that need attention. A packaged lot
 *   with no roast batches (or roast batches with no green lots)
 *   returns `{ status: 'clear', reasons: [], … }` — there's
 *   nothing to ship, so nothing to flag.
 *
 * @throws Error if `shipmentId` is not a valid UUID (defensive
 *   — the SQL parameter binding would catch it anyway, but a
 *   clear message helps debugging). Does NOT throw on missing
 *   lineage data; the verdict reflects the missing-data state.
 */
export async function computeShipmentCompliance(
  shipmentId: string,
  db: TenantDb,
): Promise<ComplianceResult> {
  // Defensive UUID check — the SQL is parameterised so a bad
  // value would just produce no rows, but a clear error here is
  // easier to debug than "result was always clear, oh because
  // the id was malformed".
  if (!UUID_RE.test(shipmentId)) {
    throw new Error(
      `computeShipmentCompliance: shipmentId must be a UUID, got ${JSON.stringify(shipmentId)}`,
    );
  }

  const checkedAt = new Date().toISOString();
  // Use the `unsafe` form because our CTE uses Postgres-style
  // `$1` positional parameters (cheaper to read in a hand-written
  // CTE than juggling tagged-template interpolation; the `db`
  // signature accepts both shapes per ./rls.ts).
  const rows = await db.unsafe<LineageRow>(LINEAGE_CTE_SQL, [shipmentId]);

  return verdictFromRows(rows, checkedAt);
}

/**
 * Pure verdict computation given the lineage rows. Extracted
 * from `computeShipmentCompliance` so tests can exercise the
 * decision logic without going through SQL — useful for the
 * cases the live DB schema can't express (e.g. an EUDR row with
 * NULL `harvest_year`, which `eudr_reference_data.harvest_year
 * NOT NULL` prohibits — the function's verdict logic still
 * needs to handle a NULL row.erd_harvest_year gracefully if
 * the schema ever relaxes the NOT NULL constraint, OR if the
 * schema drifts back to the repo migration shape).
 */
export function verdictFromRows(
  rows: readonly LineageRowLike[],
  checkedAt: string = new Date().toISOString(),
): ComplianceResult {
  // Empty packaged lot: no roast batches means no green lots.
  // Defensive — the ship form shouldn't allow dispatch on an
  // empty packaged_lot, but if it does, the verdict is `clear`.
  if (rows.length === 0) {
    return {
      status: 'clear',
      reasons: [],
      lotsNeedingAttention: [],
      checkedAt,
    };
  }

  // The verdict algorithm — three boolean accumulators, one
  // per status. The card body says:
  //
  //   blocked  if any lot is missing EudrReferenceData OR any
  //            lot's country is on the high-risk list OR any
  //            supplier has risk_assessment.overall = 'unassessed'.
  //   warning  if any lot is on the high-risk list but the
  //            operator has acknowledged it (Phase 1) OR if any
  //            supplier has risk_assessment.overall = 'high'.
  //   clear    otherwise.
  //
  // v1 (this card): `unassessed` is taken from the
  // eudr_reference_data row's completeness checks. If the row
  // is missing entirely, the lot is `unassessed` by definition.
  // The `high` case triggers warning when EUDR data is complete
  // (otherwise blocked wins). The `acknowledged` case is
  // Phase 1 — not modelled in v1, so a high-risk country with
  // complete EUDR data is `warning` (the operator sees the modal
  // but can dispatch).
  let hasBlocked = false;
  let hasWarning = false;
  const reasons = new Set<string>();
  const lotsNeedingAttention = new Set<string>();

  for (const row of rows) {
    // The lot is on the high-risk list regardless of data state.
    const highRisk = row.is_high_risk_country;

    // EUDR completeness checks on the eudr_reference_data row.
    // The row's existence + populated fields = EUDR-ready.
    const eudrRowPresent = row.eudr_reference_data_id !== null;
    const countryOfHarvest = row.erd_country_of_harvest ?? null;
    const harvestYear = row.erd_harvest_year ?? null;
    const countrySet =
      countryOfHarvest !== null && countryOfHarvest.length === 2;
    const harvestYearSet =
      harvestYear !== null && harvestYear.length > 0;
    const geolocationVerified = row.erd_geolocation_verified === true;
    // Risk status from the eudr_reference_data row. The
    // `eudr_risk_level` enum has 'low', 'standard', 'high'. The
    // `risk_status` column is the higher of `country_risk` and
    // `producer_risk` — a `high` reading is the warning signal
    // (DDS still required, but data is complete).
    const risk = row.erd_risk_status;
    const isHigh = risk === 'high';
    // A missing row OR a `risk_status` that's NULL is the
    // unassessed state — the recompute trigger hasn't run
    // (e.g. supplier/producer were created without a green lot
    // in scope yet). This is `blocked`.
    const isUnassessed = !eudrRowPresent || risk === null;

    // Per-row verdict.
    const blocked =
      !eudrRowPresent ||
      !countrySet ||
      !harvestYearSet ||
      !geolocationVerified ||
      isUnassessed;
    const warning = !blocked && (highRisk || isHigh);

    if (blocked) {
      hasBlocked = true;
      lotsNeedingAttention.add(row.green_lot_id);
      if (!eudrRowPresent) {
        reasons.add(
          `Green lot ${row.green_lot_id}: missing EudrReferenceData row`,
        );
      }
      if (!countrySet) {
        reasons.add(
          `Green lot ${row.green_lot_id}: EudrReferenceData.country_of_harvest is not set`,
        );
      }
      if (!harvestYearSet) {
        reasons.add(
          `Green lot ${row.green_lot_id}: EudrReferenceData.harvest_year is not set`,
        );
      }
      if (!geolocationVerified) {
        reasons.add(
          `Green lot ${row.green_lot_id}: producer geolocation is not verified (EUDR requires geolocation_verified=true)`,
        );
      }
    } else if (warning) {
      hasWarning = true;
      lotsNeedingAttention.add(row.green_lot_id);
      if (highRisk) {
        const country = row.producer_country_of_origin ?? 'unknown';
        reasons.add(
          `Green lot ${row.green_lot_id}: producer country ${country} is on the EU high-risk list (DDS required for EU shipment)`,
        );
      }
      if (isHigh) {
        reasons.add(
          `Green lot ${row.green_lot_id}: EudrReferenceData.risk_status is 'high' — confirm before shipping`,
        );
      }
    }
  }

  // Highest-severity verdict wins. The card body says "blocked"
  // outranks "warning" outranks "clear".
  let status: ComplianceStatus;
  if (hasBlocked) {
    status = 'blocked';
  } else if (hasWarning) {
    status = 'warning';
  } else {
    status = 'clear';
  }

  return {
    status,
    reasons: [...reasons].sort(),
    lotsNeedingAttention: [...lotsNeedingAttention].sort(),
    checkedAt,
  };
}

// ── listHighRiskCountries ────────────────────────────────────────────────

/**
 * Look up the high-risk country list — exposed so the receiving
 * form (card 0.17) can render the amber warning at green
 * receipt time. Returns the currently-active countries (those
 * with `effective_from <= now()`).
 *
 * The receiving form passes the producer's country through a
 * `Set.has()` check against the returned array; it does NOT
 * call computeShipmentCompliance at receipt time (that function
 * is lot-scoped, not shipment-scoped).
 */
export async function listHighRiskCountries(
  db: TenantDb,
): Promise<readonly string[]> {
  const rows = await db.unsafe<{ country_code: string }>(
    `SELECT country_code
       FROM public.eudr_high_risk_country
      WHERE effective_from <= now()
      ORDER BY country_code`,
  );
  return rows.map((r) => r.country_code);
}
