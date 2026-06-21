'use client';

// apps/web/src/app/(authenticated)/admin/packagings/PackagingForm.tsx
//
// Card 0.16 — Packaging create + edit form.

import {
  AdminForm,
  TextField,
  TextAreaField,
  NumberField,
  SelectField,
  CheckboxField,
} from '../_components/AdminForm';
import type { ActionResult } from '../_types';

const MATERIAL_OPTIONS = [
  { value: 'valve_bag', label: 'Valve bag' },
  { value: 'pillow_bag', label: 'Pillow bag' },
  { value: 'tin', label: 'Tin' },
  { value: 'case', label: 'Case' },
  { value: 'pouch', label: 'Pouch' },
  { value: 'pod', label: 'Pod' },
  { value: 'other', label: 'Other' },
] as const;

export interface PackagingFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  defaults?: {
    id?: string;
    code?: string;
    name?: string;
    material?: string;
    tareWeightG?: string | null;
    capacityG?: string | null;
    costMinorUnits?: number | null;
    notes?: string | null;
    active?: boolean;
  };
  submitLabel: string;
  cancelHref: string;
  disabled?: boolean;
}

export function PackagingForm(props: PackagingFormProps): React.ReactElement {
  const d = props.defaults ?? {};
  return (
    <AdminForm
      action={props.action}
      submitLabel={props.submitLabel}
      successRedirect="/admin/packagings"
      cancelHref={props.cancelHref}
      disabled={props.disabled}
    >
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      <TextField
        name="code"
        label="Code"
        required
        defaultValue={d.code}
        helpText="Operator-facing code (e.g. VB-250, CASE-12). Unique per org."
      />
      <TextField name="name" label="Name" required defaultValue={d.name} />
      <SelectField
        name="material"
        label="Material"
        required
        defaultValue={d.material ?? 'valve_bag'}
        options={MATERIAL_OPTIONS}
      />
      <NumberField
        name="tareWeightG"
        label="Tare weight (g)"
        step="0.001"
        min="0"
        defaultValue={d.tareWeightG ?? '0'}
        helpText="Net weight of the empty packaging. Use 0 for cardboard tubes."
      />
      <NumberField
        name="capacityG"
        label="Capacity (g)"
        step="0.001"
        min="0"
        required
        defaultValue={d.capacityG ?? ''}
        helpText="Maximum net weight the packaging can hold."
      />
      <NumberField
        name="costMinorUnits"
        label="Cost per unit (minor units)"
        step="1"
        min="0"
        defaultValue={
          d.costMinorUnits !== undefined && d.costMinorUnits !== null
            ? String(d.costMinorUnits)
            : '0'
        }
        helpText="Integer cents. Currency = org.base_currency. 0 if free / supplied."
      />
      <TextAreaField
        name="notes"
        label="Notes"
        defaultValue={d.notes ?? ''}
        rows={3}
      />
      <CheckboxField
        name="active"
        label="Active"
        defaultChecked={d.active ?? true}
        helpText="Inactive packagings are hidden from the pack form."
      />
    </AdminForm>
  );
}
