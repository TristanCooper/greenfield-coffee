// apps/web/src/lib/admin/server.ts
//
// Card 0.16 — server-side helpers for the admin UI.
//
// Every admin page calls `requireAdminContext()` to get the org id,
// user id, and role. This replaces the ad-hoc membership lookup
// pattern in (authenticated)/receiving/green/new/page.tsx with a
// shared helper used by all admin pages.
//
// WHAT THIS MODULE DOES
//
//   - requireAdminContext(): reads the session, looks up the
//     membership, returns the (org, user, role) tuple OR redirects
//     to login/signup/onboarding if any step fails.
//
//   - Parsers for the page/sort/search query params. Each admin
//     route's page.tsx parses these from the URL search params
//     using a single helper (`parseListPage`) so the validation is
//     consistent.
//
// The "is this row referenced by another table?" check is
// intentionally NOT generic — each entity's delete action has its
// own focused countReferences-style SQL. A generic helper across
// all entity × child-table combinations either relies on string
// interpolation (SQL injection risk) or on schema introspection
// (premature abstraction). The per-entity checks are short and
// readable; the FK constraints enforce the backstop even if a
// check is forgotten.

import 'server-only';
import { redirect } from 'next/navigation';
import type { MembershipRole } from '@greenfield/db';
import { getFirstMembership } from '@greenfield/db';
import { createClient } from '@/lib/supabase/server';

export interface AdminContext {
  orgId: string;
  orgName: string;
  userId: string;
  userEmail: string;
  role: MembershipRole;
}

/**
 * Resolve the current admin context. Redirects on failure:
 *
 *   - No session -> /login
 *   - No membership -> /signup
 *   - Membership points at a missing org -> /onboarding (defensive)
 *
 * Pages call this once at the top and destructure the result into
 * props for the form components.
 */
export async function requireAdminContext(): Promise<AdminContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const membership = await getFirstMembership(user.id);
  if (!membership) {
    redirect('/signup');
  }

  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', membership.org_id)
    .single();

  if (error || !org) {
    redirect('/onboarding');
  }

  return {
    orgId: membership.org_id,
    orgName: org.name,
    userId: user.id,
    userEmail: user.email ?? '',
    role: membership.role,
  };
}

// ── URL param parsing ────────────────────────────────────────────────────

/**
 * Coerce a URLSearchParams value to a positive integer with a
 * fallback. Returns `fallback` when the value is missing or not
 * a valid positive integer.
 */
export function parsePositiveInt(
  value: string | null | undefined,
  fallback: number,
): number {
  if (value === null || value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/**
 * Coerce a URLSearchParams value to a string with a fallback,
 * trimming whitespace.
 */
export function parseStr(
  value: string | null | undefined,
  fallback: string,
): string {
  if (value === null || value === undefined) return fallback;
  const trimmed = value.trim();
  return trimmed === '' ? fallback : trimmed;
}

/**
 * Parse the standard list-page URL params (?page=&pageSize=&q=&sort=&dir=).
 *
 * Each admin list view reads its own param shape, but the shape
 * is consistent across entities — so the parsing logic is shared.
 */
export interface ParsedListParams {
  page: number;
  pageSize: number;
  search: string;
  sortColumn: string;
  sortDir: 'asc' | 'desc';
}

export function parseListParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
  defaults: { pageSize: number; sortColumn: string; sortDir: 'asc' | 'desc' },
): ParsedListParams {
  const sp = searchParams ?? {};
  const page = parsePositiveInt(single(sp.page), 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parsePositiveInt(single(sp.pageSize), defaults.pageSize)),
  );
  const search = parseStr(single(sp.q), '');
  const sortColumn = parseStr(single(sp.sort), defaults.sortColumn);
  const sortDir =
    single(sp.dir) === 'desc' || single(sp.dir) === 'asc'
      ? (single(sp.dir) as 'asc' | 'desc')
      : defaults.sortDir;
  return { page, pageSize, search, sortColumn, sortDir };
}

function single(
  v: string | string[] | undefined,
): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
