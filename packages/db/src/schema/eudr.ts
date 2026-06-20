// packages/db/src/schema/eudr.ts
//
// Card 0.11 / plan §7.3 — EUDR tables.
//
// TABLES HERE
//
//   eudr_reference_data            — denormalised risk snapshot for a
//                                   green_lot. One row per lot (1:1
//                                   via green_lot.eudr_reference_data_id).
//                                   Recomputed by a trigger on
//                                   supplier / producer changes (see
//                                   0006_compliance.sql).
//
//   lot_producer                   — v1.5 multi-producer join table.
//                                   v1 uses a single-producer UX
//                                   (1:1 from green_lot.producer_id);
//                                   the schema supports v1.5's
//                                   multi-producer case in advance so
//                                   no migration is needed when the
//                                   UI relaxes the constraint.
//
//   dds_draft                      — Due Diligence Statement draft.
//                                   Source data stored as a jsonb
//                                   SNAPSHOT (not FKs) because DDS
//                                   PDFs are signed artifacts that
//                                   must remain valid even if upstream
//                                   data changes (plan §11.2).
//
//   shipment_eudr_decision         — per-shipment opt-out / opt-in
//                                   decision. `supersedes_id` is a
//                                   self-FK (plan §9 #19) — a new
//                                   decision supersedes an old one
//                                   rather than mutating it.
//
//   audit_pack                     — assembled, signed audit pack.
//                                   payload jsonb snapshot +
//                                   pdf_object_path (Supabase Storage
//                                   path) + signature_hash.
//
// ENUMS
//
//   eudr_reference_risk_status              — low / medium / high /
//                                              unassessed (per plan
//                                              §5.4). `unassessed`
//                                              blocks opt-out (plan
//                                              §6.5).
//   shipment_eudr_mode                      — the per-shipment
//                                              decision mode.
//   shipment_eudr_reason_code               — closed enum of opt-out
//                                              reasons.
//   dds_draft_status                        — draft / signed /
//                                              submitted / voided.
//   audit_pack_status                       — draft / signed /
//                                              submitted / archived.
//
// FORWARD REFERENCES (NO .references())
//
//   eudr_reference_data.lot_id              → green_lot (card 0.10
//                                              DONE on working tree)
//   dds_draft.lot_ids                       → green_lot[] (uuid[] —
//                                              no array FK; referential
//                                              integrity at app layer)
//   dds_draft.shipment_id                   → order (card 0.9) or
//                                              a future shipment table
//                                              — typed uuid, FK
//                                              lands when the target
//                                              table exists
//   dds_draft.supplier_id                   → supplier (this card —
//                                              the FK is in the same
//                                              migration)
//   dds_draft.producer_id                   → producer (this card)
//   shipment_eudr_decision.shipment_id      → order or future
//                                              shipment (typed uuid)
//   shipment_eudr_decision.actor_user_id    → users (public.users)
//   shipment_eudr_decision.supersedes_id    → shipment_eudr_decision
//                                              (self-FK, declared in
//                                              migration)
//   audit_pack.assembled_by_user_id         → users
//
//   All cross-card columns are typed `uuid('col')` without
//   `.references(...)`. Card 0.9/0.10 add the FKs with NOT VALID +
//   VALIDATE per the convention in lots.ts. The supplier/producer
//   FKs are added in this card's own migration because the tables
//   are co-located in the same file.

import { sql } from 'drizzle-orm';
import {
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

// ── enums ──────────────────────────────────────────────────────────────────

export const eudrReferenceRiskStatus = pgEnum(
  'eudr_reference_risk_status',
  ['low', 'medium', 'high', 'unassessed'] as const,
);
export type EudrReferenceRiskStatus =
  (typeof eudrReferenceRiskStatus.enumValues)[number];

export const shipmentEudrMode = pgEnum('shipment_eudr_mode', [
  'in_scope_requires_dds',
  'opt_out',
  'out_of_scope',
  'below_threshold',
] as const);
export type ShipmentEudrMode = (typeof shipmentEudrMode.enumValues)[number];

export const shipmentEudrReasonCode = pgEnum(
  'shipment_eudr_reason_code',
  [
    'below_threshold_kg',
    'non_eu_destination',
    'processed_before_cutoff',
    'not_a_relevant_product',
    'other',
  ] as const,
);
export type ShipmentEudrReasonCode =
  (typeof shipmentEudrReasonCode.enumValues)[number];

export const ddsDraftStatus = pgEnum('dds_draft_status', [
  'draft',
  'signed',
  'submitted',
  'voided',
] as const);
export type DdsDraftStatus = (typeof ddsDraftStatus.enumValues)[number];

export const auditPackStatus = pgEnum('audit_pack_status', [
  'draft',
  'signed',
  'submitted',
  'archived',
] as const);
export type AuditPackStatus = (typeof auditPackStatus.enumValues)[number];

// ── eudr_reference_data ────────────────────────────────────────────────────
//
// Denormalised risk snapshot for a green_lot.
//
//   `lot_id` — 1:1 with green_lot (the green_lot table has a forward
//   `eudr_reference_data_id` column per lots.ts §CROSS-MODULE FKs).
//   UNIQUE (org_id, lot_id) so the recompute trigger can upsert.
//
//   `risk_status` is recomputed by the `recompute_lot_risk(lot_id
//   uuid)` SQL function (see 0006_compliance.sql) whenever the
//   underlying supplier / producer changes. The trigger lives in
//   the migration because Drizzle-kit doesn't model Postgres
//   triggers.
//
//   `factors` is a jsonb of the inputs the recompute function used,
//   so the audit trail can show WHY a lot is high-risk (e.g.
//   "producer.verification_source = self_reported AND
//   supplier.last_reviewed_at < 90d ago"). v1 keeps the shape free-form;
//   v1.5 may pin it.
//
//   `computed_at` is set by the recompute trigger (now()).
export const eudrReferenceData = pgTable(
  'eudr_reference_data',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // Forward reference to green_lot (card 0.10 — DONE on working
    // tree). FK added in 0006_compliance.sql.
    lotId: uuid('lot_id').notNull(),
    riskStatus:
      eudrReferenceRiskStatus('risk_status').notNull().default('unassessed'),
    factors: jsonb('factors')
      .$type<{
        supplier_risk: string | null;
        producer_verification: string | null;
        country_risk: string | null;
        notes: string;
      }>()
      .notNull()
      .default(
        sql`'{"supplier_risk": null, "producer_verification": null, "country_risk": null, "notes": ""}'::jsonb`,
      ),
    computedAt: timestamp('computed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgLotUnique: unique('eudr_reference_data_org_id_lot_id_unique').on(
      table.orgId,
      table.lotId,
    ),
    orgIdIdx: index('eudr_reference_data_org_id_idx').on(table.orgId),
    riskStatusIdx: index('eudr_reference_data_org_id_risk_status_idx').on(
      table.orgId,
      table.riskStatus,
    ),
  }),
);

export type EudrReferenceData = typeof eudrReferenceData.$inferSelect;
export type NewEudrReferenceData = typeof eudrReferenceData.$inferInsert;

// ── lot_producer ───────────────────────────────────────────────────────────
//
// v1.5 multi-producer join. v1 UX is single-producer 1:1 from
// green_lot.producer_id; this table is unused in v1's write path
// but the schema supports the v1.5 case.
//
//   UNIQUE (org_id, green_lot_id, producer_id) — a producer can
//   appear once per lot. The weightKg captures how much of the lot
//   came from this producer; for v1.5 the sum across producers
//   should equal green_lot.weightKg (enforced at app layer, not
//   here — a CHECK involving another table is impractical in
//   Postgres).
export const lotProducer = pgTable(
  'lot_producer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // Forward references to green_lot and producer. producer FK
    // added in 0006_compliance.sql; green_lot FK added in 0006 as
    // well (or by card 0.10 if it lands first).
    greenLotId: uuid('green_lot_id').notNull(),
    producerId: uuid('producer_id').notNull(),
    weightKg: numeric('weight_kg', { precision: 12, scale: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgLotProducerUnique: unique(
      'lot_producer_org_id_green_lot_id_producer_id_unique',
    ).on(table.orgId, table.greenLotId, table.producerId),
    orgIdIdx: index('lot_producer_org_id_idx').on(table.orgId),
    greenLotIdIdx: index('lot_producer_green_lot_id_idx').on(
      table.greenLotId,
    ),
    producerIdIdx: index('lot_producer_producer_id_idx').on(
      table.producerId,
    ),
    weightPositive: check(
      'lot_producer_weight_positive_check',
      sql`${table.weightKg} > 0`,
    ),
  }),
);

export type LotProducer = typeof lotProducer.$inferSelect;
export type NewLotProducer = typeof lotProducer.$inferInsert;

// ── dds_draft ──────────────────────────────────────────────────────────────
//
// Due Diligence Statement draft. Stores source data as a jsonb
// SNAPSHOT — DDS PDFs are signed artifacts that must remain valid
// even if the underlying green_lot / supplier / producer data
// changes (plan §11.2). The snapshot includes the fields the EU
// information system requires: green lot references (by ID), the
// supplier's name + EORI, the producer's name + country, the
// country of harvest, harvest year, and net mass.
//
//   `lot_ids` is `uuid[]` — a DDS can cover multiple lots (a single
//   shipment consolidating several purchases). No array FK;
//   referential integrity at the app layer.
//
//   `shipment_id` is a forward reference to a future `shipment` table
//   or the existing `order` table (card 0.9). Typed uuid, FK lands
//   when the target exists.
//
//   `pdf_object_path` is a Supabase Storage path under the
//   `audit-packs` bucket (card 0.3). v1 stores the path; the
//   renderer is Phase 1.
export const ddsDraft = pgTable(
  'dds_draft',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // Forward references — typed uuid, no .references().
    shipmentId: uuid('shipment_id'),
    supplierId: uuid('supplier_id'),
    producerId: uuid('producer_id'),
    lotIds: uuid('lot_ids').array().notNull().default(sql`'{}'::uuid[]`),
    status: ddsDraftStatus('status').notNull().default('draft'),
    payload: jsonb('payload')
      .$type<{
        supplier: { name: string; eori: string | null; country: string };
        producer: { name: string; country: string };
        country_of_harvest: string;
        harvest_year: number;
        net_mass_kg: number;
        green_lot_codes: string[];
      }>()
      .notNull(),
    pdfObjectPath: text('pdf_object_path'),
    referenceNumber: text('reference_number'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('dds_draft_org_id_idx').on(table.orgId),
    statusIdx: index('dds_draft_org_id_status_idx').on(
      table.orgId,
      table.status,
    ),
    supplierIdx: index('dds_draft_supplier_id_idx').on(table.supplierId),
    producerIdx: index('dds_draft_producer_id_idx').on(table.producerId),
  }),
);

export type DdsDraft = typeof ddsDraft.$inferSelect;
export type NewDdsDraft = typeof ddsDraft.$inferInsert;

// ── shipment_eudr_decision ─────────────────────────────────────────────────
//
// Per-shipment opt-out / opt-in decision.
//
//   `mode` enum:
//     - 'in_scope_requires_dds' — the default; a DDS must exist
//     - 'opt_out'               — operator confirms the shipment
//                                 does not require a DDS (e.g.
//                                 below the small-quantity threshold
//                                 or non-EU destination). REQUIRES
//                                 reason_code + typed_phrase.
//     - 'out_of_scope'          — the shipment is not a relevant
//                                 product (e.g. instant coffee, not
//                                 green coffee).
//     - 'below_threshold'       — convenience alias for
//                                 opt_out + reason_code =
//                                 'below_threshold_kg'.
//
//   `reason_code` is required iff mode = 'opt_out'. CHECK
//   enforces.
//
//   `reason_text` is required iff reason_code = 'other'. CHECK
//   enforces.
//
//   `actor_role_snapshot` captures the user's RBAC role at decision
//   time (text, not enum) so the audit pack stays valid if the
//   user's role later changes. The text form is intentional — the
//   enum values may change across v1.x without invalidating old
//   audit packs.
//
//   `typed_phrase` is the exact text the operator typed (or
//   confirmed) to acknowledge the opt-out. Per the card body, the
//   v1 phrase is: "I confirm this shipment does not require a Due
//   Diligence Statement under EUDR. I am the operator of record."
//   The phrase lives as a constant in code (not in this table's
//   default) so the regulatory lawyer's wording tweak (card #12)
//   is a one-file edit. `typed_phrase` here records what the user
//   actually typed (a copy for the audit trail).
//
//   `supersedes_id` is a self-FK — a new decision supersedes an
//   old one rather than mutating it. Per plan §9 #19 this is in
//   v1.0. The CHECK enforces supersedes_id <> id to prevent
//   accidental self-reference.

export const shipmentEudrDecision = pgTable(
  'shipment_eudr_decision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // Forward reference to order or future shipment. FK lands
    // when the target exists.
    shipmentId: uuid('shipment_id'),
    mode: shipmentEudrMode('mode').notNull(),
    // Reason fields are nullable by design — they're only required
    // by the CHECK below for opt_out.
    reasonCode: shipmentEudrReasonCode('reason_code'),
    reasonText: text('reason_text'),
    actorUserId: uuid('actor_user_id').notNull(),
    actorRoleSnapshot: text('actor_role_snapshot').notNull(),
    typedPhrase: text('typed_phrase'),
    notes: text('notes'),
    // Self-FK — declared in the migration. CHECK enforces not-self.
    supersedesId: uuid('supersedes_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('shipment_eudr_decision_org_id_idx').on(table.orgId),
    shipmentIdx: index('shipment_eudr_decision_shipment_id_idx').on(
      table.shipmentId,
    ),
    actorIdx: index('shipment_eudr_decision_actor_user_id_idx').on(
      table.actorUserId,
    ),
    // opt_out requires reason_code + typed_phrase.
    optOutReasonRequired: check(
      'shipment_eudr_decision_opt_out_reason_required',
      sql`${table.mode} <> 'opt_out' OR ${table.reasonCode} IS NOT NULL`,
    ),
    optOutTypedPhraseRequired: check(
      'shipment_eudr_decision_opt_out_typed_phrase_required',
      sql`${table.mode} <> 'opt_out' OR ${table.typedPhrase} IS NOT NULL`,
    ),
    // 'other' reason requires reason_text.
    otherReasonTextRequired: check(
      'shipment_eudr_decision_other_reason_text_required',
      sql`${table.reasonCode} IS DISTINCT FROM 'other' OR ${table.reasonText} IS NOT NULL`,
    ),
  }),
);

export type ShipmentEudrDecision = typeof shipmentEudrDecision.$inferSelect;
export type NewShipmentEudrDecision =
  typeof shipmentEudrDecision.$inferInsert;

// ── audit_pack ─────────────────────────────────────────────────────────────
//
// Assembled, signed audit pack. v1 ships the schema; the renderer
// and signer land in Phase 1 (PRD §6.5).
//
//   `payload` is a jsonb snapshot of the source rows (similar to
//   dds_draft.payload). The renderer reads the source rows at
//   assembly time, captures them in the jsonb, and signs the
//   resulting PDF. The signature is over the jsonb + the PDF
//   bytes.
//
//   `pdf_object_path` is the Supabase Storage path under the
//   `audit-packs` bucket.
//
//   `signature_hash` is the v1.5 hash chain's hash of the
//   (canonicalised payload + PDF bytes). v1 can leave it NULL or
//   populate it opportunistically with pgcrypto's digest(); see
//   plan §11.2.
export const auditPack = pgTable(
  'audit_pack',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // Forward reference to a future `audit_period` / `audit_request`
    // table (PRD §6.5). Typed uuid, FK lands later.
    auditRequestId: uuid('audit_request_id'),
    status: auditPackStatus('status').notNull().default('draft'),
    payload: jsonb('payload')
      .$type<{
        period_start: string;
        period_end: string;
        shipments_in_scope: number;
        dds_references: string[];
        opt_out_count: number;
      }>()
      .notNull(),
    pdfObjectPath: text('pdf_object_path'),
    signatureHash: text('signature_hash'),
    assembledByUserId: uuid('assembled_by_user_id').notNull(),
    assembledAt: timestamp('assembled_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('audit_pack_org_id_idx').on(table.orgId),
    statusIdx: index('audit_pack_org_id_status_idx').on(
      table.orgId,
      table.status,
    ),
    auditRequestIdx: index('audit_pack_audit_request_id_idx').on(
      table.auditRequestId,
    ),
  }),
);

export type AuditPack = typeof auditPack.$inferSelect;
export type NewAuditPack = typeof auditPack.$inferInsert;
