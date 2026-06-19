// @greenfield/db
//
// Public surface. Card 0.4 + 0.5.
//
// Current exports:
//   - `db`       — typed Drizzle client (postgres-js, pooler-connected)
//   - `Db`       — type alias for the client (use for typed function signatures)
//   - `Database` — Supabase typed-schema interface, used to parameterise
//                  createBrowserClient / createServerClient in apps/web so
//                  `from('users')` etc. are row-level typed.
//
// Schema modules live in `./schema/*.ts` and are re-exported through
// `./schema/index.js` (which also defines `Database`).

export { db, type Db } from './client.js';
export { type Database } from './schema/index.js';
export const PACKAGE_NAME = '@greenfield/db' as const;
