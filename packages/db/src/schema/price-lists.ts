// packages/db/src/schema/price-lists.ts
//
// Card 0.9 / plan §7.3 — pricing tables.
//
// TABLES HERE
//
//   price_list       — a named price book (e.g. "Retail EU 2026",
//                      "Wholesale UK 2026", "December promo").
//   price_list_entry — the per-SKU price within a price_list.
//                      (org_id, price_list_id, sku_id) is unique.
//
// VAT MODE
//
//   The card body is explicit: price_list.vat_inclusive (boolean)
//   AND price_list.vat_mode (enum 'inclusive' / 'exclusive') are
//   both stored. The boolean is a fast filter; the enum is the
//   human-readable mode. They MUST stay in sync; a CHECK enforces
//   the equivalence.
//
//   For v1 the mode is per-list. A v1.5 card may add a per-SKU
//   override (a SKU that breaks the list's VAT mode for tax
//   reasons — e.g. food vs non-food in a wholesale context).
//
// CURRENCY
//
//   price_list.currency_code (text) is required. The seed (card
//   0.14) exercises both EUR and GBP. The card body says
//   "currency_code: text from the start". We add a CHECK that
//   the code is in the 16 UK/EU country codes' currencies — but
//   that's a fragile constraint (USD is allowed for an exporter
//   selling to a US distributor). Instead we just CHECK
//   length=3 (ISO 4217 alpha-3) and let the application
//   validate against a reference list at write time. Same
//   pattern as the country code check on green_lot.
//
// MONEY COLUMNS
//
//   price_list_entry.price_minor_units is `bigint` cents. The
//   full money spine (FX snapshot, minor-unit arithmetic helpers)
//   lives in card 0.13. The column is `bigint` here so 0.13 can
//   ALTER the type to its `money_amount` composite without
//   rewriting rows.
//
//   `currency_code` is the entry's currency (defaults to the
//   parent price_list's currency). The seed (0.14) doesn't
//   override per-entry; a v1.5 may want per-SKU currency
//   (e.g. a USD-priced item in a EUR list).
//
// PRICE LIST TYPE / AUDIENCE
//
//   price_list.kind: 'retail' / 'wholesale' / 'promo' / 'internal'.
//   Drives the order form's price-list picker (retail hides
//   wholesale lists, wholesale hides retail, etc.). The
//   'internal' kind is for cost-only lists visible to
//   accountant / owner roles.
//
// CROSS-MODULE FKs (forward references)
//
//   price_list_entry.sku_id → sku (this card) — bare uuid, FK
//                              added in 0007_operational.sql
//
//   The FK lands in the same migration as the FK from
//   packaged_lot.sku_id, so a v1.5 reader of either column
//   has a consistent reference.

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { sku } from './operational.js';

// ── enums ─────────────────────────────────────────────────────────────────

// The enum is named `price_list_vat_mode` to match the existing
// meta/0005_snapshot.json (the snapshot pre-registered this
// enum name in card 0.10's snapshot due to a forward reference
// from the lot schema). The values 'inclusive' / 'exclusive'
// are identical to what `price_list_mode` would carry; the
// name is the only thing that matters for the snapshot diff.
export const priceListVatMode = pgEnum('price_list_vat_mode', [
  'inclusive',
  'exclusive',
] as const);
export type PriceListVatMode =
  (typeof priceListVatMode.enumValues)[number];

export const priceListKind = pgEnum('price_list_kind', [
  'retail',
  'wholesale',
  'promo',
  'internal',
] as const);
export type PriceListKind = (typeof priceListKind.enumValues)[number];

// ── price_list ────────────────────────────────────────────────────────────

export const priceList = pgTable(
  'price_list',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: priceListKind('kind').notNull().default('retail'),
    // VAT mode — enum AND a derived boolean. Both stored so the
    // filter is cheap and the human-readable mode is explicit.
    // The CHECK enforces the equivalence.
    vatMode: priceListVatMode('vat_mode').notNull().default('exclusive'),
    vatInclusive: boolean('vat_inclusive')
      .notNull()
      .default(false),
    // Default VAT rate as a percentage. NULL = "use the org's
    // standard rate at order time" (the order form prompts for
    // it). CHECK 0 <= rate < 100.
    vatRatePct: numeric('vat_rate_pct', { precision: 5, scale: 2 }),
    currencyCode: text('currency_code').notNull(),
    // Optional date range for promos. The order form picks the
    // "active" price list for the order date (and the SKU within
    // it). A list with NULL dates is always eligible.
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgCodeUnique: unique('price_list_org_id_code_unique').on(
      table.orgId,
      table.code,
    ),
    orgIdIdx: index('price_list_org_id_idx').on(table.orgId),
    activeIdx: index('price_list_org_id_active_idx').on(
      table.orgId,
      table.active,
    ),
    kindIdx: index('price_list_org_id_kind_idx').on(table.orgId, table.kind),
    currencyIso3: check(
      'price_list_currency_iso3_check',
      sql`length(${table.currencyCode}) = 3`,
    ),
    vatModeConsistency: check(
      'price_list_vat_mode_consistency_check',
      sql`(${table.vatMode} = 'inclusive' AND ${table.vatInclusive} = true) OR (${table.vatMode} = 'exclusive' AND ${table.vatInclusive} = false)`,
    ),
    vatRateRange: check(
      'price_list_vat_rate_range_check',
      sql`${table.vatRatePct} IS NULL OR (${table.vatRatePct} >= 0 AND ${table.vatRatePct} < 100)`,
    ),
    effectiveDatesOrdered: check(
      'price_list_effective_dates_ordered_check',
      sql`${table.effectiveFrom} IS NULL OR ${table.effectiveTo} IS NULL OR ${table.effectiveTo} >= ${table.effectiveFrom}`,
    ),
  }),
);

export type PriceList = typeof priceList.$inferSelect;
export type NewPriceList = typeof priceList.$inferInsert;

// ── price_list_entry ─────────────────────────────────────────────────────

export const priceListEntry = pgTable(
  'price_list_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // FK to price_list — same module, .references() is OK.
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceList.id, { onDelete: 'cascade' }),
    // FK to sku — same workspace, .references() is OK.
    skuId: uuid('sku_id')
      .notNull()
      .references(() => sku.id, { onDelete: 'restrict' }),
    priceMinorUnits: bigint('price_minor_units', { mode: 'number' }).notNull(),
    // The entry's currency. Defaults to the parent list's
    // currency at INSERT time (application logic; no DB
    // default since the default depends on the parent row).
    currencyCode: text('currency_code').notNull(),
    // VAT rate in BASIS POINTS (UK 20% = 2000, DE 19% = 1900,
    // NL 21% = 2100, FR 20% = 2000, IE 23% = 2300). Card 0.13
    // spec. The price_list.vat_rate_pct column captures the
    // list-level default; this per-entry override is for SKUs
    // that break the list's rate (e.g. food vs non-food in a
    // wholesale context). NULL = inherit from
    // price_list.vat_rate_pct (or use the org's standard rate
    // at order time if neither is set).
    //
    // CHECK in [0, 10000) bps = 0%-99.99%. The 100% case
    // (VAT = full price) is degenerate and a likely data bug.
    vatRateBps: integer('vat_rate_bps'),
    // Optional min quantity for the entry to apply (volume
    // discount: 1+ at €X, 12+ at €Y). NULL = any quantity.
    minQuantity: numeric('min_quantity', { precision: 10, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // UNIQUE (org_id, price_list_id, sku_id) — one entry per
    // (list, sku) at v1. Multi-currency / multi-quantity
    // pricing tiers (v1.5) add a new column to the unique.
    listSkuUnique: unique(
      'price_list_entry_org_id_price_list_id_sku_id_unique',
    ).on(table.orgId, table.priceListId, table.skuId),
    orgIdIdx: index('price_list_entry_org_id_idx').on(table.orgId),
    priceListIdIdx: index('price_list_entry_price_list_id_idx').on(
      table.priceListId,
    ),
    skuIdIdx: index('price_list_entry_sku_id_idx').on(table.skuId),
    pricePositive: check(
      'price_list_entry_price_positive_check',
      sql`${table.priceMinorUnits} > 0`,
    ),
    currencyIso3: check(
      'price_list_entry_currency_iso3_check',
      sql`length(${table.currencyCode}) = 3`,
    ),
    minQuantityPositive: check(
      'price_list_entry_min_quantity_positive_check',
      sql`${table.minQuantity} IS NULL OR ${table.minQuantity} > 0`,
    ),
    vatRateBpsRange: check(
      'price_list_entry_vat_rate_bps_range_check',
      sql`${table.vatRateBps} IS NULL OR (${table.vatRateBps} >= 0 AND ${table.vatRateBps} < 10000)`,
    ),
  }),
);

export type PriceListEntry = typeof priceListEntry.$inferSelect;
export type NewPriceListEntry = typeof priceListEntry.$inferInsert;
