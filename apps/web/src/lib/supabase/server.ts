// apps/web/src/lib/supabase/server.ts
//
// Server-side Supabase client (App Router).
//
// Card 0.5 — Supabase Auth wired into Next.js 15 App Router using the
// @supabase/ssr cookie adapter (NOT the deprecated @supabase/auth-helpers-nextjs).
//
// Why this shape:
//
//   - next/headers.cookies() gives us a per-request cookie store. We hand it
//     to createServerClient with explicit getAll / setAll adapters. The setAll
//     adapter is special: Next.js forbids writing cookies from Server Components,
//     so we route writes through a try/catch — Next.js surfaces the error to
//     the Server Action / Route Handler that called us, which is exactly what
//     middleware needs to refresh tokens in place.
//
//   - We use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (the new Supabase naming for
//     the formerly-anon key). This client runs server-side; the publishable key
//     is safe here because RLS enforces the user identity. The service_role key
//     is NEVER touched in this module — see service.ts for the privileged client
//     (added in a later card that needs admin operations).
//
//   - The server client is per-request. Calling createServerClient inside a
//     Server Component / Route Handler gives you a fresh, request-scoped client
//     whose cookie store matches the current request. Do NOT module-level cache
//     this — the cookie store would go stale across requests.
//
//   - getUser() vs getSession(): always prefer getUser() when you need the
//     authenticated user. It revalidates the JWT against Supabase Auth so a
//     tampered cookie cannot forge identity. getSession() reads the cookie
//     without server-side validation — only safe for non-auth reads.

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Build a Supabase client bound to the current request's cookies.
 *
 * Use this in:
 *   - Server Components (`page.tsx`, `layout.tsx`)
 *   - Route Handlers (`route.ts`)
 *   - Server Actions (`actions.ts`)
 *
 * NEVER call this from a Client Component — use `./client.ts` instead.
 */
export async function createClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase env missing: NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set. See .env.example.',
    );
  }

  const cookieStore = await cookies();

  const setAllCookies = (
    cookiesToSet: { name: string; value: string; options: CookieOptions }[],
  ): void => {
    try {
      for (const { name, value, options } of cookiesToSet) {
        cookieStore.set(name, value, options);
      }
    } catch {
      // The `setAll` method was called from a Server Component. Next.js
      // blocks cookie writes from RSC — that's expected. The middleware
      // below refreshes the session on every request, so a missed write
      // here is harmless; the next request will retry.
    }
  };

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: setAllCookies,
    },
  });
}
