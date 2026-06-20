'use client';

// apps/web/src/app/(authenticated)/admin/customers/CustomerForm.tsx
//
// Card 0.16 — client-side form for Customer create + edit.
//
// The form mirrors the SkuForm shape (one component for both modes).
// Address fields are inline because v0 doesn't break out the address
// into a sub-table.

import {
  AdminForm,
  TextField,
  TextAreaField,
  CheckboxField,
} from '../_components/AdminForm';
import type { ActionResult } from '../_types';

export interface CustomerFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  defaults?: {
    id?: string;
    code?: string;
    name?: string;
    email?: string | null;
    phone?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    postalCode?: string | null;
    countryCode?: string | null;
    taxId?: string | null;
    notes?: string | null;
    active?: boolean;
  };
  submitLabel: string;
  cancelHref: string;
  disabled?: boolean;
}

export function CustomerForm(props: CustomerFormProps): React.ReactElement {
  const d = props.defaults ?? {};
  return (
    <AdminForm
      action={props.action}
      submitLabel={props.submitLabel}
      successRedirect="/admin/customers"
      cancelHref={props.cancelHref}
      disabled={props.disabled}
    >
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      <TextField
        name="code"
        label="Code"
        required
        defaultValue={d.code}
        helpText="Operator-facing code (e.g. ACME-WHOLESALE, SHOP-CUSTOMER-1). Unique per org."
      />
      <TextField name="name" label="Name" required defaultValue={d.name} />
      <TextField
        name="email"
        label="Email"
        type="email"
        defaultValue={d.email ?? ''}
      />
      <TextField
        name="phone"
        label="Phone"
        type="tel"
        defaultValue={d.phone ?? ''}
      />
      <TextField
        name="addressLine1"
        label="Address line 1"
        defaultValue={d.addressLine1 ?? ''}
      />
      <TextField
        name="addressLine2"
        label="Address line 2"
        defaultValue={d.addressLine2 ?? ''}
      />
      <TextField name="city" label="City" defaultValue={d.city ?? ''} />
      <TextField
        name="postalCode"
        label="Postal code"
        defaultValue={d.postalCode ?? ''}
      />
      <TextField
        name="countryCode"
        label="Country (ISO 3166-1 alpha-2)"
        defaultValue={d.countryCode ?? ''}
        placeholder="GB"
        helpText="Two-letter code, e.g. GB, DE, FR. Optional."
      />
      <TextField
        name="taxId"
        label="Tax ID / VAT number"
        defaultValue={d.taxId ?? ''}
        helpText="E.g. GB123456789. Used on invoices."
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
        helpText="Inactive customers are hidden from order creation."
      />
    </AdminForm>
  );
}
