// packages/db/src/schema/organizations.ts
//
// Card 0.7 / plan §7.2 — Organization entity + Membership + RBAC.
//
// Three things live here:
//
//   1. `membership_role` — Postgres ENUM with the seven roles defined
//      in the card body. The PRD calls some of these by shorter names
//      (`packer`, `buyer`) but the card is the load-bearing spec; its
//      names (`pack_ship`, `buyer_receiving`) are more specific and
//      survive through to the rest of v1. PRD v1.2 §5.1 confirms the
//      seven-role model; the role enum is the single source of truth.
//
//   2. `organizations` — the tenant root. CHECK-constrained on
//      base_currency, region, data_residency so invalid states are
//      unrepresentable per plan §3. CHECK constraints are declared on
//      the Drizzle column and ALSO re-asserted in the migration body
//      (drizzle-kit silently drops them when emitting SQL — see
//      migrations/0003_organizations.sql for the manual re-add).
//
//   3. `memberships` — the (org_id, user_id) → role join. UNIQUE
//      (org_id, user_id) so a user can only hold one role per org
//      in v1; multi-role-per-org lands in v1.5 per the PRD §5.1
//      "one user can hold multiple roles" note.
//
// NOT here (out of scope for this card):
//
//   - Per-table RLS policies — those land with the operational tables
//     in cards 0.9 / 0.10 / 0.11.
//   - `vat_number`, `eori`, addresses, contacts — PRD §5.2 lists
//     them; they land in card 0.9 alongside the rest of the org
//     settings schema (the card body for 0.7 is explicit about the
//     minimum surface).
//   - `audit_event` — referenced by createOrganization but defined
//     in card 0.12 (compliance). The create path writes the row
//     via raw SQL with try/catch fallback, per the card body.

import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';

/**
 * The seven RBAC roles for v1.
 *
 * The PRD's §5.1 lists roles more loosely; the card body is the
 * load-bearing spec for v1 and uses these exact names. `pack_ship`
 * is more specific than `packer` (it covers both the packer-shipper
 * persona) and `buyer_receiving` covers both buyer-of-green and the
 * goods-receiving clerk.
 */
export const membershipRole = pgEnum('membership_role', [
  'owner',
  'head_roaster',
  'pack_ship',
  'buyer_receiving',
  'accountant',
  'compliance_officer',
  'readonly',
]);

export type MembershipRole = (typeof membershipRole.enumValues)[number];

/**
 * The 16 UK/EU country codes the v1 product supports, mapped to
 * their ISO 3166-1 alpha-2 region code.
 *
 * Region is what the DB CHECK-constrains; the UI uses the same set
 * to drive the country → region dropdown filter (sign-up form).
 *
 * PRD §5.2 lists the set explicitly; the card body calls for "16
 * UK/EU codes". The map is also the source of the data-residency
 * inference: a `country_code` of 'GB' implies data_residency='uk',
 * everyone else implies 'eu'. For v1 data_residency is hardcoded
 * to 'uk' (per PRD §11.1 — EU residency is v1.5), but the country
 * code is still captured so the migration path doesn't require
 * a schema change.
 */
export const UK_EU_REGIONS = {
  GB: 'GB',
  IE: 'IE',
  NL: 'NL',
  DE: 'DE',
  FR: 'FR',
  BE: 'BE',
  IT: 'IT',
  ES: 'ES',
  SE: 'SE',
  DK: 'DK',
  FI: 'FI',
  NO: 'NO',
  AT: 'AT',
  PL: 'PL',
  PT: 'PT',
  CH: 'CH',
} as const;

export type CountryCode = keyof typeof UK_EU_REGIONS;
export type RegionCode = (typeof UK_EU_REGIONS)[CountryCode];

/** Region → list of country codes (the inverse of UK_EU_REGIONS, for UI). */
export const REGION_TO_COUNTRIES: Record<RegionCode, readonly CountryCode[]> = {
  GB: ['GB'],
  IE: ['IE'],
  NL: ['NL'],
  DE: ['DE'],
  FR: ['FR'],
  BE: ['BE'],
  IT: ['IT'],
  ES: ['ES'],
  SE: ['SE'],
  DK: ['DK'],
  FI: ['FI'],
  NO: ['NO'],
  AT: ['AT'],
  PL: ['PL'],
  PT: ['PT'],
  CH: ['CH'],
};

/** Allowed `base_currency` values. v1 hard-locks to EUR/GBP per PRD §1.2. */
export const SUPPORTED_BASE_CURRENCIES = ['EUR', 'GBP'] as const;
export type BaseCurrency = (typeof SUPPORTED_BASE_CURRENCIES)[number];

/** Allowed `data_residency` values. v1 = 'uk' only; 'eu' is v1.5 (PRD §11.1). */
export const SUPPORTED_DATA_RESIDENCIES = ['uk'] as const;
export type DataResidency = (typeof SUPPORTED_DATA_RESIDENCIES)[number];

/**
 * EUDR settings (jsonb). Defaults match the card body and PRD §5.2:
 *
 *   - `small_quantity_threshold_kg` — EUDR's negligible-quantity threshold.
 *     PRD §6.5 explains the legal basis; the default of 1.0 kg matches
 *     the EU's published "below 1 kg" criterion at the time of writing.
 *   - `default_mode` — org-level default for NEW shipments. 'enforce' blocks
 *     shipments that can't generate a DDS; 'flag_only' warns but allows
 *     per-shipment opt-out. The PRD explicitly forbids an org-wide opt-out
 *     mode at any time — `opt_out_org` is intentionally NOT a valid value.
 *   - `country_risk_list` — version tag for the static risk reference. The
 *     runtime resolves the actual list in a follow-up card (0.11); v1
 *     uses 'static_v1' as a forward-compatible placeholder so the schema
 *     doesn't change when the list does.
 */
export interface EudrSettings {
  small_quantity_threshold_kg: number;
  default_mode: 'enforce' | 'flag_only';
  country_risk_list: 'static_v1';
}

export const DEFAULT_EUDR_SETTINGS: EudrSettings = {
  small_quantity_threshold_kg: 1.0,
  default_mode: 'enforce',
  country_risk_list: 'static_v1',
};

/**
 * `organizations` — the tenant root.
 *
 * One row per tenant. The id is a v4 UUID (postgres default) and is the
 * canonical value referenced by every RLS-scoped table — `withTenant(orgId, ...)`
 * from src/rls.ts uses this id to scope queries.
 *
 * `country_code` and `region` are kept as separate columns to match the
 * card body's minimum surface. v1 has a 1:1 mapping (`region === country_code`
 * for the 16 UK/EU codes) but the v1.5 expansion (additional non-EU regions,
 * crown dependencies, dual-region UK/EU for NI) needs both columns
 * independently — the v1 schema doesn't constrain country_code at the DB
 * level because the allowed set is wider than the region's. Application
 * code (the signup form) restricts the input set; the DB doesn't.
 *
 * CHECK constraints:
 *
 *   - `base_currency IN ('EUR', 'GBP')` — v1 hard-locks per PRD §1.2.
 *   - `region` matches the 16 UK/EU codes in `UK_EU_REGIONS`. Enforced
 *     with a `region = ANY(ARRAY[...])` expression because CHECK doesn't
 *     accept a JS array literal directly — the migration SQL is the
 *     source of truth (drizzle-kit's `check()` helper compiles to the
 *     same expression).
 *   - `data_residency IN ('uk')` — v1 single region per PRD §11.1. The
 *     `('uk')` form (single-element IN list) is intentional so the v1.5
 *     migration to add `'eu'` is a one-line constraint edit.
 *
 * Indexes:
 *
 *   - `organizations_pkey` — implicit on `id`.
 *
 * NOT in this table (PRD §5.2 lists them but they land in card 0.9):
 *   vat_number, eori, addresses (jsonb), contacts (jsonb), timezone, units.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    countryCode: text('country_code').notNull(),
    region: text('region').notNull(),
    baseCurrency: text('base_currency').notNull(),
    dataResidency: text('data_residency').notNull().default('uk'),
    eudrSettings: jsonb('eudr_settings')
      .$type<EudrSettings>()
      .notNull()
      .default(DEFAULT_EUDR_SETTINGS),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    baseCurrencyCheck: check(
      'organizations_base_currency_check',
      sql`${table.baseCurrency} IN ('EUR', 'GBP')`,
    ),
    regionCheck: check(
      'organizations_region_check',
      sql`${table.region} IN ('GB', 'IE', 'NL', 'DE', 'FR', 'BE', 'IT', 'ES', 'SE', 'DK', 'FI', 'NO', 'AT', 'PL', 'PT', 'CH')`,
    ),
    dataResidencyCheck: check(
      'organizations_data_residency_check',
      sql`${table.dataResidency} IN ('uk')`,
    ),
  }),
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

/**
 * `memberships` — the (org_id, user_id) → role join.
 *
 * The role enum is `membership_role`; the FK to `users` is declared
 * inline in the migration (cross-schema FK to public.users is fine,
 * but we follow the same pattern as the auth.users FK in 0001).
 *
 * Unique (org_id, user_id) — a user holds exactly one role per org
 * in v1. v1.5 may relax this.
 *
 * Indexes:
 *   - `memberships_pkey` — implicit on id
 *   - `memberships_org_id_user_id_unique` — UNIQUE constraint
 *   - `memberships_user_id_idx` — for "list my memberships" lookups
 *     (the /signup redirect uses this)
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      // .references() is omitted; FK is declared in the migration body
      // to keep the generated SQL portable (mirrors the pattern in
      // schema/users.ts).
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgUserUnique: uniqueIndex('memberships_org_id_user_id_unique').on(
      table.orgId,
      table.userId,
    ),
    userIdIdx: index('memberships_user_id_idx').on(table.userId),
  }),
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;