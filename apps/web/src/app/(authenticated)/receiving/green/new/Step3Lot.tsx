'use client';

// apps/web/src/app/(authenticated)/receiving/green/new/Step3Lot.tsx
//
// Card 0.17 — Step 3: lot details (the green-lot row).
//
//   - code (required, operator-facing identifier)
//   - weightKg (required)
//   - moisturePct (optional, 0-100)
//   - process (washed/natural/honey/anaerobic/other)
//   - variety (text)
//   - grade (text)
//   - notes (text)
//
//   The harvest year and country of origin live on step 2
//   (next to the producer) for the wizard's natural flow.

import type { Dispatch } from 'react';
import type { ReactElement } from 'react';
import type { WizardState, WizardAction } from './types';

interface StepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
}

export function Step3Lot({ state, dispatch }: StepProps): ReactElement {
  return (
    <div>
      <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>
        3. Lot details
      </h2>
      <p style={{ color: '#555', marginTop: 0, marginBottom: '1.25rem' }}>
        The lot's internal identifier, weight, and physical
        characteristics.
      </p>

      <label style={labelStyle}>
        Lot code
        <input
          type="text"
          value={state.lot.code}
          onChange={(e) =>
            dispatch({ type: 'lot', patch: { code: e.target.value.toUpperCase() } })
          }
          style={inputStyle}
        />
        <span style={hintStyle}>
          Operator-facing identifier (printed on the bulk bag).
          Must be unique within the org.
        </span>
      </label>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <label style={{ ...labelStyle, flex: 1 }}>
          Weight received (kg)
          <input
            type="number"
            step="0.001"
            min="0"
            value={state.lot.weightKg}
            onChange={(e) =>
              dispatch({
                type: 'lot',
                patch: { weightKg: parseFloat(e.target.value) || 0 },
              })
            }
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, flex: 1 }}>
          Moisture (%)
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={state.lot.moisturePct ?? ''}
            onChange={(e) =>
              dispatch({
                type: 'lot',
                patch: {
                  moisturePct: e.target.value
                    ? parseFloat(e.target.value)
                    : null,
                },
              })
            }
            style={inputStyle}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <label style={{ ...labelStyle, flex: 1 }}>
          Process
          <select
            value={state.lot.process}
            onChange={(e) =>
              dispatch({
                type: 'lot',
                patch: {
                  process: e.target.value as WizardState['lot']['process'],
                },
              })
            }
            style={inputStyle}
          >
            <option value="washed">Washed</option>
            <option value="natural">Natural</option>
            <option value="honey">Honey</option>
            <option value="anaerobic">Anaerobic</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label style={{ ...labelStyle, flex: 1 }}>
          Variety
          <input
            type="text"
            value={state.lot.variety}
            onChange={(e) =>
              dispatch({ type: 'lot', patch: { variety: e.target.value } })
            }
            placeholder="e.g. Caturra"
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, flex: 1 }}>
          Grade
          <input
            type="text"
            value={state.lot.grade}
            onChange={(e) =>
              dispatch({ type: 'lot', patch: { grade: e.target.value } })
            }
            placeholder="e.g. SHB EP"
            style={inputStyle}
          />
        </label>
      </div>

      <label style={labelStyle}>
        Notes
        <textarea
          value={state.lot.notes}
          onChange={(e) =>
            dispatch({ type: 'lot', patch: { notes: e.target.value } })
          }
          rows={3}
          style={inputStyle}
          placeholder="Cupping notes, defects, anything the operator should remember."
        />
      </label>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.75rem',
  fontSize: '0.9rem',
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: '0.25rem',
  padding: '0.4rem 0.5rem',
  fontSize: '1rem',
  border: '1px solid #bbb',
  borderRadius: 4,
  fontFamily: 'inherit',
};

const hintStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  color: '#666',
  margin: '0.25rem 0',
};
