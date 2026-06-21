// @greenfield/db
//
// Public surface. Cards 0.4 / 0.5 / 0.6 / 0.7 / 0.10.
//
// Card 0.6 adds the RLS tenancy primitives. App code that reads or
// writes tenant-scoped tables MUST go through `withTenant(orgId, fn)`;
// the `db` export is unscoped (postgres role, BYPASSRLS) and intended
// only for migrations, scripts, and global lookups that legitimately
// need to bypass RLS (Organisation lookup before tenancy is known —
// card 0.7). `unscopedDb` is the raw-SQL equivalent for one-off admin
// queries; same role / same RLS-bypass semantics.
//
// Card 0.7 adds the Organization entity, Membership join, RBAC
// (assertRole), and the createOrganization function. The function is
// the pure-logic core of the sign-up flow; the Next.js Route Handler
// in apps/web wraps it with Supabase-auth-gated invocation.
//
// Card 0.10 adds the lot spine (green_lot, roast_batch, roasted_lot,
// packaged_lot, stock_movement, lot_allocation, return_event) plus
// audit_event (merged from card 0.12). The schema/types re-exports
// grow accordingly; no runtime functions added in this card.

export { db, type Db } from './client.js';
export {
  withTenant,
  unscopedDb,
  type TenantDb,
} from './rls.js';
export { type Database } from './schema/index.js';
export {
  assertRole,
  getMembership,
  getFirstMembership,
  RbacError,
  type RbacErrorCode,
  type MembershipRow,
} from './rbac.js';
export {
  createOrganization,
  CreateOrganizationError,
  type CreateOrganizationInput,
  type CreateOrganizationActor,
  type CreateOrganizationResult,
  type RegionCode as OrganizationRegionCode,
} from './organizations.js';
export {
  computeShipmentCompliance,
  listHighRiskCountries,
  type ComplianceStatus,
  type ComplianceResult,
} from './compliance.js';
export {
  UK_EU_REGIONS,
  REGION_TO_COUNTRIES,
  SUPPORTED_BASE_CURRENCIES,
  SUPPORTED_DATA_RESIDENCIES,
  DEFAULT_EUDR_SETTINGS,
  type MembershipRole,
  type CountryCode,
  type RegionCode,
  type BaseCurrency,
  type DataResidency,
  type EudrSettings,
} from './schema/organizations.js';
export {
  type GreenLotStatus,
  type RoastBatchStatus,
  type RoastedLotStatus,
  type PackagedLotStatus,
  type StockMovementKind,
} from './schema/enums.js';
export {
  type GreenLot,
  type NewGreenLot,
  type RoastBatch,
  type NewRoastBatch,
  type RoastBatchComponent,
  type NewRoastBatchComponent,
  type RoastedLot,
  type NewRoastedLot,
  type PackagedLot,
  type NewPackagedLot,
  type StockMovement,
  type NewStockMovement,
  type LotAllocation,
  type NewLotAllocation,
  type ReturnEvent,
  type NewReturnEvent,
} from './schema/lots.js';
export {
  type AuditEvent,
  type NewAuditEvent,
} from './schema/audit.js';
export {
  type Sku,
  type NewSku,
  type Packaging,
  type NewPackaging,
  type Recipe,
  type NewRecipe,
  type RecipeComponent,
  type NewRecipeComponent,
} from './schema/operational.js';
export {
  type PriceList,
  type NewPriceList,
  type PriceListEntry,
  type NewPriceListEntry,
  type PriceListKind,
  type PriceListVatMode,
} from './schema/price-lists.js';
export {
  type Supplier,
  type NewSupplier,
} from './schema/suppliers.js';
export {
  type Producer,
  type NewProducer,
  type ProducerVerificationOverride,
  type NewProducerVerificationOverride,
} from './schema/producers.js';
export {
  type Customer,
  type NewCustomer,
} from './schema/customers.js';
export { type User, type NewUser } from './schema/users.js';
export const PACKAGE_NAME = '@greenfield/db' as const;
