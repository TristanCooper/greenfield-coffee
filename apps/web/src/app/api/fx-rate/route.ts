// apps/web/src/app/api/fx-rate/route.ts
//
// Card 0.17 — FX rate lookup for the cost-allocation step.
//
//   GET /api/fx-rate?from=<ccy>&to=<ccy>
//
// Returns the most recent fx_rate row for the (base=from,
// quote=to) pair, as `rateCentsPerUnit` — the rate the
// @greenfield/money convertMinor helper expects.
//
// FALLBACK
//
//   If no row exists, returns `rate: null`. The cost step's
//   UI then shows "FX rate: loading…" until the operator
//   manually enters a rate (the v1 fallback — a v1.5 card
//   adds a daily pg_cron job to fetch ECB rates).
//
// Card 0.13 says fx_rate has no org FK — it's global
// reference data. So the lookup is unscoped (no
// withTenant).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { unscopedDb } from '@greenfield/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ rate: null }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = (url.searchParams.get('from') ?? '').toUpperCase();
  const to = (url.searchParams.get('to') ?? '').toUpperCase();
  if (from.length !== 3 || to.length !== 3) {
    return NextResponse.json({ rate: null });
  }
  if (from === to) {
    return NextResponse.json({ rate: 100 }); // 1:1, expressed as 100 cents-per-unit
  }

  try {
    const rows = await unscopedDb<{ rate_cents_per_unit: string }>(
      `SELECT rate_cents_per_unit
        FROM public.fx_rate
       WHERE base_currency = $1
         AND quote_currency = $2
       ORDER BY as_of DESC
       LIMIT 1`,
      from,
      to,
    );
    if (!rows[0]) {
      return NextResponse.json({ rate: null });
    }
    // Postgres bigint comes back as a string in postgres-js.
    // We return a JSON number (the wizard expects a number).
    return NextResponse.json({ rate: Number(rows[0].rate_cents_per_unit) });
  } catch (e) {
    return NextResponse.json(
      { rate: null, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
