// packages/db/src/schema/eudr-high-risk-country.ts
//
// Card 0.20 / plan §7.4 — static EU high-risk country reference.
//
//   A small lookup table the computeShipmentCompliance function JOINs
//   against to decide whether a green lot's country is on the
//   European Commission's published high-risk list (plan §9 #17).
//   v1 ships a static snapshot; v2 will subscribe to email alerts
//   and INSERT new rows with a later effective_from date.
//
// TABLE
//
//   eudr_high_risk_country — keyed by ISO 3166-1 alpha-2 country
//   code; `effective_from` dates the publication so future
//   updates don't mutate history (a new row for BR with
//   effective_from = '2025-12-05' coexists with the 2024 row).
//   The "currently high-risk" query reads
//   `WHERE effective_from <= now() ORDER BY effective_from DESC`
//   per country — but for v1 the active list is the single
//   (effective_from) snapshot we ship, and the check in
//   compliance.ts can use a simpler existence check because the
//   loader limits to the current row.
//
// WHY NO FK TO organizations / public.users
//
//   This is a GLOBAL reference, not a per-org config. The EU
//   publishes one list; every org sees the same one. There's no
//   org_id column. v1.5 may add an organizations.eudr_settings
//   jsonb column for org-specific overrides; out of scope here.
//
// ISO2 CHECK
//
//   CHECK length(country_code) = 2 — same convention as supplier /
//   producer / green_lot.country_of_origin.

import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';

export const eudrHighRiskCountry = pgTable(
  'eudr_high_risk_country',
  {
    countryCode: text('country_code').primaryKey().notNull(),
    effectiveFrom: date('effective_from').notNull(),
    sourceUrl: text('source_url').notNull(),
    notes: text('notes'),
  },
  (table) => ({
    effectiveFromIdx: index('eudr_high_risk_country_effective_from_idx').on(
      sql`${table.effectiveFrom} DESC`,
    ),
    countryIso2: check(
      'eudr_high_risk_country_iso2_check',
      sql`length(${table.countryCode}) = 2`,
    ),
  }),
);

export type EudrHighRiskCountry = typeof eudrHighRiskCountry.$inferSelect;
export type NewEudrHighRiskCountry =
  typeof eudrHighRiskCountry.$inferInsert;
