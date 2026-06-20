// packages/db/src/schema/lots.ts
//
// Card 0.10 / plan §7.3 — lot spine tables + stock_movement ledger.
//
// TABLES HERE
//
//   green_lot            — incoming green coffee (PRD §5.1)
//   roast_batch          — a roast event (PRD §5.1)
//   roast_batch_component — many-to-many join: roast_batch ↔ green_lot
//   roasted_lot          — loose roasted, post-roast pre-pack (PRD §5.1)
//   packaged_lot         — finished bags / cases (PRD §5.1)
//   stock_movement       — append-only inventory ledger (PRD §5.4)
//   lot_allocation       — reservation of a packaged lot to a customer/order
//   return_event         — customer return of a packaged lot
//
// CROSS-MODULE FKs (forward references — NO .references() in TS)
//
//   green_lot.supplier_id           → supplier (card 0.11) — FK added there
//   green_lot.producer_id           → producer (card 0.11) — FK added there
//   green_lot.eudr_reference_data_id → eudr_reference_data (card 0.11)
//
//   roast_batch.recipe_id           → recipe (card 0.9) — FK added there
//
//   packaged_lot.sku_id             → sku (card 0.9) — FK added there
//   packaged_lot.packaging_id       → packaging (card 0.9) — FK added there
//
//   return_event.order_line_id      → order_line (card 0.9) — FK added there
//
//   stock_movement.user_id          → users (this card)
//   roast_batch.roaster_user_id     → users (this card)
//
//   All cross-module columns are typed `uuid('col')` without
//   `.references(...)`. Card 0.9/0.11 add the FKs with NOT VALID + VALIDATE
//   pattern to avoid migration-ordering issues (the supplier/sku/recipe/
//   packaging tables don't exist yet when 0.10 ships).
//
// STOCK MOVEMENT POLYMORPHIC (target_kind, target_id)
//
//   The card body notes that `target_id` / `source_id` / `ref_id` are
//   polymorphic — at write time, (kind, target_kind) tells you which
//   table to JOIN to (green_lot / roast_batch / roasted_lot /
//   packaged_lot / order_line). No FK constraint; referential integrity
//   is enforced at the application layer.
//
// APPEND-ONLY INVARIANTS
//
//   stock_movement is append-only — UPDATE/DELETE blocked by trigger
//   (see migrations/0005_audit_event_triggers.sql). Audit_event also
//   append-only (card 0.12 merged into this card per the body).
//
// NUMERIC WEIGHTS
//
//   weight_kg columns use Drizzle's `numeric('col', { precision, scale })`.
//   drizzle-kit emits `numeric(p, s)` in the generated migration (NOT
//   `text`); the previous draft used text-by-accident. The CHECK > 0
//   constraints rely on numeric comparison; text can't do that without
//   a cast.
//
// HARVEST_YEAR
//
//   Stored as `integer` (NOT text) per the card body. CHECK
//   `harvest_year BETWEEN 2020 AND extract(year FROM now()) + 1` —
//   the upper bound allows for next-year-crop harvested in Q4.
//
// COUNTRY OF ORIGIN
//
//   `text` (2-letter ISO 3166-1 alpha-2). CHECK on length=2 —
//   we don't enumerate values because green coffee originates from
//   ~30 countries; hardcoding a list would block a Brazilian or
//   Honduran shipment. The CHECK enforces the format; the app
//   validates against a reference list at write time.
//
// LINEAGE (green_lot)
//
//   jsonb denormalised reverse-trace. The card body says: minimal
//   trigger on INSERT sets `{ green_lot_id: NEW.id }`. Deeper edges
//   (roast_batch → roasted_lot → packaged_lot) land in card 0.21's
//   smoke pass. See migrations/0005_audit_event_triggers.sql § 4.
//
// STATUS ENUMS
//
//   Status columns use Drizzle `pgEnum` (declared in this file). The
//   values are the literal unions the card body specifies; centralised
//   in enums.ts for cross-card visibility. Re-exported via schema/index.ts.
//
// STATUS DEFAULTS
//
//   green_lot.status, roasted_lot.status, and packaged_lot.status
//   default to 'available' — the lot has just been produced; the
//   operator marks it 'reserved' when allocated.

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
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

// ── enums (lot status + stock movement kind) ───────────────────────────────
//
// Declared locally because each is consumed by exactly one table in
// this module. enums.ts has the cross-card catalogue; these match its
// definitions 1:1 so the type system has a single source of truth.
//
// (The enums.ts module re-exports the same literals for consumers that
// import via the barrel — we keep both in sync.)

export const greenLotStatus = pgEnum('green_lot_status', [
  'available',
  'quarantined',
  'depleted',
] as const);
export type GreenLotStatus = (typeof greenLotStatus.enumValues)[number];

export const roastBatchStatus = pgEnum('roast_batch_status', [
  'completed',
  'cancelled',
] as const);
export type RoastBatchStatus = (typeof roastBatchStatus.enumValues)[number];

export const roastedLotStatus = pgEnum('roasted_lot_status', [
  'available',
  'reserved',
  'depleted',
] as const);
export type RoastedLotStatus = (typeof roastedLotStatus.enumValues)[number];

export const packagedLotStatus = pgEnum('packaged_lot_status', [
  'available',
  'reserved',
  'sold',
  'depleted',
] as const);
export type PackagedLotStatus = (typeof packagedLotStatus.enumValues)[number];

export const stockMovementKind = pgEnum('stock_movement_kind', [
  'receipt',
  'roast_consume',
  'roast_produce',
  'pack_consume',
  'pack_produce',
  'count_adjust',
  'sale_consume',
  'return_receive',
  'destruction',
] as const);
export type StockMovementKind = (typeof stockMovementKind.enumValues)[number];

// ── green_lot ───────────────────────────────────────────────────────────────
//
// Incoming green coffee, before any roasting. PRD §5.1.
//
// `supplier_id` / `producer_id` / `eudr_reference_data_id` are forward
// references to schema/compliance.ts (card 0.11). No `.references()`
// chain — card 0.11 adds the FKs with NOT VALID + VALIDATE so this
// migration can land before the supplier table exists.
//
// `code` is the supplier's lot code (e.g. 'ETH-2024-SID-001') plus an
// org-uniqueness constraint — two orgs can import the same supplier lot
// with different internal aliases.
//
// `lineage` is a denormalised reverse-trace. The BEFORE INSERT trigger
// in 0005_audit_event_triggers.sql sets it to `{ green_lot_id: NEW.id }`.
// Card 0.21 extends the trigger to walk the upstream chain.
export const greenLot = pgTable(
  'green_lot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id'),
    producerId: uuid('producer_id'),
    eudrReferenceDataId: uuid('eudr_reference_data_id'),
    code: text('code').notNull(),
    countryOfOrigin: text('country_of_origin').notNull(),
    harvestYear: integer('harvest_year').notNull(),
    weightKg: numeric('weight_kg', { precision: 12, scale: 3 }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    moisturePct: numeric('moisture_pct', { precision: 5, scale: 2 }),
    process: text('process'),
    notes: text('notes'),
    status: greenLotStatus('status').notNull().default('available'),
    lineage: jsonb('lineage')
      .$type<{ green_lot_id: string | null }>()
      .notNull()
      .default(sql`'{"green_lot_id": null}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgCodeUnique: unique('green_lot_org_id_code_unique').on(
      table.orgId,
      table.code,
    ),
    orgIdIdx: index('green_lot_org_id_idx').on(table.orgId),
    statusIdx: index('green_lot_org_id_status_idx').on(
      table.orgId,
      table.status,
    ),
    weightPositive: check(
      'green_lot_weight_positive_check',
      sql`${table.weightKg} > 0`,
    ),
    moistureRange: check(
      'green_lot_moisture_range_check',
      sql`${table.moisturePct} IS NULL OR (${table.moisturePct} >= 0 AND ${table.moisturePct} <= 100)`,
    ),
    harvestYearRange: check(
      'green_lot_harvest_year_range_check',
      sql`${table.harvestYear} >= 2020 AND ${table.harvestYear} <= extract(year from now())::int + 1`,
    ),
    countryIso2: check(
      'green_lot_country_iso2_check',
      sql`length(${table.countryOfOrigin}) = 2`,
    ),
  }),
);
export type GreenLot = typeof greenLot.$inferSelect;
export type NewGreenLot = typeof greenLot.$inferInsert;

// ── roast_batch ────────────────────────────────────────────────────────────
//
// A roast event. PRD §5.1.
//
// `recipe_id` is a forward reference to schema/operational.ts (card 0.9)
// — nullable because ad-hoc batches don't follow a recipe. FK lands
// with card 0.9.
//
// `status` is the roast lifecycle ('completed' | 'cancelled'). NULL
// status with NULL `completed_at` is the in-progress signal.
export const roastBatch = pgTable(
  'roast_batch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    recipeId: uuid('recipe_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    greenWeightInKg: numeric('green_weight_in_kg', {
      precision: 12,
      scale: 3,
    }).notNull(),
    roastedWeightOutKg: numeric('roasted_weight_out_kg', {
      precision: 12,
      scale: 3,
    }),
    yieldPct: numeric('yield_pct', { precision: 5, scale: 2 }),
    roasterUserId: uuid('roaster_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    roastProfileRef: text('roast_profile_ref'),
    notes: text('notes'),
    status: roastBatchStatus('status'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('roast_batch_org_id_idx').on(table.orgId),
    completedAtIdx: index('roast_batch_org_id_completed_at_idx').on(
      table.orgId,
      table.completedAt,
    ),
    greenWeightPositive: check(
      'roast_batch_green_weight_positive_check',
      sql`${table.greenWeightInKg} > 0`,
    ),
    roastedWeightPositive: check(
      'roast_batch_roasted_weight_positive_check',
      sql`${table.roastedWeightOutKg} IS NULL OR ${table.roastedWeightOutKg} > 0`,
    ),
    yieldRange: check(
      'roast_batch_yield_range_check',
      sql`${table.yieldPct} IS NULL OR (${table.yieldPct} >= 0 AND ${table.yieldPct} <= 100)`,
    ),
    completedAfterStarted: check(
      'roast_batch_completed_after_started_check',
      sql`${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.startedAt}`,
    ),
    completedStatusConsistency: check(
      'roast_batch_completed_status_consistency_check',
      sql`${table.status} IS DISTINCT FROM 'completed' OR ${table.completedAt} IS NOT NULL`,
    ),
  }),
);
export type RoastBatch = typeof roastBatch.$inferSelect;
export type NewRoastBatch = typeof roastBatch.$inferInsert;

// ── roast_batch_component ──────────────────────────────────────────────────
//
// Many-to-many: which green lots contributed to a roast batch and how
// much of each. A single roast batch can blend green lots from
// multiple suppliers / countries — this table is the join.
//
// UNIQUE (roast_batch_id, green_lot_id) — one row per (batch, lot).
// ON DELETE CASCADE from roast_batch: deleting a batch removes its
// components (the audit trail is in audit_event + stock_movement, so
// the data isn't truly lost). ON DELETE RESTRICT from green_lot:
// deleting a green lot with component rows is blocked; quarantine
// ('quarantined' status) is the legitimate alternative.
export const roastBatchComponent = pgTable(
  'roast_batch_component',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    roastBatchId: uuid('roast_batch_id')
      .notNull()
      .references(() => roastBatch.id, { onDelete: 'cascade' }),
    greenLotId: uuid('green_lot_id')
      .notNull()
      .references(() => greenLot.id, { onDelete: 'restrict' }),
    weightKg: numeric('weight_kg', { precision: 12, scale: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    batchLotUnique: unique('roast_batch_component_batch_lot_unique').on(
      table.roastBatchId,
      table.greenLotId,
    ),
    orgIdIdx: index('roast_batch_component_org_id_idx').on(table.orgId),
    greenLotIdIdx: index('roast_batch_component_green_lot_id_idx').on(
      table.greenLotId,
    ),
    weightPositive: check(
      'roast_batch_component_weight_positive_check',
      sql`${table.weightKg} > 0`,
    ),
  }),
);
export type RoastBatchComponent = typeof roastBatchComponent.$inferSelect;
export type NewRoastBatchComponent = typeof roastBatchComponent.$inferInsert;

// ── roasted_lot ────────────────────────────────────────────────────────────
//
// Loose roasted coffee, post-roast pre-pack. Created when a roast_batch
// transitions to 'completed'.
//
// UNIQUE (org_id, code) — operator-facing identifier (printed on
// the bulk bag).
// UNIQUE (org_id, roast_batch_id) — one roasted lot per roast batch
// (a batch produces exactly one roasted lot; the join is 1:1).
export const roastedLot = pgTable(
  'roasted_lot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    roastBatchId: uuid('roast_batch_id')
      .notNull()
      .references(() => roastBatch.id, { onDelete: 'restrict' }),
    weightKg: numeric('weight_kg', { precision: 12, scale: 3 }).notNull(),
    status: roastedLotStatus('status').notNull().default('available'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgCodeUnique: unique('roasted_lot_org_id_code_unique').on(
      table.orgId,
      table.code,
    ),
    orgRoastBatchUnique: unique('roasted_lot_org_id_roast_batch_id_unique').on(
      table.orgId,
      table.roastBatchId,
    ),
    orgIdIdx: index('roasted_lot_org_id_idx').on(table.orgId),
    statusIdx: index('roasted_lot_org_id_status_idx').on(
      table.orgId,
      table.status,
    ),
    weightPositive: check(
      'roasted_lot_weight_positive_check',
      sql`${table.weightKg} > 0`,
    ),
  }),
);
export type RoastedLot = typeof roastedLot.$inferSelect;
export type NewRoastedLot = typeof roastedLot.$inferInsert;

// ── packaged_lot ───────────────────────────────────────────────────────────
//
// Finished bags / cases ready to ship. PRD §5.1.
//
// `roast_batch_ids` is `uuid[]` — a single pack event can blend
// multiple roasted lots (the typical case: finishing off two half-bags
// into a 250g SKU). No FK array constraint; referential integrity
// enforced at app layer (the pack event handler validates each
// id exists in roasted_lot before inserting).
//
// `sku_id` / `packaging_id` are forward references to card 0.9.
//
// UNIQUE (org_id, code) — operator-facing identifier (printed on the
// retail bag's QR).
export const packagedLot = pgTable(
  'packaged_lot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    skuId: uuid('sku_id'),
    packagingId: uuid('packaging_id'),
    roastBatchIds: uuid('roast_batch_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    weightKg: numeric('weight_kg', { precision: 12, scale: 3 }).notNull(),
    count: integer('count').notNull(),
    unitWeightG: numeric('unit_weight_g', { precision: 10, scale: 3 }).notNull(),
    status: packagedLotStatus('status').notNull().default('available'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgCodeUnique: unique('packaged_lot_org_id_code_unique').on(
      table.orgId,
      table.code,
    ),
    orgIdIdx: index('packaged_lot_org_id_idx').on(table.orgId),
    statusIdx: index('packaged_lot_org_id_status_idx').on(
      table.orgId,
      table.status,
    ),
    weightPositive: check(
      'packaged_lot_weight_positive_check',
      sql`${table.weightKg} > 0`,
    ),
    countPositive: check(
      'packaged_lot_count_positive_check',
      sql`${table.count} > 0`,
    ),
    unitWeightPositive: check(
      'packaged_lot_unit_weight_positive_check',
      sql`${table.unitWeightG} > 0`,
    ),
  }),
);
export type PackagedLot = typeof packagedLot.$inferSelect;
export type NewPackagedLot = typeof packagedLot.$inferInsert;

// ── stock_movement ─────────────────────────────────────────────────────────
//
// The append-only inventory ledger. PRD §5.4.
//
// `kind` is an enum (receipt, roast_consume, roast_produce, …). The
// card body lists 9 kinds.
//
// `target_kind` / `target_id` are a polymorphic FK pair: target_id may
// point to green_lot, roast_batch, roasted_lot, or packaged_lot.
// `source_kind` / `source_id` are the same shape for the upstream leg
// of a movement (e.g. for `roast_consume`, source = green_lot;
// for `roast_produce`, source = roast_batch). `ref_kind` / `ref_id`
// link the movement to a domain event (e.g. order_line for a sale).
//
// `weight_kg` is signed — negative for consume, positive for produce.
// CHECK weight <> 0 prevents accidental zero-balance entries.
//
// APPEND-ONLY: BEFORE UPDATE/DELETE trigger raises (see
// 0005_audit_event_triggers.sql § 3 — same `append_only_block_mutation`
// function as audit_event).
export const stockMovement = pgTable(
  'stock_movement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    kind: stockMovementKind('kind').notNull(),
    targetKind: text('target_kind').notNull(),
    targetId: uuid('target_id').notNull(),
    weightKg: numeric('weight_kg', { precision: 12, scale: 3 }).notNull(),
    count: integer('count'),
    sourceKind: text('source_kind'),
    sourceId: uuid('source_id'),
    refKind: text('ref_kind'),
    refId: uuid('ref_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('stock_movement_org_id_idx').on(table.orgId),
    occurredAtIdx: index('stock_movement_org_id_occurred_at_idx').on(
      table.orgId,
      table.occurredAt,
    ),
    targetIdx: index('stock_movement_org_id_target_idx').on(
      table.orgId,
      table.targetKind,
      table.targetId,
    ),
    kindIdx: index('stock_movement_org_id_kind_idx').on(table.orgId, table.kind),
    weightNonzero: check(
      'stock_movement_weight_nonzero_check',
      sql`${table.weightKg} <> 0`,
    ),
    targetKindNonempty: check(
      'stock_movement_target_kind_nonempty_check',
      sql`length(${table.targetKind}) > 0`,
    ),
  }),
);
export type StockMovement = typeof stockMovement.$inferSelect;
export type NewStockMovement = typeof stockMovement.$inferInsert;

// ── lot_allocation ─────────────────────────────────────────────────────────
//
// Reservation of a packaged lot to a customer / pending order. The
// card body calls this "forward-compat" because the customer table
// doesn't exist yet (Phase 1) — `customer_id` is a plain uuid without
// a FK. Once customers land, an FK with NOT VALID + VALIDATE pattern
// wires it up without an outage.
//
// `qty` is the count of units (not weight). The lot's weight is
// decremented by a sale_consume stock_movement when the order ships,
// not by the allocation row itself — the allocation is a marker for
// "this lot is earmarked, don't auto-allocate elsewhere".
export const lotAllocation = pgTable(
  'lot_allocation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    packagedLotId: uuid('packaged_lot_id')
      .notNull()
      .references(() => packagedLot.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id'),
    qty: integer('qty').notNull(),
    reservedAt: timestamp('reserved_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('lot_allocation_org_id_idx').on(table.orgId),
    packagedLotIdIdx: index('lot_allocation_packaged_lot_id_idx').on(
      table.packagedLotId,
    ),
    qtyPositive: check(
      'lot_allocation_qty_positive_check',
      sql`${table.qty} > 0`,
    ),
  }),
);
export type LotAllocation = typeof lotAllocation.$inferSelect;
export type NewLotAllocation = typeof lotAllocation.$inferInsert;

// ── return_event ───────────────────────────────────────────────────────────
//
// Customer return of a packaged lot. PRD §6.2 (recall/return flow).
//
// `order_line_id` is a forward reference to card 0.9's order_line.
// `packaged_lot_id` is nullable because some returns arrive without
// the original packaging (e.g. "I lost the bag but want a refund on
// order #1234"). The application path is: lookup order_line → infer
// packaged_lot → set packaged_lot_id; otherwise nullable.
//
// `restock` (bool default false) — if true, a paired
// `stock_movement` of kind `return_receive` adds weight back to the
// packaged lot. If false, the lot is consumed (the return goes to
// destruction or write-off). The trigger / handler writes the
// stock_movement, not this table — return_event is the source of
// truth for the customer-facing record.
export const returnEvent = pgTable(
  'return_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    orderLineId: uuid('order_line_id'),
    packagedLotId: uuid('packaged_lot_id').references(() => packagedLot.id, {
      onDelete: 'set null',
    }),
    qty: integer('qty').notNull(),
    reasonCode: text('reason_code').notNull(),
    restock: boolean('restock').notNull().default(false),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('return_event_org_id_idx').on(table.orgId),
    packagedLotIdIdx: index('return_event_packaged_lot_id_idx').on(
      table.packagedLotId,
    ),
    qtyPositive: check(
      'return_event_qty_positive_check',
      sql`${table.qty} > 0`,
    ),
    reasonCodeNonempty: check(
      'return_event_reason_code_nonempty_check',
      sql`length(${table.reasonCode}) > 0`,
    ),
  }),
);
export type ReturnEvent = typeof returnEvent.$inferSelect;
export type NewReturnEvent = typeof returnEvent.$inferInsert;
