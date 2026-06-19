// apps/web/src/app/api/cron/supabase-keepalive/route.test.ts
//
// Card 0.8 — route handler tests for the weekly Supabase keepalive.
//
// Mocks:
//   - @greenfield/db — provides a fake `unscopedDb` so the route can
//     be exercised without a live Supabase connection. The pooler client
//     in @greenfield/db's client.ts throws at module load if DATABASE_URL
//     is unset, so we MUST mock the module to import the route at all
//     in CI.
//
// What we exercise:
//   1. CRON_SECRET unset on the server -> 500 CRON_SECRET_MISSING.
//   2. Authorization header missing -> 401 UNAUTHORIZED.
//   3. Authorization header wrong -> 401 UNAUTHORIZED.
//   4. Correct bearer + DB ping succeeds -> 200 { ok: true, ts }.
//   5. Correct bearer + DB ping throws -> 500 DB_PING_FAILED.
//
// What we DO NOT exercise here:
//   - The real `SELECT 1` round-trip. That coverage lives in
//     packages/db/src/rls.test.ts (live integration test).
//   - Vercel Cron itself — manual "Run now" in the dashboard is the
//     human step (card body lists it as an acceptance criterion but
//     it requires the deployed env, which a unit test can't see).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock @greenfield/db BEFORE importing the route so the module
// resolution hook replaces the real exports. vi.mock is hoisted to
// the top of the file by vitest, so the factory cannot reference
// any module-level variables — it has to declare its own mocks.
vi.mock('@greenfield/db', () => ({
  unscopedDb: vi.fn(),
}));

// Import AFTER mocks so the module-resolution hook replaces them.
import { GET } from './route.js';
import { unscopedDb } from '@greenfield/db';
import type { Mock } from 'vitest';
const unscopedDbMock = unscopedDb as unknown as Mock;

// Non-secret test constant. The real CRON_SECRET is generated via
// `openssl rand -hex 32` (32 bytes = 64 hex chars); we mirror the
// shape so any length-related branch in `bearerMatches` is exercised.
const TEST_SECRET = 'a'.repeat(64);

function makeRequest(authorization?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  return new NextRequest(
    'https://greenfield.example.com/api/cron/supabase-keepalive',
    { method: 'GET', headers },
  );
}

interface KeepaliveBody {
  ok: boolean;
  ts?: string;
  error?: { code: string; message: string };
}

describe('cron supabase-keepalive endpoint — GET /api/cron/supabase-keepalive', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = TEST_SECRET;
    unscopedDbMock.mockReset();
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalSecret;
    }
  });

  it('returns 500 CRON_SECRET_MISSING when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest(`Bearer ${TEST_SECRET}`));
    expect(res.status).toBe(500);
    const body = (await res.json()) as KeepaliveBody;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('CRON_SECRET_MISSING');
  });

  it('returns 401 UNAUTHORIZED when Authorization header is missing', async () => {
    const res = await GET(makeRequest(undefined));
    expect(res.status).toBe(401);
    const body = (await res.json()) as KeepaliveBody;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 UNAUTHORIZED when Authorization header is wrong', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as KeepaliveBody;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 UNAUTHORIZED when Authorization header has the wrong scheme', async () => {
    const res = await GET(makeRequest(`Basic ${TEST_SECRET}`));
    expect(res.status).toBe(401);
    const body = (await res.json()) as KeepaliveBody;
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 200 { ok: true, ts } when the bearer matches and SELECT 1 succeeds', async () => {
    unscopedDbMock.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await GET(makeRequest(`Bearer ${TEST_SECRET}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as KeepaliveBody;
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('string');
    // ISO-8601 sanity check; don't pin the exact value (clock-dependent).
    expect(new Date(body.ts!).toISOString()).toBe(body.ts);
    expect(unscopedDbMock).toHaveBeenCalledTimes(1);
  });

  it('returns 500 DB_PING_FAILED when the DB query throws', async () => {
    unscopedDbMock.mockRejectedValueOnce(new Error('connection refused'));
    const res = await GET(makeRequest(`Bearer ${TEST_SECRET}`));
    expect(res.status).toBe(500);
    const body = (await res.json()) as KeepaliveBody;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('DB_PING_FAILED');
    expect(body.error?.message).toBe('connection refused');
  });
});