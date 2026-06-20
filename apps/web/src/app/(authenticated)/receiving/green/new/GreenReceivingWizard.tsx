'use client';

// apps/web/src/app/(authenticated)/receiving/green/new/GreenReceivingWizard.tsx
//
// Card 0.17 / plan §7.4 — wizard shell.
//
// The wizard is a SINGLE form with 5 steps. It is NOT a
// multi-route flow — the entire form state lives in this
// component, and the step navigation is a `currentStep` state
// variable. The URL can reflect the step (?step=2) for
// shareable links, but the form data lives in the React
// state, not the URL.
//
// STEPS
//
//   1. Supplier & invoice
//   2. Producer & country
//   3. Lot details
//   4. Cost allocation
//   5. Risk review + submit
//
// AUTOSAVE
//
//   The form data is autosaved to localStorage on every change,
//   throttled to once per 5 seconds. The key is
//   `greenfield.receiving.draft.<userId>.<lotCode>` — the
//   lotCode is generated on mount (the user's first
//   suggested code) and used as the draft key. On mount, if
//   a draft exists for that key, the form restores from it.
//   On successful submit, the draft is cleared.
//
// SUBMIT
//
//   The submit calls a Server Action
//   (`createGreenLotAndFriends` in `./actions.ts`) which runs
//   a single DB transaction creating supplier, producer,
//   green_lot, EudrReferenceData, LandedCostEvents, and an
//   audit_event. On success, the wizard redirects to
//   /receiving/green/[id].

import { useEffect, useReducer, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { ReactElement } from 'react';
import type { WizardState, WizardAction } from './types';
import { wizardReducer, initialWizardState, totalWizardSteps, stepTitles } from './state';
import { useAutosaveDraft } from './useAutosaveDraft';
import { Step1Supplier } from './Step1Supplier';
import { Step2Producer } from './Step2Producer';
import { Step3Lot } from './Step3Lot';
import { Step4Cost } from './Step4Cost';
import { Step5Risk } from './Step5Risk';
import { createGreenLotAndFriends } from './actions';

interface WizardProps {
  orgId: string;
  orgName: string;
  baseCurrency: string;
  userId: string;
  userEmail: string;
  canSubmit: boolean;
}

export function GreenReceivingWizard(props: WizardProps): ReactElement {
  const router = useRouter();
  const [state, dispatch] = useReducer<WizardState, [WizardAction]>(
    wizardReducer,
    initialWizardState(props.baseCurrency),
  );
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  const draftKey = `greenfield.receiving.draft.${props.userId}.${state.lot.code || '_'}`;

  // Autosave hook. Loads on mount, saves on every state change
  // (throttled to 5s by the hook).
  useAutosaveDraft({
    key: draftKey,
    state,
    enabled: props.canSubmit,
    onLoaded: (loaded) => {
      if (loaded) {
        dispatch({ type: 'restore', payload: loaded });
        setDraftRestored(true);
      }
    },
  });

  // Clear the "draft restored" banner after 4s.
  useEffect(() => {
    if (!draftRestored) return;
    const t = setTimeout(() => setDraftRestored(false), 4000);
    return () => clearTimeout(t);
  }, [draftRestored]);

  // Generate a suggested lot code on mount.
  useEffect(() => {
    if (state.lot.code) return;
    const year = new Date().getFullYear();
    const code = `LOT-${year}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    dispatch({ type: 'lot', patch: { code } });
  }, [state.lot.code]);

  // Step navigation. We validate per-step before allowing advance.
  const canAdvance = (() => {
    switch (currentStep) {
      case 1:
        // Supplier + invoice amount + currency required.
        return Boolean(state.supplier.id || state.supplier.draftName) &&
          state.invoice.amountCents > 0 &&
          state.invoice.currencyCode.length === 3;
      case 2:
        return Boolean(state.producer.id || state.producer.draftName) &&
          state.lot.countryOfOrigin.length === 2 &&
          state.lot.harvestYear > 0;
      case 3:
        return (
          state.lot.code.length > 0 &&
          state.lot.weightKg > 0
        );
      case 4:
        return true; // Cost is optional (no events is valid).
      case 5:
        return state.risk.acknowledged || state.risk.overallLevel !== 'high';
      default:
        return false;
    }
  })();

  const onAdvance = useCallback(() => {
    if (!canAdvance) return;
    setCurrentStep((s) => Math.min(totalWizardSteps, s + 1));
  }, [canAdvance]);

  const onBack = useCallback(() => {
    setCurrentStep((s) => Math.max(1, s - 1));
  }, []);

  const onSubmit = useCallback(async () => {
    if (!canAdvance) return;
    if (!props.canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createGreenLotAndFriends({
        orgId: props.orgId,
        userId: props.userId,
        userRole: 'unknown', // server action reads role from session
        state,
      });
      if (!result.ok) {
        setSubmitError(result.error ?? 'Unknown error');
        setSubmitting(false);
        return;
      }
      // Clear the draft on success.
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // Ignore — localStorage may be disabled in some browsers.
      }
      router.push(`/receiving/green/${result.greenLotId}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Unknown error');
      setSubmitting(false);
    }
  }, [canAdvance, props.canSubmit, props.orgId, props.userId, state, router, draftKey]);

  if (!props.canSubmit) {
    return (
      <main style={mainStyle}>
        <h1 style={{ margin: '0 0 1rem' }}>Read-only</h1>
        <p>
          You are signed in as <strong>{props.userEmail}</strong>. Your role
          does not permit submitting green-lot receipts. Only{' '}
          <code>owner</code>, <code>head_roaster</code>,{' '}
          <code>buyer_receiving</code>, and <code>compliance_officer</code> can
          submit.
        </p>
        <p>
          <Link href="/onboarding">← Back to dashboard</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.25rem' }}>Receive green lot</h1>
        <p style={{ color: '#555', margin: 0 }}>
          {props.orgName} · base currency {props.baseCurrency}
        </p>
      </header>

      {draftRestored && (
        <div style={restoredBannerStyle}>
          Draft restored from your last session.
        </div>
      )}

      <Stepper currentStep={currentStep} />

      <section style={cardStyle}>
        {currentStep === 1 && (
          <Step1Supplier
            state={state}
            dispatch={dispatch}
            orgId={props.orgId}
          />
        )}
        {currentStep === 2 && (
          <Step2Producer
            state={state}
            dispatch={dispatch}
            orgId={props.orgId}
            baseCurrency={props.baseCurrency}
          />
        )}
        {currentStep === 3 && (
          <Step3Lot state={state} dispatch={dispatch} />
        )}
        {currentStep === 4 && (
          <Step4Cost
            state={state}
            dispatch={dispatch}
            baseCurrency={props.baseCurrency}
            orgId={props.orgId}
            fxRateLookup={async (from, to) => {
              const res = await fetch(
                `/api/fx-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
              );
              if (!res.ok) return null;
              const data = (await res.json()) as { rate: number | null };
              return data.rate;
            }}
          />
        )}
        {currentStep === 5 && (
          <Step5Risk state={state} dispatch={dispatch} />
        )}
      </section>

      {submitError && (
        <div style={errorStyle}>
          <strong>Submit failed:</strong> {submitError}
        </div>
      )}

      <nav style={navStyle}>
        <button
          type="button"
          onClick={onBack}
          disabled={currentStep === 1 || submitting}
          style={secondaryButtonStyle}
        >
          ← Back
        </button>
        <div style={{ flex: 1 }} />
        {currentStep < totalWizardSteps ? (
          <button
            type="button"
            onClick={onAdvance}
            disabled={!canAdvance}
            style={canAdvance ? primaryButtonStyle : disabledButtonStyle}
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canAdvance || submitting}
            style={
              !canAdvance || submitting
                ? disabledButtonStyle
                : primaryButtonStyle
            }
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        )}
      </nav>
    </main>
  );
}

// ── Stepper ───────────────────────────────────────────────────────────────

function Stepper({ currentStep }: { currentStep: number }): ReactElement {
  return (
    <ol style={stepperListStyle}>
      {stepTitles.map((title, i) => {
        const step = i + 1;
        const isCurrent = step === currentStep;
        const isDone = step < currentStep;
        return (
          <li
            key={title}
            style={{
              ...stepperItemStyle,
              color: isCurrent ? '#000' : isDone ? '#3a7' : '#888',
              fontWeight: isCurrent ? 600 : 400,
            }}
          >
            <span
              style={{
                ...stepperDotStyle,
                background: isCurrent ? '#3a7' : isDone ? '#3a7' : '#ccc',
              }}
            >
              {isDone ? '✓' : step}
            </span>{' '}
            {title}
          </li>
        );
      })}
    </ol>
  );
}

// ── Inline styles (kept here to avoid a CSS-in-JS dep) ─────────────────

const mainStyle: React.CSSProperties = {
  padding: '1.5rem',
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 720,
  margin: '0 auto',
  color: '#111',
};

const cardStyle: React.CSSProperties = {
  padding: '1.25rem',
  border: '1px solid #e5e5e5',
  borderRadius: 8,
  background: '#fff',
  marginBottom: '1rem',
};

const navStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  marginTop: '1rem',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  fontSize: '1rem',
  background: '#3a7',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: '#888',
};

const disabledButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: '#ccc',
  cursor: 'not-allowed',
};

const errorStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  background: '#fee',
  border: '1px solid #fcc',
  borderRadius: 4,
  color: '#a00',
  marginBottom: '1rem',
};

const restoredBannerStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: '#eef',
  border: '1px solid #ccd',
  borderRadius: 4,
  color: '#224',
  marginBottom: '1rem',
  fontSize: '0.9rem',
};

const stepperListStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
  listStyle: 'none',
  padding: 0,
  margin: '0 0 1.5rem',
  fontSize: '0.9rem',
};

const stepperItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
};

const stepperDotStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 12,
  color: '#fff',
  fontSize: '0.8rem',
};
