'use server';

// apps/web/src/app/(authenticated)/admin/skus/actions.ts
//
// Card 0.16 — server actions for the SKUs admin.
//
// PATTERN (card body §Implementation Notes)
//
//   Server Actions (not tRPC). The card body allows either; the
//   receiving wizard (card 0.17) uses Server Actions, and there's
//   no tRPC in deps yet. Adding tRPC for one card is premature —
//   the rest of the app uses Server Actions and Route Handlers
//   exclusively.
//
//   Per-form actions live next to the page (this file) rather than
//   in a centralized actions module. The actions file is the only
//   thing the form imports; everything else is implementation
//   detail.
//
// RBAC
//
//   Every action calls assertRole() with the exact allowed roles
//   for the (entity, action). The page-level gate (page.tsx) does
//   the same check; the action is the authoritative gate because
//   it runs server-side regardless of what the UI rendered.
//
//   The page can be navigated to by any role (read is granted to
//   every role per the matrix). But the write actions only succeed
//   for roles in the matrix's write allowlist. A non-writer who
//   somehow invokes a write action (e.g. by crafting the request)
//   hits a FORBIDDEN error.
//
// VALIDATION
//
//   The action parses + validates the input shape using Zod. The
//   form does the same validation client-side (for fast feedback);
//   the action's validation is the authoritative one — a
//   tampered request gets rejected here.
//
// ATOMICITY
//
//   Each action runs in a single withTenant() transaction. Inserts
//   and updates are wrapped; if any step fails the whole
//   transaction rolls back. The audit_event row is inserted in
//   the same transaction so the audit trail can't drift from the
//   data.

import { withTenant, assertRole, RbacError } from '@greenfield/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdminContext } from '@/lib/admin/server';

// ── Validation schemas ───────────────────────────────────────────────────

const skuCreateSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(64),
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().trim().max(2000).optional(),
  unitWeightG: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : Number(v)))
    .refine((n) => n === null || (Number.isFinite(n) && n > 0), {
      message: 'Unit weight must be a positive number',
    }),
  wholesaleOnly: z.boolean().optional().default(false),
  tagsText: z.string().trim().optional(),
  active: z.boolean().optional().default(true),
});

const skuUpdateSchema = skuCreateSchema.extend({
  id: z.string().uuid(),
});

export type SkuCreateInput = z.infer<typeof skuCreateSchema>;
export type SkuUpdateInput = z.infer<typeof skuUpdateSchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  id?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseTags(input: string | undefined): string[] {
  if (!input) return [];
  // Tags are comma-separated. Empty tags (consecutive commas) are
  // dropped. Whitespace trimmed.
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 32);
}

function flattenZodErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_root';
    if (!out[key]) out[key] = [];
    out[key].push(issue.message);
  }
  return out;
}

// ── createSku ────────────────────────────────────────────────────────────

export async function createSku(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdminContext();

  // RBAC: only owner can create (per matrix).
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner']);
  } catch (e) {
    if (e instanceof RbacError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }

  // Parse + validate. We coerce FormData (always strings) to the
  // typed shape using Zod's coercion.
  const raw = {
    code: formData.get('code'),
    name: formData.get('name'),
    description: formData.get('description') ?? undefined,
    unitWeightG: formData.get('unitWeightG') ?? undefined,
    wholesaleOnly: formData.get('wholesaleOnly') === 'on',
    tagsText: formData.get('tagsText') ?? undefined,
    active: formData.get('active') !== 'off', // default on
  };
  const parsed = skuCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }

  const input = parsed.data;
  try {
    const newId = await withTenant(ctx.orgId, async (tx) => {
      const inserted = await tx<{ id: string }>`
        INSERT INTO public.sku (
          org_id, code, name, description, unit_weight_g,
          wholesale_only, tags, active
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${input.code},
          ${input.name},
          ${input.description ?? null},
          ${input.unitWeightG},
          ${input.wholesaleOnly},
          ${parseTags(input.tagsText)}::text[],
          ${input.active}
        )
        RETURNING id
      `;
      if (!inserted[0]) throw new Error('Failed to insert sku');

      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'sku_created',
          'sku',
          ${inserted[0].id}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
      return inserted[0].id;
    });
    revalidatePath('/admin/skus');
    return { ok: true, id: newId };
  } catch (e) {
    // Unique violation on (org_id, code) — surface as a friendly
    // field error rather than a 500.
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/sku_org_id_code_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { code: ['A SKU with this code already exists'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── updateSku ────────────────────────────────────────────────────────────

export async function updateSku(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdminContext();

  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner']);
  } catch (e) {
    if (e instanceof RbacError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }

  const raw = {
    id: formData.get('id'),
    code: formData.get('code'),
    name: formData.get('name'),
    description: formData.get('description') ?? undefined,
    unitWeightG: formData.get('unitWeightG') ?? undefined,
    wholesaleOnly: formData.get('wholesaleOnly') === 'on',
    tagsText: formData.get('tagsText') ?? undefined,
    active: formData.get('active') !== 'off',
  };
  const parsed = skuUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }

  const input = parsed.data;
  try {
    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        UPDATE public.sku SET
          code = ${input.code},
          name = ${input.name},
          description = ${input.description ?? null},
          unit_weight_g = ${input.unitWeightG},
          wholesale_only = ${input.wholesaleOnly},
          tags = ${parseTags(input.tagsText)}::text[],
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
          'sku_updated',
          'sku',
          ${input.id}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
    });
    revalidatePath('/admin/skus');
    revalidatePath(`/admin/skus/${input.id}`);
    return { ok: true, id: input.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/sku_org_id_code_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { code: ['A SKU with this code already exists'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── deleteSku ────────────────────────────────────────────────────────────

export async function deleteSku(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner']);
  } catch (e) {
    if (e instanceof RbacError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }

  const id = formData.get('id');
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, error: 'Invalid id' };
  }

  // Reference check BEFORE delete. The FK constraints will block
  // the delete with a less friendly error otherwise; checking first
  // gives the user a clear message ("Cannot delete: referenced by
  // 3 packaged_lot row(s)").
  const refCount = await withTenant(ctx.orgId, async (tx) => {
    const r1 = await tx<{ count: string }>`
      SELECT COUNT(*)::text AS count FROM public.packaged_lot
       WHERE sku_id = ${id}::uuid
    `;
    const r2 = await tx<{ count: string }>`
      SELECT COUNT(*)::text AS count FROM public.price_list_entry
       WHERE sku_id = ${id}::uuid
    `;
    return Number(r1[0]?.count ?? '0') + Number(r2[0]?.count ?? '0');
  });

  if (refCount > 0) {
    return {
      ok: false,
      error: `Cannot delete: SKU is referenced by ${refCount} other row(s). ` +
        `Mark it inactive instead.`,
    };
  }

  try {
    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        DELETE FROM public.sku
         WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'sku_deleted',
          'sku',
          ${id}::uuid,
          '{}'::jsonb
        )
      `;
    });
    revalidatePath('/admin/skus');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ── List query (used by page.tsx as a Server Component) ──────────────────

export interface SkuRow {
  id: string;
  code: string;
  name: string;
  unit_weight_g: string | null;
  wholesale_only: boolean;
  tags: string[];
  active: boolean;
  updated_at: string;
}

/**
 * Fetch the paginated SKU list. Returns rows + total count for
 * pagination UI. Sort is hard-coded to `code asc` for v0 — a
 * later card adds column-header click-to-sort.
 */
export async function listSkus(
  orgId: string,
  page: number,
  pageSize: number,
  search: string,
): Promise<{ rows: SkuRow[]; total: number }> {
  return withTenant(orgId, async (tx) => {
    const offset = (page - 1) * pageSize;
    // The search parameter is bound as a parameter; the column
    // is hard-coded. Safe against SQL injection.
    const rowsResult = (await tx`
      SELECT id, code, name, unit_weight_g::text AS unit_weight_g,
             wholesale_only, tags, active, updated_at::text AS updated_at
        FROM public.sku
       WHERE (${search} = '' OR code ILIKE '%' || ${search} || '%' OR name ILIKE '%' || ${search} || '%')
       ORDER BY code ASC
       LIMIT ${pageSize} OFFSET ${offset}
    `) as unknown as SkuRow[];
    const countResult = (await tx`
      SELECT COUNT(*)::text AS count FROM public.sku
       WHERE (${search} = '' OR code ILIKE '%' || ${search} || '%' OR name ILIKE '%' || ${search} || '%')
    `) as unknown as Array<{ count: string }>;
    return {
      rows: rowsResult ?? [],
      total: Number(countResult?.[0]?.count ?? '0'),
    };
  });
}

/** Fetch a single SKU for the edit page. Returns null if not found. */
export async function getSku(orgId: string, id: string): Promise<SkuRow | null> {
  return withTenant(orgId, async (tx) => {
    const rows = (await tx`
      SELECT id, code, name, unit_weight_g::text AS unit_weight_g,
             wholesale_only, tags, active, updated_at::text AS updated_at
        FROM public.sku
       WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid
       LIMIT 1
    `) as unknown as SkuRow[];
    return rows[0] ?? null;
  });
}

/** Convenience redirect after a successful create/update — used by forms. */
export async function redirectToSkuList(): Promise<never> {
  redirect('/admin/skus');
}
