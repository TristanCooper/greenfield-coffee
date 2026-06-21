// apps/web/src/app/(authenticated)/admin/skus/SkuForm.tsx
//
// Card 0.16 — client-side form component for SKU create + edit.
//
// One form component handles both create (no `id`) and edit (id
// pre-filled). The Server Component page decides which to render
// by passing the right server action.

'use client';

import { AdminForm, TextField, NumberField, CheckboxField, TextAreaField } from '../_components/AdminForm';
import type { ActionResult } from '../_types';

export interface SkuFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  defaults?: {
    id?: string;
    code?: string;
    name?: string;
    description?: string | null;
    unitWeightG?: string | null;
    wholesaleOnly?: boolean;
    tags?: string[];
    active?: boolean;
  };
  submitLabel: string;
  cancelHref: string;
  disabled?: boolean;
}

export function SkuForm(props: SkuFormProps): React.ReactElement {
  const d = props.defaults ?? {};
  return (
    <AdminForm
      action={props.action}
      submitLabel={props.submitLabel}
      successRedirect="/admin/skus"
      cancelHref={props.cancelHref}
      disabled={props.disabled}
    >
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      <TextField
        name="code"
        label="Code"
        required
        defaultValue={d.code}
        helpText="Operator-facing code (e.g. BRA-250, DECAF-COL-1K). Unique per org."
      />
      <TextField name="name" label="Name" required defaultValue={d.name} />
      <TextAreaField
        name="description"
        label="Description"
        defaultValue={d.description ?? ''}
        helpText="Shown on the bag label and the wholesale portal."
      />
      <NumberField
        name="unitWeightG"
        label="Unit weight (g)"
        step="0.001"
        min="0"
        defaultValue={d.unitWeightG ?? ''}
        helpText="Net weight of one SKU. Optional — leave blank for non-physical SKUs (gift cards)."
      />
      <TextField
        name="tagsText"
        label="Tags"
        defaultValue={(d.tags ?? []).join(', ')}
        helpText="Comma-separated. e.g. espresso, single-origin, decaf"
      />
      <CheckboxField
        name="wholesaleOnly"
        label="Wholesale only"
        defaultChecked={d.wholesaleOnly ?? false}
        helpText="Hide from retail channels (Shopify / POS)."
      />
      <CheckboxField
        name="active"
        label="Active"
        defaultChecked={d.active ?? true}
        helpText="Inactive SKUs are hidden from price lists and order creation."
      />
    </AdminForm>
  );
}
