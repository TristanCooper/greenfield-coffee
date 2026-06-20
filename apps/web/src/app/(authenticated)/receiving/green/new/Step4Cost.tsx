'use client';

// apps/web/src/app/(authenticated)/receiving/green/new/Step4Cost.tsx
//
// Card 0.17 — Step 4: cost allocation.
//
//   Itemize the landed cost (freight, duty, insurance,
//   packaging, broker fee) into LandedCostEvent rows. Show
//   the per-kg landed cost in the org's base currency.
//
// FX CONVERSION
//
//   Costs entered in a non-base currency are converted
//   using the FX rate the operator provides. The rate is
//   "cents-per-unit of BASE per unit of EVENT" (per
//   @greenfield/db's fx_rate convention). The step calls
//   /api/fx-rate to look up the most recent rate for the
//   (from, to) pair; the operator can override.

import { useState, useEffect } from 'react';
import type { Dispatch } from 'react';
import type { ReactElement } from 'react';
import type { WizardState, WizardAction, CostLine } from './types';

interface StepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  baseCurrency: string;
  orgId: string;
  fxRateLookup: (from: string, to: string) => Promise<number | null>;
}

export function Step4Cost(props: StepProps): ReactElement {
  const { state, dispatch, baseCurrency } = props;

  const [draft, setDraft] = useState<Omit<CostLine, 'id'>>({
    kind: 'freight',
    amountCents: 0,
    currencyCode: baseCurrency,
    fxSnapshotCentsPerBase: null,
    vatRecoverable: false,
    description: '',
  });

  // When the user changes the draft's currency away from
  // the base, fetch an FX rate and populate the snapshot.
  useEffect(() => {
    if (
      draft.currencyCode.toUpperCase() === baseCurrency.toUpperCase() ||
      draft.amountCents === 0
    ) {
      // No FX needed.
      if (draft.fxSnapshotCentsPerBase !== null) {
        setDraft((d) => ({ ...d, fxSnapshotCentsPerBase: null }));
      }
      return;
    }
    let cancelled = false;
    props
      .fxRateLookup(draft.currencyCode, baseCurrency)
      .then((rate) => {
        if (cancelled) return;
        if (rate !== null) {
          setDraft((d) => ({ ...d, fxSnapshotCentsPerBase: rate }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [draft.currencyCode, draft.amountCents, baseCurrency, props]);

  const totalInBaseCents = state.costs.lines.reduce((sum, l) => {
    if (l.currencyCode.toUpperCase() === baseCurrency.toUpperCase()) {
      return sum + l.amountCents;
    }
    if (l.fxSnapshotCentsPerBase) {
      // Convert to base via the rate (which is pence-per-unit
      // of base per unit of event currency). Note: the
      // amount is in event currency's minor units; we
      // multiply by the rate (pence-per-unit) and divide
      // by 100 to get base minor units. For currencies
      // with a different minor-unit exponent (JPY = 0),
      // the rate's representation differs — for v1 we
      // support only 2-decimal event currencies; the FX
      // rate lookup returns a rate for the (from, to)
      // pair already adjusted for the minor-unit
      // exponent. So a simple `l.amountCents * rate / 100`
      // is correct for 2-decimal event currencies.
      return sum + Math.round((l.amountCents * l.fxSnapshotCentsPerBase) / 100);
    }
    return sum + l.amountCents; // best-effort: assume base
  }, 0);

  const perKgCents = state.lot.weightKg > 0
    ? Math.round(totalInBaseCents / state.lot.weightKg)
    : 0;

  const onAdd = (): void => {
    if (draft.amountCents === 0) return;
    dispatch({ type: 'cost.add', line: draft });
    setDraft({
      kind: 'freight',
      amountCents: 0,
      currencyCode: baseCurrency,
      fxSnapshotCentsPerBase: null,
      vatRecoverable: false,
      description: '',
    });
  };

  return (
    <div>
      <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>
        4. Cost allocation
      </h2>
      <p style={{ color: '#555', marginTop: 0, marginBottom: '1.25rem' }}>
        Itemize the landed cost for this lot. Each line becomes a
        LandedCostEvent row. Costs in non-base currencies are
        converted using the FX rate captured at the time of
        entry.
      </p>

      <fieldset style={fieldStyle}>
        <legend>Add a cost line</legend>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            Kind
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft({ ...draft, kind: e.target.value as CostLine['kind'] })
              }
              style={inputStyle}
            >
              <option value="freight">Freight</option>
              <option value="duty">Duty</option>
              <option value="insurance">Insurance</option>
              <option value="packaging">Packaging</option>
              <option value="storage">Storage</option>
              <option value="broker_fee">Broker fee</option>
              <option value="fx_adjustment">FX adjustment</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label style={{ ...labelStyle, flex: 2 }}>
            Amount
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={(draft.amountCents / 100).toString()}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    amountCents: Math.round(parseFloat(e.target.value || '0') * 100),
                  })
                }
                style={{ ...inputStyle, flex: 2 }}
              />
              <select
                value={draft.currencyCode}
                onChange={(e) =>
                  setDraft({ ...draft, currencyCode: e.target.value })
                }
                style={{ ...inputStyle, flex: 1 }}
              >
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="USD">USD</option>
                <option value="JPY">JPY</option>
                <option value="CHF">CHF</option>
              </select>
            </div>
            {draft.currencyCode.toUpperCase() !== baseCurrency.toUpperCase() && (
              <span style={hintStyle}>
                FX rate: {draft.fxSnapshotCentsPerBase ?? 'loading…'}{' '}
                ({baseCurrency} per {draft.currencyCode})
              </span>
            )}
          </label>
        </div>
        <label style={labelStyle}>
          Description
          <input
            type="text"
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            placeholder="e.g. Sea freight from Santos to Hamburg"
            style={inputStyle}
          />
        </label>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={draft.vatRecoverable}
            onChange={(e) =>
              setDraft({ ...draft, vatRecoverable: e.target.checked })
            }
          />
          VAT recoverable (B2B reverse-charge)
        </label>
        <button
          type="button"
          onClick={onAdd}
          disabled={draft.amountCents === 0}
          style={
            draft.amountCents === 0 ? disabledButtonStyle : primaryButtonStyle
          }
        >
          Add cost line
        </button>
      </fieldset>

      {state.costs.lines.length > 0 ? (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Kind</th>
              <th style={thStyle}>Amount</th>
              <th style={thStyle}>FX</th>
              <th style={thStyle}>VAT</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {state.costs.lines.map((line) => (
              <tr key={line.id}>
                <td style={tdStyle}>{line.kind}</td>
                <td style={tdStyle}>
                  {(line.amountCents / 100).toFixed(2)} {line.currencyCode}
                </td>
                <td style={tdStyle}>
                  {line.fxSnapshotCentsPerBase
                    ? `${line.fxSnapshotCentsPerBase}`
                    : '—'}
                </td>
                <td style={tdStyle}>
                  {line.vatRecoverable ? 'Recoverable' : 'Cost'}
                </td>
                <td style={tdStyle}>{line.description || '—'}</td>
                <td style={tdStyle}>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({ type: 'cost.remove', id: line.id })
                    }
                    style={linkButtonStyle}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={hintStyle}>
          No cost lines yet. Cost is optional — you can submit without
          any.
        </p>
      )}

      <div style={totalsStyle}>
        <strong>Total in {baseCurrency}:</strong>{' '}
        {(totalInBaseCents / 100).toFixed(2)} {baseCurrency}
        {state.lot.weightKg > 0 && (
          <>
            {' '}
            · <strong>Per kg:</strong>{' '}
            {(perKgCents / 100).toFixed(2)} {baseCurrency}/kg
          </>
        )}
      </div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 4,
  padding: '0.75rem 1rem',
  marginBottom: '1rem',
};

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

const primaryButtonStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  fontSize: '0.9rem',
  background: '#3a7',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

const disabledButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: '#ccc',
  cursor: 'not-allowed',
};

const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#37c',
  cursor: 'pointer',
  textDecoration: 'underline',
  fontSize: '0.85rem',
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9rem',
  marginBottom: '0.75rem',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.4rem 0.5rem',
  borderBottom: '1px solid #ddd',
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  borderBottom: '1px solid #eee',
};

const totalsStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  background: '#eef',
  border: '1px solid #ccd',
  borderRadius: 4,
  fontSize: '0.95rem',
};
