'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuraStore, type Signals } from '@/state/auraStore';

/**
 * Fires a one-shot animation when a store signal counter advances.
 *
 * Signals are counters, not booleans, so the same event can happen twice and still
 * retrigger. `useSignalPulse` returns true for `durationMs` after each advance.
 */
export function useSignalPulse(name: keyof Signals, durationMs = 700): boolean {
  const count = useAuraStore((s) => s.signals[name]);
  const [active, setActive] = useState(false);
  const seen = useRef(count);

  useEffect(() => {
    if (count === seen.current) return;
    seen.current = count;
    setActive(true);
    const t = window.setTimeout(() => setActive(false), durationMs);
    return () => window.clearTimeout(t);
  }, [count, durationMs]);

  return active;
}

/** Raw counter, for components that drive their own timeline off the change. */
export function useSignalCount(name: keyof Signals): number {
  return useAuraStore((s) => s.signals[name]);
}
