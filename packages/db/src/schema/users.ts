// packages/db/src/schema/users.ts
//
// `public.users` — application-facing mirror of `auth.users`.
//
// Card 0.5 created this table; card 0.7 moved it from schema/auth.ts
// (where the bridge was implemented) to schema/users.ts (where it
// belongs by entity name) so the schema barrel reads as
// `users | organizations | ...`. The auth.ts file is now reserved
// for the trigger that keeps the mirror in sync — the schema
// definition lives here.
//
// Why the mirror exists:
//
//   Supabase manages users in `auth.users` (private schema, owned by
//   the supabase_auth role). Foreign keys from operational tables
//   (org memberships, audit_event, etc.) need to reference that
//   table — cross-schema FKs to `auth.*` work fine in Postgres, AND
//   we want our application code to read a `public.users` row we
//   control.
//
//   Standard Supabase pattern: `public.users` PK is a 1:1 mirror of
//   `auth.users.id`, kept in sync by a trigger on auth.users inserts.
//   App code reads from `public.users` (typed, RLS-friendly,
//   extensible); auth still happens via `auth.users`.
//
//   We deliberately do NOT duplicate `password_hash`, `email_confirmed_at`,
//   etc. — Supabase Auth owns that state. The mirror is the minimum:
//   id, email, created_at. Subsequent cards add `display_name`,
//   `avatar_url`, etc.

import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * `public.users` — application-facing mirror of `auth.users`.
 *
 * FK: id references auth.users(id) ON DELETE CASCADE so deleting an auth user
 *     (GDPR right-to-erasure flow, added in a later card) cascades cleanly.
 *     Declared inline in the migration body — see packages/db/src/migrations/
 *     0001_auth_bridge.sql — because some linters flag cross-schema
 *     references from Drizzle column definitions.
 *
 * Sync: AFTER INSERT trigger on auth.users inserts the matching public.users row.
 *       See `handle_new_auth_user` in schema/auth.ts (the trigger function
 *       itself lives in 0001_auth_bridge.sql).
 *
 * RLS: enabled with a single policy `users_self_select` (auth.uid() = id) so
 *      users can read their own row. Org-membership-scoped reads land in 0.7
 *      alongside org_memberships.
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