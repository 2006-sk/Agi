/**
 * AURA design tokens.
 *
 * Neon colour carries meaning — never decoration. The same values exist as CSS
 * custom properties in globals.css; this module is for code that needs raw hex
 * (three.js materials, canvas, inline SVG gradients).
 */

import type { IncidentCategory, Priority } from '@/types/events';

export const COLOR = {
  /** Listening / caller audio / neutral-active. */
  cyan: '#22d3ee',
  /** Reasoning / AURA speaking / protocol thinking. */
  violet: '#a855f7',
  /** Urgent. */
  amber: '#f59e0b',
  /** Critical. */
  red: '#ef4444',
  /** Approved response / go signal. */
  green: '#22c55e',
  /** Structure: building edges at rest. */
  edge: '#1e3a5f',
  /** Deep navy ground. */
  ground: '#03060f',
  /** Fog / atmosphere. */
  fog: '#050b1a',
  /** Muted text and hollow outlines. */
  muted: '#64748b',
  /** Inert / missing information. */
  inert: '#1c2436',
  /** Primary readable text. */
  text: '#e2e8f4',
} as const;

export type SemanticColor = keyof typeof COLOR;

/** Priority → neon meaning. Amber is urgent, red is critical. */
export const PRIORITY_COLOR: Record<Priority, string> = {
  unknown: COLOR.muted,
  low: COLOR.cyan,
  medium: COLOR.cyan,
  high: COLOR.amber,
  critical: COLOR.red,
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  unknown: 'UNCLASSIFIED',
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'URGENT',
  critical: 'CRITICAL',
};

export const CATEGORY_COLOR: Record<IncidentCategory, string> = {
  medical: COLOR.cyan,
  fire: COLOR.amber,
  police: COLOR.violet,
  unknown: COLOR.muted,
};

export const CATEGORY_LABEL: Record<IncidentCategory, string> = {
  medical: 'MEDICAL',
  fire: 'FIRE',
  police: 'POLICE',
  unknown: 'UNKNOWN',
};

export const CATEGORY_GLYPH: Record<IncidentCategory, string> = {
  medical: '✚',
  fire: '▲',
  police: '◆',
  unknown: '?',
};

/** Speaker → colour. Cyan = caller/listening, violet = AURA/reasoning. */
export const SPEAKER_COLOR = {
  caller: COLOR.cyan,
  aura: COLOR.violet,
} as const;

/** Convert a hex string to a 0xRRGGBB number for three.js. */
export function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/** rgba() string from a hex token plus alpha — for CSS gradients and shadows. */
export function withAlpha(hex: string, alpha: number): string {
  const n = hexToInt(hex);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Shared easing curves so 2D and 3D motion feel like one system. */
export const EASE = {
  /** Default UI entrance. */
  out: [0.16, 1, 0.3, 1] as const,
  /** Snappy, for state flips. */
  snap: [0.4, 0, 0.2, 1] as const,
};

export const DURATION = {
  fast: 0.18,
  base: 0.32,
  slow: 0.6,
} as const;
