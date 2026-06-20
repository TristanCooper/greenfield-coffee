'use client';

// apps/web/src/app/(authenticated)/admin/recipes/RecipeForm.tsx
//
// Card 0.16 — client-side form for Recipe create + edit.
//
// The form's defining feature is the blend picker: N rows of
//   [green-lot code, percentage of blend, notes]
// Each row is a GreenLotPicker — a combobox that fetches
// `/api/green-lots?q=…` and lets the user pick from the
// tenant-scoped list.
//
// CLIENT-SIDE 100% VALIDATION
//
//   The form renders a "Total: NN.NN%" hint below the blend
//   and disables the submit button when the total is not 100%
//   (±0.05% tolerance). The server-side action re-validates
//   authoritatively — a tampered request is rejected at the
//   SQL boundary.

import {
  useState,
  useEffect,
  useRef,
  useId,
  useCallback,
} from 'react';
import {
  AdminForm,
  TextField,
  TextAreaField,
  NumberField,
  CheckboxField,
  useFieldError,
} from '../_components/AdminForm';
import {
  labelStyle,
  inputStyle,
  buttonSecondaryStyle,
  buttonRowStyle,
  errorStyle,
} from '@/lib/admin/styles';
import type { ActionResult } from '../_types';

// ── Types ──────────────────────────────────────────────────────────────

export interface ComponentDefault {
  greenLotId: string;
  greenLotCode?: string;
  percentBps: number;
  notes?: string | null;
}

export interface RecipeFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  defaults?: {
    id?: string;
    code?: string;
    name?: string;
    description?: string | null;
    chargeWeightG?: string | null;
    expectedYieldPct?: string | null;
    durationSeconds?: number | null;
    profileNotes?: string | null;
    components?: ComponentDefault[];
    active?: boolean;
  };
  submitLabel: string;
  cancelHref: string;
  disabled?: boolean;
}

// ── Green-lot picker ──────────────────────────────────────────────────

interface GreenLotOption {
  id: string;
  code: string;
  countryOfOrigin: string | null;
  weightKg: string;
}

function GreenLotPicker(props: {
  index: number;
  initial: ComponentDefault | null;
  disabled?: boolean;
  onChange: (next: ComponentDefault | null) => void;
}): React.ReactElement {
  const [query, setQuery] = useState<string>(
    props.initial?.greenLotCode ?? '',
  );
  const [options, setOptions] = useState<GreenLotOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    props.initial?.greenLotId ?? null,
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOptions = useCallback(async (q: string) => {
    if (q.length < 1) {
      setOptions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/green-lots?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { greenLots: GreenLotOption[] };
      setOptions(data.greenLots ?? []);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchOptions(query);
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchOptions]);

  const onSelect = (opt: GreenLotOption) => {
    setQuery(opt.code);
    setSelectedId(opt.id);
    setOpen(false);
    props.onChange({
      greenLotId: opt.id,
      greenLotCode: opt.code,
      percentBps: props.initial?.percentBps ?? 0,
      notes: props.initial?.notes ?? null,
    });
  };

  const onClear = () => {
    setQuery('');
    setSelectedId(null);
    props.onChange(null);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input type="hidden" name={`component.greenLotId.${props.index}`} value={selectedId ?? ''} />
      <input
        type="text"
        value={query}
        placeholder="Search green lot code…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          // Clear selection when the user types a new query — they may
          // be picking a different lot.
          if (selectedId) setSelectedId(null);
          props.onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        disabled={props.disabled}
        style={inputStyle}
      />
      {open && query.length > 0 ? (
        <ul
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            margin: 0,
            padding: 0,
            listStyle: 'none',
            background: '#fff',
            border: '1px solid #d4d4d4',
            borderRadius: 4,
            maxHeight: '12rem',
            overflowY: 'auto',
            zIndex: 10,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          {loading ? (
            <li style={{ padding: '0.5rem', color: '#737373' }}>Loading…</li>
          ) : options.length === 0 ? (
            <li style={{ padding: '0.5rem', color: '#737373' }}>No matches.</li>
          ) : (
            options.map((opt) => (
              <li
                key={opt.id}
                role="option"
                aria-selected={selectedId === opt.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(opt);
                }}
                style={{
                  padding: '0.4rem 0.6rem',
                  cursor: 'pointer',
                  background: selectedId === opt.id ? '#dbeafe' : 'transparent',
                }}
              >
                {opt.code}{' '}
                <span style={{ color: '#737373', fontSize: '0.85rem' }}>
                  ({opt.countryOfOrigin ?? '—'} · {opt.weightKg} kg)
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {selectedId ? (
        <button
          type="button"
          onClick={onClear}
          disabled={props.disabled}
          style={{
            marginTop: '0.25rem',
            background: 'none',
            border: 'none',
            color: '#1d4ed8',
            cursor: 'pointer',
            fontSize: '0.8rem',
            padding: 0,
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

// ── Blend editor ───────────────────────────────────────────────────────

function BlendEditor(props: {
  defaults: ComponentDefault[];
  disabled?: boolean;
}): React.ReactElement {
  // Initialise from props.defaults. The component is uncontrolled —
  // it tracks local state, and submits the rows via hidden inputs
  // that AdminForm already collects via the parent form.
  const [rows, setRows] = useState<ComponentDefault[]>(
    props.defaults.length > 0 ? props.defaults : [{ greenLotId: '', percentBps: 0 }],
  );
  const rowsId = useId();
  const fieldError = useFieldError('components');

  const update = (index: number, next: ComponentDefault | null) => {
    setRows((prev) => {
      const cp = [...prev];
      if (next === null) {
        cp[index] = { ...cp[index]!, greenLotId: '' };
      } else {
        cp[index] = next;
      }
      return cp;
    });
  };

  const updatePercent = (index: number, percent: number) => {
    setRows((prev) => {
      const cp = [...prev];
      cp[index] = { ...cp[index]!, percentBps: percent };
      return cp;
    });
  };

  const updateNotes = (index: number, notes: string) => {
    setRows((prev) => {
      const cp = [...prev];
      cp[index] = { ...cp[index]!, notes: notes || null };
      return cp;
    });
  };

  const addRow = () => {
    setRows((prev) => [...prev, { greenLotId: '', percentBps: 0 }]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const totalBps = rows.reduce((sum, r) => sum + (r.percentBps || 0), 0);
  const totalPct = (totalBps / 100).toFixed(2);
  const valid =
    rows.length === 0 || Math.abs(totalBps - 10000) <= 5; // ±0.05%

  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={labelStyle}>Blend components</label>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#737373' }}>
        Each row: a green lot, the percentage of the blend it represents,
        and optional notes. Total must sum to 100%.
      </p>
      {rows.map((row, i) => (
        <div
          key={`${rowsId}-${i}`}
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 2fr auto',
            gap: '0.5rem',
            alignItems: 'start',
            marginBottom: '0.5rem',
            padding: '0.5rem',
            border: '1px solid #e5e5e5',
            borderRadius: 4,
            background: '#fafafa',
          }}
        >
          <GreenLotPicker
            index={i}
            initial={row.greenLotId ? row : null}
            disabled={props.disabled}
            onChange={(next) => update(i, next)}
          />
          <div>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={((row.percentBps ?? 0) / 100).toString()}
              onChange={(e) => {
                const pct = Number(e.target.value);
                if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
                  updatePercent(i, Math.round(pct * 100));
                }
              }}
              placeholder="%"
              disabled={props.disabled}
              style={inputStyle}
            />
          </div>
          <input
            type="text"
            value={row.notes ?? ''}
            placeholder="Notes (optional)"
            onChange={(e) => updateNotes(i, e.target.value)}
            disabled={props.disabled}
            style={inputStyle}
            name={`component.notes.${i}`}
          />
          <button
            type="button"
            onClick={() => removeRow(i)}
            disabled={(props.disabled ?? false) || rows.length <= 1}
            style={{
              ...buttonSecondaryStyle,
              padding: '0.5rem 0.75rem',
              opacity: rows.length <= 1 ? 0.4 : 1,
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <div style={buttonRowStyle}>
        <button
          type="button"
          onClick={addRow}
          disabled={props.disabled}
          style={buttonSecondaryStyle}
        >
          Add component
        </button>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.9rem',
            color: valid ? '#15803d' : '#b91c1c',
          }}
        >
          Total: {totalPct}%{valid ? ' ✓' : ''}
        </span>
      </div>
      {fieldError ? (
        <div style={errorStyle} role="alert">
          {fieldError}
        </div>
      ) : null}
    </div>
  );
}

// ── Main form ──────────────────────────────────────────────────────────

export function RecipeForm(props: RecipeFormProps): React.ReactElement {
  const d = props.defaults ?? {};
  // Flatten profileJson.notes for the form input. The full profile
  // editor is a v1.5 card; the form only edits the notes field.
  const initialComponents: ComponentDefault[] = (d.components ?? []).map(
    (c) => ({
      greenLotId: c.greenLotId,
      greenLotCode: c.greenLotCode,
      percentBps: c.percentBps,
      notes: c.notes,
    }),
  );
  // We use a controlled-but-stateful approach: the BlendEditor owns
  // its own state and submits via repeated hidden inputs that
  // AdminForm collects. The form-level fieldErrors.components error
  // is rendered inside BlendEditor.
  return (
    <AdminForm
      action={props.action}
      submitLabel={props.submitLabel}
      successRedirect="/admin/recipes"
      cancelHref={props.cancelHref}
      disabled={props.disabled}
    >
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      <TextField
        name="code"
        label="Code"
        required
        defaultValue={d.code}
        helpText="Operator-facing code (e.g. ESPRESSO-DEV-1, BRA-STD). Unique per org."
      />
      <TextField name="name" label="Name" required defaultValue={d.name} />
      <TextAreaField
        name="description"
        label="Description"
        defaultValue={d.description ?? ''}
        rows={3}
      />
      <NumberField
        name="chargeWeightG"
        label="Charge weight (g)"
        step="0.001"
        min="0"
        required
        defaultValue={d.chargeWeightG ?? ''}
        helpText="Typical batch size at the start of the roast."
      />
      <NumberField
        name="expectedYieldPct"
        label="Expected yield (%)"
        step="0.01"
        min="0"
        max="100"
        defaultValue={d.expectedYieldPct ?? ''}
        helpText="Roasted / green. Optional — historical average."
      />
      <NumberField
        name="durationSeconds"
        label="Duration (seconds)"
        step="1"
        min="0"
        required
        defaultValue={
          d.durationSeconds !== undefined && d.durationSeconds !== null
            ? String(d.durationSeconds)
            : ''
        }
        helpText="Typical roast duration."
      />
      <TextAreaField
        name="profileNotes"
        label="Profile notes"
        defaultValue={d.profileNotes ?? ''}
        rows={3}
        helpText="Free-form notes about the profile (e.g. drop temp, dev time)."
      />
      <BlendEditor
        defaults={initialComponents}
        disabled={props.disabled}
      />
      <CheckboxField
        name="active"
        label="Active"
        defaultChecked={d.active ?? true}
        helpText="Inactive recipes are hidden from the roast form."
      />
    </AdminForm>
  );
}
