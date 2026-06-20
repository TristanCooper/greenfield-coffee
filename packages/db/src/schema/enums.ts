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
//   consumes it (lots.ts for the lot lifecycle + stock movement enums;
//   organizations.ts for membership_role; producers.ts for
//   producer_verification_source; eudr.ts for the rest).
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
