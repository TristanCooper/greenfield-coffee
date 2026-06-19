// apps/web/src/app/signup/SignupForm.tsx
//
// Client Component: the organisation-creation form.
//
// Card 0.7.
//
// Fields:
//   - org_name (text, required, max 200 chars)
//   - country_code (select, one of 16 UK/EU codes)
//   - region (select, filtered to the country_code's region — v1 has a
//     1:1 mapping so the dropdown is read-only after country selection)
//   - base_currency (radio: EUR | GBP)
//
// On submit:
//   - POST to /api/organizations with the form payload.
//   - On 200 → router.push to /onboarding (which will then route to
//     the org dashboard now that the user has a membership).
//   - On 401 → "Your session has expired — please sign in again."
//   - On 4xx/5xx → display the server's error message verbatim.
//
// Why a Client Component:
//   Local form state (field values, pending flag, error). Server
//   Components can't hold React state.
//
// Country → region filtering:
//   v1 has a 1:1 mapping (the 16 UK/EU codes are each their own
//   region). We pass REGION_TO_COUNTRIES from @greenfield/db so the
//   UI's source of truth matches the server's validator. When v1.5
//   introduces multi-region countries, the same data shape still
//   works — just the dropdown will have multiple options.
//
// WHY THE PROPS:
//   The page (Server Component) reads the constants from
//   @greenfield/db and passes them down as props. Keeping the client
//   bundle out of the @greenfield/db barrel is important because the
//   barrel also exports the postgres-js `db` client, which pulls in
//   `fs` / `perf_hooks` / etc. — Node modules that webpack tries to
//   bundle into the browser build and fails. Splitting the db
//   package into a `@greenfield/db` (client-safe constants) and
//   `@greenfield/db/server` (runtime) is a Phase 1 cleanup; for
//   now we just keep client components out of the barrel.

'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type {
  BaseCurrency,
  CountryCode,
  RegionCode,
} from '@greenfield/db';

interface SignupFormProps {
  countryCodes: readonly CountryCode[];
  baseCurrencies: readonly BaseCurrency[];
  regionCountries: Record<RegionCode, readonly CountryCode[]>;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; message: string };

export function SignupForm({
  countryCodes,
  baseCurrencies,
  regionCountries,
}: SignupFormProps) {
  const router = useRouter();
  const [orgName, setOrgName] = useState('');
  const [countryCode, setCountryCode] = useState<CountryCode>('GB');
  const [baseCurrency, setBaseCurrency] = useState<BaseCurrency>('GBP');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // v1: country and region are 1:1. v1.5 may introduce multi-region
  // countries (e.g. Northern Ireland) — when that lands, this
  // becomes the lookup that drives the region dropdown options.
  const region: RegionCode = countryCode;
  const regionCountriesForSelection = regionCountries[region];

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (status.kind === 'submitting') return;

    const trimmedName = orgName.trim();
    if (trimmedName.length === 0) {
      setStatus({ kind: 'error', message: 'Organisation name is required.' });
      return;
    }
    if (trimmedName.length > 200) {
      setStatus({
        kind: 'error',
        message: 'Organisation name must be 200 characters or fewer.',
      });
      return;
    }

    setStatus({ kind: 'submitting' });
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          countryCode,
          region,
          baseCurrency,
        }),
      });
      if (res.status === 401) {
        setStatus({
          kind: 'error',
          message: 'Your session has expired. Please sign in again.',
        });
        return;
      }
      if (!res.ok) {
        // Surface server-supplied error message verbatim. The route
        // handler returns `{ error: { code, message } }` for failures.
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        const message =
          body.error?.message ??
          `Could not create organisation (HTTP ${res.status}).`;
        setStatus({ kind: 'error', message });
        return;
      }
      // Success → route to /onboarding, which will see the new
      // membership and redirect to the dashboard.
      router.push('/onboarding');
      router.refresh();
    } catch (e) {
      setStatus({
        kind: 'error',
        message:
          e instanceof Error
            ? e.message
            : 'Network error creating organisation.',
      });
    }
  }

  const disabled = status.kind === 'submitting';

  return (
    <form onSubmit={onSubmit} noValidate>
      <div style={{ marginBottom: '1rem' }}>
        <label
          htmlFor="org_name"
          style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}
        >
          Organisation name
        </label>
        <input
          id="org_name"
          name="org_name"
          type="text"
          required
          maxLength={200}
          autoComplete="organization"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          disabled={disabled}
          style={{
            width: '100%',
            padding: '0.6rem 0.7rem',
            fontSize: '1rem',
            border: '1px solid #ccc',
            borderRadius: 6,
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label
          htmlFor="country_code"
          style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}
        >
          Country
        </label>
        <select
          id="country_code"
          name="country_code"
          value={countryCode}
          onChange={(e) => setCountryCode(e.target.value as CountryCode)}
          disabled={disabled}
          style={{
            width: '100%',
            padding: '0.6rem 0.7rem',
            fontSize: '1rem',
            border: '1px solid #ccc',
            borderRadius: 6,
            boxSizing: 'border-box',
            background: '#fff',
          }}
        >
          {countryCodes.map((cc) => (
            <option key={cc} value={cc}>
              {cc}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label
          htmlFor="region"
          style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}
        >
          Region
        </label>
        <select
          id="region"
          name="region"
          value={region}
          // Read-only in v1 — region is derived from country_code.
          // The select still submits the value so the form payload
          // matches the schema validator.
          disabled
          style={{
            width: '100%',
            padding: '0.6rem 0.7rem',
            fontSize: '1rem',
            border: '1px solid #ccc',
            borderRadius: 6,
            boxSizing: 'border-box',
            background: '#f4f4f4',
            color: '#666',
          }}
        >
          {regionCountriesForSelection.map((cc) => (
            <option key={cc} value={cc}>
              {cc}
            </option>
          ))}
        </select>
        <p
          style={{
            margin: '0.25rem 0 0',
            fontSize: '0.85rem',
            color: '#666',
          }}
        >
          Region is set from your country in v1.
        </p>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <span
          style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}
        >
          Base currency
        </span>
        <div role="radiogroup" style={{ display: 'flex', gap: '1rem' }}>
          {baseCurrencies.map((currency) => (
            <label
              key={currency}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <input
                type="radio"
                name="base_currency"
                value={currency}
                checked={baseCurrency === currency}
                onChange={() => setBaseCurrency(currency)}
                disabled={disabled}
              />
              {currency}
            </label>
          ))}
        </div>
      </div>

      {status.kind === 'error' && (
        <p
          role="alert"
          style={{
            color: '#b00020',
            margin: '0.5rem 0 1rem',
            padding: '0.5rem',
            background: '#fff5f5',
            border: '1px solid #f5c6c6',
            borderRadius: 4,
          }}
        >
          {status.message}
        </p>
      )}

      <button
        type="submit"
        disabled={disabled}
        style={{
          marginTop: '0.5rem',
          width: '100%',
          padding: '0.7rem',
          fontSize: '1rem',
          background: disabled ? '#999' : '#111',
          color: '#fff',
          border: 0,
          borderRadius: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {status.kind === 'submitting'
          ? 'Creating organisation…'
          : 'Create organisation'}
      </button>
    </form>
  );
}