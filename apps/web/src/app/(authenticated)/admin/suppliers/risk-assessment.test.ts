// apps/web/src/app/(authenticated)/admin/suppliers/risk-assessment.test.ts
//
// Card 0.16 — pure-logic tests for the supplier risk_assessment
// shape migration helper.
//
// The schema (packages/db/src/schema/suppliers.ts) declares the
// jsonb as a legacy shape; the card 0.16 form writes a richer
// structured shape. readRiskAssessment must accept BOTH shapes
// without crashing and return a valid StructuredRiskAssessment.

import { describe, it, expect } from 'vitest';
import {
  readRiskAssessment,
  defaultRiskAssessment,
  RISK_VALUES,
  type StructuredRiskAssessment,
} from './risk-assessment.js';

describe('readRiskAssessment', () => {
  it('returns defaults for null / undefined', () => {
    expect(readRiskAssessment(null)).toEqual(defaultRiskAssessment());
    expect(readRiskAssessment(undefined)).toEqual(defaultRiskAssessment());
  });

  it('returns defaults for non-object input', () => {
    // The function takes `unknown` so any value is acceptable at the
    // type level; the test exercises runtime rejection of malformed
    // values.
    expect(readRiskAssessment('string')).toEqual(defaultRiskAssessment());
    expect(readRiskAssessment(42)).toEqual(defaultRiskAssessment());
  });

  it('reads the structured shape when present', () => {
    const result = readRiskAssessment({
      country_risk: 'high',
      producer_risk: 'medium',
      supply_chain_risk: 'low',
      overall_risk: 'medium',
      last_reviewed_at: '2026-06-01',
      dds_filed_by_supplier: true,
      notes: 'reviewed Q2 2026',
    });
    expect(result.country_risk).toBe('high');
    expect(result.producer_risk).toBe('medium');
    expect(result.supply_chain_risk).toBe('low');
    expect(result.overall_risk).toBe('medium');
    expect(result.last_reviewed_at).toBe('2026-06-01');
    expect(result.dds_filed_by_supplier).toBe(true);
    expect(result.notes).toBe('reviewed Q2 2026');
  });

  it('reads the legacy shape when structured fields are missing', () => {
    // Legacy rows (card 0.11) only have last_reviewed_at,
    // dds_filed_by_supplier, notes. Structured fields default.
    const result = readRiskAssessment({
      last_reviewed_at: '2026-05-15',
      dds_filed_by_supplier: false,
      notes: 'awaiting EUDR submission',
    });
    expect(result.country_risk).toBe('unassessed');
    expect(result.producer_risk).toBe('unassessed');
    expect(result.supply_chain_risk).toBe('unassessed');
    expect(result.overall_risk).toBe('unassessed');
    expect(result.last_reviewed_at).toBe('2026-05-15');
    expect(result.dds_filed_by_supplier).toBe(false);
    expect(result.notes).toBe('awaiting EUDR submission');
  });

  it('rejects unknown risk values (returns default)', () => {
    const result = readRiskAssessment({
      country_risk: 'extreme', // not in RISK_VALUES
      producer_risk: 'medium',
    });
    expect(result.country_risk).toBe('unassessed');
    expect(result.producer_risk).toBe('medium');
  });

  it('handles malformed types defensively', () => {
    const result = readRiskAssessment({
      country_risk: 42 as unknown, // wrong type
      dds_filed_by_supplier: 'yes' as unknown, // wrong type
      last_reviewed_at: 123 as unknown, // wrong type
    });
    expect(result.country_risk).toBe('unassessed');
    expect(result.dds_filed_by_supplier).toBe(false);
    expect(result.last_reviewed_at).toBeNull();
  });

  it('exports every RISK_VALUE for use in select options', () => {
    expect(RISK_VALUES).toEqual(['low', 'medium', 'high', 'unassessed']);
  });
});

describe('defaultRiskAssessment', () => {
  it('returns the unassessed shape', () => {
    const d = defaultRiskAssessment();
    const expected: StructuredRiskAssessment = {
      country_risk: 'unassessed',
      producer_risk: 'unassessed',
      supply_chain_risk: 'unassessed',
      overall_risk: 'unassessed',
      last_reviewed_at: null,
      dds_filed_by_supplier: false,
      notes: '',
    };
    expect(d).toEqual(expected);
  });

  it('returns a fresh object each call (no shared state)', () => {
    const a = defaultRiskAssessment();
    const b = defaultRiskAssessment();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
