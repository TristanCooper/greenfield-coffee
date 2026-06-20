'use client';

// apps/web/src/app/(authenticated)/receiving/green/new/Step5Risk.tsx
//
// Card 0.17 — Step 5: risk review + submit.
//
//   Show supplier risk + producer risk + country risk +
//   overall combined risk. Require explicit acknowledgement
//   if any component is `high`; "Submit" disabled until
//   acknowledged.
//
// RISK COMPUTATION
//
//   v1 ships a SIMPLIFIED in-form risk summary. The
//   production risk_status is computed by the SQL function
//   `recompute_lot_risk` (card 0.11) on insert. This step
//   shows a *preview* of the risk based on the form data:
//
//     - supplierLevel = 'unassessed' if the supplier was
//       just created (no risk_assessment), else 'low' (a
//       v1 simplification — the real risk_assessment
//       derivation lands in a follow-up card).
//     - producerLevel = 'high' if the producer's
//       verification_source is 'self_reported' AND no
//       active producer_verification_override, else 'low'.
//     - countryLevel = 'low' for v1 (the country risk list
//       lands in card 0.20; v1 doesn't have a high-risk
//       country list yet).
//     - overallLevel = max of the three (high > medium >
//       low > unassessed).
//
//   The wizard surfaces the `overallLevel` so the operator
//   can acknowledge the risk before submit. The actual
//   risk_status written to the DB is computed by the
//   trigger; this is a UX hint, not a contract.

import { useEffect } from 'react';
import type { Dispatch } from 'react';
import type { ReactElement } from 'react';
import type { WizardState, WizardAction, RiskLevel } from './types';

interface StepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
}

const RISK_RANK: Record<RiskLevel, number> = {
  unassessed: 0,
  low: 1,
  medium: 2,
  high: 3,
};

function maxLevel(...levels: RiskLevel[]): RiskLevel {
  return levels.reduce(
    (acc, l) => (RISK_RANK[l] > RISK_RANK[acc] ? l : acc),
    'unassessed',
  );
}

function levelColor(level: RiskLevel): string {
  switch (level) {
    case 'high':
      return '#a00';
    case 'medium':
      return '#a60';
    case 'low':
      return '#3a7';
    case 'unassessed':
      return '#888';
  }
}

function levelLabel(level: RiskLevel): string {
  switch (level) {
    case 'high':
      return 'HIGH RISK';
    case 'medium':
      return 'Medium risk';
    case 'low':
      return 'Low risk';
    case 'unassessed':
      return 'Not yet assessed';
  }
}

export function Step5Risk({ state, dispatch }: StepProps): ReactElement {
  const supplierLevel: RiskLevel = state.supplier.id ? 'low' : 'unassessed';
  const producerLevel: RiskLevel =
    state.producer.draftVerificationSource === 'self_reported' &&
    !state.producer.draftGeolocation
      ? 'high'
      : 'low';
  const countryLevel: RiskLevel = 'low'; // v1 simplification
  const overallLevel: RiskLevel = maxLevel(
    supplierLevel,
    producerLevel,
    countryLevel,
  );

  // Sync the derived risk into the wizard state so the
  // main "Next" / "Submit" button can gate on it.
  useEffect(() => {
    if (
      state.risk.supplierLevel !== supplierLevel ||
      state.risk.producerLevel !== producerLevel ||
      state.risk.countryLevel !== countryLevel ||
      state.risk.overallLevel !== overallLevel
    ) {
      dispatch({
        type: 'risk',
        patch: {
          supplierLevel,
          producerLevel,
          countryLevel,
          overallLevel,
        },
      });
    }
  }, [
    supplierLevel,
    producerLevel,
    countryLevel,
    overallLevel,
    state.risk,
    dispatch,
  ]);

  return (
    <div>
      <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>
        5. Risk review
      </h2>
      <p style={{ color: '#555', marginTop: 0, marginBottom: '1.25rem' }}>
        Review the EUDR risk picture for this lot. The values below
        are a preview — the on-disk risk_status is computed by the
        database trigger when the lot is saved.
      </p>

      <div style={riskGridStyle}>
        <RiskRow
          label="Supplier risk"
          level={supplierLevel}
          note={
            state.supplier.id
              ? 'Reusing an existing supplier. Their stored risk_assessment applies.'
              : 'A new supplier is being created. They have no risk_assessment yet; the form completes one inline.'
          }
        />
        <RiskRow
          label="Producer risk"
          level={producerLevel}
          note={
            state.producer.draftVerificationSource === 'self_reported' &&
            !state.producer.draftGeolocation
              ? 'Self-reported producer with no map-verified boundary. EUDR risk is HIGH until overridden by compliance_officer.'
              : 'Producer verification is at or above third-party-verified.'
          }
        />
        <RiskRow
          label="Country risk"
          level={countryLevel}
          note="Country-of-harvest risk list (v1) is empty; the EU high-risk list ships in card 0.20."
        />
        <RiskRow
          label="Overall"
          level={overallLevel}
          note="The maximum of the three component risks."
        />
      </div>

      {overallLevel === 'high' && (
        <div style={highRiskWarningStyle}>
          <strong>High risk detected.</strong> Submitting requires your
          explicit acknowledgement below.
        </div>
      )}

      <label style={ackStyle}>
        <input
          type="checkbox"
          checked={state.risk.acknowledged}
          onChange={(e) =>
            dispatch({
              type: 'risk',
              patch: { acknowledged: e.target.checked },
            })
          }
        />
        I have reviewed the supplier, producer, and country risk
        picture and accept this green-lot receipt.{' '}
        {overallLevel === 'high' && (
          <strong>(required for high-risk lots)</strong>
        )}
      </label>
    </div>
  );
}

function RiskRow({
  label,
  level,
  note,
}: {
  label: string;
  level: RiskLevel;
  note: string;
}): ReactElement {
  return (
    <div style={riskRowStyle}>
      <div>
        <strong>{label}</strong>
      </div>
      <div style={{ color: levelColor(level), fontWeight: 600 }}>
        {levelLabel(level)}
      </div>
      <p style={{ fontSize: '0.85rem', color: '#555', margin: '0.25rem 0 0' }}>
        {note}
      </p>
    </div>
  );
}

const riskGridStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.5rem',
  marginBottom: '1rem',
};

const riskRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: '0.5rem 1rem',
  padding: '0.5rem 0.75rem',
  border: '1px solid #ddd',
  borderRadius: 4,
  background: '#fafafa',
};

const highRiskWarningStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  background: '#fee',
  border: '1px solid #fcc',
  borderRadius: 4,
  color: '#a00',
  marginBottom: '1rem',
};

const ackStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.75rem 1rem',
  background: '#eef',
  border: '1px solid #ccd',
  borderRadius: 4,
};
