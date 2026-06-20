// apps/web/src/app/(authenticated)/receiving/green/new/state.ts
//
// Card 0.17 — wizard state + reducer.
//
// The state shape mirrors the form data the wizard collects.
// Each step updates a slice of the state. The reducer is
// pure: every action returns a new state object.

import type {
  WizardState,
  WizardAction,
} from './types';

export const totalWizardSteps = 5;

export const stepTitles = [
  'Supplier & invoice',
  'Producer & country',
  'Lot details',
  'Cost allocation',
  'Risk review',
] as const;

export function initialWizardState(baseCurrency: string): WizardState {
  return {
    supplier: {
      id: null,
      draftName: '',
      draftCountryCode: '',
      draftEori: '',
    },
    invoice: {
      number: '',
      currencyCode: baseCurrency,
      amountCents: 0,
      weightKg: 0,
      notes: '',
    },
    producer: {
      id: null,
      draftName: '',
      draftCountryCode: '',
      draftRegion: '',
      draftAreaHectares: null,
      draftVerificationSource: 'self_reported',
      draftGeolocation: null,
    },
    lot: {
      code: '',
      weightKg: 0,
      moisturePct: null,
      process: 'washed',
      variety: '',
      grade: '',
      harvestYear: new Date().getFullYear(),
      countryOfOrigin: '',
      notes: '',
    },
    costs: {
      lines: [],
    },
    risk: {
      overallLevel: 'low',
      supplierLevel: 'unassessed',
      producerLevel: 'unassessed',
      countryLevel: 'unassessed',
      acknowledged: false,
    },
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'supplier':
      return { ...state, supplier: { ...state.supplier, ...action.patch } };
    case 'invoice':
      return { ...state, invoice: { ...state.invoice, ...action.patch } };
    case 'producer':
      return { ...state, producer: { ...state.producer, ...action.patch } };
    case 'lot':
      return { ...state, lot: { ...state.lot, ...action.patch } };
    case 'cost.add': {
      return {
        ...state,
        costs: {
          ...state.costs,
          lines: [
            ...state.costs.lines,
            {
              id: `cost-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              kind: action.line.kind,
              amountCents: action.line.amountCents,
              currencyCode: action.line.currencyCode,
              fxSnapshotCentsPerBase: action.line.fxSnapshotCentsPerBase,
              vatRecoverable: action.line.vatRecoverable,
              description: action.line.description,
            },
          ],
        },
      };
    }
    case 'cost.update': {
      return {
        ...state,
        costs: {
          ...state.costs,
          lines: state.costs.lines.map((l) =>
            l.id === action.id ? { ...l, ...action.patch } : l,
          ),
        },
      };
    }
    case 'cost.remove': {
      return {
        ...state,
        costs: {
          ...state.costs,
          lines: state.costs.lines.filter((l) => l.id !== action.id),
        },
      };
    }
    case 'risk':
      return { ...state, risk: { ...state.risk, ...action.patch } };
    case 'restore':
      return action.payload;
    default:
      return state;
  }
}
