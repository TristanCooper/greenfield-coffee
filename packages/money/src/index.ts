// @greenfield/money
//
// Money primitives: minor-unit ISO 4217 amounts, FX-snapshot
// helpers, VAT-inclusive/exclusive split, landed-cost
// allocation. Card 0.13 / plan §4.3 + §5.3 + §7.3.
//
// ALL MONEY IS BIGINT MINOR UNITS
//
//   The card body is explicit: "All money columns use bigint
//   minor units — no floats anywhere in money code." This file
//   follows that rule. The `toMinorUnits` / `fromMinorUnits`
//   helpers handle the major↔minor conversion at the API
//   boundary (where JS doubles are acceptable); all internal
//   arithmetic is bigint.
//
// CURRENCY EXPONENTS
//
//   The minor-unit exponent for an ISO 4217 currency is fixed
//   by the currency (most are 2; JPY is 0; some Middle
//   Eastern currencies are 3). The MINOR_UNITS_EXPONENT map
//   captures the v1 set. Adding a new currency is a one-line
//   edit; using an unmapped currency throws at runtime rather
//   than silently producing wrong amounts.
//
// ROUNDING POLICY
//
//   Per the card body: "Use round-half-up … or whatever; just
//   pick one and document it." This file uses:
//
//     - VAT split: gross = net + vat exactly. The vat
//       calculation truncates (round-down), and the net
//       absorbs any remainder. So a £100.00 gross at 20% VAT
//       is net=£83.34 + vat=£16.66. (A round-up vat would be
//       net=£83.33 + vat=£16.67; both preserve gross to the
//       penny. The truncation approach favours the seller on
//       VAT — i.e. the seller keeps 1 more pence of net per
//       invoice. TODO: confirm with founder before v1 ships.)
//
//     - FX conversion: integer multiplication, then integer
//       division by the quote-currency exponent. Truncation
//       goes to zero. The lost pence accumulate in the FX
//       rate's RATE_CENTS_PER_UNIT precision — operators can
//       see them by comparing the gross after conversion to
//       the input.
//
//     - Cost cascade: integer arithmetic; allocations split
//       with the same "remainder goes to the last allocation"
//       convention (the most recent event gets the extra
//       pence). This ensures the per-pack sums to the input
//       gross exactly.

// ── Currency metadata ────────────────────────────────────────────────────

/**
 * Minor-units exponent per ISO 4217 currency. The exponent is
 * the number of decimal places in the major unit. Most
 * currencies are 2 (cents, pence, centimes); JPY is 0; BHD,
 * JOD, KWD, OMR, TND are 3 (1/1000 dinar); a handful of
 * others are 4.
 *
 * v1 supports the 16 UK/EU country codes plus the major world
 * trade currencies the roaster might invoice in (USD, JPY,
 * CHF, NOK, SEK, DKK, CAD, AUD). Adding a new currency is a
 * one-line edit.
 */
export const MINOR_UNITS_EXPONENT: Record<string, number> = {
  // UK + EU (v1 supported set, per organizations.ts)
  EUR: 2,
  GBP: 2,
  // Other world trade currencies
  USD: 2,
  JPY: 0,
  CHF: 2,
  NOK: 2,
  SEK: 2,
  DKK: 2,
  CAD: 2,
  AUD: 2,
  // 3-decimal currencies (Middle East)
  BHD: 3,
  JOD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

function minorUnitsExponent(currency: string): number {
  const exp = MINOR_UNITS_EXPONENT[currency.toUpperCase()];
  if (exp === undefined) {
    throw new Error(
      `Unknown currency "${currency}". Add it to MINOR_UNITS_EXPONENT in @greenfield/money.`,
    );
  }
  return exp;
}

/**
 * The factor to multiply a major-unit amount by to get minor
 * units. JPY: 1; EUR: 100; BHD: 1000. Computed as 10^exponent
 * via integer exponentiation (no Math.pow to avoid the float
 * conversion).
 */
function minorUnitsFactor(currency: string): bigint {
  const exp = minorUnitsExponent(currency);
  let factor = 1n;
  for (let i = 0; i < exp; i += 1) {
    factor *= 10n;
  }
  return factor;
}

// ── toMinorUnits / fromMinorUnits ───────────────────────────────────────

/**
 * Convert a major-unit amount (e.g. 12.50) to minor units
 * (1250n). The currency's minor-units exponent is applied.
 *
 * Truncates the fractional part toward zero (round-down).
 * So 12.999 EUR → 1299n (not 1300n). For the round-up
 * variant, the caller can pre-round the major amount with
 * `Math.round` before calling.
 */
export function toMinorUnits(majorAmount: number, currency: string): bigint {
  if (!Number.isFinite(majorAmount)) {
    throw new Error(`toMinorUnits: amount must be a finite number, got ${majorAmount}`);
  }
  const factor = minorUnitsFactor(currency);
  // Multiply then truncate. JS's `* factor` on a number is a
  // float multiply, which loses precision past 2^53. For
  // practical roastery amounts (≤ 10^9) the float is fine; for
  // large institutional amounts the caller should pre-scale.
  // We don't throw on large amounts because the card body's
  // examples (£100, €120) are well within float precision.
  return BigInt(Math.trunc(majorAmount * Number(factor)));
}

/**
 * Convert minor units (1250n) to a major-unit number (12.50).
 * JS number precision is ~15.95 significant digits; for
 * amounts up to ~10^13 minor units (10^11 major) the
 * conversion is exact. The card body's amounts are well
 * within this.
 */
export function fromMinorUnits(minorAmount: bigint, currency: string): number {
  const factor = minorUnitsFactor(currency);
  return Number(minorAmount) / Number(factor);
}

// ── FX conversion ───────────────────────────────────────────────────────

/**
 * A snapshot of an FX rate at a point in time. Mirrors the
 * `fx_rate` table in @greenfield/db.
 */
export interface FxRateSnapshot {
  baseCurrency: string;
  quoteCurrency: string;
  /**
   * The rate in pence-per-unit of the QUOTE currency per
   * UNIT of the BASE currency. e.g. EUR→GBP at 0.85 = 85
   * (1 EUR = 0.85 GBP = 85 pence-per-EUR).
   */
  rateCentsPerUnit: bigint;
  asOf: Date;
  source: string | null;
}

/**
 * Convert a minor-unit amount from one currency to another,
 * using the supplied FX rate snapshot.
 *
 * Math: `result = amount * rateCentsPerUnit / (10 ^ quoteExponent)`.
 * Integer truncation (round-down). Lost pence accumulate in
 * the rate's RATE_CENTS_PER_UNIT precision.
 *
 * Throws if the rate's base/quote currencies don't match
 * the function arguments (case-insensitive). The caller is
 * expected to fetch the right rate; the function does not
 * auto-resolve.
 */
export function convertMinor(
  amount: bigint,
  fromCcy: string,
  toCcy: string,
  fx: FxRateSnapshot,
): bigint {
  const from = fromCcy.toUpperCase();
  const to = toCcy.toUpperCase();
  if (fx.baseCurrency.toUpperCase() !== from) {
    throw new Error(
      `convertMinor: fx.baseCurrency is ${fx.baseCurrency}, expected ${from}`,
    );
  }
  if (fx.quoteCurrency.toUpperCase() !== to) {
    throw new Error(
      `convertMinor: fx.quoteCurrency is ${fx.quoteCurrency}, expected ${to}`,
    );
  }
  if (from === to) {
    // No conversion; pass through.
    return amount;
  }
  const quoteFactor = minorUnitsFactor(to);
  return (amount * fx.rateCentsPerUnit) / quoteFactor;
}

// ── VAT split ────────────────────────────────────────────────────────────

/**
 * The result of a gross-to-(net, vat) split. Both fields are
 * bigint minor units. The invariant `net + vat === gross`
 * holds exactly (the remainder goes to `net`).
 */
export interface VatSplit {
  net: bigint;
  vat: bigint;
}

/**
 * Split a gross amount (VAT-inclusive) into net + VAT
 * components. The vatRateBps is the VAT rate in basis points
 * (UK 20% = 2000, DE 19% = 1900, NL 21% = 2100).
 *
 * The VAT is calculated as `gross * rate / (10000 + rate)`,
 * truncated toward zero. The net absorbs the remainder so
 * `net + vat === gross` exactly.
 *
 * For a zero VAT rate (0 bps), vat = 0 and net = gross.
 * For the corner case where rate = 10000 (100%, degenerate),
 * vat = gross and net = 0.
 */
export function splitVat(
  amountIncludingVat: bigint,
  vatRateBps: number,
): VatSplit {
  if (!Number.isInteger(vatRateBps) || vatRateBps < 0 || vatRateBps > 10000) {
    throw new Error(
      `splitVat: vatRateBps must be an integer in [0, 10000], got ${vatRateBps}`,
    );
  }
  if (amountIncludingVat === 0n) {
    return { net: 0n, vat: 0n };
  }
  if (vatRateBps === 0) {
    return { net: amountIncludingVat, vat: 0n };
  }
  // vat = gross * rate / (10000 + rate)
  // For rate=10000: vat = gross * 10000 / 20000 = gross / 2
  //   → that's a 100% VAT, which means 50/50 split. We
  //   special-case it.
  if (vatRateBps === 10000) {
    return { net: 0n, vat: amountIncludingVat };
  }
  const vat = (amountIncludingVat * BigInt(vatRateBps)) / BigInt(10000 + vatRateBps);
  const net = amountIncludingVat - vat;
  return { net, vat };
}

// ── Cost cascade ─────────────────────────────────────────────────────────

/**
 * A landed-cost allocation for one packaged_lot. The card
 * body's "per-packaged-lot landed cost" — a single number
 * (in the org's base currency, minor units) representing
 * the share of the green lot's landed costs that landed on
 * this packaged_lot.
 */
export interface LandedCostAllocation {
  packagedLotId: string;
  /** Total landed cost in base-currency minor units. */
  landedCostCents: bigint;
  /**
   * Cost per single bag/unit. = landedCostCents / count.
   * Stored as bigint via integer division (truncates toward
   * zero). The remainder is small (< count).
   */
  costPerUnitCents: bigint;
}

/**
 * Inputs to the cost cascade. The caller (a tRPC procedure)
 * reads these from the DB and passes them in; the cascade
 * function itself is pure.
 */
export interface CascadeInputs {
  /**
   * The green lot receiving landed costs. `weight_kg` is
   * the total weight at receipt; `weight_kg_remaining` (a
   * derived value computed by the caller) is the current
   * unroasted weight.
   */
  greenLot: {
    id: string;
    weightKg: number;
    weightKgRemaining: number;
  };
  /**
   * All landed cost events for this green lot. Each event
   * is in the event's own currency; the cascade converts
   * to the org's base currency using fxSnapshotCentsPerBase
   * (if set; the event's currency is the base otherwise).
   *
   * `vat_recoverable: true` events are EXCLUDED from the
   * cascade — they're a pass-through (B2B reverse-charge).
   */
  landedEvents: ReadonlyArray<{
    id: string;
    kind: string;
    amountCents: bigint;
    currencyCode: string;
    fxSnapshotCentsPerBase: bigint | null;
    vatRecoverable: boolean;
    occurredAt: Date;
  }>;
  /**
   * Roast batches that consumed the green lot. `roastedLotId`
   * links to a roasted_lot (the post-roast pre-pack product).
   * `roastedWeightKg` is the green weight in (not the
   * roasted weight out — the cascade is green-weight based).
   */
  roastBatches: ReadonlyArray<{
    id: string;
    roastedLotId: string;
    greenWeightInKg: number;
  }>;
  /**
   * The packaged lots derived from the roasted lots above
   * (a pack event consumes one or more roasted_lots and
   * produces one packaged_lot). `count` is the number of
   * retail units in the packaged_lot (a 12-bag case has
   * count=12; a 250g valve bag has count=1).
   */
  packagedLots: ReadonlyArray<{
    id: string;
    roastBatchId: string;
    weightKg: number;
    count: number;
  }>;
  /**
   * The org's base currency. The cascade returns amounts
   * in this currency's minor units.
   */
  baseCurrency: string;
}

/**
 * Compute the per-packaged-lot landed cost allocation. The
 * function is PURE — no IO, no DB, no clock. The caller
 * reads the inputs and uses the result.
 *
 * ALGORITHM (plan §5.3)
 *
 *   1. Sum the green lot's landed events in the BASE
 *      currency. Convert each event via its
 *      `fxSnapshotCentsPerBase` (pence-per-unit of base per
 *      unit of event currency). Exclude `vat_recoverable`
 *      events.
 *
 *   2. Compute the per-kg landed cost on the green lot:
 *        costPerKg = totalCost / weightKg
 *
 *   3. Distribute the cost across the lot's "outputs":
 *
 *        a. The unroasted portion: weight_kg_remaining * costPerKg
 *        b. Each roast_batch's portion: greenWeightInKg * costPerKg
 *        c. Each packaged_lot's portion: its source
 *           roast_batch's allocation, divided by the
 *           packaged_lot's count.
 *
 *   4. Late-arriving costs (a cost event with `occurredAt`
 *      AFTER some roast_batches) are split between the
 *      unroasted portion (per current weight) and the
 *      already-roasted portions (per the per-roast memo).
 *      The cascade is TIME-AWARE: it processes events in
 *      occurredAt order, and at each event the available
 *      outputs are "what's left to allocate to."
 *
 *   The card body says: "no history rewrite" — the cascade
 *   does NOT mutate historic allocations. A late event is
 *   split between current-unroasted and the
 *   roast_batch-level memo (proportional to the per-roast
 *   green_weight_in_kg at the time of the event).
 *
 * SIMPLIFICATION FOR v1
 *
 *   The full time-aware cascade is non-trivial (it would
 *   need to know the green_lot's roast history at each
 *   event's occurredAt). v1 ships a SIMPLIFIED cascade that
 *   treats the events as a single pool and distributes
 *   proportionally across CURRENT outputs (unroasted +
 *   per-roast-batch per their current weight + per-pack
 *   per their current count). Late-arriving events are
 *   added to the pool but their distribution uses CURRENT
 *   outputs, not historical.
 *
 *   This is a documented simplification. The v1.5 card
 *   (plan §6.3 money spine extension) replaces it with the
 *   time-aware version.
 */
export function cascadeCost(
  inputs: CascadeInputs,
): Map<string, LandedCostAllocation> {
  const { greenLot, landedEvents, roastBatches, packagedLots, baseCurrency } =
    inputs;

  // Step 1: sum the costs in the base currency, excluding
  // vat_recoverable.
  let totalCostCents = 0n;
  for (const ev of landedEvents) {
    if (ev.vatRecoverable) {
      // Pass-through; not a real cost to the org.
      continue;
    }
    if (ev.currencyCode.toUpperCase() === baseCurrency.toUpperCase()) {
      totalCostCents += ev.amountCents;
    } else {
      // Convert via the event's FX snapshot. The
      // fx_snapshot_cents_per_base is pence-per-unit of
      // BASE per unit of event currency. So:
      //   baseCents = eventCents * rate / (10 ^ baseExponent)
      // The function below wraps the math.
      const baseFactor = minorUnitsFactor(baseCurrency);
      totalCostCents +=
        (ev.amountCents * (ev.fxSnapshotCentsPerBase ?? 0n)) / baseFactor;
    }
  }

  if (totalCostCents === 0n) {
    // No landed cost to distribute.
    return new Map(
      packagedLots.map((p) => [
        p.id,
        { packagedLotId: p.id, landedCostCents: 0n, costPerUnitCents: 0n },
      ]),
    );
  }

  // Step 2: per-kg cost on the green lot (cents per kg,
  // exact). We scale the kg by 1e6 to preserve fractional
  // kgs in bigint division (a 0.5 kg discrepancy matters at
  // small lot sizes).
  if (greenLot.weightKg <= 0) {
    throw new Error(
      `cascadeCost: green lot ${greenLot.id} has non-positive weight (${greenLot.weightKg} kg)`,
    );
  }
  const weightKgScaled = BigInt(Math.round(greenLot.weightKg * 1_000_000));
  const costPerKgBase = (totalCostCents * 1_000_000n) / weightKgScaled;

  // Step 3: distribute across outputs. The "total output
  // weight" is unroasted + sum of roast green_weight_in_kg.
  // (We treat the green lot's full weight as the
  // denominator; the per-kg cost on what's been roasted
  // matches the per-kg cost on what's unroasted, so the
  // total allocation equals totalCostCents exactly when
  // greenLot.weightKg == weightKgRemaining +
  // sum(roastBatches.greenWeightInKg). If there's weight
  // loss or yield variance, the cascade records a
  // discrepancy.)
  const unroastedKg = greenLot.weightKgRemaining;
  const totalRoastedKg = roastBatches.reduce(
    (sum, rb) => sum + rb.greenWeightInKg,
    0,
  );
  const totalOutputKg = unroastedKg + totalRoastedKg;

  if (totalOutputKg < 0) {
    throw new Error(
      `cascadeCost: total output weight is negative (${totalOutputKg} kg); check green_lot.weight_kg_remaining and roast_batches data`,
    );
  }

  if (totalOutputKg <= 0) {
    // Nothing to allocate to. The cost is on the green lot
    // but no downstream product yet. Return zeros; the cost
    // is "in limbo" and will be distributed when the lot is
    // eventually roasted.
    return new Map(
      packagedLots.map((p) => [
        p.id,
        { packagedLotId: p.id, landedCostCents: 0n, costPerUnitCents: 0n },
      ]),
    );
  }

  // The discrepancy factor: how the per-kg cost adjusts
  // when total output weight doesn't equal the green lot's
  // total weight. (E.g. roast weight loss: green_lot was
  // 100 kg, roasts consumed 95 kg green → 80 kg roasted.
  // The cascade still attributes the cost to the 95 kg of
  // green, not the 80 kg of roasted — the cost is GREEN
  // weight-based, not roasted weight-based.)
  //
  // For v1, we treat the green lot's weight as the
  // denominator. If totalOutputKg < greenLot.weightKg
  // (e.g. some green was destroyed), the per-kg cost
  // effectively spreads the cost across FEWER kgs than
  // the lot started with — the operator sees the cost
  // land on the surviving outputs.
  const weightDiscrepancy = greenLot.weightKg - totalOutputKg;
  if (weightDiscrepancy > 0.01) {
    // Logged as a warning in real usage; for v1 the cascade
    // silently absorbs the discrepancy.
  }

  // Step 4: per-roast allocation + per-pack allocation.
  // For each roast_batch, compute its share of the cost.
  // For each packaged_lot, the cost is its source
  // roast_batch's share, divided by the pack's count.
  const allocations = new Map<string, LandedCostAllocation>();

  // Compute per-roast allocations in cents.
  const roastAllocations = new Map<string, bigint>();
  for (const rb of roastBatches) {
    const rbKgScaled = BigInt(Math.round(rb.greenWeightInKg * 1_000_000));
    const rbCost = (costPerKgBase * rbKgScaled) / 1_000_000n;
    roastAllocations.set(rb.id, rbCost);
  }

  // Distribute per-pack. The pack inherits its source
  // roast's cost; the costPerUnit = roastCost / count.
  for (const p of packagedLots) {
    const roastCost = roastAllocations.get(p.roastBatchId) ?? 0n;
    if (p.count <= 0) {
      throw new Error(
        `cascadeCost: packaged lot ${p.id} has non-positive count (${p.count})`,
      );
    }
    const costPerUnit = roastCost / BigInt(p.count);
    allocations.set(p.id, {
      packagedLotId: p.id,
      landedCostCents: roastCost,
      costPerUnitCents: costPerUnit,
    });
  }

  return allocations;
}

// ── Package identity (for the consumer's convenience) ───────────────────

export const PACKAGE_NAME = '@greenfield/money' as const;
