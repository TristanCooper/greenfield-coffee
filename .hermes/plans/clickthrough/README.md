# Click-through Prototype — North London Coffee Co.

A self-contained HTML walkthrough of the v1 product for use in the **Week 3 prototype walkthrough** of the validation plan (PRD §13.2).

## What's inside

23 screens across 3 phases (revised for v1.2 to include the per-shipment opt-out path):

| Phase | Screens | What we're testing |
|---|---|---|
| 1 — Receive green | 1.1 → 1.3a → 1.8 (9 screens) | Whether the EUDR data model feels like bureaucracy or a natural part of receiving coffee. Specifically: does the warning-not-block at receipt work, and does the harder block at shipment time feel proportionate when the EU exposure actually appears? |
| 2 — Plan & run a roast | 2.1 → 2.5 (5 screens) | Whether the daily board reads as "what to do today". Whether the net-requirements view makes the system trustworthy as a planner. |
| 3 — Fulfil an order into the EU | 3.1 → 3.7 (11 screens, including the opt-out path 3.4a → 3.4b) | The DDS workflow, *and* the per-shipment opt-out path (PRD §6.5). This is the highest-stakes part of the product for the EUDR USP. |

Each screen has an **interviewer notes block** below it with specific questions to ask and a "what we're testing" framing.

## What's new in v1.2

The PRD was updated to v1.2 to add the per-shipment opt-out path (PRD §6.5). The click-through was updated to match:

- **Screen 1.3** changed from "blocked" to "warning" — the roaster can still receive a lot without a supplier risk assessment; the system explains what happens if it later goes to the EU
- **New screen 1.3a** — the block that surfaces at shipment time when the roaster skipped the supplier onboarding and the lot is now destined for an EU shipment
- **New screen 3.4a** — the per-shipment opt-out decision (friction path: reason, role, typed confirmation phrase)
- **New screen 3.4b** — the recorded opt-out with the signed audit pack summary
- **Cover TOC** updated to include the new screens and renumber 3.5 as "DDS draft (the standard path)" to make it clear there are two paths

The per-shipment opt-out is a deliberate product call (PRD §3 principle 11): EUDR is a per-shipment legal obligation, not an org-wide one. Org-wide opt-out is intentionally not in the product. The friction is the difference between "we have a record" and "we don't know this happened."

## How to use it

### Option A — solo walk-through (you, the founder, alone)

1. Open the file in any browser: `xdg-open index.html` (Linux) / `open index.html` (macOS) / `start index.html` (Windows). It's a single self-contained HTML file, no build step, no dependencies.
2. Scroll through at your own pace. Use the **TOC on the cover** to jump to any screen.
3. Use the **Previous / Next** nav at the bottom of each screen to walk sequentially.
4. Use the interviewer notes blocks as a self-test: imagine you're the roaster, and answer the questions out loud. Where do you hesitate? Where do you push back? That's where the design is going to need iteration.

### Option B — pilot interview (the real use)

1. **Send the file to the pilot roaster 24 hours in advance** with this message:

   > "Hi [name] — attached is a click-through walkthrough of the product I'm thinking of building. It's a wireframe, not a finished design. No code, no sign-up, just 20 screens. Please spend 15-20 minutes scrolling through it before our call. I'll record the call with your permission, and I'll ask you questions about each screen. If you can also write down 3 things that feel right and 3 things that feel wrong, that would be gold."

2. **On the call:**
   - Open the file in your browser, share your screen
   - Start at the cover, read the persona and region aloud so they know the context is realistic
   - Walk through the 18 core screens in order (1.1 → 3.5), with the roaster narrating their reactions
   - For each screen, ask the **interviewer notes questions** and capture the roaster's answer in your notes
   - The 2 extension screens (3.6, 3.7) are optional — only do them if time allows
3. **After the call:** transcribe the per-screen reactions into a single document, group by screen, look for patterns across the 5 roasters. This is the input to the **decision criteria in PRD §13.3**.

### Option C — asynchronous feedback (no call)

If the roaster can't do a call, send the file with this prompt:

> "Click through the screens in order. For each one, please reply with one of:
> - 👍 clear and useful as-is
> - 🤨 works but I have questions (please describe)
> - 👎 doesn't make sense for my business (please describe)
>
> 5-line answer per screen is plenty. You don't need to review all 20 — focus on the ones that provoke a reaction."

This gets you 60-70% of the value of a synchronous interview at 20% of the time cost.

## Print / annotate

The file is print-friendly. Each frame has a `break-inside: avoid` rule so screens don't split across pages. You can print and use a highlighter for the validation if you prefer paper.

## Editing the file

The file is plain HTML with inline CSS. To add a new screen:

1. Copy the entire `<!-- N.X ... --> <div class="frame" id="sNN"> ... </div> <div class="notes"> ... </div>` block of a similar existing screen
2. Rename the id to `sNN` (next number)
3. Update the step counter, the nav buttons, and the TOC link at the top
4. Add a new TOC `<li>` to the cover

To swap the persona (e.g. to "Berlin Spezialitätenrösterei" for a German pilot):

- Search for "North London Coffee Co." — replace with the new name
- Update the cover `meta` block (staff count, kg/mo, channels)
- Update the address, the supplier names, the customer destinations
- Update the VAT treatment, the customs docs, the EORI numbers

The persona text is centralised in the cover `<div class="meta">` and in each screen's app bar. Plan ~15 min per persona swap.

## Limitations

This is a wireframe, not a working product. What it does well:
- Tests whether each step is *comprehensible*
- Tests whether the EUDR data model is *proportionate* (i.e. does the roaster see it as "useful audit trail" or "bureaucratic theatre")
- Tests the *order* of steps (does the supplier risk gate make sense before the producer step, or after?)

What it does *not* test:
- Visual design (colours, typography, density) — none of that is the point
- Performance (it's static HTML, not the real product)
- Mobile/tablet layouts (the wireframe is desktop-only; the real product is responsive)
- Interactivity beyond navigation (no live state changes, no real form submission)

For the things it doesn't test, build the actual product and use it. This is for *before* the build.

## Related docs

- The product plan this implements: `../2026-06-17_165800-coffee-ops-mvp-prd.md` (PRD v1.1)
- The research this is based on: `../../deep-research-report(2)(1).md`
- The validation plan: PRD §13

## File info

- Path: `/.hermes/plans/clickthrough/index.html`
- Size: ~114 KB
- Self-contained: no external CSS/JS/fonts/images
- Works offline, prints cleanly, mobile-tolerant (responsive to ~768px; below that some tables scroll horizontally)
- Version: 1.2 (companion to PRD v1.2)
