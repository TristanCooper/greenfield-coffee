#!/usr/bin/env python3
"""
promote.py — Manual kanban orchestration helper.

The greenfield project uses manual orchestration. Cards are created in `blocked`
state (so the dispatcher doesn't auto-promote them to `ready` the moment they
land). The founder unblocks cards one at a time to start work; the dispatcher
then claims and runs them.

Usage:
    # List blocked cards (the queue the founder can pull from)
    python3 .hermes/plans/promote.py

    # Unblock a specific card (start its worker)
    python3 .hermes/plans/promote.py 0.5

    # Block a card back (if you change your mind)
    python3 .hermes/plans/promote.py --block 0.5

    # Show what a card needs (parents, current state, branch)
    python3 .hermes/plans/promote.py --show 0.7

Why blocked-and-unblock rather than just "promote from todo":
The dispatcher auto-promotes parent-free todo cards to `ready` on its next
tick. To keep the founder in control, we put new cards in `blocked` so the
dispatcher leaves them alone. Unblock = "go". Block = "wait".

State machine reminder:
  todo       — created, auto-promotes to `ready` if parents are done
  blocked    — held back, NOT eligible for dispatch, founder-controlled
  ready      — eligible for dispatch
  running    — worker has claimed the task
  done       — completed successfully
  archived   — removed from the active board (children auto-promote!)
"""

import argparse
import json
import re
import subprocess
import sys


def run(args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, **kwargs)


def get_kanban_list():
    result = run(["hermes", "kanban", "list", "--json"], cwd="/home/tristan/Documents/Dev/Greenfield")
    if result.returncode != 0:
        print(f"error: `hermes kanban list --json` failed: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    data = json.loads(result.stdout)
    if isinstance(data, list):
        return data
    return data.get("tasks", [])


def get_kanban_show(task_id):
    result = run(["hermes", "kanban", "show", task_id, "--json"], cwd="/home/tristan/Documents/Dev/Greenfield")
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def resolve_id(needle, tasks):
    """Resolve a short id, prefix, or full id to a real task id.

    `0.1` → matches the task whose title is "[0.1] ..."
             (boundary-aware: doesn't match "[0.11]" or "[0.16]")
    `0.5-monitoring` → matches the task whose title starts with that
    `t_abc123` → exact match
    """
    needle = needle.strip()

    # Exact id
    for t in tasks:
        if t["id"] == needle:
            return t["id"]

    # Title prefix — boundary-aware so "0.1" doesn't match "0.11"
    needle_lc = needle.lower()
    candidates_exact = []
    candidates_partial = []
    for t in tasks:
        title = t.get("title", "")
        title_lc = title.lower()
        # Title looks like "[0.1] Foo bar". We want a prefix-match on
        # "[0.1" or "[0.1]" but NOT "[0.11" or "[0.10".
        if title.startswith(f"[{needle_lc}") and (
            len(title) == len(f"[{needle_lc}")
            or title[len(f"[{needle_lc}")] in ("]", " ", "-", "_")
        ):
            candidates_exact.append(t["id"])
        elif needle_lc in title_lc:
            candidates_partial.append(t["id"])

    if len(candidates_exact) == 1:
        return candidates_exact[0]
    if len(candidates_exact) > 1:
        print(f"error: '{needle}' matches multiple tasks: {candidates_exact}", file=sys.stderr)
        print("       use a more specific prefix or the full id", file=sys.stderr)
        sys.exit(1)
    if len(candidates_partial) == 1:
        return candidates_partial[0]
    if len(candidates_partial) > 1:
        print(f"error: '{needle}' matches multiple tasks: {candidates_partial}", file=sys.stderr)
        print("       use a more specific prefix or the full id", file=sys.stderr)
        sys.exit(1)
    print(f"error: no task matches '{needle}'", file=sys.stderr)
    sys.exit(1)


def show_card(task_id):
    task = get_kanban_show(task_id)
    if not task:
        print(f"error: could not fetch task {task_id}", file=sys.stderr)
        sys.exit(1)

    print(f"id:        {task.get('id', '?')}")
    print(f"title:     {task.get('title', '?')}")
    print(f"status:    {task.get('status', '?')}")
    print(f"assignee:  {task.get('assignee', '?')}")
    print(f"priority:  {task.get('priority', '?')}")
    if task.get("branch"):
        print(f"branch:    {task['branch']}")
    if task.get("workspace"):
        print(f"workspace: {task['workspace']}")
    parents = task.get("parents", [])
    if parents:
        print(f"parents:   {', '.join(parents)}")
    else:
        print("parents:   (none — root task)")


def list_queue(tasks):
    """Print the founder's queue: blocked cards (waiting on you) + ready/running (in flight)."""
    by_id = {t["id"]: t for t in tasks}

    blocked = [t for t in tasks if t.get("status") == "blocked"]
    in_flight = [t for t in tasks if t.get("status") in ("ready", "running")]
    todo = [t for t in tasks if t.get("status") == "todo"]
    done = [t for t in tasks if t.get("status") == "done"]

    print(f"\n=== WAITING ON YOU — blocked cards ({len(blocked)}) — unblock to start ===\n")
    if not blocked:
        print("  (none)")
    else:
        blocked.sort(key=lambda t: (t.get("priority", 99), t.get("title", "")))
        for t in blocked:
            pri = t.get("priority", "?")
            title = t.get("title", "?")
            tid = t["id"]
            parents = t.get("parents", [])
            parent_note = ""
            if parents:
                parent_note = f"  (parents: {', '.join(parents)})"
            print(f"  [{pri}] {tid}  {title}{parent_note}")
    print()
    print(f"=== IN FLIGHT — ready or running ({len(in_flight)}) ===\n")
    if not in_flight:
        print("  (none)")
    else:
        for t in in_flight:
            print(f"  {t.get('status'):7s} {t['id']}  {t.get('title', '?')}")
    print()
    print(f"=== WAITING ON PARENTS — todo ({len(todo)}) — auto-promotes when parents done ===\n")
    for t in todo:
        parents = t.get("parents", [])
        if parents:
            print(f"  {t['id']}  {t.get('title', '?')}")
            print(f"           waiting on: {', '.join(parents)}")
    if done:
        print(f"\n=== DONE ({len(done)}) ===\n")
        for t in done:
            print(f"  ✓ {t['id']}  {t.get('title', '?')}")
    print()


def unblock(task_id):
    """Unblock a card — it's then promoted to ready (if parents done) and the dispatcher picks it up."""
    task = get_kanban_show(task_id)
    if not task:
        print(f"error: could not fetch task {task_id}", file=sys.stderr)
        sys.exit(1)

    current = task.get("status")
    if current == "ready":
        print(f"  {task_id} is already in `ready` — the dispatcher will pick it up")
        return
    if current == "running":
        print(f"  {task_id} is already `running` — a worker has claimed it")
        return
    if current in ("done", "archived"):
        print(f"  {task_id} is `{current}` — refusing to unblock", file=sys.stderr)
        sys.exit(1)
    if current != "blocked":
        print(f"  {task_id} is `{current}` (not blocked) — unblock not applicable", file=sys.stderr)
        sys.exit(1)

    result = run(
        ["hermes", "kanban", "unblock", task_id, "--reason", "manual: founder started this"],
        cwd="/home/tristan/Documents/Dev/Greenfield",
    )
    if result.returncode != 0:
        print(f"  ✗ failed: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    print(f"  ✓ {task_id} unblocked → ready (dispatcher will pick it up)")
    print(f"    branch: {task.get('branch', '?')}")
    print(f"    workspace: {task.get('workspace', '?')}")


def block(task_id, reason):
    """Block a card — keeps it in `blocked` so the dispatcher leaves it alone."""
    task = get_kanban_show(task_id)
    if not task:
        print(f"error: could not fetch task {task_id}", file=sys.stderr)
        sys.exit(1)

    current = task.get("status")
    if current == "blocked":
        print(f"  {task_id} is already in `blocked`")
        return
    if current in ("running", "done", "archived"):
        print(f"  {task_id} is `{current}` — refusing to block (reclaim first if running)", file=sys.stderr)
        sys.exit(1)

    result = run(
        ["hermes", "kanban", "block", task_id, reason],
        cwd="/home/tristan/Documents/Dev/Greenfield",
    )
    if result.returncode != 0:
        print(f"  ✗ failed: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    print(f"  ✓ {task_id} blocked: {reason}")


def main():
    parser = argparse.ArgumentParser(
        description="Manual kanban orchestration for the greenfield project. Cards start in `blocked`; unblock to start them.",
    )
    parser.add_argument(
        "target",
        nargs="?",
        help="task id, short id (e.g. 0.5), or title prefix. omit to list the queue.",
    )
    parser.add_argument(
        "--show",
        action="store_true",
        help="show what a card needs (parents, branch, state) instead of unblocking it",
    )
    parser.add_argument(
        "--block",
        action="store_true",
        help="block a card back (put it back in the founder's queue)",
    )
    parser.add_argument(
        "--reason",
        default="manual: founder held this back",
        help="reason for blocking (only used with --block)",
    )
    args = parser.parse_args()

    tasks = get_kanban_list()
    if not tasks:
        print("board is empty — run `python3 .hermes/plans/create_phase0.py` first")
        return

    if not args.target:
        list_queue(tasks)
        return

    task_id = resolve_id(args.target, tasks)

    if args.show:
        show_card(task_id)
    elif args.block:
        block(task_id, args.reason)
    else:
        unblock(task_id)


if __name__ == "__main__":
    main()
