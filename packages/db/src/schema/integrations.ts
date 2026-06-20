// packages/db/src/schema/integrations.ts
//
// Card 0.9 / plan §7.3 — Phase 1 integration stub.
//
// TABLES HERE
//
//   integration_connection — one row per (org, provider)
//                            connection. v1 stores NOTHING
//                            active; the table exists so a
//                            Phase 1 card can write a
//                            connection without a schema
//                            migration.
//
// PROVIDERS
//
//   `provider` enum captures the planned Phase 1 connectors.
//   Adding a new provider (e.g. a future Lightspeed) is a
//   pgEnum migration — Drizzle-kit handles the
//   `ALTER TYPE … ADD VALUE` automatically.
//
// CREDENTIALS ENCRYPTION
//
//   `credentials_encrypted` is the ciphertext blob. v1 stores
//   it as text; the decryption key is a Supabase Vault
//   secret. A future card will integrate Vault properly;
//   until then the column is opaque to the app layer.
//
// STATUS
//
//   `status` enum drives the connector lifecycle:
//   'pending' (just created, not yet authorised) →
//   'active' (authorised, can sync) →
//   'revoked' (user disconnected, credentials purged) or
//   'error' (sync failed; needs operator attention).
//
// The card body is explicit: "IntegrationConnection is a stub
// for Phase 1 — just (id, org_id, provider enum,
// credentials_encrypted text, status enum, created_at,
// updated_at) with a TODO referencing the Phase 1 connectors".
// The full Phase 1 connector work (OAuth dance, sync
// orchestration, webhook receivers) is a separate card.

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

// ── enums ─────────────────────────────────────────────────────────────────

export const integrationProvider = pgEnum('integration_provider', [
  'shopify',
  'woocommerce',
  'square_pos',
] as const);
export type IntegrationProvider =
  (typeof integrationProvider.enumValues)[number];

export const integrationStatus = pgEnum('integration_status', [
  'pending',
  'active',
  'revoked',
  'error',
] as const);
export type IntegrationStatus =
  (typeof integrationStatus.enumValues)[number];

// ── integration_connection ────────────────────────────────────────────────

export const integrationConnection = pgTable(
  'integration_connection',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    provider: integrationProvider('provider').notNull(),
    // External account/connection id (e.g. the Shopify shop
    // domain, the WooCommerce site URL). Captured at OAuth
    // time. NULL while in 'pending' status.
    externalAccountId: text('external_account_id'),
    // Encrypted credentials. text (not bytea) for v1 —
    // Postgres text is the safer default for an opaque
    // ciphertext blob, and Drizzle-kit doesn't have a clean
    // bytea helper. The application layer handles
    // encryption / decryption via a Vault key reference
    // (out of scope for this card). For v1, the column is
    // always NULL — no integration code ships yet.
    credentialsEncrypted: text('credentials_encrypted'),
    status: integrationStatus('status').notNull().default('pending'),
    // Last error message when status = 'error'. Cleared on
    // the next successful sync.
    lastErrorText: text('last_error_text'),
    // Last successful sync timestamp. NULL until the first
    // sync.
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // UNIQUE (org_id, provider) — one connection per
    // (org, provider). The v1.5 may relax to support
    // multi-account (two Shopify stores under one org).
    orgProviderUnique: unique(
      'integration_connection_org_id_provider_unique',
    ).on(table.orgId, table.provider),
    orgIdIdx: index('integration_connection_org_id_idx').on(table.orgId),
    statusIdx: index('integration_connection_org_id_status_idx').on(
      table.orgId,
      table.status,
    ),
    // When status = 'active', external_account_id MUST be
    // non-null (the OAuth dance populates it before the
    // status flips to 'active'). For other statuses the
    // pointer is optional.
    activeRequiresExternalId: check(
      'integration_connection_active_requires_external_id_check',
      sql`${table.status} <> 'active' OR ${table.externalAccountId} IS NOT NULL`,
    ),
  }),
);

export type IntegrationConnection = typeof integrationConnection.$inferSelect;
export type NewIntegrationConnection =
  typeof integrationConnection.$inferInsert;
