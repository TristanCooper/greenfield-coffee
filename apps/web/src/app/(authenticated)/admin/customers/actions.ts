'use server';

// apps/web/src/app/(authenticated)/admin/customers/actions.ts
//
// Card 0.16 — server actions for the Customers admin.
//
// Mirrors apps/web/src/app/(authenticated)/admin/skus/actions.ts.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { withTenant, assertRole, RbacError } from '@greenfield/db';
import { requireAdminContext } from '@/lib/admin/server';
import { strOrUndef, flattenZodErrors } from '@/lib/admin/form-helpers';

// ── Validation ─────────────────────────────────────────────────────────

const customerCreateSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(64),
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z
    .string()
    .trim()
    .max(200)
    .optional()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: 'Email must be a valid address',
    }),
  phone: z.string().trim().max(50).optional(),
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: z
    .string()
    .trim()
    .max(2)
    .optional()
    .refine((v) => !v || /^[A-Za-z]{2}$/.test(v), {
      message: 'Country must be ISO 3166-1 alpha-2',
    })
    .transform((v) => (v ? v.toUpperCase() : undefined)),
  taxId: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(2000).optional(),
  active: z.boolean().optional().default(true),
});

const customerUpdateSchema = customerCreateSchema.extend({
  id: z.string().uuid(),
});

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  id?: string;
}

// ── createCustomer ─────────────────────────────────────────────────────

export async function createCustomer(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner']);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }

  const raw = {
    code: strOrUndef(formData.get('code')),
    name: strOrUndef(formData.get('name')),
    email: strOrUndef(formData.get('email')),
    phone: strOrUndef(formData.get('phone')),
    addressLine1: strOrUndef(formData.get('addressLine1')),
    addressLine2: strOrUndef(formData.get('addressLine2')),
    city: strOrUndef(formData.get('city')),
    postalCode: strOrUndef(formData.get('postalCode')),
    countryCode: strOrUndef(formData.get('countryCode')),
    taxId: strOrUndef(formData.get('taxId')),
    notes: strOrUndef(formData.get('notes')),
    active: formData.get('active') !== 'off',
  };
  const parsed = customerCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;

  try {
    const newId = await withTenant(ctx.orgId, async (tx) => {
      const inserted = await tx<{ id: string }>`
        INSERT INTO public.customer (
          org_id, code, name, email, phone,
          address_line1, address_line2, city, postal_code,
          country_code, tax_id, notes, active
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${input.code},
          ${input.name},
          ${input.email ?? null},
          ${input.phone ?? null},
          ${input.addressLine1 ?? null},
          ${input.addressLine2 ?? null},
          ${input.city ?? null},
          ${input.postalCode ?? null},
          ${input.countryCode ?? null},
          ${input.taxId ?? null},
          ${input.notes ?? null},
          ${input.active}
        )
        RETURNING id
      `;
      if (!inserted[0]) throw new Error('Failed to insert customer');
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'customer_created',
          'customer',
          ${inserted[0].id}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
      return inserted[0].id;
    });
    revalidatePath('/admin/customers');
    return { ok: true, id: newId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/customer_org_id_code_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { code: ['A customer with this code already exists'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── updateCustomer ─────────────────────────────────────────────────────

export async function updateCustomer(formData: FormData): Promise<ActionResult> {
  const ctx = await requireAdminContext();
  try {
    await assertRole(ctx.userId, ctx.orgId, ['owner']);
  } catch (e) {
    if (e instanceof RbacError) return { ok: false, error: e.message };
    throw e;
  }

  const raw = {
    id: strOrUndef(formData.get('id')),
    code: strOrUndef(formData.get('code')),
    name: strOrUndef(formData.get('name')),
    email: strOrUndef(formData.get('email')),
    phone: strOrUndef(formData.get('phone')),
    addressLine1: strOrUndef(formData.get('addressLine1')),
    addressLine2: strOrUndef(formData.get('addressLine2')),
    city: strOrUndef(formData.get('city')),
    postalCode: strOrUndef(formData.get('postalCode')),
    countryCode: strOrUndef(formData.get('countryCode')),
    taxId: strOrUndef(formData.get('taxId')),
    notes: strOrUndef(formData.get('notes')),
    active: formData.get('active') !== 'off',
  };
  const parsed = customerUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;

  try {
    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        UPDATE public.customer SET
          code = ${input.code},
          name = ${input.name},
          email = ${input.email ?? null},
          phone = ${input.phone ?? null},
          address_line1 = ${input.addressLine1 ?? null},
          address_line2 = ${input.addressLine2 ?? null},
          city = ${input.city ?? null},
          postal_code = ${input.postalCode ?? null},
          country_code = ${input.countryCode ?? null},
          tax_id = ${input.taxId ?? null},
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
          'customer_updated',
          'customer',
          ${input.id}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
    });
    revalidatePath('/admin/customers');
    revalidatePath(`/admin/customers/${input.id}`);
    return { ok: true, id: input.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (/customer_org_id_code_unique|duplicate key/i.test(msg)) {
      return {
        ok: false,
        fieldErrors: { code: ['A customer with this code already exists'] },
      };
    }
    return { ok: false, error: msg };
  }
}

// ── deleteCustomer ─────────────────────────────────────────────────────

export async function deleteCustomer(formData: FormData): Promise<ActionResult> {
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

  // Reference check. v1 has no FKs INTO customer yet (order.customer_id
  // is a forward reference); this hook is kept so future cards have a
  // single place to add cross-table checks.
  const refCount = await withTenant(ctx.orgId, async () => {
    // Future card: replace this no-op with COUNTs on the FK
    // targets once they're added.
    await Promise.resolve();
    return 0;
  });
  if (refCount > 0) {
    return {
      ok: false,
      error: `Cannot delete: customer is referenced by ${refCount} row(s). Mark inactive instead.`,
    };
  }

  try {
    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        DELETE FROM public.customer
         WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'customer_deleted',
          'customer',
          ${id}::uuid,
          '{}'::jsonb
        )
      `;
    });
    revalidatePath('/admin/customers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ── List / get ─────────────────────────────────────────────────────────

export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  email: string | null;
  country_code: string | null;
  active: boolean;
  updated_at: string;
}

export async function listCustomers(
  orgId: string,
  page: number,
  pageSize: number,
  search: string,
): Promise<{ rows: CustomerRow[]; total: number }> {
  return withTenant(orgId, async (tx) => {
    const offset = (page - 1) * pageSize;
    const rowsResult = (await tx`
      SELECT id, code, name, email, country_code, active, updated_at::text AS updated_at
        FROM public.customer
       WHERE (${search} = ''
              OR code ILIKE '%' || ${search} || '%'
              OR name ILIKE '%' || ${search} || '%'
              OR email ILIKE '%' || ${search} || '%')
       ORDER BY code ASC
       LIMIT ${pageSize} OFFSET ${offset}
    `) as unknown as CustomerRow[];
    const countResult = (await tx`
      SELECT COUNT(*)::text AS count FROM public.customer
       WHERE (${search} = ''
              OR code ILIKE '%' || ${search} || '%'
              OR name ILIKE '%' || ${search} || '%'
              OR email ILIKE '%' || ${search} || '%')
    `) as unknown as { count: string }[];
    return {
      rows: rowsResult ?? [],
      total: Number(countResult?.[0]?.count ?? '0'),
    };
  });
}

export async function getCustomer(
  orgId: string,
  id: string,
): Promise<CustomerRow | null> {
  return withTenant(orgId, async (tx) => {
    const rows = (await tx`
      SELECT id, code, name, email, country_code, active, updated_at::text AS updated_at
        FROM public.customer
       WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid
       LIMIT 1
    `) as unknown as CustomerRow[];
    return rows[0] ?? null;
  });
}
