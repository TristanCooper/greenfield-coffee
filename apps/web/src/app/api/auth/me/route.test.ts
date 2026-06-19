// apps/web/src/app/api/auth/me/route.test.ts
//
// Card 0.7 — /api/auth/me endpoint tests.
//
// Mocks the Supabase server client and the unscopedDb / getFirstMembership
// paths. We don't need a live DB here — the GET handler delegates to
// `getFirstMembership` and `unscopedDb`, both of which are pure
// wrappers around postgres-js that the @greenfield/db package's own
// integration tests cover.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { NextRequest } from 'next/server';

// vi.mock is hoisted to the top of the file by vitest — the factory
// can't reference module-level variables, so it has to declare its
// own mocks.
vi.mock('@greenfield/db', () => ({
  getFirstMembership: vi.fn(),
  unscopedDb: vi.fn(),
}));

const getUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser } }),
}));

import { GET } from './route.js';
import { getFirstMembership, unscopedDb } from '@greenfield/db';
const getFirstMembershipMock = getFirstMembership as unknown as Mock;
const unscopedDbMock = unscopedDb as unknown as Mock;

function makeRequest(): NextRequest {
  return new NextRequest('https://greenfield.example.com/api/auth/me', {
    method: 'GET',
  });
}

describe('GET /api/auth/me — no session', () => {
  beforeEach(() => {
    getUser.mockReset();
    getFirstMembershipMock.mockReset();
    unscopedDbMock.mockReset();
  });

  it('returns 401 with code UNAUTHENTICATED when no user', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /api/auth/me — authenticated, no membership', () => {
  beforeEach(() => {
    getUser.mockReset();
    getFirstMembershipMock.mockReset();
    unscopedDbMock.mockReset();
  });

  it('returns 200 with membership=null and organization=null', async () => {
    getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'founder@greenfield.example.com' } },
      error: null,
    });
    getFirstMembershipMock.mockResolvedValueOnce(null);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string };
      membership: null;
      organization: null;
    };
    expect(body.user.id).toBe('user-1');
    expect(body.user.email).toBe('founder@greenfield.example.com');
    expect(body.membership).toBeNull();
    expect(body.organization).toBeNull();
  });
});

describe('GET /api/auth/me — authenticated with owner membership', () => {
  beforeEach(() => {
    getUser.mockReset();
    getFirstMembershipMock.mockReset();
    unscopedDbMock.mockReset();
  });

  it('returns 200 with membership.role=owner + organization summary', async () => {
    getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'founder@greenfield.example.com' } },
      error: null,
    });
    getFirstMembershipMock.mockResolvedValueOnce({
      id: 'mem-1',
      org_id: 'org-1',
      user_id: 'user-1',
      role: 'owner',
      created_at: '2026-06-19T19:30:00Z',
    });
    unscopedDbMock.mockResolvedValueOnce([
      {
        id: 'org-1',
        name: 'Acme Roastery',
        base_currency: 'GBP',
        region: 'GB',
        data_residency: 'uk',
      },
    ]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string };
      membership: { id: string; org_id: string; role: string };
      organization: {
        id: string;
        name: string;
        base_currency: string;
        region: string;
      };
    };
    // Acceptance criterion (card body):
    //   "After signup, GET /api/auth/me returns user with at least
    //    one Membership where role='owner'"
    expect(body.user.id).toBe('user-1');
    expect(body.membership?.role).toBe('owner');
    expect(body.membership.org_id).toBe('org-1');
    expect(body.organization?.name).toBe('Acme Roastery');
    expect(body.organization.base_currency).toBe('GBP');
    expect(body.organization.region).toBe('GB');
  });

  it('returns 200 with membership set but organization null when the org row is missing', async () => {
    // Edge case: a membership exists but the organization was
    // hard-deleted (shouldn't happen with FK ON DELETE CASCADE, but
    // defence in depth). The handler must not throw.
    getUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'founder@greenfield.example.com' } },
      error: null,
    });
    getFirstMembershipMock.mockResolvedValueOnce({
      id: 'mem-1',
      org_id: 'org-deleted',
      user_id: 'user-1',
      role: 'owner',
      created_at: '2026-06-19T19:30:00Z',
    });
    unscopedDbMock.mockResolvedValueOnce([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      membership: { role: string };
      organization: null;
    };
    expect(body.membership?.role).toBe('owner');
    expect(body.organization).toBeNull();
  });
});