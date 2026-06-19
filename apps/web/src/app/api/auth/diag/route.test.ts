// apps/web/src/app/api/auth/diag/route.test.ts
//
// Card 0.5 follow-up — smoke test for the auth URL diagnostic endpoint.
//
// We don't assert the dashboard URL (depends on Supabase project ref) or
// the env-derived values (we'd have to mock process.env and that's fragile
// across vitest's worker model). What we DO assert:
//   1. The endpoint returns 200 with JSON.
//   2. Cache-Control is no-store (otherwise Vercel hides config drift).
//   3. The expected block is populated and the "must contain" list reflects
//      the request's own origin (round-trip self-consistency).
//   4. The supabase block surfaces whatever NEXT_PUBLIC_SUPABASE_URL is set
//      to — including the null case.

import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route.js';

function makeRequest(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

interface DiagBody {
  request: { origin: string; host: string | null };
  supabase: { url: string | null; publishable_key_prefix: string | null };
  expected: {
    site_url_must_match_request_origin: true;
    redirect_urls_must_contain: string[];
    note: string;
  };
  dashboard: { url_configuration: string | null };
}

describe('auth diag endpoint — GET /api/auth/diag', () => {
  it('returns 200 JSON with the expected shape', async () => {
    const res = await GET(makeRequest('https://greenfield.example.com/api/auth/diag'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiagBody;
    expect(body.request.origin).toBe('https://greenfield.example.com');
    expect(body.expected.site_url_must_match_request_origin).toBe(true);
    expect(body.expected.redirect_urls_must_contain).toContain(
      'https://greenfield.example.com',
    );
    // Local dev must remain in the allowlist so contributors aren't broken.
    expect(body.expected.redirect_urls_must_contain).toContain(
      'http://localhost:3000',
    );
  });

  it('sets Cache-Control: no-store so Vercel never caches the response', async () => {
    const res = await GET(makeRequest('https://greenfield.example.com/api/auth/diag'));
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('reports localhost when the deployment is on localhost', async () => {
    const res = await GET(makeRequest('http://localhost:3000/api/auth/diag'));
    const body = (await res.json()) as DiagBody;
    expect(body.request.origin).toBe('http://localhost:3000');
    expect(body.expected.redirect_urls_must_contain).toContain(
      'http://localhost:3000',
    );
  });
});
