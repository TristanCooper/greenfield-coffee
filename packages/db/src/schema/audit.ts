// packages/db/src/schema/audit.ts
//
// Card 0.10 / card 0.12 (merged) — audit_event table.
//
// Card 0.12 is shipped as part of 0.10 per the body: "this card SHIPS
// 0.12's audit_event table + append-only trigger as part of the
// migration". The append-only trigger lives in the migration file
// `0005_audit_event_triggers.sql` because Drizzle-kit doesn't model
// triggers — the schema module only owns the table.
//
// PRD §5.6 / §5.4 / §6.5 all reference audit_event as the source of
// truth for "who did what, when, on which row, with what diff".
//
// APPEND-ONLY INVARIANT
//
//   The migration adds BEFORE UPDATE/DELETE triggers that raise
//   `audit_event is append-only`. Same trigger pattern is reused on
//   stock_movement (also append-only, per PRD §5.4).
//
//   UPDATE/DELETE on audit_event is not allowed by anyone, including
//   the service_role (which has BYPASSRLS — the trigger fires
//   regardless because it runs as the table owner). The only
//   authorised "correction" is a NEW compensating audit_event row
//   (e.g. action = 'undo_update_pricing' with diff capturing both
//   the original and the corrected values).
//
// ACTOR USER_ID NULLABILITY
//
//   `user_id` is nullable so system-initiated events (cron jobs, the
//   seed, scheduled tasks) can record without a user. ON DELETE SET
//   NULL preserves the audit row when a user is GDPR-erased — the
//   audit_event row STAYS but the user_id pointer is nulled. The
//   trigger does NOT block the SET NULL cascade because GDPR erasure
//   is a load-bearing flow.
//
//   Column naming: the card body says `user_id`. The card 0.7
//   createOrganization helper currently INSERTs with the column name
//   `actor_user_id` (because the function was written before this card
//   landed). After 0.10 ships, that helper is updated to write
//   `user_id` — the migration renames `actor_user_id` → `user_id` (or,
//   since the rename is small, the function is updated to match the
//   column this card ships). Either way, the on-disk column is
//   `user_id` per the spec.
//
// DIFF SHAPE
//
//   `diff` is nullable jsonb — the convention is:
//     - INSERT: `{ values: {...} }`
//     - UPDATE: `{ before: {...}, after: {...} }`
//     - DELETE: `{ before: {...} }`
//   NULL for events where there's no diff to capture (e.g. login).
//
// METADATA
//
//   `metadata` is nullable jsonb — request id, ip, user_agent. App
//   code populates this from the request context; cron / scripts leave
//   it NULL.

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const auditEvent = pgTable(
  'audit_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    diff: jsonb('diff'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdIdx: index('audit_event_org_id_idx').on(table.orgId),
    entityIdx: index('audit_event_org_id_entity_idx').on(
      table.orgId,
      table.entityType,
      table.entityId,
    ),
    occurredAtIdx: index('audit_event_org_id_occurred_at_idx').on(
      table.orgId,
      table.occurredAt,
    ),
    actionIdx: index('audit_event_org_id_action_idx').on(
      table.orgId,
      table.action,
    ),
    actionNonempty: check(
      'audit_event_action_nonempty_check',
      sql`length(${table.action}) > 0`,
    ),
    entityTypeNonempty: check(
      'audit_event_entity_type_nonempty_check',
      sql`length(${table.entityType}) > 0`,
    ),
  }),
);
export type AuditEvent = typeof auditEvent.$inferSelect;
export type NewAuditEvent = typeof auditEvent.$inferInsert;
