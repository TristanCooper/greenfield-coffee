// apps/web/src/app/api/organizations/route.test.ts
//
// Card 0.7 — route handler tests.
//
// Mocks:
//   - @/lib/supabase/server — provides a fake `createClient` whose
//     auth.getUser() returns either a user or null based on test setup.
//   - @greenfield/db — provides a fake `createOrganization` whose
//     outcome we configure per test (success / typed error / throw).
//
// What we exercise:
//   1. Unauthenticated request → 401 with code UNAUTHENTICATED.
//   2. Authenticated request with malformed JSON → 400 INVALID_INPUT.
//   3. Authenticated request with missing required fields → 400.
//   4. Authenticated request with valid body + successful create →
//      200 with { orgId, membershipId, auditRecorded }.
//   5. Authenticated request where createOrganization throws
//      CreateOrganizationError('USER_NOT_FOUND') → 401.
//   6. Authenticated request where createOrganization throws an
//      unrecognised Error → 500 INTERNAL.
//
// What we DO NOT exercise here:
//   - The actual DB transaction. That coverage lives in
//     packages/db/src/organizations.test.ts (live integration test).
//   - The Supabase cookie round-trip. The middleware
//     (apps/web/src/middleware.ts) is responsible for that.
//   - The SignupForm Client Component. Vitest in jsdom is added when
//     Client Component tests land.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { CreateOrganizationError } from '@greenfield/db';

// Mock @greenfield/db BEFORE importing the route so the module
// resolution hook replaces the real exports. vi.mock is hoisted to
// the top of the file by vitest, so the factory cannot reference
// any module-level variables — it has to declare its own mocks.
vi.mock('@greenfield/db', () => ({
  createOrganization: vi.fn(),
  CreateOrganizationError: class CreateOrganizationError extends Error {
    override readonly name = 'CreateOrganizationError';
    readonly code: 'INVALID_INPUT' | 'USER_NOT_FOUND';
    constructor(code: 'INVALID_INPUT' | 'USER_NOT_FOUND', message: string) {
      super(message);
      this.code = code;
      Object.setPrototypeOf(this, CreateOrganizationError.prototype);
    }
  },
}));

// Mock the Supabase server client.
const getUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser },
  }),
}));

// Import AFTER mocks so the module-resolution hook replaces them.
// Cast to `Mock` so the test sees the mock functions with their
// `mockResolvedValueOnce` / `mockRejectedValueOnce` / `mockReset`
// helpers — without the cast, TypeScript treats `createOrganization`
// as the real (unmocked) function type and rejects those calls.
import { POST } from './route.js';
import { createOrganization } from '@greenfield/db';
import type { Mock } from 'vitest';
const createOrganizationMock = createOrganization as unknown as Mock;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('https://greenfield.example.com/api/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(raw: string): NextRequest {
  return new NextRequest('https://greenfield.example.com/api/organizations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  });
}

describe('POST /api/organizations — auth gate', () => {
  beforeEach(() => {
    getUser.mockReset();
    createOrganizationMock.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(createOrganization).not.toHaveBeenCalled();
  });
});

describe('POST /api/organizations — input validation', () => {
  beforeEach(() => {
    getUser.mockReset();
    createOrganizationMock.mockReset();
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'founder@greenfield.example.com' } },
      error: null,
    });
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const res = await POST(makeRawRequest('not-json{'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('returns 400 when the body is a non-object', async () => {
    const res = await POST(makeRequest('a string'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is missing', async () => {
    const res = await POST(
      makeRequest({ countryCode: 'GB', region: 'GB', baseCurrency: 'GBP' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toMatch(/name/);
  });

  it('returns 400 when name is empty/whitespace', async () => {
    const res = await POST(
      makeRequest({ name: '   ', countryCode: 'GB', region: 'GB', baseCurrency: 'GBP' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when countryCode is missing', async () => {
    const res = await POST(
      makeRequest({ name: 'Acme', region: 'GB', baseCurrency: 'GBP' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/organizations — happy path', () => {
  beforeEach(() => {
    getUser.mockReset();
    createOrganizationMock.mockReset();
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'founder@greenfield.example.com' } },
      error: null,
    });
  });

  it('returns 200 with orgId, membershipId, auditRecorded on success', async () => {
    createOrganizationMock.mockResolvedValueOnce({
      orgId: 'org-uuid',
      membershipId: 'mem-uuid',
      organization: { id: 'org-uuid', name: 'Acme' },
      auditRecorded: false,
    });

    const res = await POST(
      makeRequest({
        name: 'Acme Roastery',
        countryCode: 'GB',
        region: 'GB',
        baseCurrency: 'GBP',
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      orgId: string;
      membershipId: string;
      auditRecorded: boolean;
    };
    expect(body.orgId).toBe('org-uuid');
    expect(body.membershipId).toBe('mem-uuid');
    expect(body.auditRecorded).toBe(false);
    // Pass-through: handler must forward the userId and the parsed
    // input shape to createOrganization.
    expect(createOrganization).toHaveBeenCalledWith(
      {
        name: 'Acme Roastery',
        countryCode: 'GB',
        region: 'GB',
        baseCurrency: 'GBP',
      },
      { userId: 'user-1' },
    );
  });

  it('trims the org name before forwarding', async () => {
    createOrganizationMock.mockResolvedValueOnce({
      orgId: 'org-uuid',
      membershipId: 'mem-uuid',
      organization: { id: 'org-uuid', name: 'Acme' },
      auditRecorded: false,
    });
    await POST(
      makeRequest({
        name: '  Acme Roastery  ',
        countryCode: 'NL',
        region: 'NL',
        baseCurrency: 'EUR',
      }),
    );
    expect(createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme Roastery' }),
      expect.anything(),
    );
  });
});

describe('POST /api/organizations — typed-error mapping', () => {
  beforeEach(() => {
    getUser.mockReset();
    createOrganizationMock.mockReset();
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'founder@greenfield.example.com' } },
      error: null,
    });
  });

  it('maps CreateOrganizationError(USER_NOT_FOUND) to 401', async () => {
    createOrganizationMock.mockRejectedValueOnce(
      new CreateOrganizationError(
        'USER_NOT_FOUND',
        'No public.users row for actor user-1',
      ),
    );
    const res = await POST(
      makeRequest({ name: 'Acme', countryCode: 'GB', region: 'GB', baseCurrency: 'GBP' }),
    );
    expect(res.status).toBe(401);
  });

  it('maps CreateOrganizationError(INVALID_INPUT) to 400', async () => {
    createOrganizationMock.mockRejectedValueOnce(
      new CreateOrganizationError(
        'INVALID_INPUT',
        'baseCurrency must be one of EUR, GBP, got USD',
      ),
    );
    const res = await POST(
      makeRequest({ name: 'Acme', countryCode: 'GB', region: 'GB', baseCurrency: 'GBP' }),
    );
    expect(res.status).toBe(400);
  });

  it('maps unexpected throws to 500 INTERNAL', async () => {
    createOrganizationMock.mockRejectedValueOnce(new Error('connection reset'));
    const res = await POST(
      makeRequest({ name: 'Acme', countryCode: 'GB', region: 'GB', baseCurrency: 'GBP' }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL');
    // Internal-error message MUST be a generic server-side string —
    // never echo the underlying error to the client (info leak).
    expect(body.error.message).not.toMatch(/connection reset/i);
  });
});