'use client';

// apps/web/src/app/(authenticated)/receiving/green/new/useAutosaveDraft.ts
//
// Card 0.17 — localStorage autosave for the receiving wizard.
//
// The form data persists across accidental navigation. On
// mount, the hook reads the draft for the supplied key. On
// every state change, it schedules a save (throttled to
// once per 5 seconds).
//
// KEY
//
//   The key is supplied by the caller (the wizard). It's
//   keyed by userId + lotCode so different users and
//   different lots don't collide.
//
// STORAGE FAILURE
//
//   localStorage may be disabled (private browsing, security
//   policies, full quota). The hook swallows those errors
//   silently — the form still works in-memory; we just
//   can't persist drafts. We surface a console warning so
//   the operator notices.

import { useEffect, useRef } from 'react';
import type { WizardState } from './types';

interface AutosaveOptions {
  key: string;
  state: WizardState;
  enabled: boolean;
  onLoaded: (loaded: WizardState | null) => void;
  throttleMs?: number;
}

export function useAutosaveDraft(opts: AutosaveOptions): void {
  const { key, state, enabled, onLoaded, throttleMs = 5000 } = opts;
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const loadedRef = useRef(false);
  const lastSaveRef = useRef(0);

  // Load on mount.
  useEffect(() => {
    if (!enabled) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        onLoadedRef.current(null);
        return;
      }
      const parsed = JSON.parse(raw) as WizardState;
      onLoadedRef.current(parsed);
    } catch (e) {
      console.warn('Autosave load failed:', e);
      onLoadedRef.current(null);
    }
  }, [key, enabled]);

  // Save on every state change, throttled.
  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const sinceLast = now - lastSaveRef.current;
    if (sinceLast < throttleMs) return;
    lastSaveRef.current = now;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch (e) {
      console.warn('Autosave save failed:', e);
    }
  }, [key, state, enabled, throttleMs]);
}
