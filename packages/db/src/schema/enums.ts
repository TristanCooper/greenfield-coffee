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
//   organizations.ts for membership_role).
//
//   This file re-exports the declared enums so consumers can import
//   them from one place (the `enums.js` barrel) without having to
//   know which module owns the declaration.
//
// CARDS COVERED
//
//   0.10 — green_lot_status, roast_batch_status, roasted_lot_status,
//          packaged_lot_status, stock_movement_kind
//   (other cards add enums via their own module — see those modules)

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
