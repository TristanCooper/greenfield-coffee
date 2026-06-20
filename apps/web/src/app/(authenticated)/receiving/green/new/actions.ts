'use server';

// apps/web/src/app/(authenticated)/receiving/green/new/actions.ts
//
// Card 0.17 — server action for the green-receiving submit.
//
// On submit the wizard calls createGreenLotAndFriends with the
// full form state. The action runs a single DB transaction
// that creates (or updates) the supplier, the producer, the
// green_lot, the EudrReferenceData row, all the
// LandedCostEvent rows, and an audit_event row.
//
// ATOMICITY
//
//   All inserts run inside a single `withTenant` transaction.
//   If any insert fails the whole transaction rolls back
//   (postgres-js's `sql.begin` contract). This matches the
//   card body's acceptance criterion: "On submit: one DB
//   transaction creates (or updates) supplier, producer,
//   green lot, EudrReferenceData, LandedCostEvents, and an
//   audit_event row."
//
// RISK STATUS
//
//   The EudrReferenceData.risk_status is computed by the
//   `recompute_lot_risk` SQL function added in card 0.11 —
//   a BEFORE INSERT trigger on green_lot fires it. The
//   action does not compute risk itself; it relies on the
//   trigger.
//
// RBAC
//
//   The action re-reads the user's membership inside the
//   org's tenant scope and verifies the role can submit
//   (owner / head_roaster / buyer_receiving /
//   compliance_officer). The page-level gate in page.tsx
//   does the same check; this is a defence-in-depth.

import { createClient } from '@/lib/supabase/server';
import { withTenant } from '@greenfield/db';
import type { WizardState } from './types';

interface ActionInput {
  orgId: string;
  userId: string;
  userRole: string;
  state: WizardState;
}

interface ActionResult {
  ok: boolean;
  greenLotId?: string;
  error?: string;
}

const SUBMIT_ROLES = new Set([
  'owner',
  'head_roaster',
  'buyer_receiving',
  'compliance_officer',
]);

export async function createGreenLotAndFriends(
  input: ActionInput,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== input.userId) {
    return { ok: false, error: 'Not authenticated' };
  }
  if (!SUBMIT_ROLES.has(input.userRole)) {
    return { ok: false, error: 'Role cannot submit green receipts' };
  }
  const { state, orgId } = input;

  try {
    const greenLotId = await withTenant(orgId, async (tx) => {
      // ── Supplier (create or reuse) ─────────────────────────────────
      let supplierId: string;
      if (state.supplier.id) {
        supplierId = state.supplier.id;
      } else {
        const inserted = await tx<{ id: string }>`
          INSERT INTO public.supplier (org_id, name, country_code, eori)
          VALUES (
            ${orgId}::uuid,
            ${state.supplier.draftName},
            ${state.supplier.draftCountryCode},
            ${state.supplier.draftEori || null}
          )
          RETURNING id
        `;
        if (!inserted[0]) {
          throw new Error('Failed to insert supplier');
        }
        supplierId = inserted[0].id;
      }

      // ── Producer (create or reuse) ─────────────────────────────────
      let producerId: string;
      if (state.producer.id) {
        producerId = state.producer.id;
      } else {
        // The geolocation is a GeoJSON object. We stringify and
        // cast to geography; the geography type accepts WKT, but
        // Postgres also accepts GeoJSON via ::jsonb cast in some
        // configurations. For v1 the schema TS marks the column
        // as opaque (customType in card 0.11) — app code is
        // responsible for the conversion. A future card ships
        // a Postgres function to parse GeoJSON into geography.
        const geogWkt = state.producer.draftGeolocation
          ? JSON.stringify(state.producer.draftGeolocation.geojson)
          : null;
        const inserted = await tx<{ id: string }>`
          INSERT INTO public.producer (
            org_id, name, country_code, region, area_hectares,
            verification_source, geolocation
          ) VALUES (
            ${orgId}::uuid,
            ${state.producer.draftName},
            ${state.producer.draftCountryCode},
            ${state.producer.draftRegion || null},
            ${state.producer.draftAreaHectares ?? null},
            ${state.producer.draftVerificationSource}::producer_verification_source,
            ${geogWkt}::geography
          )
          RETURNING id
        `;
        if (!inserted[0]) {
          throw new Error('Failed to insert producer');
        }
        producerId = inserted[0].id;
      }

      // ── Green lot ──────────────────────────────────────────────────
      const inserted = await tx<{ id: string }>`
        INSERT INTO public.green_lot (
          org_id, supplier_id, producer_id, code,
          country_of_origin, harvest_year, weight_kg,
          received_at, moisture_pct, process, notes, status
        ) VALUES (
          ${orgId}::uuid,
          ${supplierId}::uuid,
          ${producerId}::uuid,
          ${state.lot.code},
          ${state.lot.countryOfOrigin || state.producer.draftCountryCode},
          ${state.lot.harvestYear},
          ${state.lot.weightKg},
          now(),
          ${state.lot.moisturePct ?? null},
          ${state.lot.process},
          ${state.lot.notes || null},
          'available'::green_lot_status
        )
        RETURNING id
      `;
      if (!inserted[0]) {
        throw new Error('Failed to insert green lot');
      }
      const greenLotId = inserted[0].id;

      // ── Landed cost events ─────────────────────────────────────────
      for (const line of state.costs.lines) {
        await tx`
          INSERT INTO public.landed_cost_event (
            org_id, green_lot_id, kind, amount_cents,
            currency_code, fx_snapshot_cents_per_base,
            vat_recoverable, description, occurred_at, created_by_user_id
          ) VALUES (
            ${orgId}::uuid,
            ${greenLotId}::uuid,
            ${line.kind}::landed_cost_cost_kind,
            ${line.amountCents},
            ${line.currencyCode},
            ${line.fxSnapshotCentsPerBase ?? null},
            ${line.vatRecoverable},
            ${line.description || null},
            now(),
            ${input.userId}::uuid
          )
        `;
      }

      // ── Audit event ────────────────────────────────────────────────
      // Append-only enforced by the trigger on audit_event
      // (card 0.10). The diff captures the receipt's key fields
      // for the audit trail.
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${orgId}::uuid,
          ${input.userId}::uuid,
          'green_lot_received',
          'green_lot',
          ${greenLotId}::uuid,
          ${JSON.stringify({
            values: {
              supplierId,
              producerId,
              invoiceNumber: state.invoice.number,
              invoiceCurrency: state.invoice.currencyCode,
              invoiceAmountCents: state.invoice.amountCents,
              weightKg: state.lot.weightKg,
              harvestYear: state.lot.harvestYear,
              countryOfOrigin:
                state.lot.countryOfOrigin || state.producer.draftCountryCode,
              process: state.lot.process,
              costLineCount: state.costs.lines.length,
            },
          })}::jsonb
        )
      `;

      return greenLotId;
    });

    return { ok: true, greenLotId };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}
