// apps/web/src/app/(authenticated)/admin/_components/AdminForm.tsx
//
// Card 0.16 — generic client-side form shell for admin CRUD forms.
//
// Most admin forms follow the same shape: render inputs, submit via
// a server action, display field-level + form-level errors, redirect
// on success. Wrapping this in a Client Component lets each entity's
// form be a tiny Server Component that declares its fields and a
// submit action.
//
// USAGE
//
//   <AdminForm action={createSku} submitLabel="Create SKU" successRedirect="/admin/skus">
//     <TextField name="code" label="Code" required defaultValue="" />
//     <TextField name="name" label="Name" required />
//     <NumberField name="unitWeightG" label="Unit weight (g)" step="0.001" />
//     <CheckboxField name="active" label="Active" defaultChecked />
//   </AdminForm>
//
// The AdminForm:
//   - Wraps children in a <form action={action}> (React 19 form
//     action: when action returns, react re-renders with the result).
//   - Maintains pending state and disables the submit button while
//     the server action runs.
//   - Renders form-level errors at the top.
//   - On success, navigates to `successRedirect` via `useRouter.push`.
//   - Children can call useFieldError(name) to read a field's error.
//
// Children that render inputs are expected to set `name` (so React's
// form action collects them) and to call useFieldError(name) to read
// any server-side validation errors.

'use client';

import {
  useActionState,
  useEffect,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  buttonPrimaryStyle,
  buttonSecondaryStyle,
  buttonRowStyle,
  errorStyle,
  fieldStyle,
  inputStyle,
  labelStyle,
} from '@/lib/admin/styles';
import type { ActionResult } from '../_types';

export interface AdminFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  successRedirect?: string;
  cancelHref?: string;
  disabled?: boolean;
  children: ReactNode;
}

export function AdminForm(props: AdminFormProps): ReactElement {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (_prev: ActionResult | null, formData: FormData) => {
      const result = await props.action(formData);
      if (result.ok && props.successRedirect) {
        router.push(props.successRedirect);
      }
      return result;
    },
    null,
  );

  useEffect(() => {
    // If the action returned `id` but no `successRedirect`, the
    // caller handles the navigation (e.g. a multi-step form).
  }, [state]);

  return (
    <form action={formAction}>
      {state?.error ? <FormError message={state.error} /> : null}

      <FieldErrorProvider fieldErrors={state?.fieldErrors}>
        <fieldset disabled={props.disabled || pending} style={{ border: 'none', padding: 0, margin: 0 }}>
          {props.children}

          <div style={buttonRowStyle}>
            <button type="submit" disabled={pending} style={buttonPrimaryStyle}>
              {pending ? 'Saving…' : props.submitLabel}
            </button>
            {props.cancelHref ? (
              <a href={props.cancelHref} style={buttonSecondaryStyle}>
                Cancel
              </a>
            ) : null}
          </div>
        </fieldset>
      </FieldErrorProvider>
    </form>
  );
}

function FormError({ message }: { message: string }): ReactElement {
  return <div style={errorStyle} role="alert">{message}</div>;
}

// ── Field components ─────────────────────────────────────────────────────

export function TextField(props: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  type?: 'text' | 'email' | 'tel' | 'url' | 'password';
  helpText?: string;
}): ReactElement {
  // Field errors are read via context below. The component renders the
  // input unconditionally; useFieldError returns null if no error.
  const error = useFieldError(props.name);
  return (
    <div style={fieldStyle}>
      <label style={labelStyle} htmlFor={props.name}>
        {props.label}
        {props.required ? ' *' : ''}
      </label>
      <input
        id={props.name}
        name={props.name}
        type={props.type ?? 'text'}
        required={props.required}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        style={error ? { ...inputStyle, borderColor: '#b91c1c' } : inputStyle}
      />
      {error ? <FieldError message={error} /> : null}
      {props.helpText ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#737373' }}>
          {props.helpText}
        </p>
      ) : null}
    </div>
  );
}

export function NumberField(props: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  step?: string;
  min?: string;
  max?: string;
  helpText?: string;
}): ReactElement {
  const error = useFieldError(props.name);
  return (
    <div style={fieldStyle}>
      <label style={labelStyle} htmlFor={props.name}>
        {props.label}
        {props.required ? ' *' : ''}
      </label>
      <input
        id={props.name}
        name={props.name}
        type="number"
        inputMode="decimal"
        required={props.required}
        defaultValue={props.defaultValue}
        step={props.step ?? 'any'}
        min={props.min}
        max={props.max}
        style={error ? { ...inputStyle, borderColor: '#b91c1c' } : inputStyle}
      />
      {error ? <FieldError message={error} /> : null}
      {props.helpText ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#737373' }}>
          {props.helpText}
        </p>
      ) : null}
    </div>
  );
}

export function CheckboxField(props: {
  name: string;
  label: string;
  defaultChecked?: boolean;
  helpText?: string;
}): ReactElement {
  return (
    <div style={{ ...fieldStyle, flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
      <input
        id={props.name}
        name={props.name}
        type="checkbox"
        defaultChecked={props.defaultChecked}
      />
      <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor={props.name}>
        {props.label}
      </label>
      {props.helpText ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#737373' }}>
          {props.helpText}
        </p>
      ) : null}
    </div>
  );
}

export function TextAreaField(props: {
  name: string;
  label: string;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
  helpText?: string;
}): ReactElement {
  const error = useFieldError(props.name);
  return (
    <div style={fieldStyle}>
      <label style={labelStyle} htmlFor={props.name}>
        {props.label}
      </label>
      <textarea
        id={props.name}
        name={props.name}
        rows={props.rows ?? 4}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        style={error ? { ...inputStyle, borderColor: '#b91c1c', fontFamily: 'inherit', minHeight: '5rem' } : inputStyle}
      />
      {error ? <FieldError message={error} /> : null}
      {props.helpText ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#737373' }}>
          {props.helpText}
        </p>
      ) : null}
    </div>
  );
}

export function SelectField<T extends string>(props: {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  helpText?: string;
}): ReactElement {
  const error = useFieldError(props.name);
  return (
    <div style={fieldStyle}>
      <label style={labelStyle} htmlFor={props.name}>
        {props.label}
        {props.required ? ' *' : ''}
      </label>
      <select
        id={props.name}
        name={props.name}
        required={props.required}
        defaultValue={props.defaultValue}
        style={error ? { ...inputStyle, borderColor: '#b91c1c' } : inputStyle}
      >
        {props.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? <FieldError message={error} /> : null}
      {props.helpText ? (
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#737373' }}>
          {props.helpText}
        </p>
      ) : null}
    </div>
  );
}

// ── Field-error context ──────────────────────────────────────────────────
//
// AdminForm places a FieldErrorContext.Provider with the current
// action-state's fieldErrors. Children call useFieldError(name) to
// read their field's error(s). The context is intentionally scoped
// to this module — the form composes the provider once and the
// field components consume it.

import { createContext, useContext } from 'react';

interface FieldErrorCtx {
  fieldErrors: Record<string, string[]> | undefined;
}

const FieldErrorContext = createContext<FieldErrorCtx>({ fieldErrors: undefined });

export function FieldErrorProvider({
  fieldErrors,
  children,
}: {
  fieldErrors: Record<string, string[]> | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <FieldErrorContext.Provider value={{ fieldErrors }}>
      {children}
    </FieldErrorContext.Provider>
  );
}

function useFieldError(name: string): string | null {
  const { fieldErrors } = useContext(FieldErrorContext);
  if (!fieldErrors) return null;
  const list = fieldErrors[name];
  if (!list || list.length === 0) return null;
  return list.join(', ');
}

function FieldError({ message }: { message: string }): ReactElement {
  return (
    <p style={{ margin: 0, fontSize: '0.8rem', color: '#b91c1c' }} role="alert">
      {message}
    </p>
  );
}
