// packages/db/src/schema/suppliers.ts
//
// Card 0.11 / plan §7.3 — Supplier table.
//
// TABLES HERE
//
//   supplier — upstream entity that sells green coffee into the org.
//              Distinct from `producer` (the farm / cooperative where
//              the coffee was actually grown). One supplier typically
//              sources from many producers; the supplier carries the
//              commercial risk (the producer carries the EUDR plot
//              risk).
//
// EUDR CONTEXT (plan §4.4, §5.4)
//
//   The `risk_assessment` jsonb captures whatever the org has gathered
//   about the supplier's compliance posture. v1 doesn't enforce a
//   shape — the org's compliance_officer is the human in the loop,
//   and the schema is intentionally free-form. A v1.5 card may add
//   structured fields (last_dds_check_at, last_statement_reference,
//   etc.) once the founding team decides what to validate.
//
//   `dds_reference` is the supplier's own upstream DDS for their
//   imports (if they're a roaster themselves, they've already filed).
//   Captured as `text`; the parsed fields (reference number, issue
//   date) live in the jsonb rather than as columns because the EU
//   reference format is country-specific and we don't want a v1 schema
//   churn when the format changes.
//
//   `eori` is the supplier's Economic Operators Registration and
//   Identification number. For non-EU suppliers this is the EU-side
//   representative's EORI per the EU's "indirect customs
//   representation" model. Stored as `text` (no CHECK) because the
//   format is country-specific; the receiving UI validates.
//
// COUNTRY
//
//   `country_code` is ISO 3166-1 alpha-2 text (same convention as
//   `green_lot.country_of_origin`). CHECK length=2.
//
// ORG-LEVEL UNIQUENESS
//
//   UNIQUE (org_id, name) — same org can import from a supplier of
//   the same name in two countries, but the more natural constraint
//   is "no two suppliers with the same name in the same org". A
//   stricter (org_id, country_code, name) might be the right call
//   for a v1.5 — defer to feedback.

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

/**
 * Risk assessment shape (free-form jsonb; documented for consumers).
 *
 * v1 stores whatever the compliance_officer enters via the supplier
 * form. The structured fields below are the v1 minimum — extend in
 * v1.5 once the team has more field experience.
 */
export interface SupplierRiskAssessment {
  last_reviewed_at: string | null;
  dds_filed_by_supplier: boolean;
  notes: string;
}

export const supplier = pgTable(
  'supplier',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    countryCode: text('country_code').notNull(),
    eori: text('eori'),
    ddsReference: text('dds_reference'),
    riskAssessment: jsonb('risk_assessment')
      .$type<SupplierRiskAssessment>()
      .notNull()
      .default(sql`'{"last_reviewed_at": null, "dds_filed_by_supplier": false, "notes": ""}'::jsonb`),
    contact: jsonb('contact')
      .$type<{
        email: string | null;
        phone: string | null;
        address: string | null;
      }>()
      .notNull()
      .default(sql`'{"email": null, "phone": null, "address": null}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgNameUnique: unique('supplier_org_id_name_unique').on(
      table.orgId,
      table.name,
    ),
    orgIdIdx: index('supplier_org_id_idx').on(table.orgId),
    countryIso2: check(
      'supplier_country_iso2_check',
      sql`length(${table.countryCode}) = 2`,
    ),
  }),
);

export type Supplier = typeof supplier.$inferSelect;
export type NewSupplier = typeof supplier.$inferInsert;
