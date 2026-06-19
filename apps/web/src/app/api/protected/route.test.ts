// apps/web/src/app/api/protected/route.test.ts
//
// Card 0.5 — acceptance criterion: "vitest test: protected route handler
// returns redirect to /login when no session cookie present".
//
// We mock @/lib/supabase/server so the test doesn't need:
//   - A running Next.js dev server
//   - A real Supabase project
//   - A request cookie store
//
// What we exercise:
//   1. No session → handler returns a NextResponse redirecting to /login.
//   2. Session present → handler returns 200 JSON with the user payload.
//   3. The redirect target preserves the original path via `?next=`.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse, NextRequest } from 'next/server';

const getUser = vi.fn();
const exchangeCodeForSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  // Mock shape mirrors the real createClient() return — see
  // apps/web/src/lib/supabase/server.ts. The real one is async because it
  // awaits cookies(); the mock is sync because there's nothing to await.
  createClient: () => ({
    auth: {
      getUser,
      exchangeCodeForSession,
    },
  }),
}));

// next/headers.cookies() is called by createClient (in the real path). Under
// vitest we never reach the real createClient because we mocked the module
// above, so we don't need to mock next/headers. But we DO need to mock it
// for callback/route.ts which imports createClient from '@/lib/supabase/server'
// (already mocked) — so we're fine.
//
// Import AFTER the mocks so the module-resolution hook replaces them.
import { GET as protectedGET } from './route.js';
import { GET as callbackGET } from '../../auth/callback/route.js';

function makeRequest(url: string, cookieHeader?: string): NextRequest {
  const headers = new Headers();
  if (cookieHeader) headers.set('cookie', cookieHeader);
  return new NextRequest(url, { method: 'GET', headers });
}

describe('protected route handler — GET /api/protected', () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it('redirects to /login when no session', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const req = makeRequest('https://greenfield.example.com/api/protected');
    const res = await protectedGET(req);
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'https://greenfield.example.com/login?next=%2Fapi%2Fprotected',
    );
  });

  it('returns 200 with user payload when authenticated', async () => {
    getUser.mockResolvedValueOnce({
      data: {
        user: { id: 'user-123', email: 'founder@greenfield.example.com' },
      },
      error: null,
    });
    const req = makeRequest('https://greenfield.example.com/api/protected');
    const res = await protectedGET(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      user: { id: string; email: string };
    };
    expect(body.ok).toBe(true);
    expect(body.user).toEqual({
      id: 'user-123',
      email: 'founder@greenfield.example.com',
    });
  });
});

describe('auth callback route handler — GET /auth/callback', () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
  });

  it('redirects to /login when no code is present', async () => {
    const req = makeRequest('https://greenfield.example.com/auth/callback');
    const res = await callbackGET(req);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toBe(
      'https://greenfield.example.com/login',
    );
  });

  it('exchanges code for session and redirects to validated next', async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const req = makeRequest(
      'https://greenfield.example.com/auth/callback?code=abc&next=%2Fdashboard',
    );
    const res = await callbackGET(req);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toBe(
      'https://greenfield.example.com/dashboard',
    );
  });

  it('falls back to / when next is an open-redirect attempt', async () => {
    exchangeCodeForSession.mockResolvedValueOnce({ error: null });
    const req = makeRequest(
      'https://greenfield.example.com/auth/callback?code=abc&next=' +
        encodeURIComponent('//evil.example.com/phish'),
    );
    const res = await callbackGET(req);
    expect(res.headers.get('location')).toBe(
      'https://greenfield.example.com/',
    );
  });

  it('falls back to / when code exchange fails', async () => {
    exchangeCodeForSession.mockResolvedValueOnce({
      error: { message: 'expired' },
    });
    const req = makeRequest(
      'https://greenfield.example.com/auth/callback?code=stale&next=/dashboard',
    );
    const res = await callbackGET(req);
    expect(res.headers.get('location')).toBe(
      'https://greenfield.example.com/login',
    );
  });
});
