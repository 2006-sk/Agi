'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useSignalPulse } from '@/hooks/useSignal';
import { COLOR, SPEAKER_COLOR, withAlpha } from '@/lib/tokens';
import { useAuraStore } from '@/state/auraStore';

/** How fast the smoothed level chases the incoming one, per frame. */
const LERP = 0.17;

export function VoiceOrb({
  callId,
  size = 44,
  className = '',
}: {
  callId: string;
  size?: number;
  className?: string;
}) {
  // One primitive per selector — never the whole call object.
  const level = useAuraStore((s) => s.calls[callId]?.level ?? 0);
  const speaker = useAuraStore((s) => s.calls[callId]?.speaker ?? 'caller');
  const critical = useAuraStore((s) => s.calls[callId]?.priority === 'critical');
  const ended = useAuraStore((s) => s.calls[callId]?.status === 'ended');
  const isActive = useAuraStore((s) => s.activeCallId === callId);
  const reducedMotion = useAuraStore((s) => s.reducedMotion);
  const degraded = useAuraStore((s) => s.degraded);

  const interrupted = useSignalPulse('interrupt', 340);
  const clipped = interrupted && isActive && !ended;

  // Nothing animates for a backgrounded or finished call, or in the collapsed modes.
  const still = reducedMotion || degraded || ended || !isActive;

  const color = critical ? COLOR.red : SPEAKER_COLOR[speaker];

  const haloRef = useRef<HTMLSpanElement>(null);
  const outerRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const coreRef = useRef<HTMLSpanElement>(null);

  const target = useRef(0);
  const smooth = useRef(0);

  const paint = useCallback(
    (v: number) => {
      const halo = haloRef.current;
      if (halo) {
        halo.style.transform = `scale(${(0.8 + v * 0.45).toFixed(3)})`;
        halo.style.opacity = (0.14 + v * 0.66).toFixed(3);
        // Quantised so a slowly drifting level doesn't repaint the blur every frame.
        const blur = Math.round(size * (0.09 + v * 0.14) * 2) / 2;
        halo.style.filter = `blur(${blur}px)`;
      }
      const outer = outerRef.current;
      if (outer) {
        outer.style.transform = `scale(${(0.9 + v * 0.44).toFixed(3)})`;
        outer.style.opacity = (0.22 + v * 0.6).toFixed(3);
      }
      const inner = innerRef.current;
      if (inner) {
        inner.style.transform = `scale(${(0.95 + v * 0.24).toFixed(3)})`;
        inner.style.opacity = (0.4 + v * 0.5).toFixed(3);
      }
      const core = coreRef.current;
      if (core) {
        core.style.transform = `scale(${(0.88 + v * 0.28).toFixed(3)})`;
        core.style.opacity = (0.66 + v * 0.34).toFixed(3);
      }
    },
    [size],
  );

  // Latest level lands in a ref outside render; in still mode it also paints directly.
  useEffect(() => {
    target.current = level;
    if (still) {
      smooth.current = level;
      paint(level);
    }
  }, [level, still, paint]);

  useEffect(() => {
    if (still) return;
    let raf = 0;
    const tick = () => {
      smooth.current += (target.current - smooth.current) * LERP;
      paint(smooth.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [still, paint]);

  // AURA cut off mid-sentence: snap the orb shut instead of letting it decay.
  useEffect(() => {
    if (!clipped) return;
    target.current = 0;
    smooth.current = 0;
    paint(0);
  }, [clipped, paint]);

  const ringRadius = '9999px';

  return (
    <span
      aria-hidden
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        opacity: ended ? 0.34 : isActive ? 1 : 0.56,
        filter: clipped ? 'saturate(0.12) brightness(0.62)' : undefined,
        transition: clipped ? 'none' : 'filter 240ms linear, opacity 240ms linear',
      }}
    >
      <span
        ref={haloRef}
        className="pointer-events-none absolute"
        style={{
          inset: -size * 0.28,
          borderRadius: ringRadius,
          background: `radial-gradient(circle at 50% 50%, ${withAlpha(color, 0.62)} 0%, ${withAlpha(color, 0.16)} 48%, transparent 72%)`,
          transform: 'scale(0.8)',
          opacity: 0.14,
          filter: `blur(${Math.round(size * 0.09 * 2) / 2}px)`,
          willChange: still ? undefined : 'transform, opacity',
        }}
      />
      <span
        ref={outerRef}
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: ringRadius,
          border: `1px solid ${withAlpha(color, 0.5)}`,
          transform: 'scale(0.9)',
          opacity: 0.22,
          willChange: still ? undefined : 'transform, opacity',
        }}
      />
      <span
        ref={innerRef}
        className="pointer-events-none absolute"
        style={{
          inset: size * 0.17,
          borderRadius: ringRadius,
          border: `1px solid ${withAlpha(color, 0.75)}`,
          boxShadow: `inset 0 0 ${size * 0.16}px ${withAlpha(color, 0.45)}`,
          transform: 'scale(0.95)',
          opacity: 0.4,
          willChange: still ? undefined : 'transform, opacity',
        }}
      />
      <span
        ref={coreRef}
        className="pointer-events-none absolute"
        style={{
          inset: size * 0.31,
          borderRadius: ringRadius,
          background: `radial-gradient(circle at 38% 32%, ${withAlpha('#ffffff', 0.72)} 0%, ${color} 58%, ${color} 100%)`,
          boxShadow: `0 0 ${size * 0.34}px ${withAlpha(color, 0.85)}`,
          transform: 'scale(0.88)',
          opacity: 0.66,
          willChange: still ? undefined : 'transform, opacity',
        }}
      />
    </span>
  );
}
