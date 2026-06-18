# Greenfield

UK/EU coffee-roastery operations platform — modular monolith on Next.js 15
+ Supabase (eu-west-2) + Slack + GitHub. See
`.hermes/plans/2026-06-18_225000-consolidated-v1-plan.md` for the source of
truth (PRD v1.2 + infra Session 5 decisions baked in).

## Layout

```
apps/
  web/          # Next.js 15 App Router — the one deployable
packages/
  db/           # @greenfield/db  — Drizzle schema, Supabase client (card 0.3/0.4)
  money/        # @greenfield/money — ISO 4217 minor units, FX snapshot, landed cost (M3)
```

## Quick start

```bash
pnpm install
pnpm dev      # http://localhost:3000
```

## Scripts (root)

| Script | What it does |
| --- | --- |
| `pnpm dev` | Run `apps/web` dev server |
| `pnpm build` | Build every workspace package + the Next.js app |
| `pnpm lint` | ESLint flat config over the whole tree |
| `pnpm typecheck` | `tsc --noEmit` in every workspace package |
| `pnpm test` | Run Vitest once (workspace-wide) |
| `pnpm format` | Prettier write |
| `pnpm format:check` | Prettier check (CI use) |

## Requirements

- Node 20 LTS (see `.nvmrc`)
- pnpm 11 (see `packageManager` in root `package.json`)
