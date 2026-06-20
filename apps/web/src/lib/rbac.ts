// apps/web/src/lib/rbac.ts
//
// Card 0.16 — UI-side RBAC helper.
//
// This module is the application-layer counterpart to
// packages/db/src/rbac.ts. The db-side helper (`assertRole`)
// enforces server-side role checks at the SQL boundary; this
// helper enforces UI-side checks (whether to render a form, whether
// to enable a write button, etc.).
//
// WHY A SECOND HELPER INSTEAD OF REUSING db-side:
//
//   - db-side assertRole THROWS — appropriate for a server action
//     that must reject unauthorized writes. Useless for a UI
//     component that wants to ask "should I render this button?".
//   - db-side assertRole hits the database (one membership SELECT
//     per call). A UI helper must be synchronous and zero-cost;
//     the caller already knows the role from the membership lookup
//     on the page render.
//
//   The page-level gate (apps/web/src/app/(authenticated)/admin/page.tsx)
//   loads the membership ONCE per request and passes the role to
//   the form components as a prop. The form then calls
//   `can(role, 'update', 'sku')` to decide whether to render the
//   submit button.
//
// PERMISSION MATRIX (plan §5.7, cross-referenced with card body):
//
//   owner              — full CRUD on every entity
//   head_roaster       — read all; write recipes + packagings; no price lists
//   pack_ship          — read all; no writes
//   buyer_receiving    — read all; write suppliers + producers + green lots
//                        (green lots is not part of this card's CRUD list;
//                        the receiving wizard covers it.)
//   accountant         — read all; write price lists only
//   compliance_officer — write suppliers + producers + EUDR fields;
//                        no stock / recipes / pricing
//   readonly           — read only
//
// Entities in scope for this card: sku, packaging, recipe, price_list,
// customer, supplier, producer. The `entity` arg of `can()` is a string
// literal union; adding a new entity requires updating the matrix.
//
// TESTING:
//
//   rbac.test.ts (apps/web/src/lib/rbac.test.ts) covers the matrix
//   combinatorially — every role × action × entity — so a typo in the
//   matrix is caught at PR time. The test is pure-logic, no DB
//   needed.

import type { MembershipRole } from '@greenfield/db';

/** Entities the admin UI can CRUD. Add to this union when adding a new entity. */
export type AdminEntity =
  | 'sku'
  | 'packaging'
  | 'recipe'
  | 'price_list'
  | 'customer'
  | 'supplier'
  | 'producer';

/** Actions a user can perform on an entity. */
export type AdminAction = 'read' | 'create' | 'update' | 'delete';

type Matrix = Readonly<Record<AdminEntity, Readonly<Record<AdminAction, ReadonlyArray<MembershipRole>>>>>;

/**
 * The permission matrix. Reading: for each (entity, action), which
 * roles are permitted to perform it. Order within each list does not
 * matter; the membership role must be IN the list to allow the action.
 *
 * `read` is granted to every role — the card body says "read all" for
 * every role except none-of-them. We still keep it in the matrix
 * explicitly so the test covers it and so the API shape matches the
 * others.
 */
const MATRIX: Matrix = {
  sku: {
    read: ['owner', 'head_roaster', 'pack_ship', 'buyer_receiving', 'accountant', 'compliance_officer', 'readonly'],
    create: ['owner'],
    update: ['owner'],
    delete: ['owner'],
  },
  packaging: {
    read: ['owner', 'head_roaster', 'pack_ship', 'buyer_receiving', 'accountant', 'compliance_officer', 'readonly'],
    create: ['owner', 'head_roaster'],
    update: ['owner', 'head_roaster'],
    delete: ['owner'],
  },
  recipe: {
    read: ['owner', 'head_roaster', 'pack_ship', 'buyer_receiving', 'accountant', 'compliance_officer', 'readonly'],
    create: ['owner', 'head_roaster'],
    update: ['owner', 'head_roaster'],
    delete: ['owner', 'head_roaster'],
  },
  price_list: {
    read: ['owner', 'head_roaster', 'pack_ship', 'buyer_receiving', 'accountant', 'compliance_officer', 'readonly'],
    create: ['owner', 'accountant'],
    update: ['owner', 'accountant'],
    delete: ['owner'],
  },
  customer: {
    read: ['owner', 'head_roaster', 'pack_ship', 'buyer_receiving', 'accountant', 'compliance_officer', 'readonly'],
    create: ['owner'],
    update: ['owner'],
    delete: ['owner'],
  },
  supplier: {
    read: ['owner', 'head_roaster', 'pack_ship', 'buyer_receiving', 'accountant', 'compliance_officer', 'readonly'],
    create: ['owner', 'buyer_receiving', 'compliance_officer'],
    update: ['owner', 'buyer_receiving', 'compliance_officer'],
    delete: ['owner', 'compliance_officer'],
  },
  producer: {
    read: ['owner', 'head_roaster', 'pack_ship', 'buyer_receiving', 'accountant', 'compliance_officer', 'readonly'],
    create: ['owner', 'buyer_receiving', 'compliance_officer'],
    update: ['owner', 'buyer_receiving', 'compliance_officer'],
    delete: ['owner', 'compliance_officer'],
  },
};

/**
 * Can `role` perform `action` on `entity`?
 *
 * Returns `true` if the role is in the allowlist for that
 * (entity, action) cell of the matrix; `false` otherwise.
 *
 * The function is pure and synchronous — no DB calls, no exceptions.
 * Use it freely in render paths.
 */
export function can(
  role: MembershipRole,
  action: AdminAction,
  entity: AdminEntity,
): boolean {
  const allowed = MATRIX[entity][action];
  return allowed.includes(role);
}

/**
 * Convenience: returns true iff the role can perform at least one
 * write (create/update/delete) on the entity. Use this for "show the
 * New button?" decisions in list views.
 */
export function canWrite(
  role: MembershipRole,
  entity: AdminEntity,
): boolean {
  return (
    can(role, 'create', entity) ||
    can(role, 'update', entity) ||
    can(role, 'delete', entity)
  );
}

/**
 * For tests / debugging: the raw matrix. Production code should use
 * `can()` / `canWrite()` instead.
 */
export const PERMISSION_MATRIX = MATRIX;
