'use client';

// apps/web/src/app/(authenticated)/admin/producers/ProducerForm.tsx
//
// Card 0.16 — client-side form for Producer create + edit.
//
// Reuses the card 0.17 MapPicker via the GeoLocationEditor
// client component for the geolocation field.

import {
  AdminForm,
  TextField,
  TextAreaField,
  NumberField,
  SelectField,
} from '../_components/AdminForm';
import {
  useFieldError,
} from '../_components/AdminForm';
import { errorStyle } from '@/lib/admin/styles';
import type { ActionResult } from '../_types';
import { GeoLocationEditor } from './_GeoLocationEditor';

const VERIFICATION_OPTIONS = [
  { value: 'self_reported', label: 'Self reported' },
  { value: 'third_party_verified', label: 'Third-party verified' },
  { value: 'satellite_imagery', label: 'Satellite imagery' },
  { value: 'ground_survey', label: 'Ground survey' },
] as const;

export interface ProducerFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  defaults?: {
    id?: string;
    name?: string;
    countryCode?: string;
    region?: string | null;
    areaHectares?: number | null;
    verificationSource?: string;
    riskRating?: string | null;
    notes?: string | null;
    geolocation?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  };
  submitLabel: string;
  cancelHref: string;
  disabled?: boolean;
}

export function ProducerForm(props: ProducerFormProps): React.ReactElement {
  const d = props.defaults ?? {};
  const fieldError = useFieldError('geolocation');
  return (
    <AdminForm
      action={props.action}
      submitLabel={props.submitLabel}
      successRedirect="/admin/producers"
      cancelHref={props.cancelHref}
      disabled={props.disabled}
    >
      {d.id ? <input type="hidden" name="id" value={d.id} /> : null}
      <TextField
        name="name"
        label="Name"
        required
        defaultValue={d.name}
        helpText="Operator-facing name of the farm / cooperative."
      />
      <TextField
        name="countryCode"
        label="Country (ISO 3166-1 alpha-2)"
        required
        defaultValue={d.countryCode ?? ''}
        placeholder="BR"
      />
      <TextField
        name="region"
        label="Region"
        defaultValue={d.region ?? ''}
        placeholder="Sul de Minas"
        helpText="Sub-country region (state, department, etc.)."
      />
      <NumberField
        name="areaHectares"
        label="Area (hectares)"
        step="0.01"
        min="0"
        defaultValue={
          d.areaHectares !== undefined && d.areaHectares !== null
            ? String(d.areaHectares)
            : ''
        }
        helpText="The producer's CLAIMED area. The card 0.22 audit compares this to ST_Area(geolocation)."
      />
      <SelectField
        name="verificationSource"
        label="Verification source"
        required
        defaultValue={d.verificationSource ?? 'self_reported'}
        options={VERIFICATION_OPTIONS}
      />
      <TextField
        name="riskRating"
        label="Risk rating"
        defaultValue={d.riskRating ?? ''}
        placeholder="low / medium / high"
        helpText="Free-form. Mirrors supplier.risk.assessment for consistency."
      />
      <GeoLocationEditor
        initialGeojson={d.geolocation ?? null}
        initialAreaHectares={d.areaHectares ?? null}
        disabled={props.disabled}
      />
      {fieldError ? (
        <div style={errorStyle} role="alert">
          {fieldError}
        </div>
      ) : null}
      <TextAreaField
        name="notes"
        label="Notes"
        defaultValue={d.notes ?? ''}
        rows={3}
      />
    </AdminForm>
  );
}
