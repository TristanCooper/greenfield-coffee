// packages/db/src/schema/orders.ts
//
// Card 0.9 / plan §7.3 — manual order entry (Phase 0) +
// integration stub columns (Phase 1).
//
// TABLES HERE
//
//   order        — a customer order. status enum drives the
//                  workflow: draft → pending → paid → fulfilled
//                  (or cancelled from any of draft / pending /
//                  paid).
//   order_line   — line items on the order: a SKU + quantity
//                  + price snapshot. The price snapshot is the
//                  per-line price AT ORDER TIME — the order is
//                  decoupled from price_list_entry changes.
//   order_edit   — audit trail of every state-change on the
//                  order. Append-only; same pattern as
//                  audit_event. The card body calls for an
//                  'order_edit' table; the implementation is an
//                  event log, not a single 'previous values'
//                  row.
//
// CHANNEL
//
//   `order.channel` captures how the order arrived: manual
//   (the Phase 0 form), email_in (the roaster typed it up
//   from an email), or one of the integration channels
//   (Phase 1: shopify, woocommerce, square_pos,
//   wholesale_portal). The seed (0.14) uses 'manual'.
//
// EXTERNAL ID
//
//   `order.external_id` is the integration system's order
//   reference. For 'manual' orders it's NULL. For 'shopify'
//   it's the Shopify order number (or UUID). The card body
//   says: "Include `external_id text` and `channel text`
//   columns to support the Phase 1 integration work even
//   though no integration code lands yet."
//
// CROSS-MODULE FKs (forward references)
//
//   order_line.packaged_lot_id → packaged_lot (card 0.10) —
//     optional. The Phase 0 form picks a packaged_lot to
//     fulfil from. NULL while the order is in 'draft' (the
//     operator reserves later).
//
//   order_line.price_list_entry_id → price_list_entry (this
//     card) — optional. Snapshot reference; the line carries
//     the price_minor_units as its own column for resilience
//     to price-list edits.
//
//   order.customer_id → a future customer table (not in
//     this card — see TODO). Bare uuid with a comment.
//
//   order.billing_address_id / shipping_address_id → a future
//     address table (not in this card). Bare uuid with a
//     comment.

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';
import { sku } from './operational.js';

// ── enums ─────────────────────────────────────────────────────────────────

export const orderStatus = pgEnum('order_status', [
  'draft',
  'pending',
  'paid',
  'fulfilled',
  'cancelled',
] as const);
export type OrderStatus = (typeof orderStatus.enumValues)[number];

export const orderChannel = pgEnum('order_channel', [
  'shopify',
  'woocommerce',
  'square_pos',
  'wholesale_portal',
  'email_in',
  'manual',
] as const);
export type OrderChannel = (typeof orderChannel.enumValues)[number];

export const orderEditKind = pgEnum('order_edit_kind', [
  'status_change',
  'line_added',
  'line_removed',
  'line_quantity_changed',
  'line_price_changed',
  'shipping_address_changed',
  'billing_address_changed',
  'note_added',
] as const);
export type OrderEditKind = (typeof orderEditKind.enumValues)[number];

// ── order ────────────────────────────────────────────────────────────────

export const order = pgTable(
  'order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    status: orderStatus('status').notNull().default('draft'),
    channel: orderChannel('channel').notNull().default('manual'),
    externalId: text('external_id'),
    // Forward references to a future customer + address tables.
    // Per the card body, those tables are not in v1; the v1 form
    // captures customer / address as free-text fields on the
    // order_edit audit trail.
    customerId: uuid('customer_id'),
    billingAddressId: uuid('billing_address_id'),
    shippingAddressId: uuid('shipping_address_id'),
    // Free-text customer name / contact for v1 (no customer
    // table yet).
    customerNameText: text('customer_name_text'),
    customerEmailText: text('customer_email_text'),
    customerPhoneText: text('customer_phone_text'),
    // Currency for the order. Per the card body, the org's
    // base_currency is the default; a v1.5 may let the operator
    // override.
    currencyCode: text('currency_code').notNull(),
    // Total in MINOR UNITS of `currency_code`. Computed at
    // order-write time (sum of order_line.subtotal_minor_units
    // + tax + shipping - discount). Stored for fast list views
    // (the daily board, the audit pack). bigint; full money
    // spine in 0.13.
    totalMinorUnits: bigint('total_minor_units', { mode: 'number' })
      .notNull()
      .default(0),
    placedAt: timestamp('placed_at', { withTimezone: true }),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgCodeUnique: unique('order_org_id_code_unique').on(
      table.orgId,
      table.code,
    ),
    orgIdIdx: index('order_org_id_idx').on(table.orgId),
    statusIdx: index('order_org_id_status_idx').on(table.orgId, table.status),
    channelIdx: index('order_org_id_channel_idx').on(table.orgId, table.channel),
    // For Phase 1 integration: UNIQUE (org_id, channel, external_id)
    // so the same external order can be upserted by channel. NULL
    // external_id excluded from the unique (Postgres UNIQUE
    // treats each NULL as distinct).
    channelExternalUnique: unique(
      'order_org_id_channel_external_id_unique',
    ).on(table.orgId, table.channel, table.externalId),
    currencyIso3: check(
      'order_currency_iso3_check',
      sql`length(${table.currencyCode}) = 3`,
    ),
    totalNonNegative: check(
      'order_total_non_negative_check',
      sql`${table.totalMinorUnits} >= 0`,
    ),
    placedAfterCreated: check(
      'order_placed_after_created_check',
      sql`${table.placedAt} IS NULL OR ${table.placedAt} >= ${table.createdAt}`,
    ),
  }),
);

export type Order = typeof order.$inferSelect;
export type NewOrder = typeof order.$inferInsert;

// ── order_line ───────────────────────────────────────────────────────────

export const orderLine = pgTable(
  'order_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // FK to order — same module, .references() is OK.
    orderId: uuid('order_id')
      .notNull()
      .references(() => order.id, { onDelete: 'cascade' }),
    // FK to sku — same workspace, .references() is OK.
    skuId: uuid('sku_id')
      .notNull()
      .references(() => sku.id, { onDelete: 'restrict' }),
    // Forward reference to packaged_lot. NULL while the line
    // is in 'draft' / 'pending'.
    packagedLotId: uuid('packaged_lot_id'),
    // Forward reference to price_list_entry. The snapshot
    // reference; the actual price is `unit_price_minor_units`
    // below, captured at order-write time.
    priceListEntryId: uuid('price_list_entry_id'),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
    // Price per unit at the time the line was added. Stored
    // as a snapshot so price-list edits don't mutate historical
    // orders.
    unitPriceMinorUnits: bigint('unit_price_minor_units', {
      mode: 'number',
    }).notNull(),
    // Currency of the line. Defaults to order.currency_code
    // at INSERT time (application logic).
    currencyCode: text('currency_code').notNull(),
    // Computed line subtotal. Stored for fast list views.
    // App code is expected to recompute on every write; the
    // CHECK enforces non-negative.
    subtotalMinorUnits: bigint('subtotal_minor_units', { mode: 'number' })
      .notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orderIdx: index('order_line_order_id_idx').on(table.orderId),
    orgIdIdx: index('order_line_org_id_idx').on(table.orgId),
    skuIdx: index('order_line_sku_id_idx').on(table.skuId),
    packagedLotIdx: index('order_line_packaged_lot_id_idx').on(
      table.packagedLotId,
    ),
    // UNIQUE on (order_id, sku_id, packaged_lot_id). Two lines
    // for the same SKU on the same order are merged by the
    // app; the unique is the safety net. The packaged_lot_id
    // is part of the key because a line can target a specific
    // lot (e.g. "this bag of Brazil" vs "any bag of Brazil").
    // NULL packaged_lot_id is allowed (the line is unallocated);
    // the unique treats each NULL as distinct.
    orderSkuLotUnique: unique(
      'order_line_order_id_sku_id_packaged_lot_id_unique',
    ).on(table.orderId, table.skuId, table.packagedLotId),
    currencyIso3: check(
      'order_line_currency_iso3_check',
      sql`length(${table.currencyCode}) = 3`,
    ),
    quantityPositive: check(
      'order_line_quantity_positive_check',
      sql`${table.quantity} > 0`,
    ),
    unitPriceNonNegative: check(
      'order_line_unit_price_non_negative_check',
      sql`${table.unitPriceMinorUnits} >= 0`,
    ),
    subtotalNonNegative: check(
      'order_line_subtotal_non_negative_check',
      sql`${table.subtotalMinorUnits} >= 0`,
    ),
  }),
);

export type OrderLine = typeof orderLine.$inferSelect;
export type NewOrderLine = typeof orderLine.$inferInsert;

// ── order_edit ───────────────────────────────────────────────────────────
//
// Append-only audit trail for every state change on the order.
// The card body specifies an `order_edit` table; this is the
// implementation: an event log.
//
// `kind` enum drives the shape of `diff` (jsonb):
//   - status_change:            { before: OrderStatus, after: OrderStatus }
//   - line_added:               { line: { sku_id, quantity, unit_price } }
//   - line_removed:             { line_id, snapshot }
//   - line_quantity_changed:    { line_id, before, after }
//   - line_price_changed:       { line_id, before, after }
//   - shipping_address_changed: { before, after }
//   - billing_address_changed:  { before, after }
//   - note_added:               { text }
//
// The append-only invariant is enforced by a trigger in
// 0007_operational.sql (reuses the shared
// append_only_block_mutation function from card 0.10).

export const orderEdit = pgTable(
  'order_edit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => order.id, { onDelete: 'cascade' }),
    kind: orderEditKind('kind').notNull(),
    diff: jsonb('diff')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Optional reference to the order_line this edit is about
    // (line_added, line_removed, line_*_changed). NULL for
    // status_change / note_added.
    orderLineId: uuid('order_line_id'),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    actorRoleSnapshot: text('actor_role_snapshot').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orderIdx: index('order_edit_order_id_idx').on(table.orderId),
    orgIdIdx: index('order_edit_org_id_idx').on(table.orgId),
    occurredAtIdx: index('order_edit_org_id_occurred_at_idx').on(
      table.orgId,
      table.occurredAt,
    ),
  }),
);

export type OrderEdit = typeof orderEdit.$inferSelect;
export type NewOrderEdit = typeof orderEdit.$inferInsert;
