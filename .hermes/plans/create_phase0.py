#!/usr/bin/env python3
"""
create_phase0.py — Create Phase 0 tasks on the greenfield Hermes Kanban board.

This is the canonical entry point for seeding the Phase 0 backlog from
the Session 3 architecture doc. Re-running this script is safe:
- New tasks are created with --idempotency-key greenfield-phase0-<id>,
  so a re-run resolves to the existing card (no duplicates).
- Parent links are wired via the topological sort, so the critical path
  is preserved across re-runs.

Wiring model (manual orchestration):
- Every card is created with `--workspace worktree` and `--branch wt/<id>`,
  so each worker lands in an isolated git worktree at a sibling path
  (`<repo>/.worktrees/wt.<id>/`) and commits to a `wt/<id>` branch.
  The dispatcher handles worktree creation and teardown.
- Every card is created with `--initial-status blocked`, NOT the default `todo`.
  This is the manual-orchestration primitive: `blocked` is a sticky-block
  that the dispatcher's `recompute_ready` will NOT auto-promote. The
  founder unblocks cards one at a time via
  `.hermes/plans/promote.py 0.5` (or `hermes kanban unblock <id>`).
  Unblocking transitions a card to `ready` (if parents are done) and the
  dispatcher picks it up.
- Why this and not "just stay in todo": the dispatcher's `recompute_ready`
  auto-promotes parent-free `todo` cards to `ready` on every tick. Only
  `blocked` (sticky) is safe from auto-promotion.
- Parent links are kept so the founder can see the dependency graph
  and choose what to unblock next.

If you want to start over (e.g. the board got polluted), archive everything
first and then re-run:

    python3 -c "
    import subprocess, json
    data = json.loads(subprocess.run(['hermes','kanban','list','--json'], capture_output=True, text=True).stdout)
    tasks = data if isinstance(data, list) else data.get('tasks', [])
    for t in tasks:
        if t['status'] == 'running':
            subprocess.run(['hermes','kanban','reclaim', t['id']], capture_output=True)
        subprocess.run(['hermes','kanban','archive', t['id']], capture_output=True)
    print(f'archived {len(tasks)} tasks')
    "

    python3 .hermes/plans/create_phase0.py

Source: .hermes/plans/2026-06-17_191500-architecture-v1-session3.md §1.
"""

import json
import subprocess
import sys
import time

# Priority guide:
# 1 = critical path, unblocks everything (do first)
# 2 = critical path, downstream of priority-1 (do after parents)
# 3 = parallel workstream, high value
# 4 = parallel workstream, lower priority
# 5 = hygiene / docs / polish

# Tasks in dependency order. Each entry:
#   (id, title, size, dependencies, body, priority)
TASKS = [
    # =========================================================================
    # Workstream 0.1: Repo and CI/CD
    # =========================================================================
    {
        "id": "0.1",
        "title": "Initialize monorepo: Next.js 15 + TS strict + ESLint + Prettier",
        "size": "S (1 day)",
        "parents": [],
        "priority": 1,
        "acceptance": "`pnpm dev` starts the app; `pnpm build` succeeds; lint runs clean; strict TypeScript mode is on; the /src/server and /src/client split is in place.",
        "links": ["Session 3 §1.1", "Session 1 §5.1 (repo layout)"],
    },
    {
        "id": "0.2",
        "title": "Set up GitHub Actions: lint + typecheck + test on every PR",
        "size": "S (1 day)",
        "parents": ["0.1"],
        "priority": 3,
        "acceptance": "PR shows green checks; merge to main triggers a Vercel preview deploy; the workflow file is committed at .github/workflows/ci.yml.",
        "links": ["Session 3 §1.1"],
    },
    {
        "id": "0.3",
        "title": "Set up Drizzle with empty schema + first migration + local Postgres in Docker",
        "size": "S (1 day)",
        "parents": ["0.1"],
        "priority": 1,
        "acceptance": "`pnpm db:migrate` runs cleanly; `pnpm db:studio` opens Drizzle Studio against local; a docker-compose.yml for Postgres is committed; the empty drizzle.config.ts is in place.",
        "links": ["Session 3 §1.3", "Session 1 §2.3"],
    },
    {
        "id": "0.4",
        "title": "Set up deployment pipeline: Vercel (app) + Fly.io (worker) + Neon (database)",
        "size": "M (2-3 days)",
        "parents": ["0.1", "0.3"],
        "priority": 2,
        "acceptance": "A 'hello world' worker is deployable to Fly.io; a 'hello world' Next.js app is deployable to Vercel; the production Neon database exists; environment variables are documented in .env.example.",
        "links": ["Session 3 §1.1", "Session 1 §4"],
    },
    {
        "id": "0.5",
        "title": "Set up monitoring stack: Logflare for logs, Grafana for metrics, Slack for alerts",
        "size": "S (1 day)",
        "parents": ["0.4"],
        "priority": 3,
        "acceptance": "Logs flow from the Next.js app to Logflare; a test alert pages the founder's Slack; a basic Grafana dashboard is provisioned.",
        "links": ["Session 3 §1.1", "Session 1 §6"],
    },

    # =========================================================================
    # Workstream 0.2: Auth and tenancy
    # =========================================================================
    {
        "id": "0.6",
        "title": "Email + magic link auth (Lucia or Auth.js, JWT in httpOnly cookie)",
        "size": "M (2-3 days)",
        "parents": ["0.1", "0.3"],
        "priority": 1,
        "acceptance": "A new user can sign up, receive a magic link, click it, and land in the app. JWT is set in an httpOnly cookie. Rate-limited (10 req/sec per IP).",
        "links": ["Session 3 §1.2", "Session 1 §7.1"],
    },
    {
        "id": "0.7",
        "title": "RBAC: roles per PRD §5.1, role on JWT, checked in tRPC middleware",
        "size": "M (2-3 days)",
        "parents": ["0.6"],
        "priority": 2,
        "acceptance": "A readonly user attempting a write gets a 403. A packer user attempting the opt-out procedure gets a 403. Tests cover all 7 roles and all PRD-listed role-restricted actions.",
        "links": ["Session 3 §1.2", "PRD §5.1"],
    },
    {
        "id": "0.8",
        "title": "Organization entity + signup flow: create org with base_currency + data_residency + region + eudr_settings",
        "size": "L (4-5 days)",
        "parents": ["0.6", "0.3"],
        "priority": 1,
        "acceptance": "A new user creates an org in Frankfurt with EUR base; the org row exists with all PRD-mandated fields; the user is the owner role. Signup enforces base_currency in {EUR, GBP} and data_residency in {uk, eu}.",
        "links": ["Session 3 §1.2", "Session 1 §3.2 (multi-tenancy)", "Session 2 §10 (eudr_settings)"],
    },
    {
        "id": "0.9",
        "title": "RLS policies on every per-org table; tenant context from JWT",
        "size": "L (4-5 days)",
        "parents": ["0.3", "0.6", "0.8"],
        "priority": 2,
        "acceptance": "A query for org A's data while the JWT is for org B returns zero rows. Test cases cover Organization, User, Membership, Sku, PriceList, Packaging, Recipe, GreenLot, RoastBatch, RoastedLot, PackagedLot, StockMovement, EudrReferenceData, DdsDraft, AuditPack, AuditEvent. ES Lint rule enforces withTenantContext() at every procedure call.",
        "links": ["Session 3 §1.2", "Session 1 §3.2"],
    },
    {
        "id": "0.10",
        "title": "Per-region routing: UK orgs → UK DB + UK S3; EU orgs → EU DB + EU S3",
        "size": "L (4-5 days)",
        "parents": ["0.4", "0.8"],
        "priority": 2,
        "acceptance": "A request from a UK-org user is served by the UK Postgres + UK S3; a request from an EU-org user is served by the EU Postgres + EU S3. Application reads org.data_residency at request time. Test cases cover both regions, including the cross-region read-block (cross-region is blocked at the app layer).",
        "links": ["Session 3 §1.2", "Session 1 §4.3 (region strategy)"],
    },

    # =========================================================================
    # Workstream 0.3: Schema (the data spine)
    # =========================================================================
    {
        "id": "0.11",
        "title": "Drizzle schema: operational entities (Organization, User, Membership, Sku, PriceList, PriceListEntry, Packaging, Recipe, LandedCostEvent, Order, OrderLine)",
        "size": "L (4-5 days)",
        "parents": ["0.3"],
        "priority": 1,
        "acceptance": "All tables exist; migrations apply; RLS policies attached; CRUD procedures in tRPC for each entity. Migrations are committed to /src/server/db/migrations/.",
        "links": ["Session 3 §1.3", "PRD §5.1"],
    },
    {
        "id": "0.12",
        "title": "Drizzle schema: lot entities (GreenLot, RoastBatch, RoastedLot, PackagedLot, StockMovement) with hash chain trigger",
        "size": "L (4-5 days)",
        "parents": ["0.11", "0.14"],
        "priority": 2,
        "acceptance": "All tables exist; the StockMovement hash chain trigger is in place (Session 2 §2.3); inserting a StockMovement row computes prev_hash and hash_chain_self automatically.",
        "links": ["Session 3 §1.3", "Session 2 §2.3", "PRD §5.1, §5.4"],
    },
    {
        "id": "0.13",
        "title": "Drizzle schema: compliance entities (Supplier, Producer, EudrReferenceData, LotProducer, DdsDraft, ShipmentEudrDecision, AuditPack) + PostGIS + eudr.country_risk",
        "size": "L (4-5 days)",
        "parents": ["0.11", "0.22"],
        "priority": 3,
        "acceptance": "All tables exist; PostGIS extension is enabled; the eudr.country_risk schema and table are in place; the high-risk check query (Session 2 §1.3) is tested. geography(MultiPolygon, 4326) on Producer.geolocation; area_computed_hectares as a generated column.",
        "links": ["Session 3 §1.3, §1.5", "Session 2 §1", "PRD §5.6"],
    },
    {
        "id": "0.14",
        "title": "audit_event table with hash chain trigger (BEFORE INSERT, pgcrypto, per-org chain)",
        "size": "M (2-3 days)",
        "parents": ["0.11"],
        "priority": 2,
        "acceptance": "Inserting an audit_event row computes prev_hash and hash_chain_self automatically via the Session 2 §2.3 trigger. The chain validates (Session 2 §2.5 test). 100% of state-changing procedures write an audit_event.",
        "links": ["Session 3 §1.3", "Session 2 §2.3", "PRD §7.2"],
    },
    {
        "id": "0.15",
        "title": "Money spine: LandedCostEvent with VAT tracking; PriceList with VAT-inclusive/ex-VAT modes",
        "size": "M (2-3 days)",
        "parents": ["0.11"],
        "priority": 3,
        "acceptance": "A landed cost event is recorded with VAT recoverable flag. Cost cascade computes correctly: green lot → roast → pack → order. The cost-snapshot-at-roast-time behaviour is in place (Session 2 / PRD §5.8).",
        "links": ["Session 3 §1.3", "PRD §5.8, §5.10"],
    },
    {
        "id": "0.16",
        "title": "Seed data: dev:seed script with one org, SKUs, supplier, producer, green lots, roast, pack, order",
        "size": "S (1 day)",
        "parents": ["0.11", "0.12", "0.13", "0.14", "0.15"],
        "priority": 4,
        "acceptance": "`pnpm dev:seed` populates a usable dev org; the smoke test passes against it. The seed produces a realistic UK roastery with 5-10 SKUs, 3 green lots, 1 roast batch, 1 packaged lot, 2 orders.",
        "links": ["Session 3 §1.3, §1.6"],
    },

    # =========================================================================
    # Workstream 0.4: Admin UI and daily board v0
    # =========================================================================
    {
        "id": "0.17",
        "title": "Admin UI for SKUs, customers, suppliers, packagings, recipes, price lists (read + write)",
        "size": "M (2-3 days)",
        "parents": ["0.11"],
        "priority": 3,
        "acceptance": "Each entity has a list view and an edit form; changes are persisted; form validation is shared between client and server via Zod. Keyboard navigation works on the list views.",
        "links": ["Session 3 §1.4"],
    },
    {
        "id": "0.18",
        "title": "Admin UI: manual green receiving flow (supplier, producer, geolocation, lot details, costs, risk review)",
        "size": "XL (1-2 weeks)",
        "parents": ["0.11", "0.12", "0.13"],
        "priority": 3,
        "acceptance": "A roaster can complete a full receive flow end-to-end in the admin UI. This maps to click-through screens 1.1-1.8. The map view shows the producer geolocation polygon. Landed cost entry supports multi-event capture with VAT tracking.",
        "links": ["Session 3 §1.4", "Click-through screens 1.1-1.8"],
    },
    {
        "id": "0.19",
        "title": "Daily board v0: read-only screen, computed nightly",
        "size": "M (2-3 days)",
        "parents": ["0.11", "0.12"],
        "priority": 4,
        "acceptance": "The board shows today's open orders, planned roasts, and recent stock movements. The read flow is end-to-end. The KPI strip reflects the current state. This is the offline-computed version (1.10 promotes it to event-driven).",
        "links": ["Session 3 §1.4", "Click-through screen 2.1"],
    },
    {
        "id": "0.20",
        "title": "Manual pack + sell: form-based pack event and sell event (no scan workflow yet)",
        "size": "M (2-3 days)",
        "parents": ["0.11", "0.12"],
        "priority": 4,
        "acceptance": "A roaster can pack 1 bag (loose roasted → packaged) and sell 1 bag (allocation + stock movement). The StockMovement ledger has the entries. VAT-aware allocation. No barcode/scan yet (1.12 adds it).",
        "links": ["Session 3 §1.4", "Click-through screen 3.2"],
    },
    {
        "id": "0.21",
        "title": "Compliance-aware green receiving: warning at receipt, block at EU shipment (M4 step 1)",
        "size": "M (2-3 days)",
        "parents": ["0.13", "0.18"],
        "priority": 4,
        "acceptance": "A received lot with no risk assessment can be UK-UK sold. An attempt to send it to the EU produces a 'needs attention' flag (the full block is in Phase 1 task 1.13). The 1.3 (warning) and 1.3a (block at shipment) click-through screens are implemented.",
        "links": ["Session 3 §1.4", "Click-through screens 1.3, 1.3a"],
    },

    # =========================================================================
    # Workstream 0.5: PostGIS, country-risk, validation
    # =========================================================================
    {
        "id": "0.22",
        "title": "PostGIS extension on production Postgres; eudr.country_risk table + view; seed from EU's published list",
        "size": "M (2-3 days)",
        "parents": ["0.4"],
        "priority": 2,
        "acceptance": "PostGIS extension is active on the production database; the country-risk view returns rows; the high-risk check returns the right countries. Seed data matches the EU's Q2 2026 country-risk benchmarking. Decide: Neon vs Supabase based on PostGIS availability (Session 2 §10 confirmed).",
        "links": ["Session 3 §1.5", "Session 2 §1.1"],
    },
    {
        "id": "0.23",
        "title": "Test suite for high-risk check and area-validation check (Session 2 §1.3, §1.4)",
        "size": "S (1 day)",
        "parents": ["0.22"],
        "priority": 3,
        "acceptance": "`pnpm test:int eudr-validation` passes. 100% line coverage on the high-risk check and area-validation paths. The tests cover: well-formed polygon, malformed polygon, area delta > 20%, country in high-risk list, country not in list, country list empty.",
        "links": ["Session 3 §1.5", "Session 2 §1.3, §1.4"],
    },

    # =========================================================================
    # Workstream 0.6: Phase 0 exit criteria
    # =========================================================================
    {
        "id": "0.24",
        "title": "Smoke test: end-to-end script (create org → receive green lot → log roast → pack bag → sell bag)",
        "size": "S (1 day)",
        "parents": ["0.16", "0.20"],
        "priority": 4,
        "acceptance": "`pnpm test:e2e smoke` passes against the dev environment. The test asserts the genealogy is intact at every step (green lot → roast batch → roasted lot → packaged lot → order line).",
        "links": ["Session 3 §1.6"],
    },
    {
        "id": "0.25",
        "title": "Hash chain validation worker: nightly 03:00 UTC, validates every org's chain, pages on mismatch",
        "size": "S (1 day)",
        "parents": ["0.14", "0.5"],
        "priority": 4,
        "acceptance": "A test that breaks a hash in the chain produces a Slack alert. Worker is registered at /src/server/workers/handlers/chain-validation.ts. The cron is registered at worker boot. Manual trigger works for debugging.",
        "links": ["Session 3 §1.6", "Session 2 §2.5"],
    },
]


def build_body(task):
    """Build the card body from the task spec.

    Note: workspace, branch, and worktree-path are not in the body —
    they're passed as CLI flags so the dispatcher does the right thing
    without the worker needing to read the body for path instructions.
    """
    lines = []
    lines.append(f"**Size:** {task['size']}")
    lines.append(f"**Priority:** {task['priority']} (1 = critical path, 5 = hygiene)")
    lines.append(f"**Phase:** 0 — Foundations")
    lines.append("")
    lines.append("**Acceptance criteria:**")
    lines.append(task['acceptance'])
    lines.append("")
    if task.get('links'):
        lines.append("**References:**")
        for link in task['links']:
            lines.append(f"- {link}")
        lines.append("")
    lines.append("**Source:** `.hermes/plans/2026-06-17_191500-architecture-v1-session3.md` §1 (Phase 0 — Foundations)")
    lines.append("")
    lines.append("**Workspace:** worktree (handled by the dispatcher)")
    lines.append("**Branch:** wt/" + task['id'])
    lines.append("")
    lines.append("**Manual orchestration:**")
    lines.append("This card starts in `todo`. It will NOT auto-promote to `ready`.")
    lines.append("The founder promotes cards to `ready` via `.hermes/plans/promote.py`.")
    return "\n".join(lines)


def topological_sort(tasks):
    """Return tasks in dependency order (parents before children).
    Stable for tasks with no inter-dependencies (preserves the input order)."""
    by_id = {t['id']: t for t in tasks}
    in_degree = {t['id']: len(t['parents']) for t in tasks}
    children = {t['id']: [] for t in tasks}
    for t in tasks:
        for p in t['parents']:
            children[p].append(t['id'])

    # Kahn's algorithm with input-order tiebreak
    sorted_ids = []
    available = [t['id'] for t in tasks if not t['parents']]
    seen = set(available)

    while available:
        current = available.pop(0)
        sorted_ids.append(current)
        for child in children[current]:
            in_degree[child] -= 1
            if in_degree[child] == 0 and child not in seen:
                available.append(child)
                seen.add(child)

    if len(sorted_ids) != len(tasks):
        missing = set(by_id.keys()) - set(sorted_ids)
        raise ValueError(f"Cycle in task dependencies; could not order: {missing}")

    return [by_id[tid] for tid in sorted_ids]


def main():
    print(f"Creating {len(TASKS)} Phase 0 tasks on the greenfield board...")
    print()

    tasks = topological_sort(TASKS)

    no_parent_count = sum(1 for t in tasks if not t['parents'])
    with_parents_count = len(tasks) - no_parent_count
    print(f"  {no_parent_count} tasks have no parents (will land in 'blocked', founder unblocks to start)")
    print(f"  {with_parents_count} tasks have parents (will land in 'blocked', founder unblocks to start)")
    print()
    print(f"  All tasks use --workspace worktree --branch wt/<id> for isolated branches.")
    print(f"  All tasks use --initial-status blocked so the dispatcher leaves them alone.")
    print()

    created = {}

    for task in tasks:
        parent_ids = [created[p] for p in task['parents']] if task['parents'] else None
        cmd = [
            "hermes", "kanban", "create",
            f"[{task['id']}] {task['title']}",
            "--body", build_body(task),
            "--assignee", "default",
            "--priority", str(task['priority']),
            "--workspace", "worktree",
            "--branch", f"wt/{task['id']}",
            "--initial-status", "blocked",  # manual orchestration: dispatcher's recompute_ready leaves sticky-blocked tasks alone
            "--idempotency-key", f"greenfield-phase0-{task['id']}",
        ]
        if parent_ids:
            for pid in parent_ids:
                cmd.extend(["--parent", pid])

        result = subprocess.run(cmd, capture_output=True, text=True, cwd="/home/tristan/Documents/Dev/Greenfield")
        if result.returncode != 0:
            print(f"  ✗ [{task['id']}] FAILED: {result.stderr.strip()}")
            sys.exit(1)

        output = result.stdout.strip()
        import re
        m = re.search(r"\b(t_[a-f0-9]+)\b", output)
        if not m:
            print(f"  ✗ [{task['id']}] could not parse task id from: {output!r}")
            sys.exit(1)
        created[task['id']] = m.group(1)
        is_new = "Created task" in output
        marker = "✓" if is_new else "↻"
        verb = "new" if is_new else "idempotent"
        print(f"  {marker} [{task['id']}] {verb:9s} → {m.group(1)}  {task['title'][:55]}")

    print(f"Done. {len(created)} tasks on the greenfield board, all in `blocked` state.")
    print()
    print("Next:")
    ready_immediately = [t['id'] for t in tasks if not t['parents']]
    print(f"  - All {len(created)} tasks are in `blocked` (NOT `ready` — the dispatcher leaves blocked alone).")
    print(f"  - {len(ready_immediately)} have no parents and could be unblocked first: {ready_immediately}")
    print(f"  - The founder unblocks via: python3 .hermes/plans/promote.py <id>")
    print(f"  - Or block one back via:    python3 .hermes/plans/promote.py --block <id>")
    print(f"  - View the board: `hermes kanban list`")


if __name__ == "__main__":
    main()
