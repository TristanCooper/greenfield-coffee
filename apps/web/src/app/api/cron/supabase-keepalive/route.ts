// apps/web/src/app/api/cron/supabase-keepalive/route.ts
//
// GET /api/cron/supabase-keepalive — weekly Supabase free-tier keepalive.
//
// Card 0.8 / plan §7.2. Free Supabase projects pause after 7 days of zero
// activity. Vercel Cron hits this route every Sunday at 12:00 UTC; the
// route runs `SELECT 1` against the DB so the project registers activity
// on Supabase's side and stays awake through pilot.
//
// Auth:
//   Vercel's cron worker injects `Authorization: Bearer ${CRON_SECRET}`
//   when triggered by the scheduler. We re-check the bearer against the
//   server-side `CRON_SECRET` env var so a third party who guesses the
//   URL can't fake a heartbeat.
//
//   Manual "Run now" from the Vercel dashboard uses the same header
//   (Vercel auto-fills it), so the same code path covers both.
//
// What it does NOT do:
//   - No tenant scoping. `SELECT 1` is connection-level; it doesn't read
//     a tenant table. Using `withTenant` would require a UUID we don't
//     have, and `unscopedDb` is overkill — `db` (the BYPASSRLS handle)
//     is the natural choice for a connectivity smoke test.
//   - No retry/backoff. Vercel Cron has native retry semantics; if the
//     route 500s, Vercel shows the failure in the dashboard and the
//     operator can "Run now" to retry.
//   - No second cron job. Hobby-tier Vercel allows max 2 cron jobs per
//     project (plan §3.1) and the audit-pack freshness placeholder is a
//     pg_cron concern (card 0.15), not a Vercel Cron one.
//
// Errors:
//   - 401 when the bearer is missing or wrong (security gate).
//   - 500 when CRON_SECRET is unset on the server, OR when the DB query
//     throws. Both surface as a failure in the Vercel dashboard so the
//     operator sees the regression.
//   - 200 with `{ ok: true, ts }` on success. The timestamp is the
//     server's view of when the heartbeat fired, returned for the
//     operator's diagnostic convenience (curl the URL manually and
//     confirm Vercel's clock vs. yours).

import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { unscopedDb } from '@greenfield/db';

// Force-dynamic: this endpoint is intentionally uncacheable. Vercel Cron
// invokes it on a schedule; we don't want any layer (CDN, RSC cache)
// short-circuiting the DB ping. Mirrors the pattern from
// /api/auth/diag and /api/auth/me.
export const dynamic = 'force-dynamic';

interface KeepaliveOk {
  ok: true;
  ts: string;
}

interface KeepaliveErr {
  ok: false;
  error: { code: string; message: string };
}

type KeepaliveResponse = KeepaliveOk | KeepaliveErr;

/**
 * Constant-time bearer comparison.
 *
 * `crypto.timingSafeEqual` requires equal-length buffers; if either side
 * is missing or the lengths differ we know the answer is "not equal" and
 * we still want the response time to be similar across the four cases
 * (missing header / wrong length / right length wrong value / correct).
 * Length differences are the most information-leaky of these, but on
 * a 64-char hex secret the variance is small enough that this is a
 * reasonable trade-off — the alternative (always padding to a fixed
 * length with a compare) introduces more complexity than it saves.
 */
function bearerMatches(authorization: string | null, secret: string): boolean {
  if (!authorization) return false;
  const expected = `Bearer ${secret}`;
  if (authorization.length !== expected.length) return false;
  // Both are now guaranteed same length; timingSafeEqual will not throw.
  return timingSafeEqual(
    Buffer.from(authorization, 'utf8'),
    Buffer.from(expected, 'utf8'),
  );
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<KeepaliveResponse>> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Misconfiguration: the operator hasn't set CRON_SECRET yet. Surface
    // it as a 500 so Vercel's dashboard shows the failure (don't silently
    // 200 — that would mask a config bug for weeks).
    console.error('[cron/supabase-keepalive] CRON_SECRET is not set');
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'CRON_SECRET_MISSING',
          message: 'Server is missing CRON_SECRET; check Vercel env vars.',
        },
      },
      { status: 500 },
    );
  }

  const auth = request.headers.get('authorization');
  if (!bearerMatches(auth, secret)) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or missing bearer token.' },
      },
      { status: 401 },
    );
  }

  try {
    // `SELECT 1` exercises the full pooler path (TLS handshake, auth,
    // transaction-mode routing) without reading any tenant table. We use
    // `unscopedDb` rather than `withTenant` because the call has no tenant
    // to scope (no rows read) and the route has no org context. We use
    // `unscopedDb` rather than the BYPASSRLS drizzle `db` handle because
    // `db` requires importing drizzle-orm at this layer, which would leak
    // a workspace-internal dep into apps/web. `unscopedDb` is a thin
    // postgres-js wrapper that already lives in @greenfield/db's public
    // surface (used by /api/auth/me).
    //
    // UNSCOPED READ JUSTIFICATION: a SELECT 1 statement reads zero rows and
    // zero tables — there is nothing to scope. The only purpose is to keep
    // the pooler connection warm so Supabase registers activity.
    await unscopedDb('SELECT 1');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/supabase-keepalive] DB ping failed:', message);
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'DB_PING_FAILED', message },
      },
      { status: 500 },
    );
  }

  const body: KeepaliveOk = { ok: true, ts: new Date().toISOString() };
  return NextResponse.json(body, { status: 200 });
}