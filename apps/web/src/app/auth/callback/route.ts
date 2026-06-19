// apps/web/src/app/auth/callback/route.ts
//
// Magic-link callback handler.
//
// Card 0.5. The flow:
//
//   1. User submits email on /login.
//   2. Supabase Auth sends a magic link to that email. The link's redirect URL
//      is `${origin}/auth/callback?next=<optional>`.
//   3. User clicks the link → browser lands on this Route Handler.
//   4. We exchange the `code` query param for a session. @supabase/ssr writes
//      the session into httpOnly cookies via the cookies() adapter.
//   5. We redirect to the validated `next` target (or `/` by default).
//
// Why Route Handler and not a Server Component / Server Action:
//   - Magic-link emails hit GET, not POST. The Supabase Auth JS SDK exposes
//     `exchangeCodeForSession` which is the canonical recovery path — we call
//     it from a GET handler here.
//   - Route Handlers are the right primitive for "external service → redirect
//     → set cookies" — they have full NextResponse control including cookie
//     writes that Server Components can't do.
//
// Security: `next` is validated against an allowlist of same-origin paths.
// Unvalidated `next` is an open-redirect vector (attacker crafts a magic link
// that bounces the user to a phishing page after sign-in). We accept only
// paths that start with "/" and do NOT begin with "//" (protocol-relative)
// and reject anything containing backslashes or control characters.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Force the route to be dynamic — it depends on cookies / query params and
// must never be statically pre-rendered.
export const dynamic = 'force-dynamic';

const DEFAULT_REDIRECT = '/';

/**
 * Allowlist gate for `?next=`. Returns the path if it's a safe same-origin
 * path, otherwise the default. We deliberately do NOT call new URL() because
 * we want to require the value to be a path-only string (no scheme, no host).
 */
function safeNext(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_REDIRECT;
  // Reject protocol-relative ("//evil.example.com") and absolute URLs.
  if (raw.startsWith('//') || raw.startsWith('\\')) return DEFAULT_REDIRECT;
  // Reject anything that doesn't start with a single forward slash — that's
  // the simplest same-origin path shape.
  if (!raw.startsWith('/')) return DEFAULT_REDIRECT;
  // Reject embedded backslashes, control characters, and CR/LF (header-splitting).
  // The control-character check is the WHOLE POINT of this regex; suppress the
  // no-control-regex lint rule on this one line.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\\]/.test(raw)) return DEFAULT_REDIRECT;
  return raw;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));

  // If we don't have a code, the user probably hit this URL directly. Send
  // them to /login with a friendly default — never echo raw error messages
  // to a possibly-phishing origin.
  if (!code) {
    return NextResponse.redirect(new URL('/login', url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Exchange failed — magic link expired or was already used. Bounce to
    // /login; the user can request a new link.
    return NextResponse.redirect(new URL('/login', url.origin));
  }

  // Authenticated. Send to the (validated) intended destination.
  return NextResponse.redirect(new URL(next, url.origin));
}
