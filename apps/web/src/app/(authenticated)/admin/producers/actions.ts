'use server';

// apps/web/src/app/(authenticated)/admin/producers/actions.ts
//
// Card 0.16 — server actions for the Producers admin.
//
// RBAC matrix:
//   - read: every role
//   - create / update: owner / buyer_receiving / compliance_officer
//   - delete: owner / compliance_officer
//
// The geolocation column is `geography(MultiPolygon, 4326)`. The
// form sends a GeoJSON object as a JSON string; the action parses
// it on the server, runs ST_GeomFromGeoJSON via a parameterized
// SQL expression, and writes the resulting geography. The legacy
// shape (raw WKT) is still accepted via the same path because
// ST_GeomFromText is also handled server-side.

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { withTenant, assertRole, RbacError } from '@greenfield/db';
import { requireAdminContext } from '@/lib/admin/server';
import { strOrUndef, flattenZodErrors, parsePositiveNumber } from '@/lib/admin/form-helpers';

const VERIFICATION_VALUES = [
  'self_reported',
  'third_party_verified',
  'satellite_imagery',
  'ground_survey',
] as const;

const producerCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  countryCode: z
    .string()
    .trim()
    .length(2)
    .refine((v) => /^[A-Za-z]{2}$/.test(v))
    .transform((v) => v.toUpperCase()),
  region: z.string().trim().max(100).optional(),
  areaHectares: z.number().positive().nullable(),
  verificationSource: z.enum(VERIFICATION_VALUES),
  riskRating: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(2000).optional(),
  geolocationGeojson: z.string().trim().optional(),
});

const producerUpdateSchema = producerCreateSchema.extend({
  id: z.string().uuid(),
});

export type ProducerCreateInput = z.infer<typeof producerCreateSchema>;
export type ProducerUpdateInput = z.infer<typeof producerUpdateSchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  id?: string;
}

/**
 * Parse the form's geolocation string into a JSON object. The form
 * sends either:
 *   - JSON: '{"type":"Polygon","coordinates":[…]}'
 *   - empty string: clear the geolocation
 *
 * Returns `null` to clear, an object otherwise.
 *
 * Throws with a friendly message if the JSON is malformed or the
 * shape is invalid (caller wraps in ActionResult.fieldErrors).
 */
function parseGeolocation(
  raw: string | undefined,
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!raw || raw.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Geolocation must be valid JSON');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    (parsed.type !== 'Polygon' &&
      parsed.type !== 'MultiPolygon')
  ) {
    throw new Error(
      'Geolocation must be a GeoJSON Polygon or MultiPolygon object',
    );
  }
  return parsed as GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

// ── createProducer ────────────────────────────────────────────────────

export async function createProducer(
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

  const geojsonRaw = strOrUndef(formData.get('geolocationGeojson'));
  let geolocation: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;
  try {
    geolocation = parseGeolocation(geojsonRaw);
  } catch (e) {
    return {
      ok: false,
      fieldErrors: {
        geolocation: [e instanceof Error ? e.message : 'Invalid geolocation'],
      },
    };
  }

  const raw = {
    name: strOrUndef(formData.get('name')),
    countryCode: strOrUndef(formData.get('countryCode')),
    region: strOrUndef(formData.get('region')),
    areaHectares: parsePositiveNumber(strOrUndef(formData.get('areaHectares'))),
    verificationSource: strOrUndef(formData.get('verificationSource')),
    riskRating: strOrUndef(formData.get('riskRating')),
    notes: strOrUndef(formData.get('notes')),
    geolocationGeojson: geojsonRaw,
  };
  const parsed = producerCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;

  try {
    const newId = await withTenant(ctx.orgId, async (tx) => {
      // Geolocation: ST_GeomFromGeoJSON parses a GeoJSON object into
      // geography(MultiPolygon, 4326). When the input is null we
      // pass NULL to the column.
      if (geolocation) {
        const inserted = await tx<{ id: string }>`
          INSERT INTO public.producer (
            org_id, name, country_code, region, area_hectares,
            verification_source, risk_rating, notes, geolocation
          ) VALUES (
            ${ctx.orgId}::uuid,
            ${input.name},
            ${input.countryCode},
            ${input.region ?? null},
            ${input.areaHectares ?? null},
            ${input.verificationSource}::producer_verification_source,
            ${input.riskRating ?? null},
            ${input.notes ?? null},
            ST_GeomFromGeoJSON(${JSON.stringify(geolocation)}::text)::geography(MultiPolygon, 4326)
          )
          RETURNING id
        `;
        if (!inserted[0]) throw new Error('Failed to insert producer');
        return inserted[0].id;
      }
      const inserted = await tx<{ id: string }>`
        INSERT INTO public.producer (
          org_id, name, country_code, region, area_hectares,
          verification_source, risk_rating, notes, geolocation
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${input.name},
          ${input.countryCode},
          ${input.region ?? null},
          ${input.areaHectares ?? null},
          ${input.verificationSource}::producer_verification_source,
          ${input.riskRating ?? null},
          ${input.notes ?? null},
          NULL
        )
        RETURNING id
      `;
      if (!inserted[0]) throw new Error('Failed to insert producer');
      return inserted[0].id;
    });

    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'producer_created',
          'producer',
          ${newId}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
    });

    revalidatePath('/admin/producers');
    return { ok: true, id: newId };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: msg };
  }
}

// ── updateProducer ────────────────────────────────────────────────────

export async function updateProducer(
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

  const geojsonRaw = strOrUndef(formData.get('geolocationGeojson'));
  let geolocation: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;
  try {
    geolocation = parseGeolocation(geojsonRaw);
  } catch (e) {
    return {
      ok: false,
      fieldErrors: {
        geolocation: [e instanceof Error ? e.message : 'Invalid geolocation'],
      },
    };
  }

  const raw = {
    id: strOrUndef(formData.get('id')),
    name: strOrUndef(formData.get('name')),
    countryCode: strOrUndef(formData.get('countryCode')),
    region: strOrUndef(formData.get('region')),
    areaHectares: parsePositiveNumber(strOrUndef(formData.get('areaHectares'))),
    verificationSource: strOrUndef(formData.get('verificationSource')),
    riskRating: strOrUndef(formData.get('riskRating')),
    notes: strOrUndef(formData.get('notes')),
    geolocationGeojson: geojsonRaw,
  };
  const parsed = producerUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: flattenZodErrors(parsed.error) };
  }
  const input = parsed.data;

  try {
    if (geolocation) {
      await withTenant(ctx.orgId, async (tx) => {
        await tx`
          UPDATE public.producer SET
            name = ${input.name},
            country_code = ${input.countryCode},
            region = ${input.region ?? null},
            area_hectares = ${input.areaHectares ?? null},
            verification_source = ${input.verificationSource}::producer_verification_source,
            risk_rating = ${input.riskRating ?? null},
            notes = ${input.notes ?? null},
            geolocation = ST_GeomFromGeoJSON(${JSON.stringify(geolocation)}::text)::geography(MultiPolygon, 4326),
            updated_at = now()
          WHERE id = ${input.id}::uuid AND org_id = ${ctx.orgId}::uuid
        `;
      });
    } else {
      await withTenant(ctx.orgId, async (tx) => {
        await tx`
          UPDATE public.producer SET
            name = ${input.name},
            country_code = ${input.countryCode},
            region = ${input.region ?? null},
            area_hectares = ${input.areaHectares ?? null},
            verification_source = ${input.verificationSource}::producer_verification_source,
            risk_rating = ${input.riskRating ?? null},
            notes = ${input.notes ?? null},
            geolocation = NULL,
            updated_at = now()
          WHERE id = ${input.id}::uuid AND org_id = ${ctx.orgId}::uuid
        `;
      });
    }

    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'producer_updated',
          'producer',
          ${input.id}::uuid,
          ${JSON.stringify({ values: input })}::jsonb
        )
      `;
    });

    revalidatePath('/admin/producers');
    revalidatePath(`/admin/producers/${input.id}`);
    return { ok: true, id: input.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false, error: msg };
  }
}

// ── deleteProducer ────────────────────────────────────────────────────

export async function deleteProducer(
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

  const refCount = await withTenant(ctx.orgId, async (tx) => {
    const r = await tx<{ count: string }>`
      SELECT COUNT(*)::text AS count FROM public.green_lot
       WHERE producer_id = ${id}::uuid
    `;
    return Number(r[0]?.count ?? '0');
  });
  if (refCount > 0) {
    return {
      ok: false,
      error: `Cannot delete: producer is referenced by ${refCount} green_lot row(s). Mark inactive instead.`,
    };
  }

  try {
    await withTenant(ctx.orgId, async (tx) => {
      await tx`
        DELETE FROM public.producer
         WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid
      `;
      await tx`
        INSERT INTO public.audit_event (
          org_id, user_id, action, entity_type, entity_id, diff
        ) VALUES (
          ${ctx.orgId}::uuid,
          ${ctx.userId}::uuid,
          'producer_deleted',
          'producer',
          ${id}::uuid,
          '{}'::jsonb
        )
      `;
    });
    revalidatePath('/admin/producers');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ── List / get ─────────────────────────────────────────────────────────

export interface ProducerRow {
  id: string;
  name: string;
  country_code: string;
  region: string | null;
  area_hectares: string | null;
  verification_source: string;
  risk_rating: string | null;
  has_geolocation: boolean;
  updated_at: string;
}

export interface ProducerDetail {
  producer: ProducerRow;
  geolocation: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  areaHectares: number | null;
}

export async function listProducers(
  orgId: string,
  page: number,
  pageSize: number,
  search: string,
): Promise<{ rows: ProducerRow[]; total: number }> {
  return withTenant(orgId, async (tx) => {
    const offset = (page - 1) * pageSize;
    const rowsResult = (await tx`
      SELECT id, name, country_code, region,
             area_hectares::text AS area_hectares,
             verification_source::text AS verification_source,
             risk_rating,
             (geolocation IS NOT NULL) AS has_geolocation,
             updated_at::text AS updated_at
        FROM public.producer
       WHERE (${search} = ''
              OR name ILIKE '%' || ${search} || '%'
              OR country_code ILIKE '%' || ${search} || '%'
              OR region ILIKE '%' || ${search} || '%')
       ORDER BY name ASC
       LIMIT ${pageSize} OFFSET ${offset}
    `) as unknown as ProducerRow[];
    const countResult = (await tx`
      SELECT COUNT(*)::text AS count FROM public.producer
       WHERE (${search} = ''
              OR name ILIKE '%' || ${search} || '%'
              OR country_code ILIKE '%' || ${search} || '%'
              OR region ILIKE '%' || ${search} || '%')
    `) as unknown as { count: string }[];
    return {
      rows: rowsResult ?? [],
      total: Number(countResult?.[0]?.count ?? '0'),
    };
  });
}

export async function getProducer(
  orgId: string,
  id: string,
): Promise<ProducerDetail | null> {
  return withTenant(orgId, async (tx) => {
    const rows = (await tx`
      SELECT id, name, country_code, region,
             area_hectares::text AS area_hectares,
             verification_source::text AS verification_source,
             risk_rating,
             (geolocation IS NOT NULL) AS has_geolocation,
             updated_at::text AS updated_at,
             ST_AsGeoJSON(geolocation)::jsonb AS geolocation_json
        FROM public.producer
       WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid
       LIMIT 1
    `) as unknown as (ProducerRow & { geolocation_json: unknown })[];
    const row = rows[0];
    if (!row) return null;

    let geolocation: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;
    let hasGeolocation = false;
    if (
      row.geolocation_json &&
      typeof row.geolocation_json === 'object'
    ) {
      const gj = row.geolocation_json as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      if (gj.type === 'Polygon' || gj.type === 'MultiPolygon') {
        geolocation = gj;
        hasGeolocation = true;
      }
    }

    const { geolocation_json: _gj, ...rest } = row;
    void _gj;
    return {
      producer: { ...rest, has_geolocation: hasGeolocation },
      geolocation,
      areaHectares: rest.area_hectares ? Number(rest.area_hectares) : null,
    };
  });
}
