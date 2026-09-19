'use client';

import { useEffect } from 'react';
import { useAuraStore } from '@/state/auraStore';

/**
 * Mirrors `prefers-reduced-motion` into the store and onto <html> so CSS, Framer
 * Motion and the 3D scene all read one flag. Also reflects the degraded-renderer
 * flag, which the performance monitor sets when WebGL can't hold frame rate.
 */
export function useReducedMotionSync(): void {
  const setReducedMotion = useAuraStore((s) => s.setReducedMotion);
  const reducedMotion = useAuraStore((s) => s.reducedMotion);
  const degraded = useAuraStore((s) => s.degraded);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setReducedMotion]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    document.documentElement.dataset.degraded = String(degraded);
  }, [degraded]);
}

export function useReducedMotion(): boolean {
  return useAuraStore((s) => s.reducedMotion);
}
