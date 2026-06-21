'use client';

// apps/web/src/app/(authenticated)/admin/suppliers/SupplierForm.tsx
//
// Card 0.16 — client-side form for Supplier create + edit.
//
// The form's defining feature is the risk_assessment editor — a
// structured set of radio buttons for each of (country, producer,
// supply-chain, overall) risk levels (low/medium/high/unassessed)
// plus the legacy fields (last_reviewed_at, dds_filed_by_supplier,
// notes). See ./risk-assessment.ts.

import {
  AdminForm,
  TextField,
  TextAreaField,
  CheckboxField,
  SelectField,
  useFieldError,
} from '../_components/AdminForm';
import {
  labelStyle,
  errorStyle,
} from '@/lib/admin/styles';
import type { ActionResult } from '../_types';
import type { RiskLevel } from './risk-assessment';

const RISK_OPTIONS: readonly { value: RiskLevel; label: string }[] = [
  { value: 'unassessed', label: 'Unassessed' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export interface SupplierFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  defaults?: {
    id?: string;
    name?: string;
    countryCode?: string;
    eori?: string | null;
    ddsReference?: string | null;
    contact?: { email?: string | null; phone?: string | null; address?: string | null };
    risk?: {
      country_risk: RiskLevel;
      producer_risk: RiskLevel;
      supply_chain_risk: RiskLevel;
      overall_risk: RiskLevel;
      last_reviewed_at: string | null;
      dds_filed_by_supplier: boolean;
      notes: string;
    };
  };
  submitLabel: string;
  cancelHref: string;
  disabled?: boolean;
}

function RiskEditor(props: {
  defaults: NonNullable<SupplierFormProps['defaults']>['risk'];
  disabled?: boolean;
}): React.ReactElement {
  const d = props.defaults;
  if (!d) return <></>;
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ ...labelStyle, marginBottom: '0.5rem' }}>
        Risk assessment
      </label>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: '#737373' }}>
        EUDR-aligned structured risk assessment. Each axis is low / medium /
        high / unassessed. The overall rating is a summary of the three
        component ratings — pick what the team has agreed on.
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
          gap: '0.75rem',
        }}
      >
        <RiskSelect name="risk.country" label="Country risk" defaultValue={d.country_risk} disabled={props.disabled} />
        <RiskSelect name="risk.producer" label="Producer risk" defaultValue={d.producer_risk} disabled={props.disabled} />
        <RiskSelect name="risk.supplyChain" label="Supply chain risk" defaultValue={d.supply_chain_risk} disabled={props.disabled} />
        <RiskSelect name="risk.overall" label="Overall risk" defaultValue={d.overall_risk} disabled={props.disabled} />
      </div>
      <div style={{ marginTop: '0.75rem' }}>
        <TextField
          name="risk.lastReviewedAt"
          label="Last reviewed (ISO 8601 date)"
          defaultValue={d.last_reviewed_at ?? ''}
          helpText="YYYY-MM-DD or full timestamp. Optional."
        />
      </div>
      <CheckboxField
        name="risk.ddsFiledBySupplier"
        label="DDS filed by supplier"
        defaultChecked={d.dds_filed_by_supplier}
        helpText="Supplier has filed their own Due Diligence Statement upstream."
      />
      <TextAreaField
        name="risk.notes"
        label="Risk notes"
        defaultValue={d.notes}
        rows={3}
        helpText="Free-form notes about the assessment."
      />
    </div>
  );
}

function RiskSelect(props: {
  name: string;
  label: string;
  defaultValue: RiskLevel;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <SelectField
      name={props.name}
      label={props.label}
      required
      defaultValue={props.defaultValue}
      options={RISK_OPTIONS}
    />
  );
}

function ContactEditor(props: {
  defaults: NonNullable<SupplierFormProps['defaults']>['contact'];
  disabled?: boolean;
}): React.ReactElement {
  const d = props.defaults ?? {};
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={labelStyle}>Contact</label>
      <TextField
        name="contact.email"
        label="Email"
        type="email"
        defaultValue={d.email ?? ''}
      />
      <TextField
        name="contact.phone"
        label="Phone"
        type="tel"
        defaultValue={d.phone ?? ''}
      />
      <TextField
        name="contact.address"
        label="Address"
        defaultValue={d.address ?? ''}
      />
    </div>
  );
}

export function SupplierForm(props: SupplierFormProps): React.ReactElement {
  const d = props.defaults ?? {};
  const fieldError = useFieldError('risk');
  return (
    <AdminForm
      action={props.action}
      submitLabel={props.submitLabel}
      successRedirect="/admin/suppliers"
      cancelHref={props.cancelHref}
      disabled={props.disabled}
    >
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      <TextField
        name="name"
        label="Name"
        required
        defaultValue={d.name}
        helpText="Operator-facing name. Unique per org."
      />
      <TextField
        name="countryCode"
        label="Country (ISO 3166-1 alpha-2)"
        required
        defaultValue={d.countryCode ?? ''}
        placeholder="BR"
        helpText="2-letter code, e.g. BR, CO, ET."
      />
      <TextField
        name="eori"
        label="EORI"
        defaultValue={d.eori ?? ''}
        helpText="Economic Operators Registration and Identification number. Optional."
      />
      <TextField
        name="ddsReference"
        label="DDS reference"
        defaultValue={d.ddsReference ?? ''}
        helpText="Supplier's upstream DDS reference (if filed). Optional."
      />
      <ContactEditor defaults={d.contact} disabled={props.disabled} />
      {fieldError ? <div style={errorStyle}>{fieldError}</div> : null}
      <RiskEditor defaults={d.risk} disabled={props.disabled} />
    </AdminForm>
  );
}
