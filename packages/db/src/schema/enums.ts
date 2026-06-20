// packages/db/src/schema/enums.ts
//
// Centralised re-export of all pgEnum declarations across schema modules.
//
// WHY THIS FILE EXISTS
//
//   pgEnum declarations create a Postgres `CREATE TYPE` at migration
//   time. Two pgEnum() calls with the same name conflict (no CREATE
//   TYPE IF NOT EXISTS). To keep ownership unambiguous, each enum is
//   pgEnum-declared in ONE module — the module whose table first
//   consumes it.
//
//   This file re-exports the declared enums so consumers can import
//   them from one place (the `enums.js` barrel) without having to
//   know which module owns the declaration.
//
// CARDS COVERED
//
//   0.7  — membership_role (organizations.ts)
//   0.10 — green_lot_status, roast_batch_status, roasted_lot_status,
//          packaged_lot_status, stock_movement_kind
//   0.11 — producer_verification_source, eudr_reference_risk_status,
//          shipment_eudr_mode, shipment_eudr_reason_code,
//          dds_draft_status, audit_pack_status
//   0.9  — price_list_mode, price_list_kind (price-lists.ts),
//          landed_cost_cost_kind, landed_cost_target_kind (money.ts),
//          order_status, order_channel, order_edit_kind (orders.ts),
//          integration_provider, integration_status (integrations.ts)

export {
  greenLotStatus,
  type GreenLotStatus,
  roastBatchStatus,
  type RoastBatchStatus,
  roastedLotStatus,
  type RoastedLotStatus,
  packagedLotStatus,
  type PackagedLotStatus,
  stockMovementKind,
  type StockMovementKind,
} from './lots.js';

export {
  producerVerificationSource,
  type ProducerVerificationSource,
} from './producers.js';

export {
  eudrReferenceRiskStatus,
  type EudrReferenceRiskStatus,
  shipmentEudrMode,
  type ShipmentEudrMode,
  shipmentEudrReasonCode,
  type ShipmentEudrReasonCode,
  ddsDraftStatus,
  type DdsDraftStatus,
  auditPackStatus,
  type AuditPackStatus,
} from './eudr.js';

export {
  priceListVatMode,
  type PriceListVatMode,
  priceListKind,
  type PriceListKind,
} from './price-lists.js';

export {
  landedCostCostKind,
  type LandedCostCostKind,
  landedCostTargetKind,
  type LandedCostTargetKind,
} from './money.js';

export {
  orderStatus,
  type OrderStatus,
  orderChannel,
  type OrderChannel,
  orderEditKind,
  type OrderEditKind,
} from './orders.js';

export {
  integrationProvider,
  type IntegrationProvider,
  integrationStatus,
  type IntegrationStatus,
} from './integrations.js';
