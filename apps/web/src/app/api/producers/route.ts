// apps/web/src/app/api/producers/route.ts
//
// Card 0.17 — producer autocomplete for the receiving wizard.

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
    return NextResponse.json({ producers: [] }, { status: 401 });
  }
  const membership = await getFirstMembership(user.id);
  if (!membership) {
    return NextResponse.json({ producers: [] }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 1) {
    return NextResponse.json({ producers: [] });
  }

  try {
    const rows = await withTenant(membership.org_id, async (tx) => {
      return [...(await tx<{ id: string; name: string; country_code: string; region: string | null }>`
          SELECT id, name, country_code, region
            FROM public.producer
           WHERE org_id = ${membership.org_id}::uuid
             AND name ILIKE ${'%' + q + '%'}
           ORDER BY name
           LIMIT 10
        `)];
    });
    return NextResponse.json({
      producers: rows.map((r) => ({
        id: r.id,
        name: r.name,
        countryCode: r.country_code,
        region: r.region,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { producers: [], error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
