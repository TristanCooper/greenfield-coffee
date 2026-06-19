// packages/db/src/schema/auth.ts
//
// `auth.users` ↔ `public.users` sync bridge.
//
// Card 0.5 created the public.users mirror and the trigger that keeps
// it in sync. Card 0.7 moved the table DEFINITION to schema/users.ts
// (the entity's natural home by name) but kept THIS file as the home
// for the cross-schema bridge documentation.
//
// What lives here:
//
//   - Re-export of the `users` table from users.ts, so anything that
//     imports `@greenfield/db` (or the schema barrel) still sees
//     `import { users } from './schema/auth.js'` work without breakage.
//     This matches the spirit of the original card 0.5 layout.
//
//   - The Postgres trigger function `handle_new_auth_user` is defined
//     in the hand-written migration 0001_auth_bridge.sql. The TypeScript
//     shape that mirrors it lives below for typed access in tests and
//     tooling.
//
// What does NOT live here:
//
//   - The `users` table itself — that's in users.ts. Adding a column?
//     Edit users.ts.
//   - The auth.users table — that's owned by Supabase's auth schema,
//     not something we model.

export { users, type User, type NewUser } from './users.js';

/**
 * Mirror of the `public.handle_new_auth_user()` trigger function from
 * 0001_auth_bridge.sql. Returned shape matches `Supabase Auth` event
 * payload after a successful sign-up.
 *
 * Useful for typed callers that want to reason about what the trigger
 * inserts without parsing SQL — the runtime contract is enforced by
 * the trigger body, not this type.
 */
export interface HandleNewAuthUserArgs {
  id: string;
  email: string;
  created_at: string;
}