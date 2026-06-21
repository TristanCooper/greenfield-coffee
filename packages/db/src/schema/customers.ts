// packages/db/src/schema/customers.ts
//
// Card 0.16 / plan §7.4 — customer entity.
//
// Why this exists as a new table in card 0.16:
//
//   The order table (card 0.9, schema/orders.ts) currently captures
//   customer identity as three free-text columns
//   (customer_name_text, customer_email_text, customer_phone_text).
//   The rationale at the time was: v1 orders are mostly from
//   wholesale channels (Shopify / WooCommerce / Square POS) where
//   the customer lives upstream and we don't need our own customer
//   table for the basic flow.
//
//   Card 0.16 ships the Admin UI v0, which the plan says includes
//   a "Customers" admin screen (card 0.16 §Acceptance Criteria:
//   `/admin/customers`). Without a real `customer` table, the admin
//   screen has nothing to CRUD. We add a minimal customer entity
//   here so the admin UI can land.
//
//   What we DO NOT do in this card:
//
//     - Migrate existing order rows to populate customer_id. The
//       order's free-text columns stay as a snapshot of the
//       customer at order time. A future card (likely in Phase 1)
//       adds the order.customer_id FK and a one-time backfill.
//
//     - Add per-customer VAT settings, credit limits, payment
//       terms, etc. v1 is intentionally minimal — name, email,
//       phone, address, tax_id, notes. A future card extends.
//
//   The customer lives in the admin UI as a normal CRUD target.
//   RBAC (plan §5.7) gates writes — owner has full CRUD,
//   accountant and compliance_officer have read-only, etc.

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations } from './organizations.js';

export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    postalCode: text('postal_code'),
    countryCode: text('country_code'),
    taxId: text('tax_id'),
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
    orgCodeUnique: unique('customer_org_id_code_unique').on(
      table.orgId,
      table.code,
    ),
    orgIdIdx: index('customer_org_id_idx').on(table.orgId),
    activeIdx: index('customer_org_id_active_idx').on(
      table.orgId,
      table.active,
    ),
    countryIso2: check(
      'customer_country_iso2_check',
      sql`${table.countryCode} IS NULL OR length(${table.countryCode}) = 2`,
    ),
  }),
);

export type Customer = typeof customer.$inferSelect;
export type NewCustomer = typeof customer.$inferInsert;
