// apps/web/src/app/api/auth/me/route.ts
//
// GET /api/auth/me — current session + first membership.
//
// Card 0.7 acceptance criterion:
//   "After signup, GET /api/auth/me returns user with at least one
//    Membership where role='owner' (smoke test)"
//
// Response shape (200):
//   {
//     user: { id, email },
//     membership: { id, org_id, role, org: { id, name } } | null,
//     organization: { id, name, base_currency, region, data_residency } | null
//   }
//
// The membership + organization are denormalised into the response so
// the client (or a smoke test) gets the whole "who am I, what org am
// I in, what role" tuple in one request. Phase 1 will likely add a
// separate `organizations.listMine` endpoint once users can hold
// memberships in multiple orgs.
//
// 401 if no session. We deliberately do NOT auto-redirect to /login
// (unlike the /api/protected example handler) — /api/auth/me is a
// programmatic endpoint, not a browser-facing page. Callers should
// branch on the 401 status code.
//
// UNSCOPED READ JUSTIFICATION:
//   `getFirstMembership` runs as BYPASSRLS postgres — the
//   tenant scope can't be set until we know which org the user
//   belongs to. The membership lookup IS the bootstrap step that
//   produces the org id. The RLS-tightened read path lands in a
//   later card.

import { NextResponse, type NextRequest } from 'next/server';
import { getFirstMembership, unscopedDb } from '@greenfield/db';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface MeResponse {
  user: {
    id: string;
    email: string | null;
  };
  membership: {
    id: string;
    org_id: string;
    role: string;
  } | null;
  organization: {
    id: string;
    name: string;
    base_currency: string;
    region: string;
    data_residency: string;
  } | null;
}

interface OrganizationRow {
  id: string;
  name: string;
  base_currency: string;
  region: string;
  data_residency: string;
}

async function fetchOrganization(orgId: string): Promise<OrganizationRow | null> {
  const rows = await unscopedDb<OrganizationRow>(
    `SELECT id, name, base_currency, region, data_residency
       FROM public.organizations
      WHERE id = $1
      LIMIT 1`,
    orgId,
  );
  return rows[0] ?? null;
}

export async function GET(
  _request: NextRequest,
): Promise<NextResponse<MeResponse | { error: { code: string; message: string } }>> {
  void _request; // unused param — reserved for future ?expand= query
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } },
      { status: 401 },
    );
  }

  const membership = await getFirstMembership(user.id);
  if (!membership) {
    // Authenticated user, but no membership yet — they're in the
    // /signup flow. Return 200 with membership=null so the client
    // knows to redirect to /signup rather than treating the absence
    // as an error.
    const body: MeResponse = {
      user: { id: user.id, email: user.email ?? null },
      membership: null,
      organization: null,
    };
    return NextResponse.json(body, { status: 200 });
  }

  const organization = await fetchOrganization(membership.org_id);
  const body: MeResponse = {
    user: { id: user.id, email: user.email ?? null },
    membership: {
      id: membership.id,
      org_id: membership.org_id,
      role: membership.role,
    },
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          base_currency: organization.base_currency,
          region: organization.region,
          data_residency: organization.data_residency,
        }
      : null,
  };
  return NextResponse.json(body, { status: 200 });
}