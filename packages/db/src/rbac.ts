// packages/db/src/rbac.ts
//
// Card 0.7 / plan §7.2 — RBAC helper.
//
// API:
//
//   assertRole(userId, orgId, allowedRoles[])
//     Look up the user's membership in `orgId`; throw RbacError(FORBIDDEN)
//     if no membership exists OR the membership's role is not in
//     `allowedRoles`. Use this to gate tRPC procedures / route handlers
//     that need to enforce role-based access:
//
//        await assertRole(userId, orgId, ['compliance_officer']);
//        // …proceed with the privileged write.
//
//   getMembership(userId, orgId)
//     Return the membership row (or null) for the (user, org) pair.
//     Useful for UI routes that need to know the role without enforcing.
//
// Why a custom error class (not a raw Error):
//
//   The card body calls for a typed TRPCError('FORBIDDEN') helper. tRPC
//   is not in the project's runtime deps (cards 0.4 / 0.6 explicitly
//   deferred stack choices to Phase 1) — adding it for one helper
//   would be premature. Instead we ship `RbacError` with a `code`
//   field shaped identically to tRPC's TRPCError so:
//
//     1. Tests can assert on `error.code === 'FORBIDDEN'` regardless of
//        whether the future caller is tRPC, a Route Handler, or a script.
//     2. When tRPC lands, the assertion stays a single line: replace
//        `throw new RbacError('FORBIDDEN', ...)` with
//        `throw new TRPCError({ code: 'FORBIDDEN', ... })`. The call
//        sites don't change.
//
// Why an unscoped read of the membership table:
//
//   The membership lookup MUST happen OUTSIDE the tenant scope because
//   the caller (a route handler / tRPC procedure) hasn't yet proven
//   the user has a membership — using `withTenant` here would be a
//   chicken-and-egg loop (the tenant context IS the org we're trying
//   to assert against). The unscopedDb escape hatch is the
//   documented mechanism (see rls.ts) and this is exactly the use
//   case it was added for. Memberships are intentionally simple —
//   no per-row RLS — so the unscoped read returns the same row the
//   scoped read would. When per-membership RLS lands in a later
//   card, this becomes a `withTenant(orgId, ...)` call — the
//   signatures don't change.
//
// UNSCOPED QUERY JUSTIFICATION (required by rls.ts):
//
//   Looking up a membership by (user_id, org_id) BEFORE the caller has
//   proven tenancy is the canonical "global lookup that legitimately
//   needs to bypass RLS" case the escape hatch was created for. The
//   query is a single-row SELECT by a composite (org_id, user_id)
//   UNIQUE index — there is no information leak beyond "does user X
//   have a role in org Y", which is the entire point of this check.

import { unscopedDb } from './rls.js';
import { membershipRole } from './schema/organizations.js';
import type { MembershipRole } from './schema/organizations.js';

/**
 * RBAC error shape. `code` is one of a fixed set so callers can branch
 * on it; `name` is the constructor name so logs / stack traces surface
 * the right type.
 *
 * Why the `code` field is a literal union, not a string:
 *   - TypeScript will catch typos at the call site (e.g. writing
 *     'FORBIDEN' fails typecheck).
 *   - Tests can write `expect(err.code).toBe('FORBIDDEN')` and TS
 *     narrows the union correctly.
 *
 * The shape is compatible with @trpc/server's TRPCError — when tRPC
 * lands, the migration is: `new TRPCError({ code: this.code, message:
 * this.message })` and no call site changes.
 */
export type RbacErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'INTERNAL';

export class RbacError extends Error {
  readonly code: RbacErrorCode;
  // Override Error.name so logs / stack traces surface 'RbacError'
  // (the default would be 'Error', which loses the type info at
  // log-grep time). We declare the type as `string` — narrower than
  // the Error.name signature, but the literal assignment still
  // satisfies the override.
  override readonly name: string = 'RbacError';

  constructor(code: RbacErrorCode, message: string) {
    super(message);
    this.code = code;
    // Preserve the prototype chain across the transpile target — the
    // tsconfig targets ES2022 but the runtime may be older; without
    // this `instanceof RbacError` fails after `throw new RbacError(...)`
    // is caught in a different module.
    Object.setPrototypeOf(this, RbacError.prototype);
  }
}

/** Shape of a membership row returned by the lookup. */
export interface MembershipRow {
  id: string;
  org_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Internal: run a membership lookup as a raw SQL query (bypasses RLS;
 * see file header justification).
 *
 * Returns the membership row or null. The query is parameterised — no
 * string interpolation of caller-supplied ids.
 */
async function fetchMembership(
  userId: string,
  orgId: string,
): Promise<MembershipRow | null> {
  // The pgEnum type literal lives in Drizzle's runtime; we use the
  // `.enumValues` array to build a typed string-literal check at the
  // SQL boundary. Members of the enum are validated server-side; the
  // cast ::text is safe because Postgres already enforces the enum.
  const allowedRoles = membershipRole.enumValues;
  // We SELECT role as text so the result type matches the literal
  // union at the call site without a runtime cast. The query is
  // bound by parameter id ($1, $2) — no SQL injection surface.
  const rows = await unscopedDb<MembershipRow>(
    `SELECT id, org_id, user_id, role::text AS role, created_at::text AS created_at
       FROM public.memberships
      WHERE org_id = $1 AND user_id = $2
      LIMIT 1`,
    orgId,
    userId,
  );
  // Single-row SELECT LIMIT 1 — either 0 or 1 row.
  const row = rows[0];
  if (!row) return null;
  // Defensive runtime check that the role value is one we know about
  // (a future migration adding a new enum value shouldn't crash the
  // helper, but it shouldn't silently return an unknown string).
  if (!(allowedRoles as readonly string[]).includes(row.role)) {
    throw new RbacError(
      'INTERNAL',
      `membership row has unknown role '${row.role}' (allowed: ${allowedRoles.join(', ')})`,
    );
  }
  return row;
}

/**
 * Assert that `userId` has a membership in `orgId` with a role in
 * `allowedRoles`. Throws `RbacError('FORBIDDEN')` otherwise.
 *
 * @param userId - UUID of the user making the request.
 * @param orgId  - UUID of the org whose resource is being accessed.
 * @param allowedRoles - Roles permitted to perform the operation.
 *   Pass `['owner']` for owner-only writes; `['compliance_officer', 'owner']`
 *   for actions a compliance officer can also take; etc.
 *
 * @throws {RbacError} `code: 'FORBIDDEN'` if no membership exists OR
 *   the membership's role is not in `allowedRoles`. The error message
 *   intentionally doesn't leak WHICH check failed (membership-exists vs
 *   role-matches) to avoid an enumeration oracle — both branches throw
 *   the same code with similar wording.
 *
 * @example
 *   await assertRole(user.id, orgId, ['compliance_officer']);
 *   // safe to write the EUDR reference data
 */
export async function assertRole(
  userId: string,
  orgId: string,
  allowedRoles: readonly MembershipRole[],
): Promise<void> {
  if (!UUID_RE.test(userId)) {
    throw new RbacError(
      'INTERNAL',
      `assertRole: userId must be a UUID, got ${JSON.stringify(userId)}`,
    );
  }
  if (!UUID_RE.test(orgId)) {
    throw new RbacError(
      'INTERNAL',
      `assertRole: orgId must be a UUID, got ${JSON.stringify(orgId)}`,
    );
  }
  if (allowedRoles.length === 0) {
    throw new RbacError(
      'INTERNAL',
      'assertRole: allowedRoles must be non-empty (an empty allowlist ' +
        'would forbid every caller)',
    );
  }

  const membership = await fetchMembership(userId, orgId);
  if (!membership || !allowedRoles.includes(membership.role)) {
    // Same code for both branches — see the comment above about
    // enumeration oracles.
    throw new RbacError(
      'FORBIDDEN',
      `User ${userId} is not permitted to perform this action in org ${orgId}.`,
    );
  }
}

/**
 * Look up the user's membership in `orgId` without enforcing a role.
 * Returns the membership row or null. Useful for UI routes that want
 * to render a role-aware dashboard ("You are signed in as <role>")
 * without throwing.
 */
export async function getMembership(
  userId: string,
  orgId: string,
): Promise<MembershipRow | null> {
  if (!UUID_RE.test(userId) || !UUID_RE.test(orgId)) return null;
  return fetchMembership(userId, orgId);
}

/**
 * Look up the user's first membership across ALL orgs. Used by the
 * /onboarding route to decide whether to redirect to /signup (no
 * membership → sign-up) or show the dashboard (has membership).
 *
 * Returns the oldest membership (lowest created_at) — for v1 a user
 * is expected to have at most one, but the API is forward-compatible
 * with the v1.5 "user can hold multiple roles" model by picking a
 * deterministic one.
 */
export async function getFirstMembership(
  userId: string,
): Promise<MembershipRow | null> {
  if (!UUID_RE.test(userId)) return null;
  const rows = await unscopedDb<MembershipRow>(
    `SELECT id, org_id, user_id, role::text AS role, created_at::text AS created_at
       FROM public.memberships
      WHERE user_id = $1
      ORDER BY created_at ASC
      LIMIT 1`,
    userId,
  );
  return rows[0] ?? null;
}