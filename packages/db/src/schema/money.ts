// packages/db/src/schema/money.ts
//
// Card 0.13 / plan §7.3 — money spine: the full LandedCostEvent
// and FxRate tables (the 0.9 card shipped a MINIMAL version;
// this card refines the shape per the 0.13 spec).
//
// TABLES HERE
//
//   fx_rate             — FX rate snapshot. No org FK (per the
//                         0.13 spec: "No FK to anything — pure
//                         reference data"). Rate is stored as
//                         bigint pence-per-unit (e.g. EUR→GBP at
//                         0.85 = 85). as_of is timestamptz (when
//                         the rate was observed, not a calendar
//                         date).
//   landed_cost_event   — a single cost line on a lot. The 0.13
//                         spec uses three direct FK columns
//                         (green_lot_id, roasted_lot_id,
//                         packaged_lot_id) all nullable with a
//                         CHECK enforcing exactly-one-non-null.
//                         The 0.9 polymorphic pattern (target_kind
//                         enum + target_id + applies_to_*_id) is
//                         removed in 0008_money_spine.sql.
//
// ADDITIVE COLUMNS OVER 0.9
//
//   fx_snapshot_cents_per_base — bigint. The FX rate observed
//                                when the event was recorded.
//                                NULL when the event's currency
//                                is the org base (no conversion
//                                needed). When set, the value is
//                                the rate in pence-per-unit:
//                                amount_cents *
//                                fx_snapshot_cents_per_base /
//                                10^N(event_ccy) gives the
//                                base-currency amount. (See
//                                @greenfield/money's
//                                convertMinor helper for the
//                                pure-function implementation.)
//   vat_recoverable             — boolean. True for B2B
//                                reverse-charge situations (the
//                                org claims the VAT back via the
//                                quarterly return); false for
//                                domestic VAT-inclusive costs.
//                                Drives the per-event cost
//                                allocation: recoverable VAT is
//                                EXCLUDED from the landed-cost
//                                cascade (it's not a real cost
//                                to the org). The cascade logic
//                                in @greenfield/money
//                                consults this column.
//
// ENUM EXTENSIONS OVER 0.9
//
//   landed_cost_cost_kind gains:
//     - 'broker_fee'   (e.g. importer-of-record commission)
//     - 'fx_adjustment' (a manual adjustment when the FX rate
//                       at invoice settlement differs from the
//                       rate at receipt; the cascade treats it
//                       as a separate cost line)
//
//   The 0.9 enum value 'storage' is RETAINED — it was in the
//   0.9 spec ("freight, duty, insurance, packaging, storage,
//   other") and warehouse storage IS a legitimate landed
//   cost. The 0.13 spec lists 'broker_fee' and 'fx_adjustment'
//   but doesn't explicitly remove 'storage'.
//
//   landed_cost_target_kind enum is REMOVED. The new shape
//   doesn't need a target_kind discriminator (the three FK
//   columns are the discriminator).
//
// CROSS-MODULE FKs (forward references — NO .references() in TS)
//
//   landed_cost_event.green_lot_id    → green_lot (card 0.10)
//   landed_cost_event.roasted_lot_id  → roasted_lot (card 0.10)
//   landed_cost_event.packaged_lot_id → packaged_lot (card 0.10)
//
//   supplier_id (the cost's billing supplier) is a forward
//   reference to public.supplier (card 0.11).
//
// CROSS-CARD ENUM REFERENCES
//
//   landed_cost_event.kind uses landed_cost_cost_kind
//   (defined in this file, owned by this module).
//   landed_cost_event.vat_recoverable is a boolean — the
//   per-VAT-rate rules (UK 20% = 2000 bps) live on
//   price_list_entry.vat_rate_bps (card 0.13 spec).
//
// CONSUMERS
//
//   @greenfield/money reads these tables (via the typed
//   Database interface) to compute the per-packaged-lot
//   landed cost. The pure-function helpers (toMinorUnits,
//   convertMinor, splitVat, cascadeCost) live in
//   @greenfield/money — no business logic in the db package
//   (per the card body's "Implementation Notes" final bullet).

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

// ── enums ─────────────────────────────────────────────────────────────────
//
// landed_cost_cost_kind: extended in 0.13 to add 'broker_fee'
// and 'fx_adjustment'. The 0.9 value 'storage' is retained.
// landed_cost_target_kind is REMOVED in 0.13 (see file header).

export const landedCostCostKind = pgEnum('landed_cost_cost_kind', [
  'freight',
  'duty',
  'insurance',
  'packaging',
  'storage',
  'broker_fee',
  'fx_adjustment',
  'other',
] as const);
export type LandedCostCostKind =
  (typeof landedCostCostKind.enumValues)[number];

// ── fx_rate ──────────────────────────────────────────────────────────────
//
// Reference data: a snapshot of an FX rate at a point in time.
// No org FK — the same rate applies across orgs (it's a market
// observation). The (base, quote, as_of) triple is unique; a
// later rate for the same pair is a new row.
//
// `rate_cents_per_unit` is bigint. The 0.13 spec example: EUR→GBP
// at 0.85 = 85 (i.e. 1 EUR = 0.85 GBP = 85 pence-per-EUR).
// The rate is in MINOR UNITS of the QUOTE currency per UNIT of
// the BASE currency. So:
//
//   100 EUR * 85 pence-per-EUR / 100 pence-per-GBP
//         = 85 GBP
//
//   100 EUR → convertMinor(10000n, 'EUR', 'GBP', fxRate)
//          → 10000n * 85n / 100n = 8500n (85.00 GBP)
//
// The 100 in the denominator is a constant derived from the
// quote currency's minor-unit exponent (e.g. GBP has exponent 2,
// EUR has exponent 2, JPY has exponent 0). The @greenfield/money
// package exposes a `MINOR_UNITS_EXPONENT` map; the cascade
// function uses it to do the integer arithmetic without
// floating-point.
//
// `source` is a free-form text ("ecb_daily", "manual", etc.).
// v1 doesn't constrain the set — different FX providers are
// pluggable in v1.5.

export const fxRate = pgTable(
  'fx_rate',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    baseCurrency: text('base_currency').notNull(),
    quoteCurrency: text('quote_currency').notNull(),
    rateCentsPerUnit: bigint('rate_cents_per_unit', { mode: 'number' })
      .notNull(),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // UNIQUE on (base, quote, as_of). The same rate observed at
    // a later time is a new row; the (base, quote) pair may have
    // many rows over time.
    pairAsOfUnique: unique('fx_rate_pair_as_of_unique').on(
      table.baseCurrency,
      table.quoteCurrency,
      table.asOf,
    ),
    pairIdx: index('fx_rate_base_quote_idx').on(
      table.baseCurrency,
      table.quoteCurrency,
    ),
    asOfIdx: index('fx_rate_as_of_idx').on(table.asOf),
    baseIso3: check(
      'fx_rate_base_currency_iso3_check',
      sql`length(${table.baseCurrency}) = 3`,
    ),
    quoteIso3: check(
      'fx_rate_quote_currency_iso3_check',
      sql`length(${table.quoteCurrency}) = 3`,
    ),
    ratePositive: check(
      'fx_rate_rate_cents_per_unit_positive_check',
      sql`${table.rateCentsPerUnit} > 0`,
    ),
    distinctCurrencies: check(
      'fx_rate_distinct_currencies_check',
      sql`${table.baseCurrency} <> ${table.quoteCurrency}`,
    ),
  }),
);

export type FxRate = typeof fxRate.$inferSelect;
export type NewFxRate = typeof fxRate.$inferInsert;

// ── landed_cost_event ─────────────────────────────────────────────────────
//
// A single cost line on a lot. The 0.13 spec uses three direct
// FK columns (green_lot_id, roasted_lot_id, packaged_lot_id),
// all nullable, with a CHECK enforcing exactly-one-non-null.
//
// "exactly one non-null" is stronger than "at most one
// non-null": a cost that doesn't apply to any of the three
// lot kinds is invalid (a cost must have a target). The CHECK
// uses a CASE expression or three booleans.
//
// `amount_cents` is bigint minor units of `currency_code`. The
// column name matches the 0.13 spec's `amount_cents` (vs the
// 0.9 name `amount_minor_units` — same value, just a
// shorter name per the 0.13 spec).
//
// `currency_code` is the event's currency. To convert to the
// org's base currency: multiply amount_cents by
// fx_snapshot_cents_per_base and divide by 100 (for 2-decimal
// currencies; the @greenfield/money helper handles the
// per-currency exponent).
//
// `fx_snapshot_cents_per_base` is the rate observed at event
// time, NULL when the event's currency is the org base.
//
// `vat_recoverable` is true for B2B reverse-charge
// situations; the cascade EXCLUDES recoverable VAT from the
// landed cost (it's a pass-through).
//
// `occurred_at` is the event time (when the cost was
// incurred). `created_at` is the system clock (when the row
// was inserted). The two are usually close but not
// identical — an operator back-dating a late-arriving invoice
// would set `occurred_at` to the invoice date and `created_at`
// to the row-insert time.

export const landedCostEvent = pgTable(
  'landed_cost_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // The three direct FK columns. Exactly one is non-null
    // (CHECK below).
    greenLotId: uuid('green_lot_id'),
    roastedLotId: uuid('roasted_lot_id'),
    packagedLotId: uuid('packaged_lot_id'),
    kind: landedCostCostKind('kind').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currencyCode: text('currency_code').notNull(),
    // The FX rate observed at event time, in pence-per-unit of
    // the base currency per 1 unit of `currency_code`. NULL
    // when currency_code is the org's base currency (no
    // conversion needed).
    fxSnapshotCentsPerBase: bigint('fx_snapshot_cents_per_base', {
      mode: 'number',
    }),
    // True for B2B reverse-charge (the org reclaims the VAT).
    // The cascade EXCLUDES this amount from the landed cost
    // (it's a pass-through). Default false (most events are
    // VAT-inclusive domestic).
    vatRecoverable: boolean('vat_recoverable').notNull().default(false),
    // Optional supplier linkage — the billing supplier for
    // the cost. Forward reference to public.supplier (card
    // 0.11). NULL when the cost isn't supplier-billed (a
    // broker fee, a storage charge from a 3PL, an FX
    // adjustment).
    supplierId: uuid('supplier_id'),
    // Optional human description for the audit trail.
    description: text('description'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: uuid('created_by_user_id').notNull(),
  },
  (table) => ({
    orgIdIdx: index('landed_cost_event_org_id_idx').on(table.orgId),
    greenLotIdx: index('landed_cost_event_green_lot_id_idx').on(
      table.greenLotId,
    ),
    roastedLotIdx: index('landed_cost_event_roasted_lot_id_idx').on(
      table.roastedLotId,
    ),
    packagedLotIdx: index('landed_cost_event_packaged_lot_id_idx').on(
      table.packagedLotId,
    ),
    supplierIdx: index('landed_cost_event_supplier_id_idx').on(
      table.supplierId,
    ),
    occurredAtIdx: index('landed_cost_event_org_id_occurred_at_idx').on(
      table.orgId,
      table.occurredAt,
    ),
    kindIdx: index('landed_cost_event_org_id_kind_idx').on(
      table.orgId,
      table.kind,
    ),
    currencyIso3: check(
      'landed_cost_event_currency_iso3_check',
      sql`length(${table.currencyCode}) = 3`,
    ),
    amountNonZero: check(
      'landed_cost_event_amount_nonzero_check',
      sql`${table.amountCents} <> 0`,
    ),
    // Exactly one of the three FK columns is non-null. A cost
    // MUST apply to exactly one of green_lot / roasted_lot /
    // packaged_lot. The check is:
    //   (green_lot_id IS NOT NULL)::int
    // + (roasted_lot_id IS NOT NULL)::int
    // + (packaged_lot_id IS NOT NULL)::int = 1
    exactlyOneTarget: check(
      'landed_cost_event_exactly_one_target_check',
      sql`(
        (CASE WHEN ${table.greenLotId} IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN ${table.roastedLotId} IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN ${table.packagedLotId} IS NOT NULL THEN 1 ELSE 0 END)
      ) = 1`,
    ),
    // fx_snapshot_cents_per_base is NULL when the event's
    // currency equals the org base currency; otherwise it
    // must be a positive integer. The application layer is
    // expected to set this correctly; the CHECK is a safety
    // net. (The DB doesn't have a direct way to read the
    // org's base currency; the application's responsibility
    // is to ensure the value is NULL when not needed.)
    fxSnapshotPositive: check(
      'landed_cost_event_fx_snapshot_positive_check',
      sql`${table.fxSnapshotCentsPerBase} IS NULL OR ${table.fxSnapshotCentsPerBase} > 0`,
    ),
  }),
);

export type LandedCostEvent = typeof landedCostEvent.$inferSelect;
export type NewLandedCostEvent = typeof landedCostEvent.$inferInsert;
