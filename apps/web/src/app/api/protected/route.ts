// apps/web/src/app/api/protected/route.ts
//
// Example protected Route Handler.
//
// Card 0.5 — acceptance criterion "vitest test: protected route handler
// returns redirect to /login when no session cookie present". This handler
// is the minimal shape used by the test below; subsequent cards (0.6+)
// will replace this with the real protected API surface (org membership
// queries, etc.) and add the matching production redirects.
//
// Behaviour:
//   - If `supabase.auth.getUser()` returns a user → 200 + minimal JSON.
//   - If no user → redirect to /login?next=<current-path>.
//
// `getUser()` revalidates the JWT against Supabase Auth — it doesn't just
// trust the cookie. So a tampered cookie can't fake identity.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', new URL(request.url).pathname);
    return NextResponse.redirect(url, { status: 307 });
  }

  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email },
  });
}
