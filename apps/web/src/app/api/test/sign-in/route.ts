// apps/web/src/app/api/test/sign-in/route.ts
//
// Test-only route used by the Playwright auth helper.
//
// In dev (NODE_ENV !== 'production'), this route accepts a
// `?email=...&password=...` query and calls Supabase's
// signInWithPassword. On success, it sets the same session
// cookies that the production /auth/callback route sets,
// so the test process ends up with a real session without
// needing the service-role key.
//
// SECURITY
//
//   - Refuses to run in production (returns 404).
//   - Rate-limited in spirit: the route only works in
//     development; production traffic never reaches it.
//   - We never log the password.
//
// WHY NOT signInWithPassword IN THE TEST
//
//   We could call signInWithPassword from the test process
//   directly and set the cookies via context.addCookies —
//   but constructing the exact cookie format that
//   @supabase/ssr expects (cookie name + base64url-encoded
//   JSON value) is brittle. Going through the real cookie
//   path (the same setAll that the magic-link callback uses)
//   is the lowest-risk way to get a working session in the
//   test browser.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    // 404 (not 403) — don't disclose the route exists in
    // production.
    return new NextResponse('Not found', { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const password = url.searchParams.get('password');
  if (!email || !password) {
    return NextResponse.json(
      { error: 'Missing email or password query param' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return NextResponse.json(
      { error: `signInWithPassword failed: ${error.message}` },
      { status: 401 },
    );
  }
  if (!data.session) {
    return NextResponse.json(
      { error: 'signInWithPassword returned no session' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    userId: data.user.id,
    expiresAt: data.session.expires_at,
  });
}
