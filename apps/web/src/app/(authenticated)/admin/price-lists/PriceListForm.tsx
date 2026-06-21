'use client';

// apps/web/src/app/(authenticated)/admin/price-lists/PriceListForm.tsx
//
// Card 0.16 — client-side form for Price List create + edit.
//
// The form has two parts:
//
//   1. List-level fields (code, name, kind, VAT mode, currency,
//      effective dates, etc).
//
//   2. Per-SKU entries (price_list_entry rows). The EntriesEditor
//      maintains an array of {skuId, priceMinorUnits, currencyCode,
//      vatRateBps, minQuantity} rows. Each row has a SKU picker
//      (combobox via /api/skus), a price input in minor units, a
//      currency override (defaults to the list's currency), and
//      optional VAT/min-quantity overrides.
//
// The action replaces the entry set wholesale on update — see
// apps/web/src/app/(authenticated)/admin/price-lists/actions.ts.

import { useState, useId } from 'react';
import {
  AdminForm,
  TextField,
  TextAreaField,
  NumberField,
  SelectField,
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
import { SkuPicker } from './_SkuPicker';

const KIND_OPTIONS = [
  { value: 'retail', label: 'Retail' },
  { value: 'wholesale', label: 'Wholesale' },
  { value: 'promo', label: 'Promo' },
  { value: 'internal', label: 'Internal' },
] as const;

const VAT_MODE_OPTIONS = [
  { value: 'inclusive', label: 'Inclusive (VAT already in the price)' },
  { value: 'exclusive', label: 'Exclusive (VAT added at checkout)' },
] as const;

export interface EntryDefault {
  skuId: string;
  skuCode?: string;
  skuName?: string;
  priceMinorUnits: number;
  currencyCode: string;
  vatRateBps: number | null;
  minQuantity: number | null;
}

export interface PriceListFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  defaults?: {
    id?: string;
    code?: string;
    name?: string;
    kind?: string;
    vatMode?: string;
    vatRatePct?: string | null;
    currencyCode?: string;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
    notes?: string | null;
    entries?: EntryDefault[];
    active?: boolean;
  };
  submitLabel: string;
  cancelHref: string;
  disabled?: boolean;
}

interface EntryRow {
  skuId: string;
  skuCode?: string;
  skuName?: string;
  priceMinorUnits: number;
  currencyCode: string;
  vatRateBps: number | null;
  minQuantity: number | null;
}

function EntriesEditor(props: {
  defaults: EntryDefault[];
  defaultCurrency: string;
  disabled?: boolean;
}): React.ReactElement {
  const [rows, setRows] = useState<EntryRow[]>(
    props.defaults.length > 0
      ? props.defaults
      : [
          {
            skuId: '',
            priceMinorUnits: 0,
            currencyCode: props.defaultCurrency,
            vatRateBps: null,
            minQuantity: null,
          },
        ],
  );
  const rowsId = useId();
  const fieldError = useFieldError('entries');

  const updateRow = (index: number, patch: Partial<EntryRow>) => {
    setRows((prev) => {
      const cp = [...prev];
      cp[index] = { ...cp[index]!, ...patch };
      return cp;
    });
  };
  const removeRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };
  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        skuId: '',
        priceMinorUnits: 0,
        currencyCode: props.defaultCurrency,
        vatRateBps: null,
        minQuantity: null,
      },
    ]);
  };

  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={labelStyle}>Entries</label>
      <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: '#737373' }}>
        Each row: a SKU, the price in minor units (cents), and optional per-SKU
        overrides (currency, VAT rate bps, min quantity for volume discount).
      </p>
      {rows.map((row, i) => (
        <div
          key={`${rowsId}-${i}`}
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 0.6fr 0.7fr 0.6fr auto',
            gap: '0.5rem',
            alignItems: 'start',
            marginBottom: '0.5rem',
            padding: '0.5rem',
            border: '1px solid #e5e5e5',
            borderRadius: 4,
            background: '#fafafa',
          }}
        >
          <SkuPicker
            index={i}
            initial={row.skuId ? { skuId: row.skuId, skuCode: row.skuCode, skuName: row.skuName } : null}
            disabled={props.disabled}
            onChange={(next) => {
              if (next === null) {
                updateRow(i, { skuId: '', skuCode: undefined, skuName: undefined });
              } else {
                updateRow(i, { skuId: next.skuId, skuCode: next.skuCode, skuName: next.skuName });
              }
            }}
          />
          <input
            type="number"
            min="0"
            step="1"
            value={row.priceMinorUnits ?? ''}
            placeholder="Cents"
            onChange={(e) => updateRow(i, { priceMinorUnits: Number(e.target.value) || 0 })}
            disabled={props.disabled}
            name={`entry.priceMinorUnits.${i}`}
            style={inputStyle}
          />
          <input
            type="text"
            maxLength={3}
            value={row.currencyCode}
            placeholder="CUR"
            onChange={(e) => updateRow(i, { currencyCode: e.target.value.toUpperCase() })}
            disabled={props.disabled}
            name={`entry.currencyCode.${i}`}
            style={inputStyle}
          />
          <input
            type="number"
            min="0"
            max="9999"
            step="1"
            value={row.vatRateBps ?? ''}
            placeholder="VAT bps"
            onChange={(e) =>
              updateRow(i, {
                vatRateBps: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            disabled={props.disabled}
            name={`entry.vatRateBps.${i}`}
            style={inputStyle}
            title="VAT rate in basis points (2000 = 20%). Leave blank to inherit the list's rate."
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={row.minQuantity ?? ''}
            placeholder="Min qty"
            onChange={(e) =>
              updateRow(i, {
                minQuantity: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            disabled={props.disabled}
            name={`entry.minQuantity.${i}`}
            style={inputStyle}
            title="Minimum quantity for this price to apply (volume discount)."
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
          Add entry
        </button>
      </div>
      {fieldError ? (
        <div style={errorStyle} role="alert">
          {fieldError}
        </div>
      ) : null}
    </div>
  );
}

export function PriceListForm(props: PriceListFormProps): React.ReactElement {
  const d = props.defaults ?? {};
  const defaultCurrency = d.currencyCode ?? 'GBP';
  return (
    <AdminForm
      action={props.action}
      submitLabel={props.submitLabel}
      successRedirect="/admin/price-lists"
      cancelHref={props.cancelHref}
      disabled={props.disabled}
    >
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      <TextField
        name="code"
        label="Code"
        required
        defaultValue={d.code}
        helpText="Operator-facing code (e.g. RETAIL-EU-2026, WHOLESALE-UK-Q4). Unique per org."
      />
      <TextField name="name" label="Name" required defaultValue={d.name} />
      <SelectField
        name="kind"
        label="Kind"
        required
        defaultValue={d.kind ?? 'retail'}
        options={KIND_OPTIONS}
      />
      <SelectField
        name="vatMode"
        label="VAT mode"
        required
        defaultValue={d.vatMode ?? 'exclusive'}
        options={VAT_MODE_OPTIONS}
      />
      <NumberField
        name="vatRatePct"
        label="Default VAT rate (%)"
        step="0.01"
        min="0"
        max="99.99"
        defaultValue={d.vatRatePct ?? ''}
        helpText="List-level default. Per-SKU overrides below."
      />
      <TextField
        name="currencyCode"
        label="Currency (ISO 4217)"
        required
        defaultValue={defaultCurrency}
        placeholder="GBP"
        helpText="3-letter code. Entries inherit this unless overridden."
      />
      <TextField
        name="effectiveFrom"
        label="Effective from"
        type="text"
        defaultValue={d.effectiveFrom ?? ''}
        placeholder="YYYY-MM-DD"
        helpText="Optional. List is eligible from this date."
      />
      <TextField
        name="effectiveTo"
        label="Effective to"
        type="text"
        defaultValue={d.effectiveTo ?? ''}
        placeholder="YYYY-MM-DD"
        helpText="Optional. List stops being eligible at this date."
      />
      <TextAreaField
        name="notes"
        label="Notes"
        defaultValue={d.notes ?? ''}
        rows={3}
      />
      <EntriesEditor
        defaults={d.entries ?? []}
        defaultCurrency={defaultCurrency}
        disabled={props.disabled}
      />
      <CheckboxField
        name="active"
        label="Active"
        defaultChecked={d.active ?? true}
        helpText="Inactive price lists are hidden from order creation."
      />
    </AdminForm>
  );
}
