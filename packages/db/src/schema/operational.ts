// packages/db/src/schema/operational.ts
//
// Card 0.9 / plan §7.3 — operational entities the roaster uses
// day-to-day, but which are NOT part of the lot spine (that lives
// in card 0.10).
//
// TABLES HERE
//
//   sku        — saleable product (e.g. "Brazil Cerrado 250g",
//                "Decaf Colombia 1kg"). One SKU per (org, code).
//   packaging  — the physical container a SKU ships in. A SKU
//                references a packaging; the packaging carries
//                weight + material specs.
//   recipe     — a roast profile: charge weight, target drop
//                weight, expected yield, durations, profile ref.
//                v1 stores the spec; the runtime (Phase 1 / card
//                0.21) consumes it. NULL recipe on a roast_batch
//                is allowed for ad-hoc batches.
//
// SKU ↔ PACKAGING ↔ RECIPE — NOT IN V1
//
//   The card body does not require an explicit FK from sku →
//   packaging or sku → recipe. A SKU MAY reference a packaging
//   (the "this SKU is always packed in this 250g valve bag"
//   relationship), and a roast_batch MAY reference a recipe, but
//   those edges are stored on the lot spine side, not the SKU
//   side. The sku table is the product catalog; the relationship
//   to the lot spine is via the packaged_lot.sku_id column in
//   card 0.10.
//
//   If a v1.5 card wants to model "the canonical recipe for a
//   SKU" (a 1:1 from sku → recipe used to seed roast_batch.recipe
//   in the form), it lands here as a NEW column. v1 keeps the
//   tables independent so a SKU can be sold without a canonical
//   recipe (e.g. "gift card" SKU or a wholesale SKU shipped from
//   a third-party roaster).
//
// CROSS-MODULE FKs (forward references — NO .references() in TS)
//
//   packaged_lot.sku_id       → sku (this card) — FK added in
//                                0007_operational.sql
//   packaged_lot.packaging_id → packaging (this card) — FK added
//                                in 0007_operational.sql
//   roast_batch.recipe_id     → recipe (this card) — FK added in
//                                0007_operational.sql
//
//   The forward references live in the lot spine (lots.ts) as
//   bare `uuid` columns with comment blocks. This card's
//   migration adds the FKs with NOT VALID + VALIDATE per the
//   convention in lots.ts §CROSS-MODULE FKs.
//
// CODES
//
//   SKU codes are operator-facing ("BRA-250", "DECAF-COL-1K")
//   and the QR printed on the retail bag. UNIQUE (org_id, code).
//   Packaging codes are warehouse-facing ("VB-250", "CASE-12").
//   Recipe codes are roaster-facing ("ESPRESSO-DEV-1", "BRA-STD").

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

// ── sku ────────────────────────────────────────────────────────────────────

export const sku = pgTable(
  'sku',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    // Reference weight in grams for the unit (a 250g bag has
    // unit_weight_g = 250; a 1kg bag has 1000). Used by the
    // pack form to default the unit weight input. CHECK > 0.
    unitWeightG: numeric('unit_weight_g', { precision: 10, scale: 3 }),
    // Wholesale-vs-retail flag — drives the price-list
    // resolution at order entry. v1 supports one channel per
    // SKU; multi-channel is v1.5 (the per-SKU price_list
    // resolution already supports it via price_list_entry).
    wholesaleOnly: boolean('wholesale_only').notNull().default(false),
    // Tags as a free-form text array for the operator's
    // organisation ("single-origin", "decaf", "espresso").
    // v1.5 may switch this to a structured tag table.
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    // Display sort order for the admin UI; NULL = no override.
    sortOrder: integer('sort_order'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgCodeUnique: unique('sku_org_id_code_unique').on(
      table.orgId,
      table.code,
    ),
    orgIdIdx: index('sku_org_id_idx').on(table.orgId),
    activeIdx: index('sku_org_id_active_idx').on(table.orgId, table.active),
    unitWeightPositive: check(
      'sku_unit_weight_positive_check',
      sql`${table.unitWeightG} IS NULL OR ${table.unitWeightG} > 0`,
    ),
  }),
);

export type Sku = typeof sku.$inferSelect;
export type NewSku = typeof sku.$inferInsert;

// ── packaging ─────────────────────────────────────────────────────────────

export const packaging = pgTable(
  'packaging',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    // Material: 'valve_bag', 'pillow_bag', 'tin', 'case',
    // 'pouch', 'pod', 'other' — text with a CHECK on the
    // allowed set. We use text + CHECK (not pgEnum) because
    // the PRD lists 6 values but new materials (a
    // compostable pod, say) land in v1.x without a migration.
    material: text('material').notNull(),
    // Net weight of the EMPTY packaging in grams (the tare).
    // Used by the pack form to compute the gross weight from
    // the net weight. CHECK >= 0 (a cardboard tube has 0
    // tare; a glass jar has 200+).
    tareWeightG: numeric('tare_weight_g', { precision: 10, scale: 3 })
      .notNull()
      .default('0'),
    // Capacity in grams — the maximum net weight this packaging
    // can hold. A 250g valve bag has capacity 250; a 1kg bag
    // has 1000. CHECK > 0.
    capacityG: numeric('capacity_g', { precision: 10, scale: 3 }).notNull(),
    // Cost per packaging unit in MINOR UNITS (e.g. cents) of
    // the org's base currency. Card 0.9 ships a plain bigint;
    // the full money-spine primitives (FX snapshot, minor-unit
    // arithmetic helpers) land in card 0.13. The currency is
    // implicit (= org.base_currency); an FX conversion happens
    // at landed-cost allocation time in card 0.13.
    costMinorUnits: integer('cost_minor_units').notNull().default(0),
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
    orgCodeUnique: unique('packaging_org_id_code_unique').on(
      table.orgId,
      table.code,
    ),
    orgIdIdx: index('packaging_org_id_idx').on(table.orgId),
    materialCheck: check(
      'packaging_material_check',
      sql`${table.material} IN ('valve_bag', 'pillow_bag', 'tin', 'case', 'pouch', 'pod', 'other')`,
    ),
    tareWeightNonNegative: check(
      'packaging_tare_weight_non_negative_check',
      sql`${table.tareWeightG} >= 0`,
    ),
    capacityPositive: check(
      'packaging_capacity_positive_check',
      sql`${table.capacityG} > 0`,
    ),
    costNonNegative: check(
      'packaging_cost_non_negative_check',
      sql`${table.costMinorUnits} >= 0`,
    ),
  }),
);

export type Packaging = typeof packaging.$inferSelect;
export type NewPackaging = typeof packaging.$inferInsert;

// ── recipe ────────────────────────────────────────────────────────────────
//
// A roast profile. The runtime (Phase 1 / card 0.21) consumes
// the profile; v1 stores the spec.
//
// `profile_json` is a free-form jsonb with the per-second
// (time, bean_temp, env_temp, gas_pct, fan_pct) trace. v1
// schema doesn't constrain the shape — different roasters use
// different roast-logger formats. The UI normalises on import.
//
// `expected_yield_pct` is the historical yield (roasted /
// green) the roaster expects. CHECK in [0, 100].
//
// `charge_weight_g` is the typical batch size. CHECK > 0.
//
// `duration_seconds` is the typical roast duration. CHECK > 0.
// Stored as `integer` seconds; the jsonb profile has the
// per-second resolution.

export const recipe = pgTable(
  'recipe',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    profileJson: jsonb('profile_json')
      .$type<{
        seconds: Array<{
          t: number;
          bean_temp_c: number | null;
          env_temp_c: number | null;
          gas_pct: number | null;
          fan_pct: number | null;
        }>;
        notes: string;
      }>()
      .notNull()
      .default(sql`'{"seconds": [], "notes": ""}'::jsonb`),
    chargeWeightG: numeric('charge_weight_g', { precision: 10, scale: 3 })
      .notNull(),
    expectedYieldPct: numeric('expected_yield_pct', {
      precision: 5,
      scale: 2,
    }),
    durationSeconds: integer('duration_seconds').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgCodeUnique: unique('recipe_org_id_code_unique').on(
      table.orgId,
      table.code,
    ),
    orgIdIdx: index('recipe_org_id_idx').on(table.orgId),
    activeIdx: index('recipe_org_id_active_idx').on(table.orgId, table.active),
    chargeWeightPositive: check(
      'recipe_charge_weight_positive_check',
      sql`${table.chargeWeightG} > 0`,
    ),
    expectedYieldRange: check(
      'recipe_expected_yield_range_check',
      sql`${table.expectedYieldPct} IS NULL OR (${table.expectedYieldPct} >= 0 AND ${table.expectedYieldPct} <= 100)`,
    ),
    durationPositive: check(
      'recipe_duration_positive_check',
      sql`${table.durationSeconds} > 0`,
    ),
  }),
);

export type Recipe = typeof recipe.$inferSelect;
export type NewRecipe = typeof recipe.$inferInsert;

// ── recipe_component ─────────────────────────────────────────────────────
//
// Card 0.16 — the recipe's blend of green lots by percentage.
//
// The card body requires the Recipe admin form to "list of green-lot
// components with % of blend; validates total = 100% (within
// rounding)". A recipe's component list is the canonical blend spec:
// when a roaster pulls a green lot for a batch, they consult the
// recipe's components to know what fraction of the batch should be
// which lot. (The actual batch is `roast_batch_component`, card 0.10,
// which records the executed weights — not the spec.)
//
// `percent_bps` is integer basis points (1 bps = 0.01%). 10000 bps =
// 100%. The form's "total must equal 100%" check is
// `sum(percent_bps) === 10000` (with a small rounding tolerance to
// allow e.g. 3333 + 3333 + 3334 = 10000).
//
// UNIQUE (recipe_id, green_lot_id) — a green lot cannot appear twice
// in the same recipe's blend.
//
// FK to green_lot uses ON DELETE RESTRICT — deleting a green lot is
// blocked if it's referenced by a recipe_component. The recipe admin
// surfaces the reference in the delete-confirmation panel.
//
// Forward reference note: `green_lot` lives in schema/lots.ts (card
// 0.10). As with the existing forward references in this file, the
// TS column is a bare `uuid` and the SQL FK lands in the migration.

import { greenLot } from './lots.js';

export const recipeComponent = pgTable(
  'recipe_component',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    recipeId: uuid('recipe_id')
      .notNull()
      // FK added in 0009_admin_ui.sql — ON DELETE CASCADE so deleting
      // a recipe removes its blend lines.
      .references(() => recipe.id, { onDelete: 'cascade' }),
    greenLotId: uuid('green_lot_id')
      .notNull()
      // FK added in 0009_admin_ui.sql — ON DELETE RESTRICT so a
      // green lot referenced by a recipe cannot be deleted.
      .references(() => greenLot.id, { onDelete: 'restrict' }),
    percentBps: integer('percent_bps').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    recipeLotUnique: unique('recipe_component_recipe_lot_unique').on(
      table.recipeId,
      table.greenLotId,
    ),
    orgIdIdx: index('recipe_component_org_id_idx').on(table.orgId),
    greenLotIdIdx: index('recipe_component_green_lot_id_idx').on(
      table.greenLotId,
    ),
    percentBpsRange: check(
      'recipe_component_percent_bps_range_check',
      sql`${table.percentBps} >= 0 AND ${table.percentBps} <= 10000`,
    ),
  }),
);

export type RecipeComponent = typeof recipeComponent.$inferSelect;
export type NewRecipeComponent = typeof recipeComponent.$inferInsert;
