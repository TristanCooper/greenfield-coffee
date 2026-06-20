// packages/db/src/schema/money.ts
//
// Card 0.9 / plan §7.3 — money spine MINIMAL stubs. The full
// money spine (FX snapshot, minor-unit arithmetic helpers,
// cross-currency landed-cost cascade) is card 0.13. This card
// lands just enough for the 0.9 acceptance criteria
// ("Money tables are minimal here — full money spine is card
// 0.13. Just enough columns for 0.9 to compile and migrate").
//
// TABLES HERE
//
//   fx_rate             — daily FX rate for a (from, to) currency
//                         pair. v1 stores the rate as a numeric
//                         factor (multiply from-amount by rate to
//                         get to-amount). The full spine
//                         (effective_date, source, audit trail)
//                         is card 0.13; this card ships a date
//                         column and a source_text column so the
//                         schema is forward-compatible.
//   landed_cost_event   — a single cost line attached to a lot.
//                         e.g. "freight: €120 on green_lot X".
//                         The full cascade (split across multiple
//                         lots, prorate by weight, etc.) is card
//                         0.13; this card ships the table with
//                         the cost + the target pointer.
//
// CROSS-MODULE FKs (forward references)
//
//   landed_cost_event.target_id → green_lot / roast_batch /
//                                   packaged_lot (card 0.10). The
//                                   target_kind enum tells which.
//                                   No FK on target_id (polymorphic);
//                                   referential integrity at app
//                                   layer, same pattern as
//                                   stock_movement in lots.ts.
//
// CROSS-CARD FKs
//
//   landed_cost_event.applies_to_green_lot_id → green_lot
//     (card 0.10) — optional, used when the cost is specific
//     to a single green_lot (the typical "freight on lot X"
//     case). NULL when the cost is spread across multiple
//     lots (a "duty: 8% of total" line). Bare uuid, FK lands
//     in 0007_operational.sql.
//
//   landed_cost_event.applies_to_roast_batch_id → roast_batch
//     (card 0.10). Same pattern.
//
//   landed_cost_event.applies_to_packaged_lot_id → packaged_lot
//     (card 0.10). Same pattern.
//
//   The application code writes to the right column based on
//   `target_kind`. A CHECK enforces target_kind matches the
//   non-null pointer.

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

// ── enums ─────────────────────────────────────────────────────────────────

export const landedCostCostKind = pgEnum('landed_cost_cost_kind', [
  'freight',
  'duty',
  'insurance',
  'packaging',
  'storage',
  'other',
] as const);
export type LandedCostCostKind =
  (typeof landedCostCostKind.enumValues)[number];

export const landedCostTargetKind = pgEnum('landed_cost_target_kind', [
  'green_lot',
  'roast_batch',
  'packaged_lot',
] as const);
export type LandedCostTargetKind =
  (typeof landedCostTargetKind.enumValues)[number];

// ── fx_rate ──────────────────────────────────────────────────────────────
//
// Daily FX rate. v1: one row per (from_currency, to_currency,
// effective_date) — unique. Card 0.13 extends with provider +
// fetch timestamp + audit trail.
//
// `rate` is the factor: 1 unit of from_currency = rate units of
// to_currency. So 1 EUR → 0.85 GBP would be from='EUR',
// to='GBP', rate=0.85.
//
// CHECK rate > 0 — a non-positive rate is nonsense.

export const fxRate = pgTable(
  'fx_rate',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    fromCurrency: text('from_currency').notNull(),
    toCurrency: text('to_currency').notNull(),
    rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
    effectiveDate: date('effective_date').notNull(),
    sourceText: text('source_text'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // UNIQUE on (org_id, from, to, effective_date). Cross-card
    // also: the same rate applies across orgs (it's a market
    // rate), but the seed (0.14) sets up one row per org so
    // the per-org uniqueness keeps the schema forward-compatible
    // with org-specific FX (a roaster with a private rate
    // agreement).
    orgPairDateUnique: unique('fx_rate_org_id_pair_date_unique').on(
      table.orgId,
      table.fromCurrency,
      table.toCurrency,
      table.effectiveDate,
    ),
    orgIdIdx: index('fx_rate_org_id_idx').on(table.orgId),
    fromIso3: check(
      'fx_rate_from_currency_iso3_check',
      sql`length(${table.fromCurrency}) = 3`,
    ),
    toIso3: check(
      'fx_rate_to_currency_iso3_check',
      sql`length(${table.toCurrency}) = 3`,
    ),
    ratePositive: check(
      'fx_rate_rate_positive_check',
      sql`${table.rate} > 0`,
    ),
    distinctCurrencies: check(
      'fx_rate_distinct_currencies_check',
      sql`${table.fromCurrency} <> ${table.toCurrency}`,
    ),
  }),
);

export type FxRate = typeof fxRate.$inferSelect;
export type NewFxRate = typeof fxRate.$inferInsert;

// ── landed_cost_event ─────────────────────────────────────────────────────

export const landedCostEvent = pgTable(
  'landed_cost_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    kind: landedCostCostKind('kind').notNull(),
    targetKind: landedCostTargetKind('target_kind').notNull(),
    // Forward reference to green_lot / roast_batch / packaged_lot.
    // target_id is a polymorphic pointer; the specific *_id
    // column below carries the actual FK target. The CHECK
    // enforces target_kind matches the non-null pointer.
    targetId: uuid('target_id').notNull(),
    appliesToGreenLotId: uuid('applies_to_green_lot_id'),
    appliesToRoastBatchId: uuid('applies_to_roast_batch_id'),
    appliesToPackagedLotId: uuid('applies_to_packaged_lot_id'),
    // Cost in MINOR UNITS of the event's currency. bigint;
    // the full money-spine composite (`money_amount` with
    // minor_units + currency_code + fx_rate_id snapshot) is
    // card 0.13.
    amountMinorUnits: bigint('amount_minor_units', { mode: 'number' })
      .notNull(),
    currencyCode: text('currency_code').notNull(),
    // Optional supplier linkage — when the cost is "freight
    // billed by supplier X", the supplier FK is useful for
    // the audit trail. NULL when the cost isn't tied to a
    // supplier (a broker fee, a storage charge from a 3PL).
    supplierId: uuid('supplier_id'),
    // Optional human description for the audit trail.
    description: text('description'),
    // When the cost was incurred (incurred_at) and when it was
    // recorded (created_at — system clock).
    incurredAt: timestamp('incurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: uuid('created_by_user_id').notNull(),
  },
  (table) => ({
    orgIdIdx: index('landed_cost_event_org_id_idx').on(table.orgId),
    targetIdx: index('landed_cost_event_target_idx').on(
      table.targetKind,
      table.targetId,
    ),
    greenLotIdx: index(
      'landed_cost_event_applies_to_green_lot_id_idx',
    ).on(table.appliesToGreenLotId),
    supplierIdx: index('landed_cost_event_supplier_id_idx').on(
      table.supplierId,
    ),
    currencyIso3: check(
      'landed_cost_event_currency_iso3_check',
      sql`length(${table.currencyCode}) = 3`,
    ),
    amountNonZero: check(
      'landed_cost_event_amount_nonzero_check',
      sql`${table.amountMinorUnits} <> 0`,
    ),
    // target_kind ↔ applies_to_*_id consistency. If
    // target_kind = 'green_lot', then
    // applies_to_green_lot_id MUST be non-null and the other
    // two MUST be null. Same for the other two.
    targetKindConsistency: check(
      'landed_cost_event_target_kind_consistency_check',
      sql`(
        (${table.targetKind} = 'green_lot'
          AND ${table.appliesToGreenLotId} IS NOT NULL
          AND ${table.appliesToRoastBatchId} IS NULL
          AND ${table.appliesToPackagedLotId} IS NULL)
        OR (${table.targetKind} = 'roast_batch'
          AND ${table.appliesToRoastBatchId} IS NOT NULL
          AND ${table.appliesToGreenLotId} IS NULL
          AND ${table.appliesToPackagedLotId} IS NULL)
        OR (${table.targetKind} = 'packaged_lot'
          AND ${table.appliesToPackagedLotId} IS NOT NULL
          AND ${table.appliesToGreenLotId} IS NULL
          AND ${table.appliesToRoastBatchId} IS NULL)
      )`,
    ),
    // target_id must match the non-null pointer column. This
    // is the integrity guard for the polymorphic pointer.
    targetIdConsistency: check(
      'landed_cost_event_target_id_consistency_check',
      sql`(
        (${table.targetKind} = 'green_lot' AND ${table.targetId} = ${table.appliesToGreenLotId})
        OR (${table.targetKind} = 'roast_batch' AND ${table.targetId} = ${table.appliesToRoastBatchId})
        OR (${table.targetKind} = 'packaged_lot' AND ${table.targetId} = ${table.appliesToPackagedLotId})
      )`,
    ),
  }),
);

export type LandedCostEvent = typeof landedCostEvent.$inferSelect;
export type NewLandedCostEvent = typeof landedCostEvent.$inferInsert;
