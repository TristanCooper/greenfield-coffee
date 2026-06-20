// apps/web/src/app/api/suppliers/route.ts
//
// Card 0.17 — supplier autocomplete for the receiving wizard.
//
//   GET /api/suppliers?q=<query>
//
// Returns up to 10 suppliers whose name ILIKE the query
// string. The query is tenant-scoped via withTenant; the
// caller's org id is inferred from the membership lookup
// (the supplier autocomplete is per-org, never global).

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
    return NextResponse.json({ suppliers: [] }, { status: 401 });
  }
  const membership = await getFirstMembership(user.id);
  if (!membership) {
    return NextResponse.json({ suppliers: [] }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 1) {
    return NextResponse.json({ suppliers: [] });
  }

  try {
    const rows = await withTenant(membership.org_id, async (tx) => {
      return [...(await tx<{ id: string; name: string; country_code: string }>`
          SELECT id, name, country_code
            FROM public.supplier
           WHERE org_id = ${membership.org_id}::uuid
             AND name ILIKE ${'%' + q + '%'}
           ORDER BY name
           LIMIT 10
        `)];
    });
    return NextResponse.json({
      suppliers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        countryCode: r.country_code,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { suppliers: [], error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
