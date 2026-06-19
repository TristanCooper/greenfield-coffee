// packages/db/src/schema/auth.ts
//
// Supabase Auth bridge — Drizzle mirror of `auth.users`.
//
// Card 0.5.
//
// Why this exists:
//
//   Supabase manages users in the `auth.users` table (private schema, owned by
//   the supabase_auth role). Foreign keys from operational tables (org
//   memberships, audit_event, etc.) need to reference that table — but
//   cross-schema FKs to `auth.*` work fine in Postgres, AND we want our
//   application code to read a `public.users` row that we control.
//
//   So the standard Supabase pattern is: a `public.users` table whose PK is a
//   1:1 mirror of `auth.users.id`, kept in sync by a trigger on auth.users
//   inserts. Application code reads from `public.users` (typed, RLS-friendly,
//   extensible with org_id etc.); auth still happens via `auth.users`.
//
//   We deliberately do NOT duplicate `password_hash`, `email_confirmed_at`,
//   etc. — Supabase Auth owns that state. The mirror is the minimum: id, email,
//   created_at. Subsequent cards add `display_name`, `avatar_url`, etc.
//
//   Card 0.7 (RBAC) will add `public.org_memberships` with FK to public.users.id.

import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * `public.users` — application-facing mirror of `auth.users`.
 *
 * FK: id references auth.users(id) ON DELETE CASCADE so deleting an auth user
 *     (GDPR right-to-erasure flow, added in a later card) cascades cleanly.
 *
 * Sync: AFTER INSERT trigger on auth.users inserts the matching public.users row.
 *       See the trigger DDL appended to the generated migration.
 *
 * RLS: enabled with a single policy `users_self_select` (auth.uid() = id) so
 *      users can read their own row. Org-membership-scoped reads land in 0.7
 *      when org_memberships exist.
 */
export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    // .references() is omitted from the Drizzle column so the generated SQL
    // is portable — the FK is declared inline in the migration body where we
    // can spell out `REFERENCES auth.users(id) ON DELETE CASCADE` exactly the
    // way Supabase recommends (some linters flag cross-schema references from
    // Drizzle column definitions).
    .notNull(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
