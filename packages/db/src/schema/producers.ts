// packages/db/src/schema/producers.ts
//
// Card 0.11 / plan §7.3 — Producer table + producer_verification_override.
//
// TABLES HERE
//
//   producer                          — the farm / cooperative where
//                                      the green coffee was grown.
//   producer_verification_override    — a v1.5-shaped event log: when a
//                                      producer's verification is
//                                      self-reported, the org records
//                                      a free-text reason + uploaded
//                                      PDF + checkbox. Schema supports
//                                      the override path now; UI lands
//                                      in card 0.17.
//
// PRODUCER vs SUPPLIER
//
//   A producer is the GROWER. A supplier is the SELLER. One supplier
//   typically sources from many producers. The lot spine
//   (green_lot.producer_id) points at the producer; the lot's
//   supplier_id points at the supplier. Both are needed for EUDR —
//   the supplier's risk and the producer's risk combine to compute
//   the lot's overall risk_status (see the recompute_lot_risk
//   trigger in 0006_compliance.sql).
//
// POSTGIS GEOLOCATION
//
//   `geolocation` is `geography(MultiPolygon, 4326)` — the producer's
//   farm boundary, in WGS84 lat/lon on the ellipsoid. We use
//   `geography` (not `geometry`) because the EUDR area-validation
//   check in card 0.22 is a ST_Area computation in square meters on
//   the WGS84 ellipsoid (plan §5.4). `geometry` would require a
//   projection choice; `geography` is unambiguously WGS84.
//
//   Drizzle doesn't have a built-in PostGIS type, so we declare a
//   `customType` and emit `geography(MultiPolygon, 4326)` via raw SQL
//   in the migration. The Drizzle column type is `text` for inserts
//   — the canonical input form is WKT (`MULTIPOLYGON(((...)))`) or
//   GeoJSON, both strings. App code uses PostGIS-aware helpers to
//   build the WKT; the column itself is opaque to Drizzle's type
//   system.
//
//   GIST index on the geography column is created in the migration —
//   spatial queries (`ST_Area`, `ST_Contains`) need it. The Drizzle
//   `index()` helper compiles to a btree index, so the GIST index
//   is declared in the migration body (not on the table builder).
//
// AREA HECTARES
//
//   `area_hectares` is `numeric` with CHECK > 0. The area-validation
//   check in card 0.22 compares ST_Area(geolocation) / 10000
//   (square meters → hectares) against this column and flags a
//   discrepancy > 20%. Both columns are necessary: ST_Area is the
//   measurement, area_hectares is what the producer CLAIMS, and a
//   delta between them is the audit signal.
//
// VERIFICATION SOURCE
//
//   `verification_source` is a pgEnum: 'self_reported' /
//   'third_party_verified' / 'satellite_imagery' / 'ground_survey'
//   per plan §5.4. A 'self_reported' producer REQUIRES an active
//   producer_verification_override row (enforced in the recompute
//   trigger / at the application layer — we don't model the
//   constraint at the schema level because the override is an
//   event, not a property of the producer).
//
// OVERRIDE TABLE
//
//   `producer_verification_override` captures the three things plan
//   §9 #16 says are required for a self-reported producer:
//
//     - free-text reason              → `reason_text`
//     - uploaded PDF                  → `pdf_object_path` (Supabase
//                                        Storage path; v1 stores the
//                                        path, the bucket itself is
//                                        provisioned in card 0.3)
//     - checkbox confirming risk     → `regulatory_risk_acknowledged`
//                                        (boolean, NOT NULL — must
//                                        be true; the UI enforces)
//
//   `actor_user_id` is typed `uuid` (forward reference to users)
//   without `.references()` — the FK lands when the user table is
//   re-confirmed in the migration. We add the FK in the migration
//   body so Drizzle-kit doesn't choke on the forward reference.
//
// UNIQUE on (producer_id, superseded_at IS NULL) — partial
// uniqueness: at most one ACTIVE override per producer. We model
// this as a `superseded_at` timestamp rather than a boolean so the
// audit trail of overrides is preserved (a roaster who "undoes"
// their override is recorded, not erased).

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

// Drizzle doesn't ship a PostGIS `geography` type. `customType` lets
// us declare the column type as far as Drizzle is concerned (string
// in, string out — typically WKT or GeoJSON), while the migration
// emits the real `geography(MultiPolygon, 4326)` DDL. The returned
// `dataType()` value is what drizzle-kit uses to compile `pgTable`'s
// column metadata; the migration's raw SQL overrides it on disk.
const geographyMultiPolygon = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'geography(MultiPolygon, 4326)';
  },
  toDriver(value: string): string {
    // App code passes WKT or GeoJSON as a string; we hand it to
    // Postgres verbatim. The migration adds a CHECK that the input
    // parses as valid geography via ST_GeomFromText — the app
    // doesn't need to validate client-side.
    return value;
  },
  fromDriver(value: string): string {
    // ST_AsText output by default; the app can also call
    // ST_AsGeoJSON if it wants a structured response.
    return value;
  },
});

// ── enums (verification source) ────────────────────────────────────────────

export const producerVerificationSource = pgEnum(
  'producer_verification_source',
  [
    'self_reported',
    'third_party_verified',
    'satellite_imagery',
    'ground_survey',
  ] as const,
);
export type ProducerVerificationSource =
  (typeof producerVerificationSource.enumValues)[number];

// ── producer ───────────────────────────────────────────────────────────────

export const producer = pgTable(
  'producer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    countryCode: text('country_code').notNull(),
    region: text('region'),
    geolocation: geographyMultiPolygon('geolocation'),
    areaHectares: numeric('area_hectares', { precision: 12, scale: 4 }),
    verificationSource: producerVerificationSource('verification_source')
      .notNull()
      .default('self_reported'),
    riskRating: text('risk_rating'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('producer_org_id_idx').on(table.orgId),
    countryIdx: index('producer_org_id_country_code_idx').on(
      table.orgId,
      table.countryCode,
    ),
    countryIso2: check(
      'producer_country_iso2_check',
      sql`length(${table.countryCode}) = 2`,
    ),
    areaPositive: check(
      'producer_area_hectares_positive_check',
      sql`${table.areaHectares} IS NULL OR ${table.areaHectares} > 0`,
    ),
  }),
);

export type Producer = typeof producer.$inferSelect;
export type NewProducer = typeof producer.$inferInsert;

// ── producer_verification_override ────────────────────────────────────────
//
// Event log: each override is a NEW row. The "currently active"
// override is the one with `superseded_at IS NULL`. Partial unique
// index is created in the migration (drizzle-kit's `unique()` helper
// doesn't model partial indexes).

export const producerVerificationOverride = pgTable(
  'producer_verification_override',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    producerId: uuid('producer_id')
      .notNull()
      // FK to producer — same module, so we can use .references() here.
      .references(() => producer.id, { onDelete: 'cascade' }),
    reasonText: text('reason_text').notNull(),
    pdfObjectPath: text('pdf_object_path'),
    regulatoryRiskAcknowledged: boolean(
      'regulatory_risk_acknowledged',
    )
      .notNull(),
    // actor_user_id is a forward reference to public.users; FK is
    // declared in the migration body to keep the Drizzle module
    // import surface small (no ./.users.js dependency).
    actorUserId: uuid('actor_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (table) => ({
    producerIdx: index(
      'producer_verification_override_producer_id_idx',
    ).on(table.producerId),
    orgIdIdx: index('producer_verification_override_org_id_idx').on(
      table.orgId,
    ),
    // No full UNIQUE on (producer_id) — partial uniqueness is modelled
    // as a CREATE UNIQUE INDEX ... WHERE superseded_at IS NULL in the
    // migration. The reason: a producer can have many SUPERSEDED
    // overrides but at most one ACTIVE one.
    acknowledgedRequired: check(
      'producer_verification_override_acknowledged_check',
      sql`${table.regulatoryRiskAcknowledged} = true`,
    ),
  }),
);

export type ProducerVerificationOverride =
  typeof producerVerificationOverride.$inferSelect;
export type NewProducerVerificationOverride =
  typeof producerVerificationOverride.$inferInsert;
