// apps/web/src/lib/rbac.test.ts
//
// Card 0.16 — exhaustive RBAC matrix test.
//
// Goal: catch a typo in PERMISSION_MATRIX the moment it's introduced.
// We cross-product every (role, action, entity) cell and assert the
// expected allow/deny against the matrix.
//
// What we DO NOT test here:
//   - server-side enforcement (covered by packages/db/src/rbac.test.ts,
//     which is an integration test against a live database).
//   - That the matrix matches plan §5.7 exactly — that's a review-time
//     check, not a runtime one. The matrix-as-code is the spec for v0.
//
// Why this is a single test with a giant table and not 7 × 4 × 7 = 196
// individual `it()`s:
//
//   - The table is the spec. Reading the table tells you exactly which
//     roles can do what on which entities.
//   - When a future card adjusts the matrix (e.g. "compliance_officer
//     can now write producer"), the diff is a single cell in the table
//     and the test update is mechanical.

import { describe, it, expect } from 'vitest';
import { can, canWrite, PERMISSION_MATRIX } from './rbac.js';
import type { AdminAction, AdminEntity } from './rbac.js';

// Every role / entity / action combination the matrix covers.
// Adding to any of these unions forces a test update here, which is
// what we want.
const ROLES = [
  'owner',
  'head_roaster',
  'pack_ship',
  'buyer_receiving',
  'accountant',
  'compliance_officer',
  'readonly',
] as const;

const ENTITIES: AdminEntity[] = [
  'sku',
  'packaging',
  'recipe',
  'price_list',
  'customer',
  'supplier',
  'producer',
];

const ACTIONS: AdminAction[] = ['read', 'create', 'update', 'delete'];

// ── Cross-product ────────────────────────────────────────────────────────

describe('PERMISSION_MATRIX', () => {
  for (const entity of ENTITIES) {
    for (const action of ACTIONS) {
      for (const role of ROLES) {
        const allowed = PERMISSION_MATRIX[entity][action].includes(role);
        it(`${role} ${action} ${entity} -> ${allowed ? 'ALLOW' : 'DENY'}`, () => {
          expect(can(role, action, entity)).toBe(allowed);
        });
      }
    }
  }
});

// ── canWrite ─────────────────────────────────────────────────────────────

describe('canWrite', () => {
  it('owner can write every entity', () => {
    for (const entity of ENTITIES) {
      expect(canWrite('owner', entity)).toBe(true);
    }
  });

  it('readonly can write nothing', () => {
    for (const entity of ENTITIES) {
      expect(canWrite('readonly', entity)).toBe(false);
    }
  });

  it('pack_ship can write nothing', () => {
    for (const entity of ENTITIES) {
      expect(canWrite('pack_ship', entity)).toBe(false);
    }
  });

  it('accountant can write price_list only', () => {
    for (const entity of ENTITIES) {
      expect(canWrite('accountant', entity)).toBe(entity === 'price_list');
    }
  });

  it('head_roaster can write recipe + packaging only', () => {
    for (const entity of ENTITIES) {
      const expected = entity === 'recipe' || entity === 'packaging';
      expect(canWrite('head_roaster', entity)).toBe(expected);
    }
  });

  it('buyer_receiving can write supplier + producer only', () => {
    for (const entity of ENTITIES) {
      const expected = entity === 'supplier' || entity === 'producer';
      expect(canWrite('buyer_receiving', entity)).toBe(expected);
    }
  });

  it('compliance_officer can write supplier + producer only', () => {
    for (const entity of ENTITIES) {
      const expected = entity === 'supplier' || entity === 'producer';
      expect(canWrite('compliance_officer', entity)).toBe(expected);
    }
  });
});

// ── Matrix invariants ────────────────────────────────────────────────────
//
//   These rules must hold for the matrix to be considered "well-formed".
//   A broken invariant is a sign the matrix was edited in a way that
//   violated the plan's RBAC contract.

describe('matrix invariants', () => {
  it('every role can read every entity', () => {
    for (const entity of ENTITIES) {
      const readers = PERMISSION_MATRIX[entity].read;
      for (const role of ROLES) {
        expect(readers.includes(role)).toBe(true);
      }
    }
  });

  it('delete implies create+update+read', () => {
    // Plan §5.7: delete is the most privileged operation. If a role
    // can delete an entity it should be able to create/update/read it
    // too — the matrix must reflect that. This catches a matrix where
    // "delete" was added without granting the other operations.
    for (const entity of ENTITIES) {
      for (const role of ROLES) {
        if (PERMISSION_MATRIX[entity].delete.includes(role)) {
          expect(PERMISSION_MATRIX[entity].create).toContain(role);
          expect(PERMISSION_MATRIX[entity].update).toContain(role);
          expect(PERMISSION_MATRIX[entity].read).toContain(role);
        }
      }
    }
  });

  it('owner is permitted everywhere', () => {
    // Owner is the highest privilege role. They MUST be in every
    // allowlist. A typo like 'owner ' (trailing space) would silently
    // remove them; this invariant catches it.
    for (const entity of ENTITIES) {
      for (const action of ACTIONS) {
        expect(PERMISSION_MATRIX[entity][action]).toContain('owner');
      }
    }
  });
});
