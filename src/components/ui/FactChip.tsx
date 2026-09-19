'use client';

import { motion } from 'framer-motion';

import type { FactEntry } from '@/state/auraStore';
import { COLOR, EASE, withAlpha } from '@/lib/tokens';

/**
 * A structured fact.
 *
 * Confirmed facts animate in as a lit chip. Missing information stays visibly dark
 * and hollow — a dashed outline with no value — so the gap reads as a gap and never
 * as "nothing to see here". Critical gaps are outlined in amber.
 */
export function FactChip({ fact }: { fact: FactEntry }) {
  const missing = fact.state === 'missing';
  const accent = missing
    ? fact.critical
      ? COLOR.amber
      : COLOR.muted
    : fact.critical
      ? COLOR.cyan
      : COLOR.muted;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.34, ease: EASE.out }}
      className="flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5"
      style={
        missing
          ? {
              border: `1px dashed ${withAlpha(accent, 0.42)}`,
              background: 'rgba(3, 8, 20, 0.5)',
            }
          : {
              border: `1px solid ${withAlpha(accent, 0.34)}`,
              background: `linear-gradient(180deg, ${withAlpha(accent, 0.1)}, rgba(3,8,20,0.55))`,
              boxShadow: `inset 0 0 18px ${withAlpha(accent, 0.09)}`,
            }
      }
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={
          missing
            ? { border: `1px solid ${withAlpha(accent, 0.6)}` }
            : { background: accent, boxShadow: `0 0 8px ${accent}` }
        }
        aria-hidden
      />
      <span className="flex min-w-0 flex-col">
        <span className="aura-label" style={{ fontSize: 8.5 }}>
          {fact.label}
        </span>
        {missing ? (
          <span
            className="aura-mono truncate"
            style={{ fontSize: 11, color: withAlpha(accent, 0.55) }}
          >
            {fact.critical ? 'REQUIRED · UNKNOWN' : 'unknown'}
          </span>
        ) : (
          <span className="aura-mono truncate" style={{ fontSize: 11.5, color: COLOR.text }}>
            {fact.value}
          </span>
        )}
      </span>
      {!missing && fact.confidence < 0.85 && (
        <span
          className="aura-mono ml-auto shrink-0"
          style={{ fontSize: 9, color: withAlpha(COLOR.amber, 0.9) }}
          title="Low confidence"
        >
          {Math.round(fact.confidence * 100)}
        </span>
      )}
    </motion.div>
  );
}
