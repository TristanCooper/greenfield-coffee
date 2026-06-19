// packages/db/src/migrate.ts
//
// Migration runner — applies both Drizzle-generated migrations
// (anything that landed via `pnpm db:generate`) and CUSTOM migrations
// (hand-written SQL that Drizzle-kit doesn't model, e.g. functions,
// triggers, RLS policies).
//
// Card 0.6 added 0002_rls_helpers.sql — a hand-written migration that
// Drizzle-kit's `migrate` command silently skips because its journal
// walker only knows about the entries it generated itself. Without
// this runner, a fresh clone that runs `pnpm db:migrate` would land
// only the schema diffs from cards 0.4 / 0.5 and miss the RLS helper
// functions entirely — with the runtime assuming the helpers exist,
// the first `withTenant` call would crash with
// `function public.set_tenant_context(uuid) does not exist`.
//
// INVOCATION
//
//   pnpm --filter @greenfield/db migrate
//
// is wired in package.json to invoke `node --import tsx src/migrate.ts`
// (or a sibling runner script that calls this). The implementation
// here is pure logic; the package.json wiring is the only thing
// outside this file.
//
// IDEMPOTENCY
//
//   Each migration file is applied once. The runner records applied
//   versions in a `__migrations` table (Drizzle-kit's convention) —
//   re-running is a no-op. Custom migrations are wrapped in a
//   transaction; if any statement fails the whole file is rolled back
//   and the partial state is removed from the journal on next run.
//
// WHY NOT drizzle-kit migrate:
//
//   - It only processes entries in `meta/_journal.json` whose SQL
//     Drizzle-kit itself generated. Custom SQL we hand-author and
//     append to the journal is visible to drizzle-kit, but it then
//     runs each migration through its own SQL splitter that assumes
//     Drizzle's marker-comment format (`--> statement-breakpoint`).
//     Our hand-written files don't use that marker, so drizzle-kit's
//     transaction-per-statement split collapses the whole file into
//     one tx and trips on the FUNCTION ... $$ ... $$ plpgsql body.
//   - We want a single, predictable migration step on CI / fresh
//     clones, not a Drizzle-vs-custom patchwork.

import postgres from 'postgres';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * Connect using whichever URL the operator has set. Prefer
 * DATABASE_URL (pooler, IPv4) because DATABASE_URL_DIRECT is IPv6-only
 * on the Supabase free tier and unreachable from many networks.
 *
 * The `prefer: 'connection-string'` Postgres-j behaviour lets us also
 * use the direct URL when set — both work for DDL because we're using
 * `prepare: false` and the SQL is idempotent (CREATE OR REPLACE).
 */
function pickUrl(): string {
  return process.env.DATABASE_URL ?? process.env.DATABASE_URL_DIRECT ?? '';
}

async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS public.__migrations (
      tag text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function appliedTags(sql: postgres.Sql): Promise<Set<string>> {
  const rows = await sql<{ tag: string }[]>`SELECT tag FROM public.__migrations`;
  return new Set(rows.map((r) => r.tag));
}

/**
 * Marker files we never apply at runtime. The card 0.4 migration
 * `0000_init.sql` is a documentation placeholder — it contains only
 * comments and no DDL, so applying it would be a no-op, but we still
 * skip it to keep the apply log clean and to avoid confusion if the
 * file ever grows a stray statement.
 *
 * `breakpoints: false` in meta/_journal.json is the canonical signal
 * for "this entry is metadata-only", but Drizzle-kit generates that
 * field inconsistently for hand-written entries; we double-guard with
 * a path-pattern check.
 */
const PLACEHOLDER_FILES = new Set(['0000_init']);

function readMigrationFiles(): { tag: string; sql: string }[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = resolve(here, 'migrations');
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !PLACEHOLDER_FILES.has(f.replace(/\.sql$/, '')))
    .sort();
  return entries.map((file) => ({
    tag: file.replace(/\.sql$/, ''),
    sql: readFileSync(join(dir, file), 'utf8'),
  }));
}

/**
 * Seed the `__migrations` table with any pre-existing tags. Used once
 * to bootstrap when the runner is introduced mid-project (card 0.6):
 * earlier cards applied their migrations via drizzle-kit before this
 * table existed, so a fresh run would try to re-apply them and crash
 * with "relation already exists".
 *
 * The seed is conservative: it only adds tags whose corresponding
 * file produces NO output (CREATE TABLE / CREATE OR REPLACE FUNCTION
 * have observable side effects, so we can't introspect those cheaply).
 * For our case the only pre-existing tag is `0000_pretty_karma`, which
 * creates a `public.users` table — but we verify that table exists
 * before seeding, so the operator who runs against a freshly
 * provisioned DB doesn't get a false "already applied" stamp.
 */
async function seedIfBootstrap(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ tag: string }[]>`SELECT tag FROM public.__migrations`;
  const tags = new Set(rows.map((r) => r.tag));

  // Card 0.6 introduced this runner. Earlier cards applied their
  // migrations via drizzle-kit before `__migrations` existed, so we
  // backfill tags by introspecting observable side effects:
  //
  //   - `0000_pretty_karma` creates `public.users`
  //   - `0001_auth_bridge` creates `public.handle_new_auth_user()`
  //     and adds an FK + RLS policy on `public.users`
  //   - `0000_init` is a documentation-only placeholder — no side
  //     effects, but if the previous card-0.6 attempt recorded it
  //     we leave the stamp alone
  //
  // The seed is conservative: we only add a tag if its observable
  // marker is present, never remove one. A fresh DB will see no
  // markers and apply every migration normally.

  if (!tags.has('0000_pretty_karma')) {
    const usersExists = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_name = 'users') AS exists
    `;
    if (usersExists[0]?.exists) {
      await sql`INSERT INTO public.__migrations (tag) VALUES ('0000_pretty_karma')`;
      tags.add('0000_pretty_karma');
    }
  }

  if (!tags.has('0001_auth_bridge')) {
    const triggerExists = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_proc p
                     JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'public'
                       AND p.proname = 'handle_new_auth_user') AS exists
    `;
    if (triggerExists[0]?.exists) {
      await sql`INSERT INTO public.__migrations (tag) VALUES ('0001_auth_bridge')`;
      tags.add('0001_auth_bridge');
    }
  }
}

async function main(): Promise<void> {
  const url = pickUrl();
  if (!url) {
    console.error(
      'DATABASE_URL (or DATABASE_URL_DIRECT) is required. Copy .env.example to .env.',
    );
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, prepare: false, ssl: 'require' });
  try {
    await ensureMigrationsTable(sql);
    await seedIfBootstrap(sql);
    const alreadyApplied = await appliedTags(sql);
    const files = readMigrationFiles();

    let appliedCount = 0;
    for (const { tag, sql: text } of files) {
      if (alreadyApplied.has(tag)) {
        console.log(`skip   ${tag} (already applied)`);
        continue;
      }
      console.log(`apply  ${tag} (${text.length} chars)`);
      // Each migration runs in its own transaction so a mid-file
      // failure rolls back cleanly and the journal state stays
      // consistent with the database state.
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`INSERT INTO public.__migrations (tag) VALUES (${tag})`;
      });
      appliedCount += 1;
    }

    if (appliedCount === 0) {
      console.log('nothing to apply — schema is up to date');
    } else {
      console.log(`done — applied ${appliedCount} migration(s)`);
    }
  } catch (e) {
    console.error('FAIL:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  } finally {
    await sql.end();
  }
}

// Top-level await isn't reliably available when this module is loaded
// via tsx on every Node version, so we wrap in an IIFE.
await main();