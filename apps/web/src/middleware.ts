// apps/web/src/middleware.ts
//
// Session-refresh middleware.
//
// Card 0.5 — Supabase Auth cookie refresh.
//
// Why this exists:
//   Supabase access tokens (the JWT in the auth cookie) have a default
//   lifetime of 1 hour. Without periodic refresh, the user is silently signed
//   out mid-session. The @supabase/ssr pattern is: on every request, call
//   supabase.auth.getUser() — if the access token is within ~60s of expiry,
//   the SDK uses the refresh token to mint a new access token AND writes
//   the updated cookies back to the response. The user stays signed in.
//
// What this does NOT do:
//   - It does NOT block unauthenticated requests. Cards 0.6+ add
//     route-level guards ("if no user, redirect to /login"). Mixing auth + RBAC
//     into middleware makes the gate hard to test and impossible to bypass for
//     health checks / marketing pages. Card 0.5 ships the refresh primitive;
//     the redirect layer lands with the first protected route.
//   - It does NOT do per-user rate limiting. That's a Vercel/edge concern
//     handled upstream.
//
// Matcher:
//   We exclude _next/static, _next/image, favicon, and any common static
//   extensions. Running supabase.auth.getUser() on every static asset would
//   be wasteful — the JWT refresh check is cheap but not free.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import type { Database } from '@greenfield/db';

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // Build a response up front so the SSR client can mutate its cookies.
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    // Misconfigured deployment — surface loudly. Better a 500 in the dev
    // console than silent auth failure in production.
    throw new Error(
      'Supabase env missing in middleware: NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set.',
    );
  }

  const setAllCookies = (
    cookiesToSet: { name: string; value: string; options: CookieOptions }[],
  ): void => {
    // Write refreshed cookies to BOTH the request (so the rest of the
    // middleware chain / downstream route handlers see the updated
    // identity) AND the response (so the browser persists them).
    for (const { name, value } of cookiesToSet) {
      request.cookies.set(name, value);
    }
    for (const { name, value, options } of cookiesToSet) {
      response.cookies.set(name, value, options);
    }
  };

  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: setAllCookies,
    },
  });

  // IMPORTANT: getUser() validates the JWT against Supabase Auth, not just
  // reads the cookie. This catches tampered tokens. We do NOT use the
  // returned user object for authorization decisions here — that lands in
  // per-route guards. This call exists purely to trigger cookie refresh.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image  (image optimisation)
     * - favicon.ico
     * - common static asset extensions
     *
     * This regex is taken from the @supabase/ssr Next.js README — it's the
     * official pattern.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
