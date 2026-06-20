// apps/web/src/app/(authenticated)/receiving/green/new/types.ts
//
// Card 0.17 — shared types for the wizard state and reducer.

export type RiskLevel = 'unassessed' | 'low' | 'medium' | 'high';

export interface SupplierOption {
  id: string;
  name: string;
  countryCode: string;
}

export interface ProducerOption {
  id: string;
  name: string;
  countryCode: string;
  region: string | null;
}

export interface CostLine {
  id: string;
  kind:
    | 'freight'
    | 'duty'
    | 'insurance'
    | 'packaging'
    | 'storage'
    | 'broker_fee'
    | 'fx_adjustment'
    | 'other';
  amountCents: number;
  currencyCode: string;
  /** null when the cost's currency is the org base. */
  fxSnapshotCentsPerBase: number | null;
  vatRecoverable: boolean;
  description: string;
}

export interface GeolocationState {
  /** GeoJSON MultiPolygon (or Polygon; wrapped to MultiPolygon server-side). */
  geojson: unknown;
  /** Computed area in hectares (rough client-side estimate). */
  areaHectares: number;
}

export interface WizardState {
  supplier: {
    id: string | null;
    /** When `id` is null, the user is creating a new supplier. */
    draftName: string;
    draftCountryCode: string;
    draftEori: string;
  };
  invoice: {
    number: string;
    currencyCode: string;
    amountCents: number;
    weightKg: number;
    notes: string;
  };
  producer: {
    id: string | null;
    draftName: string;
    draftCountryCode: string;
    draftRegion: string;
    draftAreaHectares: number | null;
    draftVerificationSource:
      | 'self_reported'
      | 'third_party_verified'
      | 'satellite_imagery'
      | 'ground_survey';
    draftGeolocation: GeolocationState | null;
  };
  lot: {
    code: string;
    weightKg: number;
    moisturePct: number | null;
    process: 'washed' | 'natural' | 'honey' | 'anaerobic' | 'other';
    variety: string;
    grade: string;
    harvestYear: number;
    countryOfOrigin: string;
    notes: string;
  };
  costs: {
    lines: CostLine[];
  };
  risk: {
    overallLevel: RiskLevel;
    supplierLevel: RiskLevel;
    producerLevel: RiskLevel;
    countryLevel: RiskLevel;
    acknowledged: boolean;
  };
}

export type WizardAction =
  | { type: 'supplier'; patch: Partial<WizardState['supplier']> }
  | { type: 'invoice'; patch: Partial<WizardState['invoice']> }
  | { type: 'producer'; patch: Partial<WizardState['producer']> }
  | { type: 'lot'; patch: Partial<WizardState['lot']> }
  | {
      type: 'cost.add';
      line: Omit<CostLine, 'id'>;
    }
  | {
      type: 'cost.update';
      id: string;
      patch: Partial<Omit<CostLine, 'id'>>;
    }
  | { type: 'cost.remove'; id: string }
  | { type: 'risk'; patch: Partial<WizardState['risk']> }
  | { type: 'restore'; payload: WizardState };
