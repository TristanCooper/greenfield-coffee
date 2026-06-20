// apps/web/src/app/api/skus/route.ts
//
// Card 0.16 — SKU autocomplete for the recipe admin and the
// price-list admin.
//
//   GET /api/skus?q=<query>
//
// Returns up to 20 sku rows whose code or name ILIKE the query.
// Tenant-scoped via withTenant.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirstMembership, withTenant } from '@greenfield/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ skus: [] }, { status: 401 });
  }
  const membership = await getFirstMembership(user.id);
  if (!membership) {
    return NextResponse.json({ skus: [] }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 1) {
    return NextResponse.json({ skus: [] });
  }

  try {
    const rows = await withTenant(membership.org_id, async (tx) => {
      return await tx<{
        id: string;
        code: string;
        name: string;
        unit_weight_g: string | null;
      }>`
        SELECT id, code, name, unit_weight_g::text AS unit_weight_g
          FROM public.sku
         WHERE org_id = ${membership.org_id}::uuid
           AND active = true
           AND (code ILIKE ${'%' + q + '%'} OR name ILIKE ${'%' + q + '%'})
         ORDER BY code
         LIMIT 20
      `;
    });
    return NextResponse.json({
      skus: rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        unitWeightG: r.unit_weight_g,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { skus: [], error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
