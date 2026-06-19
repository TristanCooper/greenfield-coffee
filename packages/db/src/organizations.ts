// packages/db/src/organizations.ts
//
// Card 0.7 / plan §7.2 — Organization creation flow.
//
// API:
//
//   createOrganization(input, actor)
//     Insert an Organization row + a Membership row (role='owner')
//     for the actor, atomically. Returns the new org's id.
//
// Why this module:
//   The card body calls for a "tRPC v11 procedure" wrapping the
//   create flow. tRPC is not in the project's runtime deps (cards 0.4
//   / 0.6 explicitly deferred stack choices to Phase 1) — adding it
//   for this card would be premature. Instead the logic lives here
//   as a pure async function with explicit input validation, and
//   apps/web/src/app/api/organizations/route.ts wraps it as a Route
//   Handler that drives the Supabase-auth-gated flow.
//
//   When tRPC lands (Phase 1 per the architecture plan), the
//   migration is: re-export `createOrganization` from a `trpc.ts`
//   module as a procedure, route handlers become tRPC mutations.
//   The function body, input shape, and audit-event semantics are
//   stable across that move.
//
// TRANSACTION DISCIPLINE:
//
//   The org insert, membership insert, and audit_event insert MUST be
//   in the same transaction so a partial failure doesn't leave an
//   org with no owner (inconsistent state) or an audit row with no
//   org (orphan audit). We use the typed Drizzle `db.transaction`
//   wrapper, which:
//
//     - opens a Postgres transaction on the BYPASSRLS `db` connection
//     - runs the callback with a `tx` handle bound to that transaction
//     - commits on resolve, rolls back on throw
//
//   We use `db` (BYPASSRLS) rather than `withTenant` because the org
//   doesn't exist yet — there is no tenant id to set. Using
//   `withTenant` here would be chicken-and-egg. After this function
//   returns, future reads of the new org should use `withTenant(orgId, ...)`
//   so RLS scopes them.
//
// AUDIT_EVENT FALLBACK:
//
//   The card body says "audit_event insert uses raw SQL because card
//   0.12 hasn't landed yet — wrap in try/catch and log+continue if
//   the table doesn't exist". Card 0.12 ships audit_event. Until
//   then, we INSERT INTO public.audit_event via raw SQL inside the
//   transaction; if the table doesn't exist, the INSERT raises a
//   SQLSTATE 42P01 ("relation does not exist") which we catch and
//   log+continue. The org + membership are NOT rolled back — the
//   audit row is best-effort until 0.12 lands.
//
//   Card 0.12 will tighten this: switch from try/catch fallback to a
//   direct INSERT, and add a `NOT NULL DEFAULT` on the audit table
//   so omission becomes impossible rather than warn-and-continue.

import { db } from './client.js';
import { sql } from 'drizzle-orm';
import {
  organizations,
  memberships,
  type BaseCurrency,
  type CountryCode,
  type EudrSettings,
  type Organization,
  type RegionCode,
} from './schema/organizations.js';

/** Re-export RegionCode from the schema module so consumers have a single import. */
export type { RegionCode } from './schema/organizations.js';

export interface CreateOrganizationInput {
  name: string;
  countryCode: CountryCode;
  region: RegionCode;
  baseCurrency: BaseCurrency;
  /** Optional override; defaults to DEFAULT_EUDR_SETTINGS when omitted. */
  eudrSettings?: EudrSettings;
}

export interface CreateOrganizationActor {
  /** UUID of the authenticated user (auth.users.id == public.users.id). */
  userId: string;
}

export interface CreateOrganizationResult {
  orgId: string;
  membershipId: string;
  organization: Organization;
  /** True iff the audit_event row was inserted; false if the fallback swallowed it. */
  auditRecorded: boolean;
}

/** Set of valid region codes — used to validate the input before INSERT. */
const VALID_REGION_CODES: ReadonlySet<RegionCode> = new Set<RegionCode>([
  'GB',
  'IE',
  'NL',
  'DE',
  'FR',
  'BE',
  'IT',
  'ES',
  'SE',
  'DK',
  'FI',
  'NO',
  'AT',
  'PL',
  'PT',
  'CH',
]);

const VALID_COUNTRIES: ReadonlySet<CountryCode> = new Set<CountryCode>([
  'GB',
  'IE',
  'NL',
  'DE',
  'FR',
  'BE',
  'IT',
  'ES',
  'SE',
  'DK',
  'FI',
  'NO',
  'AT',
  'PL',
  'PT',
  'CH',
]);

const VALID_CURRENCIES: ReadonlySet<BaseCurrency> = new Set<BaseCurrency>([
  'EUR',
  'GBP',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate the createOrganization input. Throws a typed error on failure. */
export class CreateOrganizationError extends Error {
  readonly code: 'INVALID_INPUT' | 'USER_NOT_FOUND';
  override readonly name: string = 'CreateOrganizationError';
  constructor(code: 'INVALID_INPUT' | 'USER_NOT_FOUND', message: string) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, CreateOrganizationError.prototype);
  }
}

function validate(input: CreateOrganizationInput, actor: CreateOrganizationActor): void {
  if (!UUID_RE.test(actor.userId)) {
    throw new CreateOrganizationError(
      'INVALID_INPUT',
      `actor.userId must be a UUID, got ${JSON.stringify(actor.userId)}`,
    );
  }
  const name = input.name.trim();
  if (name.length === 0) {
    throw new CreateOrganizationError(
      'INVALID_INPUT',
      'name must be a non-empty string',
    );
  }
  if (name.length > 200) {
    throw new CreateOrganizationError(
      'INVALID_INPUT',
      'name must be 200 characters or fewer',
    );
  }
  if (!VALID_COUNTRIES.has(input.countryCode)) {
    throw new CreateOrganizationError(
      'INVALID_INPUT',
      `countryCode must be one of ${[...VALID_COUNTRIES].join(', ')}, got ${JSON.stringify(input.countryCode)}`,
    );
  }
  if (!VALID_REGION_CODES.has(input.region)) {
    throw new CreateOrganizationError(
      'INVALID_INPUT',
      `region must be one of ${[...VALID_REGION_CODES].join(', ')}, got ${JSON.stringify(input.region)}`,
    );
  }
  // Region and country_code must match — for v1 the mapping is 1:1.
  // Mismatch is almost certainly a UI bug, so we reject loudly rather
  // than silently accepting an inconsistent row.
  if (input.region !== input.countryCode) {
    throw new CreateOrganizationError(
      'INVALID_INPUT',
      `region (${input.region}) and country_code (${input.countryCode}) must match in v1`,
    );
  }
  if (!VALID_CURRENCIES.has(input.baseCurrency)) {
    throw new CreateOrganizationError(
      'INVALID_INPUT',
      `baseCurrency must be one of ${[...VALID_CURRENCIES].join(', ')}, got ${JSON.stringify(input.baseCurrency)}`,
    );
  }
}

/**
 * Create an organization + owner membership atomically.
 *
 * Returns the new org id, membership id, and the inserted Organization
 * row. The audit_event row (when the table exists) is written in the
 * same transaction; if it doesn't yet exist, the fallback logs a
 * warning and the org + membership commit without it.
 *
 * @throws {CreateOrganizationError} `code: 'INVALID_INPUT'` if input fails validation.
 * @throws {CreateOrganizationError} `code: 'USER_NOT_FOUND'` if the actor's user row
 *   doesn't exist (caller should re-fetch the session before retrying).
 */
export async function createOrganization(
  input: CreateOrganizationInput,
  actor: CreateOrganizationActor,
): Promise<CreateOrganizationResult> {
  validate(input, actor);

  // Wrap the three INSERTs in a single Postgres transaction so a
  // failure in any one rolls back the others. The Drizzle
  // `db.transaction(callback)` helper opens an explicit transaction
  // on the BYPASSRLS `db` connection — there's no tenant yet, so we
  // can't use `withTenant`.
  return db.transaction(async (tx) => {
    // Verify the actor's user row exists. The memberships FK requires
    // public.users.id; without this check, a stale or tampered
    // session would surface as a confusing FK violation. Returning a
    // typed error here lets the route handler return a 401/404
    // cleanly. Drizzle's `sql` tagged template inside the tx is the
    // canonical raw-SQL escape hatch — equivalent to
    // `tx.execute(sql\`...\`)` but typed at the parameter boundary.
    const userRows = (await tx.execute(
      sql`SELECT id FROM public.users WHERE id = ${actor.userId} LIMIT 1`,
    )) as unknown as readonly { id: string }[];
    if (userRows.length === 0) {
      throw new CreateOrganizationError(
        'USER_NOT_FOUND',
        `No public.users row for actor ${actor.userId}`,
      );
    }

    // 1. Insert the organization. We use the Drizzle insert builder
    //    so CHECK constraints are applied at the DB level (we don't
    //    double-encode them in the SQL string). If the input passes
    //    `validate()` but slips through a new constraint, the INSERT
    //    raises and the tx rolls back.
    const [orgRow] = await tx
      .insert(organizations)
      .values({
        name: input.name.trim(),
        countryCode: input.countryCode,
        region: input.region,
        baseCurrency: input.baseCurrency,
        // data_residency is fixed at 'uk' for v1 — see PRD §11.1.
        // The column has a DEFAULT of 'uk' at the DB level; we set it
        // explicitly here so the TS shape carries it and a future
        // v1.5 expansion to EU residency is a one-line change.
        dataResidency: 'uk',
        // eudr_settings has a DEFAULT too; we pass through the input
        // value when present, otherwise omit and let the DB default
        // win. The Drizzle `.default(...)` chain sets the SQL
        // DEFAULT clause — passing undefined here doesn't trigger
        // NULL; the DB default fills in.
        ...(input.eudrSettings !== undefined ? { eudrSettings: input.eudrSettings } : {}),
      })
      .returning();
    if (!orgRow) {
      // INSERT … RETURNING should always return one row. This branch
      // is unreachable in practice; the type-guard keeps the
      // downstream code non-null.
      throw new CreateOrganizationError(
        'INVALID_INPUT',
        'Organization INSERT returned no row (unreachable)',
      );
    }

    // 2. Insert the membership row with role='owner'. UNIQUE
    //    (org_id, user_id) protects against double-create if the
    //    caller retries; the constraint surfaces as a 23505 we can
    //    let bubble.
    const [memberRow] = await tx
      .insert(memberships)
      .values({
        orgId: orgRow.id,
        userId: actor.userId,
        role: 'owner',
      })
      .returning();
    if (!memberRow) {
      throw new CreateOrganizationError(
        'INVALID_INPUT',
        'Membership INSERT returned no row (unreachable)',
      );
    }

    // 3. Best-effort audit_event insert. The card body explicitly
    //    defers the audit table to card 0.12; until then, we
    //    pre-check whether the table exists and skip the INSERT
    //    entirely if it doesn't. The pre-check uses `to_regclass`
    //    which is the canonical Postgres "does this relation
    //    exist" helper and doesn't itself throw — returns NULL
    //    when the relation is missing.
    //
    //    Why pre-check rather than try/catch:
    //      postgres-js's `sql.begin` (used by `db.transaction`)
    //      captures ANY error from a query in the tx's
    //      `uncaughtError` slot and re-throws it after the
    //      callback resolves — even if you caught the error
    //      inside the callback. See node_modules/postgres/src/
    //      index.js: `q.catch(e => uncaughtError || ...)`.
    //      So a try/catch around the INSERT doesn't actually
    //      suppress the rollback. The pre-check sidesteps the
    //      failed query entirely; we only INSERT when the
    //      relation is known to exist.
    //
    //    Card 0.12 will tighten this to a direct INSERT and
    //    remove the pre-check.
    let auditRecorded = false;
    const auditTableExists = (await tx.execute(
      sql`SELECT EXISTS (
              SELECT 1 FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'audit_event'
            ) AS exists`,
    )) as unknown as readonly { exists: boolean }[];
    if (auditTableExists[0]?.exists === true) {
      const diff = JSON.stringify({
        name: orgRow.name,
        country_code: orgRow.countryCode,
        region: orgRow.region,
        base_currency: orgRow.baseCurrency,
        data_residency: orgRow.dataResidency,
      });
      await tx.execute(
        sql`INSERT INTO public.audit_event
              (org_id, actor_user_id, action, entity_type, entity_id, diff)
            VALUES (${orgRow.id}, ${actor.userId}, 'organization.create',
                    'organization', ${orgRow.id}, ${diff}::jsonb)`,
      );
      auditRecorded = true;
    } else {
      console.log(
        '[createOrganization] audit_event table not present (card 0.12 pending); continuing without audit row',
      );
    }

    return {
      orgId: orgRow.id,
      membershipId: memberRow.id,
      organization: orgRow,
      auditRecorded,
    };
  });
}