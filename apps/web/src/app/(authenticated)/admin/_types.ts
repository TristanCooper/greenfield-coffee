// apps/web/src/app/(authenticated)/admin/_types.ts
//
// Card 0.16 — shared types for the admin section.
//
// ActionResult is the shape every server action returns. Each
// entity's actions.ts has its own typed alias for clarity, but the
// underlying shape is consistent so the generic AdminForm client
// component can render errors uniformly.

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  id?: string;
}
