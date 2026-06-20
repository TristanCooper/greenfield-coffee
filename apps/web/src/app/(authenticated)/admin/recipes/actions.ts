'use server';

// apps/web/src/app/(authenticated)/admin/recipes/actions.ts
//
// Card 0.16 — server actions for the Recipes admin.
//
// RBAC matrix: read = every role; write (create/update/delete) =
// owner or head_roaster.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { withTenant, assertRole, RbacError } from '@greenfield/db';
import { requireAdminContext } from '@/lib/admin/server';
import {
  strOrUndef,
  flattenZodErrors,
  parsePositiveNumber,
} from '@/lib/admin/form-helpers';

// ── Validation ─────────────────────────────────────────────────────────

// Each blend line: a green_lot UUID + a percent in bps (0..10000).
// `notes` is optional. The form sends lines as repeated FormData
// fields with the pattern `component.greenLotId[i]`,
// `component.percentBps[i]`, `component.notes[i]`.
const componentSchema = z.object({
  greenLotId: z.string().uuid('Green lot id must be a UUID'),
  percentBps: z.number().int().min(0).max(10000),
  notes: z.string().trim().max(500).optional(),
});

const recipeCreateSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(64),
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().trim().max(2000).optional(),
  chargeWeightG: z.number().positive('Charge weight must be positive'),
  expectedYieldPct: z.number().min(0).max(100).nullable(),
  durationSeconds: z.number().int().positive('Duration must be positive'),
  profileNotes: z.string().trim().max(2000).optional(),
  components: z.array(componentSchema).default([]),
  active: z.boolean().optional().default(true),
});

const recipeUpdateSchema = recipeCreateSchema.extend({
  id: z.string().uuid(),
});

export type RecipeCreateInput = z.infer<typeof recipeCreateSchema>;
export type RecipeUpdateInput = z.infer<typeof recipeUpdateSchema>;
export interface RecipeComponentInput {
  greenLotId: string;
  percentBps: number;
  notes?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  id?: string;
}

// TOTAL_BPS_TOLERANCE — the recipe blend sum is 10000 bps = 100%, but
// the user might type 3334 / 3333 / 3333 (sum = 10000) — we accept
// anything in [10000 - tolerance, 10000 + tolerance] to absorb
// rounding.
const TOTAL_BPS_TOLERANCE = 5; // ±0.05%

function parseComponents(formData: FormData): RecipeComponentInput[] {
  // Read repeated FormData entries. The form renders N rows with
  // name="component.greenLotId.0", "component.greenLotId.1", etc.
  // We collect by index then assemble into a typed array.
  const indices = new Set<number>();
  for (const key of formData.keys()) {
    const m = /^component\.(greenLotId|percentBps|notes)\.(\d+)$/.exec(key);
    if (m?.[2]) indices.add(Number(m[2]));
  }
  const out: RecipeComponentInput[] = [];
  for (const idx of indices) {
    const greenLotId = strOrUndef(formData.get(`component.greenLotId.${idx}`));
    const percentRaw = strOrUndef(formData.get(`component.percentBps.${idx}`));
    const notes = strOrUndef(formData.get(`component.notes.${idx}`));
    if (!greenLotId || !percentRaw) continue;
    const percentBps = parsePositiveNumber(percentRaw);
    if (percentBps === null) continue;
    // percentRaw is "0.00".."100.00" — convert to integer bps.
    const bps = Math.round(percentBps * 100);
    out.push({ greenLotId, percentBps: bps, ...(notes ? { notes } : {}) });
  }
  // Stable sort by greenLotId so the order is reproducible.
  out.sort((a, b) => a.greenLotId.localeCompare(b.greenLotId));
  return out;
}

/**
 * Sum the percentBps field across an array of recipe components.
 * Used by both create and update to validate the blend sums to
 * 100% (10000 bps), within TOTAL_BPS_TOLERANCE.
 */
function componentsTotalBps(components: RecipeComponentInput[]): number {
  return components.reduce((sum, c) => sum + c.percentBps, 0);
}

// ── createRecipe ───────────────────────────────────────────────────────

export async function createRecipe(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner', 'head_roaster']);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }

  const components = parseComponents(formData);
  const totalBps = componentsTotalBps(components);
  if (
    components.length > 0 &&
    Math.abs(totalBps - 10000) > TOTAL_BPS_TOLERANCE
  ) {
    return {
      ok: false,
      fieldErrors: {
        components: [
          `Recipe blend must sum to 100% (got ${(totalBps / 100).toFixed(2)}%). ` +
            `Adjust the percentages and save again.`,
        ],
      },
    };
  }

  const raw = {
    code: strOrUndef(formData.get('code')),
    name: strOrUndef(formData.get('name')),
    description: strOrUndef(formData.get('description')),
    chargeWeightG: parsePositiveNumber(strOrUndef(formData.get('chargeWeightG'))),
    expectedYieldPct: parsePositiveNumber(
      strOrUndef(formData.get('expectedYieldPct')),
    ),
    durationSeconds:
      parsePositiveNumber(strOrUndef(formData.get('durationSeconds'))) ?? 0,
    profileNotes: strOrUndef(formData.get('profileNotes')),
    components,
    active: formData.get('active') !== 'off',
  };
  const parsed = recipeCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;

  try {
    const newId = await withTenant(ctx.orgId, async (tx) => {
      const profileJson = {
        seconds: [],
        notes: input.profileNotes ?? '',
      };
      const inserted = await tx<{ id: string }>`
        INSERT INTO public.recipe (
          org_id, code, name, description,
          profile_json, charge_weight_g, expected_yield_pct,
          duration_seconds, active
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${input.code},
          ${input.name},
          ${input.description ?? null},
          ${JSON.stringify(profileJson)}::jsonb,
          ${input.chargeWeightG},
          ${input.expectedYieldPct ?? null},
          ${input.durationSeconds},
          ${input.active}
        )
        RETURNING id
      `;
      if (!inserted[0]) throw new Error('Failed to insert recipe');

      for (const c of input.components) {
        await tx`
          INSERT INTO public.recipe_component (
            org_id, recipe_id, green_lot_id, percent_bps, notes
          ) VALUES (
            ${ctx.orgId}::uuid,
            ${inserted[0].id}::uuid,
            ${c.greenLotId}::uuid,
            ${c.percentBps},
            ${c.notes ?? null}
          )
        `;
      }

      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'recipe_created',
          'recipe',
          ${inserted[0].id}::uuid,
          ${JSON.stringify({ values: { ...input, profileJson } })}::jsonb
        )
      `;
      return inserted[0].id;
    });
    revalidatePath('/admin/recipes');
    return { ok: true, id: newId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/recipe_org_id_code_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { code: ['A recipe with this code already exists'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── updateRecipe ───────────────────────────────────────────────────────

export async function updateRecipe(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner', 'head_roaster']);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }

  const components = parseComponents(formData);
  const totalBps = componentsTotalBps(components);
  if (
    components.length > 0 &&
    Math.abs(totalBps - 10000) > TOTAL_BPS_TOLERANCE
  ) {
    return {
      ok: false,
      fieldErrors: {
        components: [
          `Recipe blend must sum to 100% (got ${(totalBps / 100).toFixed(2)}%).`,
        ],
      },
    };
  }

  const raw = {
    id: strOrUndef(formData.get('id')),
    code: strOrUndef(formData.get('code')),
    name: strOrUndef(formData.get('name')),
    description: strOrUndef(formData.get('description')),
    chargeWeightG: parsePositiveNumber(strOrUndef(formData.get('chargeWeightG'))),
    expectedYieldPct: parsePositiveNumber(
      strOrUndef(formData.get('expectedYieldPct')),
    ),
    durationSeconds:
      parsePositiveNumber(strOrUndef(formData.get('durationSeconds'))) ?? 0,
    profileNotes: strOrUndef(formData.get('profileNotes')),
    components,
    active: formData.get('active') !== 'off',
  };
  const parsed = recipeUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;

  try {
    await withTenant(ctx.orgId, async (tx) => {
      const profileJson = {
        // Preserve any existing seconds trace; the form only edits notes.
        // We use a placeholder empty array — the full profile editor
        // is a v1.5 card.
        seconds: [],
        notes: input.profileNotes ?? '',
      };
      await tx`
        UPDATE public.recipe SET
          code = ${input.code},
          name = ${input.name},
          description = ${input.description ?? null},
          profile_json = ${JSON.stringify(profileJson)}::jsonb,
          charge_weight_g = ${input.chargeWeightG},
          expected_yield_pct = ${input.expectedYieldPct ?? null},
          duration_seconds = ${input.durationSeconds},
          active = ${input.active},
          updated_at = now()
        WHERE id = ${input.id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      // Replace components wholesale: delete existing rows then insert
      // the new ones. The recipe_component UNIQUE on
      // (recipe_id, green_lot_id) would otherwise block a swap.
      await tx`
        DELETE FROM public.recipe_component
         WHERE recipe_id = ${input.id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      for (const c of input.components) {
        await tx`
          INSERT INTO public.recipe_component (
            org_id, recipe_id, green_lot_id, percent_bps, notes
          ) VALUES (
            ${ctx.orgId}::uuid,
            ${input.id}::uuid,
            ${c.greenLotId}::uuid,
            ${c.percentBps},
            ${c.notes ?? null}
          )
        `;
      }
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'recipe_updated',
          'recipe',
          ${input.id}::uuid,
          ${JSON.stringify({ values: { ...input, profileJson } })}::jsonb
        )
      `;
    });
    revalidatePath('/admin/recipes');
    revalidatePath(`/admin/recipes/${input.id}`);
    return { ok: true, id: input.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/recipe_org_id_code_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { code: ['A recipe with this code already exists'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── deleteRecipe ───────────────────────────────────────────────────────

export async function deleteRecipe(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner', 'head_roaster']);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }
  const id = strOrUndef(formData.get('id'));
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, error: 'Invalid id' };
  }

  // Reference check — roast_batch.recipe_id FK ON DELETE RESTRICT
  // is the backstop.
  const refCount = await withTenant(ctx.orgId, async (tx) => {
    const r = await tx<{ count: string }>`
      SELECT COUNT(*)::text AS count FROM public.roast_batch
       WHERE recipe_id = ${id}::uuid
    `;
    return Number(r[0]?.count ?? '0');
  });
  if (refCount > 0) {
    return {
      ok: false,
      error: `Cannot delete: recipe is referenced by ${refCount} roast_batch row(s). Mark it inactive instead.`,
    };
  }

  try {
    await withTenant(ctx.orgId, async (tx) => {
      // recipe_component has ON DELETE CASCADE so components go with the recipe.
      await tx`
        DELETE FROM public.recipe
         WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'recipe_deleted',
          'recipe',
          ${id}::uuid,
          '{}'::jsonb
        )
      `;
    });
    revalidatePath('/admin/recipes');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ── List / get ─────────────────────────────────────────────────────────

export interface RecipeRow {
  id: string;
  code: string;
  name: string;
  charge_weight_g: string;
  expected_yield_pct: string | null;
  duration_seconds: number;
  active: boolean;
  updated_at: string;
  component_count: number;
}

export interface RecipeDetail {
  recipe: RecipeRow;
  components: {
    id: string;
    green_lot_id: string;
    green_lot_code: string;
    percent_bps: number;
    notes: string | null;
  }[];
}

export async function listRecipes(
  orgId: string,
  page: number,
  pageSize: number,
  search: string,
): Promise<{ rows: RecipeRow[]; total: number }> {
  return withTenant(orgId, async (tx) => {
    const offset = (page - 1) * pageSize;
    const rowsResult = (await tx`
      SELECT r.id, r.code, r.name,
             r.charge_weight_g::text AS charge_weight_g,
             r.expected_yield_pct::text AS expected_yield_pct,
             r.duration_seconds, r.active, r.updated_at::text AS updated_at,
             (SELECT COUNT(*)::int FROM public.recipe_component c
               WHERE c.recipe_id = r.id) AS component_count
        FROM public.recipe r
       WHERE (${search} = ''
              OR r.code ILIKE '%' || ${search} || '%'
              OR r.name ILIKE '%' || ${search} || '%')
       ORDER BY r.code ASC
       LIMIT ${pageSize} OFFSET ${offset}
    `) as unknown as RecipeRow[];
    const countResult = (await tx`
      SELECT COUNT(*)::text AS count FROM public.recipe
       WHERE (${search} = ''
              OR code ILIKE '%' || ${search} || '%'
              OR name ILIKE '%' || ${search} || '%')
    `) as unknown as { count: string }[];
    return {
      rows: rowsResult ?? [],
      total: Number(countResult?.[0]?.count ?? '0'),
    };
  });
}

export async function getRecipe(
  orgId: string,
  id: string,
): Promise<RecipeDetail | null> {
  return withTenant(orgId, async (tx) => {
    const recipeRows = (await tx`
      SELECT r.id, r.code, r.name,
             r.charge_weight_g::text AS charge_weight_g,
             r.expected_yield_pct::text AS expected_yield_pct,
             r.duration_seconds, r.active, r.updated_at::text AS updated_at,
             (SELECT COUNT(*)::int FROM public.recipe_component c
               WHERE c.recipe_id = r.id) AS component_count
        FROM public.recipe r
       WHERE r.id = ${id}::uuid AND r.org_id = ${orgId}::uuid
       LIMIT 1
    `) as unknown as RecipeRow[];
    const recipe = recipeRows[0];
    if (!recipe) return null;

    const componentRows = (await tx`
      SELECT c.id, c.green_lot_id, g.code AS green_lot_code,
             c.percent_bps, c.notes
        FROM public.recipe_component c
        JOIN public.green_lot g ON g.id = c.green_lot_id
       WHERE c.recipe_id = ${id}::uuid AND c.org_id = ${orgId}::uuid
       ORDER BY g.code
    `) as unknown as {
      id: string;
      green_lot_id: string;
      green_lot_code: string;
      percent_bps: number;
      notes: string | null;
    }[];
    return { recipe, components: componentRows };
  });
}
