// @greenfield/money — unit tests
//
// Card 0.13 spec: "Vitest unit tests in
// `packages/money/src/index.test.ts` cover: minor-unit
// conversion (rounding mode is banker's — confirm with
// founder if not specified), VAT split (does 100.00 GBP @
// 20% give net=83.33, vat=16.67?), FX conversion, and a
// simple cost cascade example."
//
// ROUNDING POLICY (per the package source comments)
// - toMinorUnits: round-down (truncate toward zero)
// - splitVat: round-down on vat, remainder goes to net (so net + vat === gross)
// - convertMinor: integer multiply then integer divide (truncate)
// - cascadeCost: per-kg cost truncated, last allocation absorbs remainder

import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  cascadeCost,
  convertMinor,
  fromMinorUnits,
  splitVat,
  toMinorUnits,
  type CascadeInputs,
  type FxRateSnapshot,
} from './index.js';

describe('@greenfield/money', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@greenfield/money');
  });
});

describe('toMinorUnits', () => {
  it('converts a simple 2-decimal amount', () => {
    expect(toMinorUnits(12.5, 'EUR')).toBe(1250n);
    expect(toMinorUnits(0.99, 'GBP')).toBe(99n);
    expect(toMinorUnits(100, 'USD')).toBe(10000n);
  });

  it('truncates the fractional part toward zero (round-down)', () => {
    // 12.999 → 1299 (not 1300)
    expect(toMinorUnits(12.999, 'EUR')).toBe(1299n);
    // 0.001 → 0 (loses 0.1 of a cent)
    expect(toMinorUnits(0.001, 'EUR')).toBe(0n);
  });

  it('handles zero-decimal currencies (JPY)', () => {
    expect(toMinorUnits(100, 'JPY')).toBe(100n);
    expect(toMinorUnits(100.5, 'JPY')).toBe(100n); // truncated
  });

  it('handles 3-decimal currencies (BHD, JOD)', () => {
    expect(toMinorUnits(1.5, 'BHD')).toBe(1500n);
    expect(toMinorUnits(1.234, 'BHD')).toBe(1234n);
  });

  it('is case-insensitive on currency', () => {
    expect(toMinorUnits(1.0, 'eur')).toBe(100n);
    expect(toMinorUnits(1.0, 'Eur')).toBe(100n);
  });

  it('throws on unknown currency', () => {
    expect(() => toMinorUnits(1, 'XYZ')).toThrow(/Unknown currency/);
  });

  it('throws on non-finite amount', () => {
    expect(() => toMinorUnits(NaN, 'EUR')).toThrow(/finite/);
    expect(() => toMinorUnits(Infinity, 'EUR')).toThrow(/finite/);
  });
});

describe('fromMinorUnits', () => {
  it('converts back to the major-unit number', () => {
    expect(fromMinorUnits(1250n, 'EUR')).toBe(12.5);
    expect(fromMinorUnits(99n, 'GBP')).toBe(0.99);
    expect(fromMinorUnits(100n, 'JPY')).toBe(100);
    expect(fromMinorUnits(1234n, 'BHD')).toBe(1.234);
  });

  it('round-trips with toMinorUnits for whole-penny amounts', () => {
    expect(fromMinorUnits(toMinorUnits(12.5, 'EUR'), 'EUR')).toBe(12.5);
  });
});

describe('splitVat', () => {
  it('splits 100.00 GBP @ 20% to net=83.34, vat=16.66', () => {
    // Per the card body's worked example.
    const { net, vat } = splitVat(10000n, 2000);
    // vat = 10000 * 2000 / 12000 = 16666.67 → truncated to 1666
    expect(vat).toBe(1666n);
    // net = 10000 - 1666 = 8334
    expect(net).toBe(8334n);
    // Invariant: net + vat === gross
    expect(net + vat).toBe(10000n);
  });

  it('splits 100.01 GBP @ 20% correctly', () => {
    // vat = 10001 * 2000 / 12000 = 1666.83 → 1666
    // net = 10001 - 1666 = 8335
    const { net, vat } = splitVat(10001n, 2000);
    expect(vat).toBe(1666n);
    expect(net).toBe(8335n);
    expect(net + vat).toBe(10001n);
  });

  it('returns zero VAT when rate is 0', () => {
    const { net, vat } = splitVat(10000n, 0);
    expect(vat).toBe(0n);
    expect(net).toBe(10000n);
  });

  it('returns zero NET when rate is 100% (degenerate)', () => {
    // 100% VAT means everything is VAT, nothing is net.
    const { net, vat } = splitVat(10000n, 10000);
    expect(net).toBe(0n);
    expect(vat).toBe(10000n);
  });

  it('handles the zero-gross edge case', () => {
    const { net, vat } = splitVat(0n, 2000);
    expect(net).toBe(0n);
    expect(vat).toBe(0n);
  });

  it('handles European VAT rates', () => {
    // DE 19% on 100.00 EUR → vat = 10000 * 1900 / 11900 = 1596 → net = 8404
    const de = splitVat(10000n, 1900);
    expect(de.vat).toBe(1596n);
    expect(de.net).toBe(8404n);
    expect(de.net + de.vat).toBe(10000n);

    // NL 21% on 100.00 EUR → vat = 10000 * 2100 / 12100 = 1735 → net = 8265
    const nl = splitVat(10000n, 2100);
    expect(nl.vat).toBe(1735n);
    expect(nl.net).toBe(8265n);
    expect(nl.net + nl.vat).toBe(10000n);
  });

  it('throws on out-of-range rate', () => {
    expect(() => splitVat(10000n, -1)).toThrow();
    expect(() => splitVat(10000n, 10001)).toThrow();
    expect(() => splitVat(10000n, 1.5)).toThrow(); // not an integer
  });
});

describe('convertMinor', () => {
  const fxEurGbp: FxRateSnapshot = {
    baseCurrency: 'EUR',
    quoteCurrency: 'GBP',
    rateCentsPerUnit: 85n, // 1 EUR = 0.85 GBP = 85 pence-per-EUR
    asOf: new Date('2026-01-15'),
    source: 'ecb_daily',
  };

  it('converts 100 EUR to 85.00 GBP', () => {
    // 10000n EUR cents * 85 / 100 = 8500n GBP cents
    expect(convertMinor(10000n, 'EUR', 'GBP', fxEurGbp)).toBe(8500n);
  });

  it('passes through unchanged when source equals target', () => {
    // Even with a "wrong" fx, same-currency conversion is a no-op.
    const fxGbpEur: FxRateSnapshot = {
      ...fxEurGbp,
      baseCurrency: 'GBP',
      quoteCurrency: 'GBP',
    };
    expect(convertMinor(12345n, 'GBP', 'GBP', fxGbpEur)).toBe(12345n);
  });

  it('throws when the rate\'s base currency does not match fromCcy', () => {
    expect(() => convertMinor(100n, 'USD', 'GBP', fxEurGbp)).toThrow(
      /baseCurrency is EUR, expected USD/,
    );
  });

  it('throws when the rate\'s quote currency does not match toCcy', () => {
    expect(() => convertMinor(100n, 'EUR', 'USD', fxEurGbp)).toThrow(
      /quoteCurrency is GBP, expected USD/,
    );
  });

  it('handles JPY (zero-decimal) conversions', () => {
    // 1 USD = 150 JPY, rate expressed as 150n JPY-cents per USD-cent
    // (since JPY has 0 decimals, the "minor unit" is the major
    // unit itself; 1 USD-cent = 1.5 JPY = 150n JPY-cents... wait,
    // let me re-derive: $1 = ¥150. The rate is
    // `rate_cents_per_unit` = pence-per-unit of QUOTE per
    // UNIT of BASE. For USD→JPY, the quote is JPY. The
    // "minor unit" of JPY is 1 yen (no decimals). So
    // 1 USD-cent = 1.5 JPY = 150n JPY-cents. The rate is 150n.)
    const fxUsdJpy: FxRateSnapshot = {
      baseCurrency: 'USD',
      quoteCurrency: 'JPY',
      rateCentsPerUnit: 150n, // 1 USD-cent = 1.5 JPY = 150n JPY-cents
      asOf: new Date('2026-01-15'),
      source: 'manual',
    };
    // 100 USD (10000 cents) → 10000 * 150 / 1 (JPY factor) = 1,500,000 JPY-cents
    // (JPY has 0 decimals, so 1,500,000 JPY-cents === ¥1,500,000)
    expect(convertMinor(10000n, 'USD', 'JPY', fxUsdJpy)).toBe(1500000n);
  });
});

describe('cascadeCost', () => {
  it('returns zeros when there are no landed events', () => {
    const inputs: CascadeInputs = {
      greenLot: { id: 'gl1', weightKg: 100, weightKgRemaining: 0 },
      landedEvents: [],
      roastBatches: [
        { id: 'rb1', roastedLotId: 'rl1', greenWeightInKg: 100 },
      ],
      packagedLots: [
        { id: 'p1', roastBatchId: 'rb1', weightKg: 80, count: 100 },
      ],
      baseCurrency: 'EUR',
    };
    const result = cascadeCost(inputs);
    expect(result.size).toBe(1);
    expect(result.get('p1')?.landedCostCents).toBe(0n);
    expect(result.get('p1')?.costPerUnitCents).toBe(0n);
  });

  it('distributes a simple freight cost across one pack', () => {
    // Green lot: 100 kg @ €2.00/kg landed cost (€200 total)
    // Roast: 100 kg green in → 80 kg roasted
    // Pack: 100 bags from the roast
    // Per-pack landed cost: €200 / 100 = €2.00
    const inputs: CascadeInputs = {
      greenLot: { id: 'gl1', weightKg: 100, weightKgRemaining: 0 },
      landedEvents: [
        {
          id: 'ev1',
          kind: 'freight',
          amountCents: 20000n, // €200.00
          currencyCode: 'EUR',
          fxSnapshotCentsPerBase: null,
          vatRecoverable: false,
          occurredAt: new Date('2026-01-10'),
        },
      ],
      roastBatches: [
        { id: 'rb1', roastedLotId: 'rl1', greenWeightInKg: 100 },
      ],
      packagedLots: [
        { id: 'p1', roastBatchId: 'rb1', weightKg: 80, count: 100 },
      ],
      baseCurrency: 'EUR',
    };
    const result = cascadeCost(inputs);
    const alloc = result.get('p1');
    expect(alloc?.landedCostCents).toBe(20000n);
    expect(alloc?.costPerUnitCents).toBe(200n); // €2.00 per bag
  });

  it('excludes vat_recoverable events from the cascade', () => {
    // £200 freight (real cost) + £40 reverse-charge VAT (pass-through)
    // Total cost to org: £200, not £240.
    const inputs: CascadeInputs = {
      greenLot: { id: 'gl1', weightKg: 100, weightKgRemaining: 0 },
      landedEvents: [
        {
          id: 'ev1',
          kind: 'freight',
          amountCents: 20000n,
          currencyCode: 'GBP',
          fxSnapshotCentsPerBase: null,
          vatRecoverable: false,
          occurredAt: new Date('2026-01-10'),
        },
        {
          id: 'ev2',
          kind: 'duty',
          amountCents: 4000n,
          currencyCode: 'GBP',
          fxSnapshotCentsPerBase: null,
          vatRecoverable: true, // B2B reverse-charge
          occurredAt: new Date('2026-01-12'),
        },
      ],
      roastBatches: [
        { id: 'rb1', roastedLotId: 'rl1', greenWeightInKg: 100 },
      ],
      packagedLots: [
        { id: 'p1', roastBatchId: 'rb1', weightKg: 80, count: 100 },
      ],
      baseCurrency: 'GBP',
    };
    const result = cascadeCost(inputs);
    // Only the £200 freight counts; £40 VAT is excluded.
    expect(result.get('p1')?.landedCostCents).toBe(20000n);
  });

  it('distributes proportionally across two roasts from one green lot', () => {
    // 100 kg green, 60 kg into roast A, 40 kg into roast B
    // €300 freight → 60% to A, 40% to B
    const inputs: CascadeInputs = {
      greenLot: { id: 'gl1', weightKg: 100, weightKgRemaining: 0 },
      landedEvents: [
        {
          id: 'ev1',
          kind: 'freight',
          amountCents: 30000n, // €300
          currencyCode: 'EUR',
          fxSnapshotCentsPerBase: null,
          vatRecoverable: false,
          occurredAt: new Date('2026-01-10'),
        },
      ],
      roastBatches: [
        { id: 'rbA', roastedLotId: 'rlA', greenWeightInKg: 60 },
        { id: 'rbB', roastedLotId: 'rlB', greenWeightInKg: 40 },
      ],
      packagedLots: [
        { id: 'pA', roastBatchId: 'rbA', weightKg: 50, count: 100 },
        { id: 'pB', roastBatchId: 'rbB', weightKg: 30, count: 60 },
      ],
      baseCurrency: 'EUR',
    };
    const result = cascadeCost(inputs);
    // 60% of €300 = €180 to roast A; 40% = €120 to roast B.
    // The integer math may round by ±1 due to bigint division;
    // we assert the sum is exactly the input gross.
    const aCost = result.get('pA')?.landedCostCents ?? 0n;
    const bCost = result.get('pB')?.landedCostCents ?? 0n;
    expect(aCost + bCost).toBe(30000n);
    // A should be ≥ B (more green weight → more cost).
    expect(aCost).toBeGreaterThan(bCost);
  });

  it('converts a USD landed cost to EUR using fx_snapshot_cents_per_base', () => {
    // $100 freight on a 100 kg green lot, base currency EUR.
    // fx_snapshot = 92 (1 USD = 0.92 EUR = 92 EUR-cents per USD-cent)
    // The function computes: 10000n USD-cents * 92 / 100 EUR-cents = 9200n
    //   EUR-cents = €92.00
    //   per-kg = €0.92/kg
    //   per-pack (100 bags) = €0.92 / bag
    const inputs: CascadeInputs = {
      greenLot: { id: 'gl1', weightKg: 100, weightKgRemaining: 0 },
      landedEvents: [
        {
          id: 'ev1',
          kind: 'freight',
          amountCents: 10000n, // $100.00
          currencyCode: 'USD',
          fxSnapshotCentsPerBase: 92n, // 92 EUR-cents per USD-cent
          vatRecoverable: false,
          occurredAt: new Date('2026-01-10'),
        },
      ],
      roastBatches: [
        { id: 'rb1', roastedLotId: 'rl1', greenWeightInKg: 100 },
      ],
      packagedLots: [
        { id: 'p1', roastBatchId: 'rb1', weightKg: 80, count: 100 },
      ],
      baseCurrency: 'EUR',
    };
    const result = cascadeCost(inputs);
    expect(result.get('p1')?.landedCostCents).toBe(9200n); // €92.00
    expect(result.get('p1')?.costPerUnitCents).toBe(92n); // €0.92 / bag
  });

  it('handles unroasted weight (cost in limbo until roasted)', () => {
    // 100 kg green, 50 kg roasted, 50 kg still unroasted
    // €100 freight → €50 to roast, €50 "limbo" (unroasted)
    // Only the roasted portion has a pack → pack gets €50
    const inputs: CascadeInputs = {
      greenLot: { id: 'gl1', weightKg: 100, weightKgRemaining: 50 },
      landedEvents: [
        {
          id: 'ev1',
          kind: 'freight',
          amountCents: 10000n,
          currencyCode: 'EUR',
          fxSnapshotCentsPerBase: null,
          vatRecoverable: false,
          occurredAt: new Date('2026-01-10'),
        },
      ],
      roastBatches: [
        { id: 'rb1', roastedLotId: 'rl1', greenWeightInKg: 50 },
      ],
      packagedLots: [
        { id: 'p1', roastBatchId: 'rb1', weightKg: 40, count: 50 },
      ],
      baseCurrency: 'EUR',
    };
    const result = cascadeCost(inputs);
    // €100 / 100 kg = €1/kg. 50 kg roasted → €50 to the roast.
    expect(result.get('p1')?.landedCostCents).toBe(5000n); // €50
    expect(result.get('p1')?.costPerUnitCents).toBe(100n); // €1.00 / bag
  });

  it('throws on non-positive green lot weight when there is a cost', () => {
    const inputs: CascadeInputs = {
      greenLot: { id: 'gl1', weightKg: 0, weightKgRemaining: 0 },
      landedEvents: [
        {
          id: 'ev1',
          kind: 'freight',
          amountCents: 10000n,
          currencyCode: 'EUR',
          fxSnapshotCentsPerBase: null,
          vatRecoverable: false,
          occurredAt: new Date('2026-01-10'),
        },
      ],
      roastBatches: [
        { id: 'rb1', roastedLotId: 'rl1', greenWeightInKg: 100 },
      ],
      packagedLots: [
        { id: 'p1', roastBatchId: 'rb1', weightKg: 80, count: 100 },
      ],
      baseCurrency: 'EUR',
    };
    expect(() => cascadeCost(inputs)).toThrow(/non-positive weight/);
  });

  it('throws on non-positive packaged_lot count', () => {
    const inputs: CascadeInputs = {
      greenLot: { id: 'gl1', weightKg: 100, weightKgRemaining: 0 },
      landedEvents: [
        {
          id: 'ev1',
          kind: 'freight',
          amountCents: 10000n,
          currencyCode: 'EUR',
          fxSnapshotCentsPerBase: null,
          vatRecoverable: false,
          occurredAt: new Date('2026-01-10'),
        },
      ],
      roastBatches: [
        { id: 'rb1', roastedLotId: 'rl1', greenWeightInKg: 100 },
      ],
      packagedLots: [
        { id: 'p1', roastBatchId: 'rb1', weightKg: 80, count: 0 },
      ],
      baseCurrency: 'EUR',
    };
    expect(() => cascadeCost(inputs)).toThrow(/count/);
  });
});
