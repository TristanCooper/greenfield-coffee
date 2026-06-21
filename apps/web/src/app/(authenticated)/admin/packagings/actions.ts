'use server';

// apps/web/src/app/(authenticated)/admin/packagings/actions.ts
//
// Card 0.16 — server actions for the Packagings admin.
//
// RBAC matrix: read = every role; write (create/update) =
// owner or head_roaster; delete = owner only.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { withTenant, assertRole, RbacError } from '@greenfield/db';
import { requireAdminContext } from '@/lib/admin/server';
import {
  strOrUndef,
  flattenZodErrors,
  parsePositiveNumber,
  parseNonNegativeNumber,
} from '@/lib/admin/form-helpers';

// Material values mirror the CHECK constraint in the migration
// (see packages/db/src/migrations/0007_operational.sql).
const MATERIAL_VALUES = [
  'valve_bag',
  'pillow_bag',
  'tin',
  'case',
  'pouch',
  'pod',
  'other',
] as const;

const packagingCreateSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(64),
  name: z.string().trim().min(1, 'Name is required').max(200),
  material: z.enum(MATERIAL_VALUES, {
    message: 'Material must be one of the allowed values',
  }),
  tareWeightG: z.number().positive().nullable(),
  capacityG: z.number().positive('Capacity must be positive'),
  costMinorUnits: z.number().int().nonnegative(),
  notes: z.string().trim().max(2000).optional(),
  active: z.boolean().optional().default(true),
});

const packagingUpdateSchema = packagingCreateSchema.extend({
  id: z.string().uuid(),
});

export type PackagingCreateInput = z.infer<typeof packagingCreateSchema>;
export type PackagingUpdateInput = z.infer<typeof packagingUpdateSchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  id?: string;
}

// ── createPackaging ────────────────────────────────────────────────────

export async function createPackaging(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner', 'head_roaster']);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }

  const raw = {
    code: strOrUndef(formData.get('code')),
    name: strOrUndef(formData.get('name')),
    material: strOrUndef(formData.get('material')),
    tareWeightG: parseNonNegativeNumber(strOrUndef(formData.get('tareWeightG'))),
    capacityG: parsePositiveNumber(strOrUndef(formData.get('capacityG'))),
    costMinorUnits:
      parseNonNegativeNumber(strOrUndef(formData.get('costMinorUnits'))) ?? 0,
    notes: strOrUndef(formData.get('notes')),
    active: formData.get('active') !== 'off',
  };
  const parsed = packagingCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;

  try {
    const newId = await withTenant(ctx.orgId, async (tx) => {
      const inserted = await tx<{ id: string }>`
        INSERT INTO public.packaging (
          org_id, code, name, material,
          tare_weight_g, capacity_g, cost_minor_units, notes, active
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${input.code},
          ${input.name},
          ${input.material},
          ${input.tareWeightG ?? 0},
          ${input.capacityG},
          ${input.costMinorUnits},
          ${input.notes ?? null},
          ${input.active}
        )
        RETURNING id
      `;
      if (!inserted[0]) throw new Error('Failed to insert packaging');
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'packaging_created',
          'packaging',
          ${inserted[0].id}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
      return inserted[0].id;
    });
    revalidatePath('/admin/packagings');
    return { ok: true, id: newId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/packaging_org_id_code_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { code: ['A packaging with this code already exists'] },
      };
    }
    if (/packaging_material_check|check constraint/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { material: ['Material must be one of the allowed values'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── updatePackaging ────────────────────────────────────────────────────

export async function updatePackaging(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner', 'head_roaster']);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }

  const raw = {
    id: strOrUndef(formData.get('id')),
    code: strOrUndef(formData.get('code')),
    name: strOrUndef(formData.get('name')),
    material: strOrUndef(formData.get('material')),
    tareWeightG: parseNonNegativeNumber(strOrUndef(formData.get('tareWeightG'))),
    capacityG: parsePositiveNumber(strOrUndef(formData.get('capacityG'))),
    costMinorUnits:
      parseNonNegativeNumber(strOrUndef(formData.get('costMinorUnits'))) ?? 0,
    notes: strOrUndef(formData.get('notes')),
    active: formData.get('active') !== 'off',
  };
  const parsed = packagingUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;

  try {
    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        UPDATE public.packaging SET
          code = ${input.code},
          name = ${input.name},
          material = ${input.material},
          tare_weight_g = ${input.tareWeightG ?? 0},
          capacity_g = ${input.capacityG},
          cost_minor_units = ${input.costMinorUnits},
          notes = ${input.notes ?? null},
          active = ${input.active},
          updated_at = now()
        WHERE id = ${input.id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'packaging_updated',
          'packaging',
          ${input.id}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
    });
    revalidatePath('/admin/packagings');
    revalidatePath(`/admin/packagings/${input.id}`);
    return { ok: true, id: input.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/packaging_org_id_code_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { code: ['A packaging with this code already exists'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── deletePackaging ────────────────────────────────────────────────────

export async function deletePackaging(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner']);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }
  const id = strOrUndef(formData.get('id'));
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, error: 'Invalid id' };
  }

  // Reference check — packaged_lot.packaging_id FK ON DELETE RESTRICT
  // is the backstop; we check first for a friendlier error.
  const refCount = await withTenant(ctx.orgId, async (tx) => {
    const r = await tx<{ count: string }>`
      SELECT COUNT(*)::text AS count FROM public.packaged_lot
       WHERE packaging_id = ${id}::uuid
    `;
    return Number(r[0]?.count ?? '0');
  });
  if (refCount > 0) {
    return {
      ok: false,
      error: `Cannot delete: packaging is referenced by ${refCount} packaged_lot row(s). Mark it inactive instead.`,
    };
  }

  try {
    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        DELETE FROM public.packaging
         WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'packaging_deleted',
          'packaging',
          ${id}::uuid,
          '{}'::jsonb
        )
      `;
    });
    revalidatePath('/admin/packagings');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ── List / get ─────────────────────────────────────────────────────────

export interface PackagingRow {
  id: string;
  code: string;
  name: string;
  material: string;
  tare_weight_g: string;
  capacity_g: string;
  cost_minor_units: number;
  notes: string | null;
  active: boolean;
  updated_at: string;
}

export async function listPackagings(
  orgId: string,
  page: number,
  pageSize: number,
  search: string,
): Promise<{ rows: PackagingRow[]; total: number }> {
  return withTenant(orgId, async (tx) => {
    const offset = (page - 1) * pageSize;
    const rowsResult = (await tx`
      SELECT id, code, name, material,
             tare_weight_g::text AS tare_weight_g,
             capacity_g::text AS capacity_g,
             cost_minor_units, notes, active, updated_at::text AS updated_at
        FROM public.packaging
       WHERE (${search} = ''
              OR code ILIKE '%' || ${search} || '%'
              OR name ILIKE '%' || ${search} || '%')
       ORDER BY code ASC
       LIMIT ${pageSize} OFFSET ${offset}
    `) as unknown as PackagingRow[];
    const countResult = (await tx`
      SELECT COUNT(*)::text AS count FROM public.packaging
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

export async function getPackaging(
  orgId: string,
  id: string,
): Promise<PackagingRow | null> {
  return withTenant(orgId, async (tx) => {
    const rows = (await tx`
      SELECT id, code, name, material,
             tare_weight_g::text AS tare_weight_g,
             capacity_g::text AS capacity_g,
             cost_minor_units, notes, active, updated_at::text AS updated_at
        FROM public.packaging
       WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid
       LIMIT 1
    `) as unknown as PackagingRow[];
    return rows[0] ?? null;
  });
}
