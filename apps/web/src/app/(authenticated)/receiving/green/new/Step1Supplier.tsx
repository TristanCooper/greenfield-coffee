'use client';

// apps/web/src/app/(authenticated)/receiving/green/new/Step1Supplier.tsx
//
// Card 0.17 — Step 1: supplier + invoice details.
//
// AUTOCOMPLETE
//
//   The supplier field is an autocomplete. As the user types,
//   we fetch matching suppliers from the API. Selecting one
//   sets state.supplier.id; the draft fields below are
//   ignored. "+ New supplier" toggles a form for the draft
//   fields.
//
// INVOICE
//
//   Invoice number is optional (v1 — a weight ticket without
//   an invoice is allowed per plan §4.1). Currency defaults
//   to the org's base currency. The amount is the
//   invoice total in minor units (we use a major-unit input
//   that the user reads; conversion to minor units happens
//   on submit).

import { useState, useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import type { ReactElement } from 'react';
import type { WizardState, WizardAction, SupplierOption } from './types';

interface StepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  orgId: string;
}

export function Step1Supplier({ state, dispatch }: StepProps): ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SupplierOption[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state.supplier.id) {
      setQuery(state.supplier.draftName || '');
      return;
    }
    if (!query) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/suppliers?q=${encodeURIComponent(query)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { suppliers: SupplierOption[] };
          setResults(data.suppliers);
        }
      } catch {
        // Silently ignore — the user can still type a new one.
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, state.supplier.id, state.supplier.draftName]);

  const isNewMode = !state.supplier.id;

  return (
    <div>
      <h2 style={stepHeaderStyle}>1. Supplier & invoice</h2>
      <p style={stepHelpStyle}>
        Pick an existing supplier or create a new one. Then enter the
        invoice details.
      </p>

      <fieldset style={fieldStyle}>
        <legend>Supplier</legend>
        {state.supplier.id && (
          <div style={selectedChipStyle}>
            <strong>{state.supplier.draftName || 'Selected supplier'}</strong>
            <button
              type="button"
              onClick={() =>
                dispatch({
                  type: 'supplier',
                  patch: { id: null, draftName: '', draftCountryCode: '', draftEori: '' },
                })
              }
              style={linkButtonStyle}
            >
              Change
            </button>
          </div>
        )}
        {!state.supplier.id && (
          <>
            <label style={labelStyle}>
              Search existing
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  dispatch({ type: 'supplier', patch: { draftName: e.target.value } });
                }}
                placeholder="e.g. Sucafina"
                style={inputStyle}
              />
            </label>
            {searching && <p style={hintStyle}>Searching…</p>}
            {results.length > 0 && (
              <ul style={resultListStyle}>
                {results.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        dispatch({
                          type: 'supplier',
                          patch: { id: s.id, draftName: s.name },
                        });
                        setQuery(s.name);
                        setResults([]);
                      }}
                      style={resultItemStyle}
                    >
                      <strong>{s.name}</strong>
                      <span style={hintStyle}> · {s.countryCode}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.length > 0 && results.length === 0 && !searching && (
              <p style={hintStyle}>
                No existing supplier matches. Fill the new-supplier
                fields below to create one.
              </p>
            )}

            <div style={dividerStyle} />
            <p style={hintStyle}>
              <strong>New supplier fields</strong> (required if no match above)
            </p>
            <label style={labelStyle}>
              Name
              <input
                type="text"
                value={state.supplier.draftName}
                onChange={(e) =>
                  dispatch({ type: 'supplier', patch: { draftName: e.target.value } })
                }
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Country (ISO 3166-1 alpha-2)
              <input
                type="text"
                maxLength={2}
                value={state.supplier.draftCountryCode}
                onChange={(e) =>
                  dispatch({
                    type: 'supplier',
                    patch: { draftCountryCode: e.target.value.toUpperCase() },
                  })
                }
                placeholder="e.g. NL"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              EORI (optional)
              <input
                type="text"
                value={state.supplier.draftEori}
                onChange={(e) =>
                  dispatch({ type: 'supplier', patch: { draftEori: e.target.value } })
                }
                style={inputStyle}
              />
            </label>
          </>
        )}
      </fieldset>

      <fieldset style={fieldStyle}>
        <legend>Invoice</legend>
        <label style={labelStyle}>
          Invoice number (optional)
          <input
            type="text"
            value={state.invoice.number}
            onChange={(e) =>
              dispatch({ type: 'invoice', patch: { number: e.target.value } })
            }
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Invoice total
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="number"
              step="0.01"
              min="0"
              value={(state.invoice.amountCents / 100).toString()}
              onChange={(e) => {
                const cents = Math.round(parseFloat(e.target.value || '0') * 100);
                dispatch({ type: 'invoice', patch: { amountCents: cents } });
              }}
              style={{ ...inputStyle, flex: 2 }}
            />
            <select
              value={state.invoice.currencyCode}
              onChange={(e) =>
                dispatch({ type: 'invoice', patch: { currencyCode: e.target.value } })
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
          <span style={hintStyle}>
            Stored as {state.invoice.amountCents} minor units
          </span>
        </label>
        <label style={labelStyle}>
          Invoice notes (optional)
          <textarea
            value={state.invoice.notes}
            onChange={(e) =>
              dispatch({ type: 'invoice', patch: { notes: e.target.value } })
            }
            rows={2}
            style={inputStyle}
          />
        </label>
      </fieldset>

      {!isNewMode && (
        <p style={hintStyle}>
          You selected an existing supplier. The "new supplier" fields
          above are ignored.
        </p>
      )}
    </div>
  );
}

// ── Inline styles ─────────────────────────────────────────────────────────

const stepHeaderStyle: React.CSSProperties = {
  margin: '0 0 0.5rem',
  fontSize: '1.2rem',
};

const stepHelpStyle: React.CSSProperties = {
  color: '#555',
  marginTop: 0,
  marginBottom: '1.25rem',
};

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

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: '#eee',
  margin: '0.75rem 0',
};

const selectedChipStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.5rem 0.75rem',
  background: '#eef',
  border: '1px solid #ccd',
  borderRadius: 4,
  marginBottom: '0.5rem',
};

const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#37c',
  cursor: 'pointer',
  textDecoration: 'underline',
  fontSize: '0.85rem',
  marginLeft: 'auto',
};

const resultListStyle: React.CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: '0.5rem 0',
  border: '1px solid #ddd',
  borderRadius: 4,
  background: '#fff',
  maxHeight: 200,
  overflowY: 'auto',
};

const resultItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '0.5rem 0.75rem',
  background: 'none',
  border: 'none',
  borderBottom: '1px solid #eee',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.95rem',
};
