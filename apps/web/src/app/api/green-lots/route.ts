// apps/web/src/app/api/green-lots/route.ts
//
// Card 0.16 — green-lot autocomplete for the recipe admin (recipe
// blend picker).
//
//   GET /api/green-lots?q=<query>
//
// Returns up to 20 green_lot rows whose code ILIKE the query string.
// Tenant-scoped via withTenant; the caller's org id is inferred from
// the membership lookup.
//
// Why this lives at /api/green-lots and not /api/recipes/green-lots:
// the recipe admin form calls this same endpoint; future cards
// (e.g. the pack form's "consumed from" picker) reuse it.

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
    return NextResponse.json({ greenLots: [] }, { status: 401 });
  }
  const membership = await getFirstMembership(user.id);
  if (!membership) {
    return NextResponse.json({ greenLots: [] }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 1) {
    return NextResponse.json({ greenLots: [] });
  }

  try {
    const rows = await withTenant(membership.org_id, async (tx) => {
      return await tx<{
        id: string;
        code: string;
        country_of_origin: string | null;
        weight_kg: string;
      }>`
        SELECT id, code, country_of_origin, weight_kg::text AS weight_kg
          FROM public.green_lot
         WHERE org_id = ${membership.org_id}::uuid
           AND code ILIKE ${'%' + q + '%'}
         ORDER BY code
         LIMIT 20
      `;
    });
    return NextResponse.json({
      greenLots: rows.map((r) => ({
        id: r.id,
        code: r.code,
        countryOfOrigin: r.country_of_origin,
        weightKg: r.weight_kg,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      {
        greenLots: [],
        error: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
