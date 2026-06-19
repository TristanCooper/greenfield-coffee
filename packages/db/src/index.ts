// @greenfield/db
//
// Public surface. Cards 0.4 / 0.5 / 0.6.
//
// Card 0.6 adds the RLS tenancy primitives. App code that reads or
// writes tenant-scoped tables MUST go through `withTenant(orgId, fn)`;
// the `db` export is unscoped (postgres role, BYPASSRLS) and intended
// only for migrations, scripts, and global lookups that legitimately
// need to bypass RLS (Organisation lookup before tenancy is known —
// card 0.7). `unscopedDb` is the raw-SQL equivalent for one-off admin
// queries; same role / same RLS-bypass semantics.

export { db, type Db } from './client.js';
export {
  withTenant,
  unscopedDb,
  type TenantDb,
} from './rls.js';
export { type Database } from './schema/index.js';
export const PACKAGE_NAME = '@greenfield/db' as const;
