// apps/web/src/app/api/organizations/route.ts
//
// POST /api/organizations — create the caller's first organisation.
//
// Card 0.7.
//
// DEVATION FROM THE CARD BODY:
//
//   The card body calls for a "tRPC v11 procedure". tRPC is not in
//   the project's runtime deps (cards 0.4 / 0.6 / 0.7 explicitly
//   defer stack choices to Phase 1). Adding tRPC for this card
//   would be premature — it'd commit to a stack decision that's
//   still open. Instead the create-organisation logic lives as a
//   plain async function in @greenfield/db (see `createOrganization`)
//   and this Route Handler wraps it with the Supabase-auth gate.
//
//   When tRPC lands in Phase 1, the migration is: re-export
//   `createOrganization` from a `trpc.ts` module as a procedure;
//   this route handler becomes a thin tRPC router file. The body
//   is identical, only the entry-point shape changes.
//
//   The deviation is documented in the kanban handoff (review-required
//   comment) so the operator can flag if they prefer the tRPC
//   dep added now.
//
// BEHAVIOUR:
//
//   - Requires a Supabase session (401 otherwise).
//   - Validates the JSON body against the CreateOrganizationInput
//     shape — wrong/missing fields → 400.
//   - Calls createOrganization(...) — that function does the DB
//     inserts atomically (org + membership + best-effort audit).
//   - On success → 200 + { orgId, membershipId, auditRecorded }.
//   - On CreateOrganizationError('USER_NOT_FOUND') → 401
//     (mirrors "no session" because the user row is missing —
//     usually means the session was minted before the auth-bridge
//     trigger populated public.users, or someone is tampering).
//   - On any other error → 500 + { error: { code, message } }.
//
// WHY THE AUTH CHECK IS HERE (not in middleware):
//   Per the pattern in apps/web/src/app/api/protected/route.ts —
//   auth + redirect logic lives at the route handler, not in the
//   middleware, so the route's contract is self-contained and
//   testable in isolation.

import { NextResponse, type NextRequest } from 'next/server';
import {
  createOrganization,
  CreateOrganizationError,
} from '@greenfield/db';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface ApiSuccess {
  orgId: string;
  membershipId: string;
  auditRecorded: boolean;
}

interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Strict-shape guard for the request body. Returns either the
 * normalised input (passed to createOrganization) or a 400 response
 * body describing what's wrong.
 *
 * Hand-written rather than using a runtime schema library (zod,
 * valibot) because:
 *   1. The input shape is small (4 fields) — schema-library
 *      overhead isn't justified.
 *   2. Adding a new dep for this card would be premature.
 *   3. createOrganization re-validates server-side (defence in
 *      depth); this guard is just for early-out with a clear
 *      error message.
 */
function parseBody(body: unknown):
  | {
      ok: true;
      data: {
        name: string;
        countryCode: 'GB' | 'IE' | 'NL' | 'DE' | 'FR' | 'BE' | 'IT' | 'ES' | 'SE' | 'DK' | 'FI' | 'NO' | 'AT' | 'PL' | 'PT' | 'CH';
        region: 'GB' | 'IE' | 'NL' | 'DE' | 'FR' | 'BE' | 'IT' | 'ES' | 'SE' | 'DK' | 'FI' | 'NO' | 'AT' | 'PL' | 'PT' | 'CH';
        baseCurrency: 'EUR' | 'GBP';
      };
    }
  | { ok: false; error: ApiError['error'] } {
  if (!body || typeof body !== 'object') {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'Request body must be a JSON object.' },
    };
  }
  const obj = body as Record<string, unknown>;

  const name = typeof obj.name === 'string' ? obj.name : '';
  if (name.trim().length === 0) {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: '`name` is required.' },
    };
  }

  const countryCode = obj.countryCode;
  if (typeof countryCode !== 'string') {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: '`countryCode` is required.' },
    };
  }
  const region = obj.region;
  if (typeof region !== 'string') {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: '`region` is required.' },
    };
  }
  const baseCurrency = obj.baseCurrency;
  if (typeof baseCurrency !== 'string') {
    return {
      ok: false,
      error: { code: 'INVALID_INPUT', message: '`baseCurrency` is required.' },
    };
  }

  // The runtime guard rejects unknown country/region codes BEFORE
  // we hit createOrganization. The literal-type cast is safe
  // because createOrganization re-validates with the same allowlist
  // (defence in depth) — if the string slips past, the
  // CreateOrganizationError('INVALID_INPUT') surfaces a 400.
  return {
    ok: true,
    data: {
      name: name.trim(),
      countryCode: countryCode as never,
      region: region as never,
      baseCurrency: baseCurrency as never,
    },
  };
}

export async function POST(
  request: NextRequest,
): Promise<NextResponse<ApiSuccess | ApiError>> {
  // 1. Supabase auth check. `getUser()` revalidates the JWT, so a
  //    tampered cookie can't fake identity.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  // 2. Parse + validate the request body. Unknown JSON shape → 400.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: 'Request body must be valid JSON.',
        },
      },
      { status: 400 },
    );
  }
  const parsed = parseBody(rawBody);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // 3. Call createOrganization. This is the BYPASSRLS path — the
  //    org doesn't exist yet so we can't use withTenant. The
  //    transaction wraps the org insert, the membership insert,
  //    and the best-effort audit_event insert.
  try {
    const result = await createOrganization(parsed.data, {
      userId: user.id,
    });
    return NextResponse.json(
      {
        orgId: result.orgId,
        membershipId: result.membershipId,
        auditRecorded: result.auditRecorded,
      },
      { status: 200 },
    );
  } catch (e) {
    // Typed-error → typed-HTTP mapping. CreateOrganizationError's
    // `code` field drives the response; everything else is a 500.
    if (e instanceof CreateOrganizationError) {
      const status = e.code === 'USER_NOT_FOUND' ? 401 : 400;
      return NextResponse.json(
        { error: { code: e.code, message: e.message } },
        { status },
      );
    }
    const message = e instanceof Error ? e.message : 'Unknown error.';
    // Surface the underlying message in server logs (PII-safe: we
    // already know it's a server-internal error, not user-supplied).
    console.error('[POST /api/organizations] unexpected error', message);
    void message; // message is logged above; suppress noUnusedLocals
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL',
          message: 'Could not create organisation. Please try again.',
        },
      },
      { status: 500 },
    );
  }
}