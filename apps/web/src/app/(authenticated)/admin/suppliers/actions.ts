'use server';

// apps/web/src/app/(authenticated)/admin/suppliers/actions.ts
//
// Card 0.16 — server actions for the Suppliers admin.
//
// RBAC matrix:
//   - read: every role
//   - create / update: owner / buyer_receiving / compliance_officer
//   - delete: owner / compliance_officer
//
// The form writes a structured risk_assessment jsonb that includes
// both the new (card 0.16) fields and the legacy (card 0.11)
// fields so the column stays backward-compatible. See
// ./risk-assessment.ts.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { withTenant, assertRole, RbacError } from '@greenfield/db';
import { requireAdminContext } from '@/lib/admin/server';
import { strOrUndef, flattenZodErrors } from '@/lib/admin/form-helpers';
import {
  RISK_VALUES,
  defaultRiskAssessment,
  type StructuredRiskAssessment,
} from './risk-assessment';

const riskSchema = z.object({
  country_risk: z.enum(RISK_VALUES),
  producer_risk: z.enum(RISK_VALUES),
  supply_chain_risk: z.enum(RISK_VALUES),
  overall_risk: z.enum(RISK_VALUES),
  last_reviewed_at: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(v),
      'Date must be ISO 8601 (YYYY-MM-DD or full timestamp)',
    ),
  dds_filed_by_supplier: z.boolean(),
  notes: z.string().trim().max(2000),
});

const contactSchema = z.object({
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: 'Email must be a valid address',
    }),
  phone: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
});

const supplierCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  countryCode: z
    .string()
    .trim()
    .length(2, 'Country must be ISO 3166-1 alpha-2')
    .refine((v) => /^[A-Za-z]{2}$/.test(v), 'Country must be 2 letters')
    .transform((v) => v.toUpperCase()),
  eori: z.string().trim().max(50).optional(),
  ddsReference: z.string().trim().max(200).optional(),
  contact: contactSchema,
  risk: riskSchema,
});

const supplierUpdateSchema = supplierCreateSchema.extend({
  id: z.string().uuid(),
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  id?: string;
}

function parseRiskFromForm(formData: FormData): StructuredRiskAssessment {
  const base = defaultRiskAssessment();
  const pick = (name: string): string | undefined =>
    strOrUndef(formData.get(name));
  return {
    country_risk:
      (RISK_VALUES as readonly string[]).includes(pick('risk.country') ?? '')
        ? (pick('risk.country') as StructuredRiskAssessment['country_risk'])
        : base.country_risk,
    producer_risk:
      (RISK_VALUES as readonly string[]).includes(pick('risk.producer') ?? '')
        ? (pick('risk.producer') as StructuredRiskAssessment['producer_risk'])
        : base.producer_risk,
    supply_chain_risk:
      (RISK_VALUES as readonly string[]).includes(
        pick('risk.supplyChain') ?? '',
      )
        ? (pick('risk.supplyChain') as StructuredRiskAssessment['supply_chain_risk'])
        : base.supply_chain_risk,
    overall_risk:
      (RISK_VALUES as readonly string[]).includes(pick('risk.overall') ?? '')
        ? (pick('risk.overall') as StructuredRiskAssessment['overall_risk'])
        : base.overall_risk,
    last_reviewed_at: pick('risk.lastReviewedAt') ?? null,
    dds_filed_by_supplier: formData.get('risk.ddsFiledBySupplier') === 'on',
    notes: pick('risk.notes') ?? '',
  };
}

function parseContactFromForm(formData: FormData): {
  email?: string;
  phone?: string;
  address?: string;
} {
  const email = strOrUndef(formData.get('contact.email'));
  const phone = strOrUndef(formData.get('contact.phone'));
  const address = strOrUndef(formData.get('contact.address'));
  return {
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(address ? { address } : {}),
  };
}

// ── createSupplier ─────────────────────────────────────────────────────

export async function createSupplier(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, [
      'owner',
      'buyer_receiving',
      'compliance_officer',
    ]);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }

  const contact = parseContactFromForm(formData);
  const risk = parseRiskFromForm(formData);

  const raw = {
    name: strOrUndef(formData.get('name')),
    countryCode: strOrUndef(formData.get('countryCode')),
    eori: strOrUndef(formData.get('eori')),
    ddsReference: strOrUndef(formData.get('ddsReference')),
    contact,
    risk,
  };
  const parsed = supplierCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;

  try {
    const newId = await withTenant(ctx.orgId, async (tx) => {
      const inserted = await tx<{ id: string }>`
        INSERT INTO public.supplier (
          org_id, name, country_code, eori, dds_reference,
          risk_assessment, contact
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${input.name},
          ${input.countryCode},
          ${input.eori ?? null},
          ${input.ddsReference ?? null},
          ${JSON.stringify(input.risk)}::jsonb,
          ${JSON.stringify(input.contact)}::jsonb
        )
        RETURNING id
      `;
      if (!inserted[0]) throw new Error('Failed to insert supplier');
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'supplier_created',
          'supplier',
          ${inserted[0].id}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
      return inserted[0].id;
    });
    revalidatePath('/admin/suppliers');
    return { ok: true, id: newId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/supplier_org_id_name_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { name: ['A supplier with this name already exists'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── updateSupplier ─────────────────────────────────────────────────────

export async function updateSupplier(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, [
      'owner',
      'buyer_receiving',
      'compliance_officer',
    ]);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }

  const contact = parseContactFromForm(formData);
  const risk = parseRiskFromForm(formData);

  const raw = {
    id: strOrUndef(formData.get('id')),
    name: strOrUndef(formData.get('name')),
    countryCode: strOrUndef(formData.get('countryCode')),
    eori: strOrUndef(formData.get('eori')),
    ddsReference: strOrUndef(formData.get('ddsReference')),
    contact,
    risk,
  };
  const parsed = supplierUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;

  try {
    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        UPDATE public.supplier SET
          name = ${input.name},
          country_code = ${input.countryCode},
          eori = ${input.eori ?? null},
          dds_reference = ${input.ddsReference ?? null},
          risk_assessment = ${JSON.stringify(input.risk)}::jsonb,
          contact = ${JSON.stringify(input.contact)}::jsonb,
          updated_at = now()
        WHERE id = ${input.id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'supplier_updated',
          'supplier',
          ${input.id}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
    });
    revalidatePath('/admin/suppliers');
    revalidatePath(`/admin/suppliers/${input.id}`);
    return { ok: true, id: input.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/supplier_org_id_name_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { name: ['A supplier with this name already exists'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── deleteSupplier ─────────────────────────────────────────────────────

export async function deleteSupplier(
  formData: FormData,
): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner', 'compliance_officer']);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }
  const id = strOrUndef(formData.get('id'));
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return { ok: false, error: 'Invalid id' };
  }

  // Reference check — green_lot.supplier_id FK ON DELETE RESTRICT.
  const refCount = await withTenant(ctx.orgId, async (tx) => {
    const r = await tx<{ count: string }>`
      SELECT COUNT(*)::text AS count FROM public.green_lot
       WHERE supplier_id = ${id}::uuid
    `;
    return Number(r[0]?.count ?? '0');
  });
  if (refCount > 0) {
    return {
      ok: false,
      error: `Cannot delete: supplier is referenced by ${refCount} green_lot row(s). Mark inactive instead.`,
    };
  }

  try {
    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        DELETE FROM public.supplier
         WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'supplier_deleted',
          'supplier',
          ${id}::uuid,
          '{}'::jsonb
        )
      `;
    });
    revalidatePath('/admin/suppliers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ── List / get ─────────────────────────────────────────────────────────

export interface SupplierRow {
  id: string;
  name: string;
  country_code: string;
  eori: string | null;
  dds_reference: string | null;
  // The risk_assessment column is jsonb; we expose the structured
  // shape via the read helper in ./risk-assessment.ts.
  risk_assessment: unknown;
  contact: unknown;
  updated_at: string;
}

export async function listSuppliers(
  orgId: string,
  page: number,
  pageSize: number,
  search: string,
): Promise<{ rows: SupplierRow[]; total: number }> {
  return withTenant(orgId, async (tx) => {
    const offset = (page - 1) * pageSize;
    const rowsResult = (await tx`
      SELECT id, name, country_code, eori, dds_reference,
             risk_assessment, contact, updated_at::text AS updated_at
        FROM public.supplier
       WHERE (${search} = ''
              OR name ILIKE '%' || ${search} || '%'
              OR country_code ILIKE '%' || ${search} || '%')
       ORDER BY name ASC
       LIMIT ${pageSize} OFFSET ${offset}
    `) as unknown as SupplierRow[];
    const countResult = (await tx`
      SELECT COUNT(*)::text AS count FROM public.supplier
       WHERE (${search} = ''
              OR name ILIKE '%' || ${search} || '%'
              OR country_code ILIKE '%' || ${search} || '%')
    `) as unknown as { count: string }[];
    return {
      rows: rowsResult ?? [],
      total: Number(countResult?.[0]?.count ?? '0'),
    };
  });
}

export async function getSupplier(
  orgId: string,
  id: string,
): Promise<SupplierRow | null> {
  return withTenant(orgId, async (tx) => {
    const rows = (await tx`
      SELECT id, name, country_code, eori, dds_reference,
             risk_assessment, contact, updated_at::text AS updated_at
        FROM public.supplier
       WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid
       LIMIT 1
    `) as unknown as SupplierRow[];
    return rows[0] ?? null;
  });
}
