// @greenfield/db — schema barrel
//
// Re-export per-entity Drizzle modules here. Cards add modules in this order:
//   0.5  — auth (public.users mirror of auth.users)
//   0.7  — organizations + memberships + membership_role enum  ← this card
//   0.9  — operational tables (orgs settings, customers, suppliers)
//   0.10 — lot tables (green coffee lots, roast batches, sensory events)
//   0.11 — compliance + traceability (chain-of-custody, audit_event)
//
// The `Database` type below is what `@supabase/supabase-js` is parameterised on
// in apps/web/src/lib/supabase/client.ts — keep it in sync as modules land.

export * from './auth.js';
export * from './users.js';
export * from './organizations.js';

import type { users } from './users.js';
import type {
  organizations,
  memberships,
  membershipRole,
} from './organizations.js';

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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      membership_role: (typeof membershipRole.enumValues)[number];
    };
    CompositeTypes: Record<string, never>;
  };
}