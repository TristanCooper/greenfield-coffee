'use server';

// apps/web/src/app/(authenticated)/admin/price-lists/actions.ts
//
// Card 0.16 — server actions for the Price Lists admin.
//
// RBAC matrix:
//   - read: every role
//   - create / update: owner or accountant
//   - delete: owner only
//
// The form has two parts:
//   1. The list-level fields (code, name, kind, VAT mode, currency, dates).
//   2. Per-SKU entries (price_list_entry rows). Entries are an
//      array sent as repeated FormData fields; the action replaces
//      the entry set wholesale on update.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { withTenant, assertRole, RbacError } from '@greenfield/db';
import { requireAdminContext } from '@/lib/admin/server';
import {
  strOrUndef,
  flattenZodErrors,
  parsePositiveNumber,
} from '@/lib/admin/form-helpers';

const KIND_VALUES = ['retail', 'wholesale', 'promo', 'internal'] as const;
const VAT_MODE_VALUES = ['inclusive', 'exclusive'] as const;

const entrySchema = z.object({
  skuId: z.string().uuid('SKU id must be a UUID'),
  priceMinorUnits: z.number().int().positive('Price must be positive'),
  currencyCode: z.string().trim().length(3, 'Currency must be 3 letters'),
  vatRateBps: z.number().int().min(0).max(9999).nullable(),
  minQuantity: z.number().positive().nullable(),
  notes: z.string().trim().max(500).optional(),
});

const priceListCreateSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(64),
  name: z.string().trim().min(1, 'Name is required').max(200),
  kind: z.enum(KIND_VALUES),
  vatMode: z.enum(VAT_MODE_VALUES),
  vatRatePct: z.number().min(0).max(99.99).nullable(),
  currencyCode: z.string().trim().length(3, 'Currency must be 3 letters'),
  effectiveFrom: z.string().trim().optional(),
  effectiveTo: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
  active: z.boolean().optional().default(true),
  entries: z.array(entrySchema).default([]),
});

const priceListUpdateSchema = priceListCreateSchema.extend({
  id: z.string().uuid(),
});

export type PriceListCreateInput = z.infer<typeof priceListCreateSchema>;
export type PriceListUpdateInput = z.infer<typeof priceListUpdateSchema>;
export interface PriceListEntryInput {
  skuId: string;
  priceMinorUnits: number;
  currencyCode: string;
  vatRateBps: number | null;
  minQuantity: number | null;
  notes?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  id?: string;
}

function parseEntries(formData: FormData): PriceListEntryInput[] {
  const indices = new Set<number>();
  for (const key of formData.keys()) {
    const m = /^entry\.(skuId|priceMinorUnits|currencyCode|vatRateBps|minQuantity|notes)\.(\d+)$/.exec(key);
    if (m?.[2]) indices.add(Number(m[2]));
  }
  const out: PriceListEntryInput[] = [];
  for (const idx of indices) {
    const skuId = strOrUndef(formData.get(`entry.skuId.${idx}`));
    const priceRaw = strOrUndef(formData.get(`entry.priceMinorUnits.${idx}`));
    const currencyCode = strOrUndef(formData.get(`entry.currencyCode.${idx}`));
    const vatBpsRaw = strOrUndef(formData.get(`entry.vatRateBps.${idx}`));
    const minQtyRaw = strOrUndef(formData.get(`entry.minQuantity.${idx}`));
    const notes = strOrUndef(formData.get(`entry.notes.${idx}`));
    if (!skuId || !priceRaw || !currencyCode) continue;
    const priceMinorUnits = Number(priceRaw);
    if (!Number.isFinite(priceMinorUnits) || priceMinorUnits <= 0) continue;
    const vatRateBps =
      vatBpsRaw && vatBpsRaw !== ''
        ? Math.round(Number(vatBpsRaw))
        : null;
    const minQuantity =
      minQtyRaw && minQtyRaw !== '' ? Number(minQtyRaw) : null;
    out.push({
      skuId,
      priceMinorUnits: Math.round(priceMinorUnits),
      currencyCode: currencyCode.toUpperCase(),
      vatRateBps,
      minQuantity,
      ...(notes ? { notes } : {}),
    });
  }
  out.sort((a, b) => a.skuId.localeCompare(b.skuId));
  return out;
}

// ── createPriceList ────────────────────────────────────────────────────

export async function createPriceList(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner', 'accountant']);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }

  const raw = {
    code: strOrUndef(formData.get('code')),
    name: strOrUndef(formData.get('name')),
    kind: strOrUndef(formData.get('kind')),
    vatMode: strOrUndef(formData.get('vatMode')),
    vatRatePct: parsePositiveNumber(strOrUndef(formData.get('vatRatePct'))),
    currencyCode: strOrUndef(formData.get('currencyCode'))?.toUpperCase(),
    effectiveFrom: strOrUndef(formData.get('effectiveFrom')),
    effectiveTo: strOrUndef(formData.get('effectiveTo')),
    notes: strOrUndef(formData.get('notes')),
    active: formData.get('active') !== 'off',
    entries: parseEntries(formData),
  };
  const parsed = priceListCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;

  // vatMode and vat_inclusive must match (CHECK constraint).
  const vatInclusive = input.vatMode === 'inclusive';

  try {
    const newId = await withTenant(ctx.orgId, async (tx) => {
      const inserted = await tx<{ id: string }>`
        INSERT INTO public.price_list (
          org_id, code, name, kind,
          vat_mode, vat_inclusive, vat_rate_pct,
          currency_code,
          effective_from, effective_to, notes, active
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${input.code},
          ${input.name},
          ${input.kind}::price_list_kind,
          ${input.vatMode}::price_list_vat_mode,
          ${vatInclusive},
          ${input.vatRatePct ?? null},
          ${input.currencyCode},
          ${input.effectiveFrom ?? null},
          ${input.effectiveTo ?? null},
          ${input.notes ?? null},
          ${input.active}
        )
        RETURNING id
      `;
      if (!inserted[0]) throw new Error('Failed to insert price_list');

      for (const e of input.entries) {
        await tx`
          INSERT INTO public.price_list_entry (
            org_id, price_list_id, sku_id,
            price_minor_units, currency_code,
            vat_rate_bps, min_quantity
          ) VALUES (
            ${ctx.orgId}::uuid,
            ${inserted[0].id}::uuid,
            ${e.skuId}::uuid,
            ${e.priceMinorUnits},
            ${e.currencyCode},
            ${e.vatRateBps},
            ${e.minQuantity}
          )
        `;
      }

      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'price_list_created',
          'price_list',
          ${inserted[0].id}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
      return inserted[0].id;
    });
    revalidatePath('/admin/price-lists');
    return { ok: true, id: newId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/price_list_org_id_code_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { code: ['A price list with this code already exists'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── updatePriceList ────────────────────────────────────────────────────

export async function updatePriceList(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner', 'accountant']);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }

  const raw = {
    id: strOrUndef(formData.get('id')),
    code: strOrUndef(formData.get('code')),
    name: strOrUndef(formData.get('name')),
    kind: strOrUndef(formData.get('kind')),
    vatMode: strOrUndef(formData.get('vatMode')),
    vatRatePct: parsePositiveNumber(strOrUndef(formData.get('vatRatePct'))),
    currencyCode: strOrUndef(formData.get('currencyCode'))?.toUpperCase(),
    effectiveFrom: strOrUndef(formData.get('effectiveFrom')),
    effectiveTo: strOrUndef(formData.get('effectiveTo')),
    notes: strOrUndef(formData.get('notes')),
    active: formData.get('active') !== 'off',
    entries: parseEntries(formData),
  };
  const parsed = priceListUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;
  const vatInclusive = input.vatMode === 'inclusive';

  try {
    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        UPDATE public.price_list SET
          code = ${input.code},
          name = ${input.name},
          kind = ${input.kind}::price_list_kind,
          vat_mode = ${input.vatMode}::price_list_vat_mode,
          vat_inclusive = ${vatInclusive},
          vat_rate_pct = ${input.vatRatePct ?? null},
          currency_code = ${input.currencyCode},
          effective_from = ${input.effectiveFrom ?? null},
          effective_to = ${input.effectiveTo ?? null},
          notes = ${input.notes ?? null},
          active = ${input.active},
          updated_at = now()
        WHERE id = ${input.id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      // Replace entries wholesale.
      await tx`
        DELETE FROM public.price_list_entry
         WHERE price_list_id = ${input.id}::uuid
           AND org_id = ${ctx.orgId}::uuid
      `;
      for (const e of input.entries) {
        await tx`
          INSERT INTO public.price_list_entry (
            org_id, price_list_id, sku_id,
            price_minor_units, currency_code,
            vat_rate_bps, min_quantity
          ) VALUES (
            ${ctx.orgId}::uuid,
            ${input.id}::uuid,
            ${e.skuId}::uuid,
            ${e.priceMinorUnits},
            ${e.currencyCode},
            ${e.vatRateBps},
            ${e.minQuantity}
          )
        `;
      }
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'price_list_updated',
          'price_list',
          ${input.id}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
    });
    revalidatePath('/admin/price-lists');
    revalidatePath(`/admin/price-lists/${input.id}`);
    return { ok: true, id: input.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/price_list_org_id_code_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { code: ['A price list with this code already exists'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── deletePriceList ────────────────────────────────────────────────────

export async function deletePriceList(
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

  // No forward references to price_list in v1 — the backstop is the
  // entry count (entries are CASCADE-deleted with the list).
  try {
    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        DELETE FROM public.price_list
         WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'price_list_deleted',
          'price_list',
          ${id}::uuid,
          '{}'::jsonb
        )
      `;
    });
    revalidatePath('/admin/price-lists');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ── List / get ─────────────────────────────────────────────────────────

export interface PriceListRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  vat_mode: string;
  currency_code: string;
  vat_rate_pct: string | null;
  effective_from: string | null;
  effective_to: string | null;
  active: boolean;
  updated_at: string;
  entry_count: number;
}

export interface PriceListDetail {
  priceList: PriceListRow;
  entries: {
    id: string;
    sku_id: string;
    sku_code: string;
    sku_name: string;
    price_minor_units: number;
    currency_code: string;
    vat_rate_bps: number | null;
    min_quantity: string | null;
  }[];
}

export async function listPriceLists(
  orgId: string,
  page: number,
  pageSize: number,
  search: string,
): Promise<{ rows: PriceListRow[]; total: number }> {
  return withTenant(orgId, async (tx) => {
    const offset = (page - 1) * pageSize;
    const rowsResult = (await tx`
      SELECT p.id, p.code, p.name, p.kind, p.vat_mode::text AS vat_mode,
             p.currency_code, p.vat_rate_pct::text AS vat_rate_pct,
             p.effective_from::text AS effective_from,
             p.effective_to::text AS effective_to,
             p.active, p.updated_at::text AS updated_at,
             (SELECT COUNT(*)::int FROM public.price_list_entry e
               WHERE e.price_list_id = p.id) AS entry_count
        FROM public.price_list p
       WHERE (${search} = ''
              OR p.code ILIKE '%' || ${search} || '%'
              OR p.name ILIKE '%' || ${search} || '%')
       ORDER BY p.code ASC
       LIMIT ${pageSize} OFFSET ${offset}
    `) as unknown as PriceListRow[];
    const countResult = (await tx`
      SELECT COUNT(*)::text AS count FROM public.price_list
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

export async function getPriceList(
  orgId: string,
  id: string,
): Promise<PriceListDetail | null> {
  return withTenant(orgId, async (tx) => {
    const plRows = (await tx`
      SELECT p.id, p.code, p.name, p.kind, p.vat_mode::text AS vat_mode,
             p.currency_code, p.vat_rate_pct::text AS vat_rate_pct,
             p.effective_from::text AS effective_from,
             p.effective_to::text AS effective_to,
             p.active, p.updated_at::text AS updated_at,
             (SELECT COUNT(*)::int FROM public.price_list_entry e
               WHERE e.price_list_id = p.id) AS entry_count
        FROM public.price_list p
       WHERE p.id = ${id}::uuid AND p.org_id = ${orgId}::uuid
       LIMIT 1
    `) as unknown as PriceListRow[];
    const priceList = plRows[0];
    if (!priceList) return null;
    const entryRows = (await tx`
      SELECT e.id, e.sku_id, s.code AS sku_code, s.name AS sku_name,
             e.price_minor_units, e.currency_code,
             e.vat_rate_bps, e.min_quantity::text AS min_quantity
        FROM public.price_list_entry e
        JOIN public.sku s ON s.id = e.sku_id
       WHERE e.price_list_id = ${id}::uuid AND e.org_id = ${orgId}::uuid
       ORDER BY s.code
    `) as unknown as {
      id: string;
      sku_id: string;
      sku_code: string;
      sku_name: string;
      price_minor_units: number;
      currency_code: string;
      vat_rate_bps: number | null;
      min_quantity: string | null;
    }[];
    return { priceList, entries: entryRows };
  });
}
