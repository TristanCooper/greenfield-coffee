// apps/web/src/app/api/auth/diag/route.ts
//
// Card 0.5 follow-up — runtime diagnostic endpoint for Supabase Auth URL drift.
//
// Background: Supabase Auth uses a project-level "Site URL" setting
// (Authentication → URL Configuration) as the BASE for magic-link email
// redirects. If Site URL is left at the default http://localhost:3000,
// every magic-link email sent by the project links to localhost, even if
// our client passes a production `emailRedirectTo` via signInWithOtp().
//
// This endpoint exists so the founder can curl one URL from the terminal
// and see exactly what the deployed app sees:
//
//   $ curl -s https://greenfield.example.com/api/auth/diag | jq
//
// Response shape:
//   {
//     "request":   { "origin", "host", "x_forwarded_host", "x_forwarded_proto" },
//     "supabase":  { "url", "publishable_key_prefix" },
//     "expected":  { "site_url_must_match_request_origin": true,
//                    "redirect_urls_must_contain": ["<request.origin>", "http://localhost:3000"] },
//     "dashboard": { "url_configuration": "https://supabase.com/dashboard/project/<ref>/auth/url-configuration" }
//   }
//
// It does NOT call the Supabase Management API (we don't ship a service-role
// key to the client). The "expected" block is computed locally — it tells
// the operator what to set in the dashboard for THIS deployment to work.
//
// Intentionally unauthenticated: the only data we leak is the Supabase URL
// and a key prefix, both of which are already public via NEXT_PUBLIC_*.

import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

interface DiagResponse {
  request: {
    origin: string;
    host: string | null;
    x_forwarded_host: string | null;
    x_forwarded_proto: string | null;
  };
  supabase: {
    url: string | null;
    publishable_key_prefix: string | null;
  };
  expected: {
    site_url_must_match_request_origin: true;
    redirect_urls_must_contain: string[];
    note: string;
  };
  dashboard: {
    url_configuration: string | null;
  };
}

// Async per the project's Route Handler convention — `await supabase.auth.*`
// in this module's siblings is async, and even though THIS handler is sync
// internally, declaring async keeps the call-site shape uniform and avoids
// NextResponse.json() overload-resolution surprises.
// eslint-disable-next-line @typescript-eslint/require-await
export async function GET(request: NextRequest): Promise<NextResponse<DiagResponse>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? null;

  // Derive the project ref (e.g. "sanglkthpcidrkmerhdg") from the Supabase
  // URL so we can hand the operator a direct dashboard link. The pattern is
  // https://<ref>.supabase.co — the first subdomain label IS the ref.
  let projectRef: string | null = null;
  if (url) {
    try {
      const u = new URL(url);
      const first = u.hostname.split('.')[0];
      if (first) projectRef = first;
    } catch {
      // Malformed URL — leave ref null; dashboard link is null too.
    }
  }

  // Key prefix is the first 12 chars after the "." separator (Supabase
  // publishable keys are "sb_publishable_<base64>" or legacy "eyJ..." JWTs).
  // Showing the prefix lets the operator eyeball-verify they pasted the
  // *publishable* key into NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and not a
  // privileged server-side key — without leaking enough to be useful to
  // an attacker.
  const keyPrefix =
    key && key.length > 12 ? `${key.slice(0, 12)}…` : key;

  const xfh = request.headers.get('x-forwarded-host');
  const xfp = request.headers.get('x-forwarded-proto');

  const body: DiagResponse = {
    request: {
      origin: request.nextUrl.origin,
      host: request.headers.get('host'),
      x_forwarded_host: xfh,
      x_forwarded_proto: xfp,
    },
    supabase: {
      url,
      publishable_key_prefix: keyPrefix,
    },
    expected: {
      site_url_must_match_request_origin: true,
      // The two origins the project needs in the Redirect URLs allowlist:
      //   1. THIS deployment's origin (so emailRedirectTo from prod works)
      //   2. http://localhost:3000 (so local dev still works)
      redirect_urls_must_contain: [request.nextUrl.origin, 'http://localhost:3000'],
      note:
        'Set Site URL to the production origin and add this origin + ' +
        'http://localhost:3000 to Redirect URLs. Otherwise magic-link ' +
        'emails will redirect to whatever Site URL is set to (default: ' +
        'http://localhost:3000).',
    },
    dashboard: {
      url_configuration: projectRef
        ? `https://supabase.com/dashboard/project/${projectRef}/auth/url-configuration`
        : null,
    },
  };

  return NextResponse.json(body, {
    headers: {
      // Diag endpoint must never be cached — Vercel's edge CDN will cache
      // GET responses by default and that hides config drift.
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
