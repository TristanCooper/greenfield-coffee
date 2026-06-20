// packages/db/src/schema/index.ts
//
// Schema barrel — re-exports per-entity Drizzle modules. Card 0.10
// adds the lot spine (8 tables) + audit_event (merged from card 0.12).
//
// Modules here:
//   - auth.ts          (card 0.5)   — public.users mirror
//   - organizations.ts (card 0.7)   — Organization + Membership
//   - enums.ts         (card 0.10)  — re-exports of pgEnum declarations
//   - lots.ts          (card 0.10)  — 7 lot tables + 5 status enums
//   - audit.ts         (card 0.10)  — audit_event table (card 0.12 merged)

export * from './auth.js';
export * from './users.js';
export * from './organizations.js';
export * from './enums.js';
export * from './lots.js';
export * from './audit.js';

import type { users } from './users.js';
import type {
  organizations,
  memberships,
  membershipRole,
} from './organizations.js';
import type {
  greenLot,
  roastBatch,
  roastedLot,
  packagedLot,
  stockMovement,
  roastBatchComponent,
  lotAllocation,
  returnEvent,
  greenLotStatus,
  roastBatchStatus,
  roastedLotStatus,
  packagedLotStatus,
  stockMovementKind,
} from './lots.js';
import type { auditEvent } from './audit.js';

/**
 * Typed Supabase schema. Add new entity tables here as they're introduced so
 * the typed browser/server clients get autocomplete + row-level inference.
 *
 * `__InternalSupabase.PostgrestVersion: '12'` is required by @supabase/supabase-js
 * ≥2.46 to drive its typed client overloads — without it, the postgrest client
 * types fall back to `any` for row-level inference.
 */
export interface Database {
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      users: {
        Row: typeof users.$inferSelect;
        Insert: typeof users.$inferInsert;
        Update: Partial<typeof users.$inferInsert>;
      };
      organizations: {
        Row: typeof organizations.$inferSelect;
        Insert: typeof organizations.$inferInsert;
        Update: Partial<typeof organizations.$inferInsert>;
      };
      memberships: {
        Row: typeof memberships.$inferSelect;
        Insert: typeof memberships.$inferInsert;
        Update: Partial<typeof memberships.$inferInsert>;
      };
      green_lot: {
        Row: typeof greenLot.$inferSelect;
        Insert: typeof greenLot.$inferInsert;
        Update: Partial<typeof greenLot.$inferInsert>;
      };
      roast_batch: {
        Row: typeof roastBatch.$inferSelect;
        Insert: typeof roastBatch.$inferInsert;
        Update: Partial<typeof roastBatch.$inferInsert>;
      };
      roast_batch_component: {
        Row: typeof roastBatchComponent.$inferSelect;
        Insert: typeof roastBatchComponent.$inferInsert;
        Update: Partial<typeof roastBatchComponent.$inferInsert>;
      };
      roasted_lot: {
        Row: typeof roastedLot.$inferSelect;
        Insert: typeof roastedLot.$inferInsert;
        Update: Partial<typeof roastedLot.$inferInsert>;
      };
      packaged_lot: {
        Row: typeof packagedLot.$inferSelect;
        Insert: typeof packagedLot.$inferInsert;
        Update: Partial<typeof packagedLot.$inferInsert>;
      };
      stock_movement: {
        Row: typeof stockMovement.$inferSelect;
        Insert: typeof stockMovement.$inferInsert;
        Update: Partial<typeof stockMovement.$inferInsert>;
      };
      lot_allocation: {
        Row: typeof lotAllocation.$inferSelect;
        Insert: typeof lotAllocation.$inferInsert;
        Update: Partial<typeof lotAllocation.$inferInsert>;
      };
      return_event: {
        Row: typeof returnEvent.$inferSelect;
        Insert: typeof returnEvent.$inferInsert;
        Update: Partial<typeof returnEvent.$inferInsert>;
      };
      audit_event: {
        Row: typeof auditEvent.$inferSelect;
        Insert: typeof auditEvent.$inferInsert;
        Update: Partial<typeof auditEvent.$inferInsert>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      membership_role: (typeof membershipRole.enumValues)[number];
      green_lot_status: (typeof greenLotStatus.enumValues)[number];
      roast_batch_status: (typeof roastBatchStatus.enumValues)[number];
      roasted_lot_status: (typeof roastedLotStatus.enumValues)[number];
      packaged_lot_status: (typeof packagedLotStatus.enumValues)[number];
      stock_movement_kind: (typeof stockMovementKind.enumValues)[number];
    };
    CompositeTypes: Record<string, never>;
  };
}
