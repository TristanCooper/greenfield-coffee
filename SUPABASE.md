# Supabase setup — greenfield-prod (eu-west-2)

> Operator walkthrough for provisioning the Greenfield Supabase project. Card 0.3. Plan §7.1.

This is the canonical "how to recreate this from scratch" doc. If you're a fresh operator and the project doesn't exist yet, follow the steps below in order. If it already exists, jump to the **Smoke test** at the bottom to verify health.

## Why this region

Single-region for v1 (plan §11.1). `data_residency = 'uk'` only at signup. All v1 orgs — UK + EU pilot — live in this one project. Scaling out to `eu-west-1`/`eu-central-1` is a v2 problem.

## Prerequisites

- A Supabase account (founder's email)
- 1Password (or any password manager) for the DB password
- Vercel account linked to the greenfield GitHub repo
- Local psql for the smoke test (`psql --version` → PostgreSQL 14+ is fine)

## Step 1 — Create the project

In the Supabase dashboard:

1. New project → name: **`greenfield-prod`**
2. Database password: **strong, generated**, save to 1Password immediately (you cannot recover this — it gates the postgres role)
3. Region: **`eu-west-2` (London)**
4. Plan: **Free** (Pro upgrade deferred until we hit 500MB / paused-project limits — see plan §9 cost notes)

Wait for "Project provisioned" — usually <2 min.

## Step 2 — Enable extensions

Dashboard → **Database** → **Extensions**, search and enable:

- **`postgis`** — geographic data (org HQ coordinates, future roaster locations, lot-zone radius queries)
- **`pgcrypto`** — `digest()` for the v1.5 audit hash chain. Enabled now even though v1 doesn't use it, so the schema can reference it without a migration.

Both are free-tier-eligible. No DB restart needed.

Verify with:

```sql
select extname, extversion
from pg_extension
where extname in ('postgis','pgcrypto')
order by extname;
```

Expected: `pgcrypto | 1.3` and `postgis | 3.3.x`.

## Step 3 — Copy API keys

Dashboard → **Settings** → **API**:

| Dashboard field                | Env var                          |
| ------------------------------ | -------------------------------- |
| Project URL                    | `NEXT_PUBLIC_SUPABASE_URL`       |
| `anon` `public` key            | `NEXT_PUBLIC_SUPABASE_ANON_KEY`  |
| `service_role` `secret`        | `SUPABASE_SERVICE_ROLE_KEY`      |

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — server code only. Never expose to the browser, never commit.

## Step 4 — Copy connection strings

Dashboard → **Settings** → **Database** → **Connection string**:

| Mode          | Port | Goes to              | Append          |
| ------------- | ---- | -------------------- | --------------- |
| Transaction   | 6543 | `DATABASE_URL`       | `?sslmode=require` |
| Direct        | 5432 | `DATABASE_URL_DIRECT`| `?sslmode=require` |

Pooler (6543) is what the running Next.js app uses. Direct (5432) is what
Drizzle migrations and scripts use — it bypasses pgBouncer so prepared
statements / DDL don't trip the pooler's transaction-mode quirks.

> **Reachability caveat (added card 0.4):** the Zenbook's `wlp195s0` interface
> has an IPv4-only default route. `db.<project>.supabase.co` (DIRECT, port
> 5432) is AAAA-only on Supabase's side, so DIRECT is **unreachable from
> the Zenbook**. The pooler host is dual-stack and reachable on its IPv4
> address. **Migration recipes:**
>
> - From Vercel / CI / any IPv6-capable host: use `DATABASE_URL_DIRECT`
>   (plan §7.1 default — cleanest, no pgBouncer in the loop).
> - From the Zenbook: pass `DATABASE_URL_DIRECT=$DATABASE_URL` to override
>   for **empty / no-DDL migrations only**. Card 0.4 verified that
>   drizzle-kit's `__drizzle_migrations` bootstrap (one `CREATE TABLE IF
>   NOT EXISTS`) succeeds against the pooler. Once real DDL lands (cards
>   0.9+), prefer Vercel/CI for migrations.

## Step 5 — Wire to Vercel

1. Vercel → **Add New** → **Project** → import the greenfield GitHub repo (card 0.1 must be on `main` first)
2. In the project → **Settings** → **Environment Variables**, add all 5 vars from steps 3 + 4 for:
   - **Production**
   - **Preview**
   - **Development**
3. **Do NOT** commit `.env` files. `.gitignore` already excludes them.

Smoke: push a commit, open a Preview deploy, view-source and confirm the page references `NEXT_PUBLIC_SUPABASE_URL` (browser-visible vars get inlined at build time, so a missing var fails the build).

## Smoke test (operator-side)

```bash
# Copy .env.example to .env and fill from steps 3 + 4
cp .env.example .env
$EDITOR .env

# Pooler must answer
psql "$DATABASE_URL" -c "select 1;"
# → 1 row

# Extensions enabled
psql "$DATABASE_URL" -c "select extname, extversion from pg_extension where extname in ('postgis','pgcrypto');"
# → pgcrypto | 1.3
# → postgis  | 3.3.7

# Functional postgis check
psql "$DATABASE_URL" -c "select postgis_version();"
# → 3.3 USE_GEOS=1 USE_PROJ=1 USE_STATS=1
```

## What lives in this project (v1)

- One DB (`postgres`), schemas added incrementally by 0.4 (Drizzle baseline)
- All v1 organisations — UK + EU pilot
- Storage buckets deferred to v1.1 — do NOT create any yet
- Edge Functions: 0 (all server logic is in the Next.js app)

## What does NOT live here

- Source code → GitHub (`greenfield` repo)
- Deploys / serverless → Vercel
- Logs / alerts → Vercel + Slack (per infra revision Session 5; Logflare was archived)
- Background jobs → pg_cron (this DB) + Vercel Cron (per infra revision; BullMQ/Fly.io deferred)

## Handoff

When smoke passes, card 0.3 is done. Next:
- **0.4** — Drizzle schema baseline, run first migration against `DATABASE_URL_DIRECT`
- **0.5** — Supabase Auth wiring using `NEXT_PUBLIC_SUPABASE_ANON_KEY` + RLS policies

## Loading env into the shell

`.env` is gitignored. Two ways to make `pnpm db:migrate` /
`pnpm db:studio` see `DATABASE_URL_DIRECT`:

```bash
# 1. Inline (one-shot)
set -a; . ./.env; set +a
pnpm db:migrate

# 2. direnv (recommended once you re-run these often)
echo 'dotenv .env' > .envrc
direnv allow   # auto-loads .env on every cd
```

Both work. drizzle-kit's `dotenv/config` import in `drizzle.config.ts`
also loads `.env` automatically — `direnv` is optional, not required.