'use client';

// apps/web/src/app/(authenticated)/receiving/green/new/Step2Producer.tsx
//
// Card 0.17 — Step 2: producer + country of harvest.
//
// AUTOCOMPLETE
//
//   Same pattern as Step 1 — search the producer table for
//   matches. Selecting one sets state.producer.id; the
//   draft fields below are ignored. "+ New producer" toggles
//   the form including the GeoJSON map picker (see
//   MapPicker.tsx).
//
// COUNTRY OF HARVEST
//
//   `countryCode` is required (ISO 3166-1 alpha-2). The list
//   of allowed codes is the 30+ coffee-producing countries;
//   for v1 we accept any 2-letter code and validate against
//   a reference list at the application layer (per the
//   card body's "from a reference list" — the reference list
//   ships as a static module in card 0.22 / a follow-up).
//
// HARVEST YEAR
//
//   CHECK in lots.ts requires
//   2020 <= harvest_year <= extract(year from now()) + 1.
//   The default is the current year.

import { useState, useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import type { ReactElement } from 'react';
import type { WizardState, WizardAction, ProducerOption } from './types';
import { MapPicker } from './MapPicker';

interface StepProps {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  orgId: string;
  baseCurrency: string;
}

export function Step2Producer({ state, dispatch }: StepProps): ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProducerOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state.producer.id) {
      setQuery(state.producer.draftName || '');
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
          `/api/producers?q=${encodeURIComponent(query)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { producers: ProducerOption[] };
          setResults(data.producers);
        }
      } catch {
        // ignore
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, state.producer.id, state.producer.draftName]);

  return (
    <div>
      <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.2rem' }}>
        2. Producer & country
      </h2>
      <p style={{ color: '#555', marginTop: 0, marginBottom: '1.25rem' }}>
        Pick an existing producer or create a new one (with map picker
        for the geolocation). The country of harvest is the country
        where the coffee was grown.
      </p>

      <fieldset style={fieldStyle}>
        <legend>Producer</legend>
        {state.producer.id && (
          <div style={selectedChipStyle}>
            <strong>{state.producer.draftName || 'Selected producer'}</strong>
            <button
              type="button"
              onClick={() =>
                dispatch({
                  type: 'producer',
                  patch: {
                    id: null,
                    draftName: '',
                    draftCountryCode: '',
                    draftRegion: '',
                    draftAreaHectares: null,
                    draftGeolocation: null,
                  },
                })
              }
              style={linkButtonStyle}
            >
              Change
            </button>
          </div>
        )}
        {!state.producer.id && (
          <>
            <label style={labelStyle}>
              Search existing
              <input
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  dispatch({
                    type: 'producer',
                    patch: { draftName: e.target.value },
                  });
                }}
                placeholder="e.g. Finca La Esperanza"
                style={inputStyle}
              />
            </label>
            {searching && <p style={hintStyle}>Searching…</p>}
            {results.length > 0 && (
              <ul style={resultListStyle}>
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        dispatch({
                          type: 'producer',
                          patch: {
                            id: p.id,
                            draftName: p.name,
                            draftCountryCode: p.countryCode,
                            draftRegion: p.region || '',
                          },
                        });
                        setQuery(p.name);
                        setResults([]);
                      }}
                      style={resultItemStyle}
                    >
                      <strong>{p.name}</strong>
                      <span style={hintStyle}>
                        {' '}
                        · {p.countryCode}
                        {p.region ? ` (${p.region})` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.length > 0 && results.length === 0 && !searching && (
              <p style={hintStyle}>
                No existing producer matches. Fill the new-producer
                fields below to create one.
              </p>
            )}

            <div style={dividerStyle} />
            <p style={hintStyle}>
              <strong>New producer fields</strong>
            </p>
            <label style={labelStyle}>
              Name
              <input
                type="text"
                value={state.producer.draftName}
                onChange={(e) =>
                  dispatch({
                    type: 'producer',
                    patch: { draftName: e.target.value },
                  })
                }
                style={inputStyle}
              />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <label style={{ ...labelStyle, flex: 1 }}>
                Country
                <input
                  type="text"
                  maxLength={2}
                  value={state.producer.draftCountryCode}
                  onChange={(e) =>
                    dispatch({
                      type: 'producer',
                      patch: {
                        draftCountryCode: e.target.value.toUpperCase(),
                      },
                    })
                  }
                  placeholder="e.g. CO"
                  style={inputStyle}
                />
              </label>
              <label style={{ ...labelStyle, flex: 1 }}>
                Region (optional)
                <input
                  type="text"
                  value={state.producer.draftRegion}
                  onChange={(e) =>
                    dispatch({
                      type: 'producer',
                      patch: { draftRegion: e.target.value },
                    })
                  }
                  placeholder="e.g. Huila"
                  style={inputStyle}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <label style={{ ...labelStyle, flex: 1 }}>
                Area (hectares)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={state.producer.draftAreaHectares ?? ''}
                  onChange={(e) =>
                    dispatch({
                      type: 'producer',
                      patch: {
                        draftAreaHectares: e.target.value
                          ? parseFloat(e.target.value)
                          : null,
                      },
                    })
                  }
                  style={inputStyle}
                />
              </label>
              <label style={{ ...labelStyle, flex: 1 }}>
                Verification source
                <select
                  value={state.producer.draftVerificationSource}
                  onChange={(e) =>
                    dispatch({
                      type: 'producer',
                      patch: {
                        draftVerificationSource: e.target
                          .value as WizardState['producer']['draftVerificationSource'],
                      },
                    })
                  }
                  style={inputStyle}
                >
                  <option value="self_reported">Self-reported</option>
                  <option value="third_party_verified">
                    Third-party verified
                  </option>
                  <option value="satellite_imagery">Satellite imagery</option>
                  <option value="ground_survey">Ground survey</option>
                </select>
              </label>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowMapPicker(true)}
                style={secondaryButtonStyle}
              >
                {state.producer.draftGeolocation
                  ? 'Edit farm boundary (map)'
                  : 'Draw farm boundary (map)'}
              </button>
              {state.producer.draftGeolocation && (
                <span style={hintStyle}>
                  {' '}
                  · area ~{state.producer.draftGeolocation.areaHectares.toFixed(2)} ha
                </span>
              )}
            </div>

            {showMapPicker && (
              <MapPicker
                initialGeojson={
                  (state.producer.draftGeolocation?.geojson as
                    | GeoJSON.Polygon
                    | GeoJSON.MultiPolygon
                    | null) ?? null
                }
                initialAreaHectares={
                  state.producer.draftGeolocation?.areaHectares ?? null
                }
                onCancel={() => setShowMapPicker(false)}
                onSave={(geojson, areaHectares) => {
                  dispatch({
                    type: 'producer',
                    patch: {
                      draftGeolocation: { geojson, areaHectares },
                    },
                  });
                  setShowMapPicker(false);
                }}
              />
            )}
          </>
        )}
      </fieldset>

      <fieldset style={fieldStyle}>
        <legend>Country of harvest</legend>
        <label style={labelStyle}>
          ISO 3166-1 alpha-2 code
          <input
            type="text"
            maxLength={2}
            value={state.lot.countryOfOrigin}
            onChange={(e) =>
              dispatch({
                type: 'lot',
                patch: { countryOfOrigin: e.target.value.toUpperCase() },
              })
            }
            placeholder="e.g. CO"
            style={inputStyle}
          />
          <span style={hintStyle}>
            Defaults to the producer's country if left blank.
          </span>
        </label>
        <label style={labelStyle}>
          Harvest year
          <input
            type="number"
            min="2020"
            max={new Date().getFullYear() + 1}
            value={state.lot.harvestYear}
            onChange={(e) =>
              dispatch({
                type: 'lot',
                patch: { harvestYear: parseInt(e.target.value, 10) || 0 },
              })
            }
            style={inputStyle}
          />
        </label>
      </fieldset>
    </div>
  );
}

// ── Inline styles ─────────────────────────────────────────────────────────

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

const secondaryButtonStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  fontSize: '0.9rem',
  background: '#888',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};
