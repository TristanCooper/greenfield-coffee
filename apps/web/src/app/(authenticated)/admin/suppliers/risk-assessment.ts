// apps/web/src/app/(authenticated)/admin/suppliers/risk-assessment.ts
//
// Card 0.16 — types and helpers for the supplier.risk_assessment
// jsonb column.
//
// The schema (packages/db/src/schema/suppliers.ts) declares the
// jsonb as `{last_reviewed_at: string | null, dds_filed_by_supplier:
// boolean, notes: string}` — that's the LEGACY shape that ships
// with card 0.11's migration.
//
// Card 0.16 wants a STRUCTURED shape — country / producer /
// supply-chain / overall risk, each low/medium/high/unassessed.
// The card 0.16 migration comment acknowledges this is a
// non-breaking extension: the jsonb column is free-form and the
// form writes a richer shape that includes both the new fields
// AND the legacy fields (so old data reads back unchanged, and
// new data populates both).
//
// This file defines the structured shape and helpers to migrate
// between the legacy and structured forms. The supplier form
// reads structured fields, the action serializes a JSON object
// that satisfies both shapes.

export const RISK_VALUES = ['low', 'medium', 'high', 'unassessed'] as const;
export type RiskLevel = (typeof RISK_VALUES)[number];

/**
 * Structured risk assessment — the shape the card body asks for.
 * The form edits these fields directly. On save the action also
 * populates the legacy fields (`last_reviewed_at`,
 * `dds_filed_by_supplier`, `notes`) so old code that reads the
 * jsonb still works.
 */
export interface StructuredRiskAssessment {
  country_risk: RiskLevel;
  producer_risk: RiskLevel;
  supply_chain_risk: RiskLevel;
  overall_risk: RiskLevel;
  last_reviewed_at: string | null;
  dds_filed_by_supplier: boolean;
  notes: string;
}

/** Default risk assessment when creating a new supplier. */
export function defaultRiskAssessment(): StructuredRiskAssessment {
  return {
    country_risk: 'unassessed',
    producer_risk: 'unassessed',
    supply_chain_risk: 'unassessed',
    overall_risk: 'unassessed',
    last_reviewed_at: null,
    dds_filed_by_supplier: false,
    notes: '',
  };
}

/**
 * Read a supplier row's risk_assessment jsonb value into the
 * structured shape. If the column is null or in the legacy
 * shape (no `country_risk` field), the structured fields
 * default to 'unassessed'. The legacy fields are read verbatim
 * if present.
 */
export function readRiskAssessment(
  raw: unknown,
): StructuredRiskAssessment {
  const base = defaultRiskAssessment();
  if (raw === null || raw === undefined || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  return {
    country_risk: asRisk(obj.country_risk) ?? base.country_risk,
    producer_risk: asRisk(obj.producer_risk) ?? base.producer_risk,
    supply_chain_risk: asRisk(obj.supply_chain_risk) ?? base.supply_chain_risk,
    overall_risk: asRisk(obj.overall_risk) ?? base.overall_risk,
    last_reviewed_at:
      typeof obj.last_reviewed_at === 'string'
        ? obj.last_reviewed_at
        : base.last_reviewed_at,
    dds_filed_by_supplier:
      typeof obj.dds_filed_by_supplier === 'boolean'
        ? obj.dds_filed_by_supplier
        : base.dds_filed_by_supplier,
    notes: typeof obj.notes === 'string' ? obj.notes : base.notes,
  };
}

function asRisk(v: unknown): RiskLevel | null {
  if (typeof v !== 'string') return null;
  return (RISK_VALUES as readonly string[]).includes(v)
    ? (v as RiskLevel)
    : null;
}
