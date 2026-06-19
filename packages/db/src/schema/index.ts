// @greenfield/db — schema barrel
//
// Re-export per-entity Drizzle modules here. Cards add modules in this order:
//   0.5  — auth (public.users mirror of auth.users)            ← this card
//   0.9  — operational tables (orgs, memberships, roles)
//   0.10 — lot tables (green coffee lots, roast batches, sensory events)
//   0.11 — compliance + traceability (chain-of-custody, audit_event)
//
// The `Database` type below is what `@supabase/supabase-js` is parameterised on
// in apps/web/src/lib/supabase/client.ts — keep it in sync as modules land.
//
// Example shape (current):
//
//   export * from './auth.js';
//

export * from './auth.js';

import type { users } from './auth.js';

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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
