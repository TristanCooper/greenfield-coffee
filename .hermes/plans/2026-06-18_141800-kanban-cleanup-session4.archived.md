# Session 4 — kanban cleanup, worktree model, manual orchestration
> ⚠️ **ARCHIVED — SUPERSEDED**
>
> This doc described the pre-revision architecture (modular monolith on Vercel + Neon + Fly.io + Logflare + Grafana Cloud + S3 + Slack, 8-vendor stack, per-region routing, hash-chain audit, BullMQ worker).
> **Frozen at tag `freeze-pre-revision` (commit 0bc4200, 2026-06-18).**
> Replaced by `2026-06-18_153000-infra-revision-session5.md`. Do not implement from this doc.
>
> PRD scope (4 modules: Demand / Inventory / Money / Compliance, UK/EU, EUDR as pillar) is unchanged — see `2026-06-17_165800-coffee-ops-mvp-prd.md`.



**Date:** 2026-06-18
**Continues from:** Session 3 (`2026-06-17_191500-architecture-v1-session3.md`)

## What this session fixed

The previous kanban setup (Session 3) was running workers in **shared `dir:` mode** — multiple workers writing to `/home/tristan/Documents/Dev/Greenfield/code/` simultaneously with no worktree isolation, leading to clobbering risk on shared files (`package.json`, `pnpm-lock.yaml`, `packages/db/src/*`). The HERMES.md files contained `cd /home/tristan/...` instructions as a workaround.

This session **restored the hermes-canonical worktree model** and **made orchestration manual** so the founder controls the order in which cards run.

## What we did

### Step 1: salvaged real work, binned broken/orphan

Inspected the 3 feat/* branches:

- `feat/0.7-rbac` (ce27976, 6 files / 1238 lines) — **real, merged to main** ✓
- `feat/0.15-money-spine` (6c5b80f, 13 files / 1705 lines) — **real, merged to main** ✓
- `feat/0.17-admin-ui` (b3f7477) — **broken: 1219 lines BEHIND main (would re-delete 0.7 RBAC code)**. Deleted.
- `feat/0.22-postgis`, `feat/0.8-org-signup` — empty merges (workers wrote to shared dir, didn't push actual code). Deleted.
- `throwaway-0.22-extract` — leftover worktree, deleted.

Main ended at 7 commits ahead of origin (5 real work + 1 doc + 1 housekeeping).

### Step 2: stopped all 7 running/blocked workers

Reclaimed the 5 `running` cards (`t_124a2030`, `t_15da5db6`, `t_b5d49617`, `t_e1ebec5a`, `t_fff009ce`) and let the 2 `blocked` cards (`t_5f87c36f`, `t_65efd720`) end naturally.

### Step 3: archived all 24 greenfield cards

Started fresh — the old cards had the bad workspace model baked into their bodies and idempotency keys, and re-running create_phase0.py would just resolve to the old ones. The `kanban.db` was backed up to `kanban.db.bak-1781742609` before the archive.

### Step 4: rewrote `create_phase0.py`

The script now passes the proper hermes API:

```python
"--workspace", "worktree",       # worker gets isolated git worktree
"--branch", f"wt/{task['id']}",  # worker commits to its own branch
"--initial-status", "blocked",   # sticky-block; dispatcher's recompute_ready leaves it alone
"--idempotency-key", f"greenfield-phase0-{task['id']}",
```

The `--initial-status blocked` is the **manual-orchestration primitive**: `blocked` is a sticky block, the dispatcher's `recompute_ready` will NOT auto-promote it. Without this, parent-free `todo` cards get auto-promoted the moment they land, which defeats manual control.

### Step 5: rewrote both `HERMES.md` files

`/home/tristan/.hermes/HERMES.md` — slimmed to a router (canonical project root + tooling reminders). The old version told workers to `cd /home/tristan/Documents/Dev/Greenfield/code/`; the new version just says the dispatcher handles worktree creation.

`/home/tristan/Documents/Dev/Greenfield/code/HERMES.md` — **describe, not instruct**. The old version had a "What to do at task start" section with explicit `cd` commands. The new version just describes the project (architecture decisions, v1 scope, anti-scope) and lets the worktree mechanic do the rest.

### Step 6: wrote `promote.py`

`/home/tristan/Documents/Dev/Greenfield/.hermes/plans/promote.py` — manual orchestration helper:

```bash
# Show the queue: what's blocked (waiting on you), in flight, waiting on parents
python3 .hermes/plans/promote.py

# Unblock a specific card (start its worker)
python3 .hermes/plans/promote.py 0.5

# Block a card back (put it back in your queue)
python3 .hermes/plans/promote.py --block 0.5

# Show a card's details
python3 .hermes/plans/promote.py --show 0.7
```

Boundary-aware prefix matching: `0.1` matches the title `"[0.1] ..."` but NOT `"[0.11] ..."` or `"[0.16] ..."`.

### Step 7: re-seeded and verified

Re-ran `create_phase0.py` with the new model — 25 cards created, all in `blocked`. The dispatcher ignored them (correct). The end-to-end test of unblocking `0.1` and watching a worker spawn confirmed:

- worker spawned in `/home/tristan/.hermes/.worktrees/t_<id>/` (canonical hermes location)
- worker on `wt/0.1` branch
- worker correctly read the project HERMES.md, recognised the task was already done, and was about to produce a clean review handoff before the test was reclaimed

The auto-promote gotcha from the worker reference doc came into play: when a card is **archived** (not `done`), the dispatcher treats its parent slot as satisfied and promotes the child. After the test `0.1` was archived, `0.2` and `0.3` auto-promoted (they were also already done, so we archived them). Then `0.4`, `0.6`, `0.11` auto-promoted — these are real, undone work. They hit the **provider rate limit (HTTP 429)** and died. We blocked them, cleaned their orphan worktrees, deleted their empty branches, and now we sit at 22 cards in `blocked`, no running, no orphans.

## Final state

### Code

- `main` is clean, 8 commits ahead of `origin/main`
- Last 4 commits:
  - `037da18 docs: rewrite project HERMES.md — describe, not instruct (worktree model)`
  - `11fbb3c merge: feat(0.15) money spine — LandedCostEvent + PriceList RLS, cost cascade green→roast→pack→order`
  - `2ad7ea3 merge: feat(0.7) RBAC core + tRPC-shaped middleware + stub opt-out procedure`
  - `bc08f27 feat(0.5): monitoring stack — Logflare logs, Prometheus metrics, Slack alerts`
- Working tree clean
- 1 worktree: just `code/` on main

### Kanban board

- 22 cards, all in `blocked`
- 3 cards archived (0.1, 0.2, 0.3 — all already done on main)
- 0 cards in `ready` or `running`
- 0 in `done` (we archived the done cards because they were from the old model; new cards with idempotency keys won't re-create them)

### Files

- `~/.hermes/HERMES.md` — slim router, 822 bytes
- `code/HERMES.md` — describe, not instruct, 4.5KB
- `.hermes/plans/create_phase0.py` — worktree model + sticky-block
- `.hermes/plans/promote.py` — manual orchestration helper

### Safety

- `kanban.db.bak-1781742609` — pre-cleanup backup of the board DB
- All workers stopped, all orphan worktrees removed, all orphan branches deleted

## How the founder works from here

1. `python3 .hermes/plans/promote.py` — see the queue
2. pick a card from the `WAITING ON YOU` section (priority 1, no parents yet)
3. `python3 .hermes/plans/promote.py 0.X` — unblock it
4. dispatcher claims, worker spawns in `/home/tristan/.hermes/.worktrees/t_xxx/`, commits to `wt/0.X`
5. worker completes or blocks → on completion, children that are `todo` (not blocked) auto-promote
6. repeat

## What to flag for the next session

1. **Provider rate limit** — the 3 workers that died from HTTP 429 are blocked. Need to wait for the provider budget to recover before unblocking them. The kanban skill explicitly says: "If the user complains about token cost, **don't** tell them to run sequential. The right answer is to fix the prompt structure." This is the next thing to look at — the user prompt size for these workers, given they're 8,934 tokens of context already, is mostly the kanban-worker's auto-injected system prompt. Caching should help once the budget recovers.
2. **The worktree model works** — verified end-to-end. Workers spawn in canonical `/home/tristan/.hermes/.worktrees/`, commit to `wt/<id>`, see the project HERMES.md.
3. **Manual orchestration works** — `--initial-status blocked` is the right primitive. The dispatcher's `recompute_ready` respects sticky blocks; auto-promotion only happens for parent-free `todo` cards.
4. **Main has real Phase 0 work** — 0.5 monitoring, 0.7 RBAC, 0.15 money spine are committed and mergeable. The schema migrations, money package, monitoring instrumentation, and RBAC core are all on main.
5. **The remaining 22 cards represent the unfinished Phase 0** — when the budget recovers, the founder can unblock them one at a time and watch real work land.

## Open question

**Should we look at the user-prompt cost for workers?** The 8,934-token context was the *system prompt only* (KANBAN_GUIDANCE + project HERMES.md + user-level HERMES.md + kanban-worker skill). The user prompt is the card body. With 25 cards × ~9K tokens system prompt each, even with cache hits, we're paying 25 × ~9K = 225K tokens of cache-read on top of the input cost. Not catastrophic but worth tracking.

If the provider rate limit was tripped specifically by kanban activity, the fix is one or more of:
- bigger `cache_ttl` (currently 1h, could go to 24h)
- a smaller system prompt (the kanban-worker skill is ~10KB; we could trim it for solo-founder use)
- a project-level AGENTS.md that the kanban-worker skill auto-injects, but cheaper than HERMES.md (same content, lighter format)

No change made — this is a flag for the next session.
