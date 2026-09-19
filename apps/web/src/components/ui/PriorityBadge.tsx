'use client';

import type { IncidentCategory, Priority } from '@/types/events';
import {
  CATEGORY_GLYPH,
  CATEGORY_LABEL,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  withAlpha,
} from '@/lib/tokens';

/** Priority as a neon chit. Colour carries the meaning; the word confirms it. */
export function PriorityBadge({
  priority,
  category,
  size = 'md',
  pulse = false,
}: {
  priority: Priority;
  category?: IncidentCategory;
  size?: 'sm' | 'md';
  /** Set while critical — a slow, unmistakable breath. */
  pulse?: boolean;
}) {
  const color = PRIORITY_COLOR[priority];
  const small = size === 'sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${
        small ? 'px-1.5 py-[2px]' : 'px-2.5 py-1'
      } ${pulse ? 'aura-breathe' : ''}`}
      style={{
        borderColor: withAlpha(color, 0.45),
        background: withAlpha(color, 0.1),
        boxShadow: `inset 0 0 12px ${withAlpha(color, 0.14)}, 0 0 10px ${withAlpha(color, 0.18)}`,
      }}
    >
      {category && category !== 'unknown' && (
        <span
          className="leading-none"
          style={{ color, fontSize: small ? 8 : 10 }}
          aria-hidden
        >
          {CATEGORY_GLYPH[category]}
        </span>
      )}
      <span
        className="aura-mono uppercase leading-none"
        style={{
          color,
          fontSize: small ? 8.5 : 10,
          letterSpacing: '0.14em',
          textShadow: `0 0 8px ${withAlpha(color, 0.6)}`,
        }}
      >
        {category && category !== 'unknown' && !small
          ? `${CATEGORY_LABEL[category]} · ${PRIORITY_LABEL[priority]}`
          : PRIORITY_LABEL[priority]}
      </span>
    </span>
  );
}
