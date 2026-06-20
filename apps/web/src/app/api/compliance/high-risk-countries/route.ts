// apps/web/src/app/api/compliance/high-risk-countries/route.ts
//
// Card 0.20 — fetch the currently-active EU high-risk country list
// for the receiving-form warning at producer-selection time.
//
// The list is global (not per-org), so the route is safe to call
// without RLS scoping. We still require authentication so the
// static list isn't exposed to the public web (defense-in-depth
// against an unauthenticated enumeration of EU policy data —
// the list itself is published by the European Commission and
// not secret, but the data is sensitive enough to gate).
//
// CACHING
//
//   The list changes only when the European Commission publishes
//   a benchmarking update — which is a once-a-year event at
//   most. We set Cache-Control: max-age=3600 so the browser and
//   CDN cache for an hour. The receiving form fetches the list
//   once per session; the warning re-evaluates on each producer
//   country change without re-fetching.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listHighRiskCountries, unscopedDb } from '@greenfield/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ countries: [] }, { status: 401 });
  }

  try {
    // The high-risk reference table is a global reference
    // (no per-org scoping needed). `unscopedDb` is the
    // right escape hatch — see the BYPASSRLS comment in
    // rls.ts for the global-lookup rationale.
    const countries = await listHighRiskCountries(
      unscopedDb as unknown as Parameters<typeof listHighRiskCountries>[0],
    );
    return NextResponse.json(
      { countries: [...countries] },
      {
        headers: {
          // Cache for an hour; the European Commission publishes
          // updates infrequently.
          'Cache-Control': 'private, max-age=3600',
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { countries: [], error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
