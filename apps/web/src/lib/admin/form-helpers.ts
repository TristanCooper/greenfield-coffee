// apps/web/src/lib/admin/form-helpers.ts
//
// Card 0.16 — shared form helpers for the admin server actions.
//
// Mirrors the small helpers defined inline in
// apps/web/src/app/(authenticated)/admin/skus/actions.ts so the
// per-entity actions files can share them without circular imports.

import { type z } from 'zod';

/**
 * Normalise FormData.get() (which is FormDataEntryValue | null)
 * into a string-or-undefined shape Zod can consume. Returns
 * undefined for missing / empty / non-string values.
 */
export function strOrUndef(
  v: FormDataEntryValue | null,
): string | undefined {
  if (typeof v !== 'string') return undefined;
  if (v === '') return undefined;
  return v;
}

/**
 * Convert a ZodError into a per-field error map. The form's
 * useFieldError(name) hook reads this map to render inline messages.
 */
export function flattenZodErrors(
  err: z.ZodError,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const joined = issue.path.join('.');
    const key = joined === '' ? '_root' : joined;
    out[key] ??= [];
    out[key].push(issue.message);
  }
  return out;
}

/**
 * Coerce a FormData string to a positive number or null. Used
 * for the admin forms' numeric inputs (weight, capacity, cost).
 *
 *   parsePositiveNumber('123.4')   -> 123.4
 *   parsePositiveNumber('')        -> null
 *   parsePositiveNumber(undefined) -> null
 *   parsePositiveNumber('-1')      -> null  (caller validates >= 0 separately)
 *
 * Returns null on parse failure or non-positive values; the
 * caller should add a `.refine()` to surface a field error if
 * "must be positive" is required.
 */
export function parsePositiveNumber(
  v: string | undefined,
): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function parseNonNegativeNumber(
  v: string | undefined,
): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Parse a comma-separated tag string into a deduped, trimmed
 * array of up to 32 entries. Empty segments are dropped.
 */
export function parseTags(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 32);
}
