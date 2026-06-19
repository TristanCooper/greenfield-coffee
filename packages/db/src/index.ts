// @greenfield/db
//
// Public surface. Card 0.4.
//
// Current exports:
//   - `db`       — typed Drizzle client (postgres-js, pooler-connected)
//   - `Db`       — type alias for the client (use for typed function signatures)
//
// Schema modules land in subsequent cards (0.9 / 0.10 / 0.11) and are
// re-exported from `./schema/index.js`.

export { db, type Db } from './client.js';
export const PACKAGE_NAME = '@greenfield/db' as const;
