<!--
Greenfield PR template — keep PRs short and decision-focused.

Links the PR back to the plan section that motivated the change so
reviewers can verify the implementation matches the spec.
-->

## Plan reference

Which plan section does this implement? (e.g. `plan §4.2 — batch tracking`)

## What

One to three bullets. What changed and why.

## How to verify

Steps a reviewer can run locally (`pnpm install --frozen-lockfile`, `pnpm test`, `pnpm build`, etc.).

## Checklist

- [ ] `pnpm install --frozen-lockfile` runs clean
- [ ] `pnpm lint` clean
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green
- [ ] `pnpm build` green
- [ ] No secrets, no `.env*` files, no `node_modules`
