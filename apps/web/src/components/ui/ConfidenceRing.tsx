'use client';

import { COLOR } from '@/lib/tokens';

/**
 * Confidence as a ring, not a number. The arc length *is* the value; the numeral is
 * secondary. A low-confidence ring stays visibly incomplete so an operator can see
 * the gap at a glance.
 */
export function ConfidenceRing({
  value,
  size = 46,
  thickness = 3,
  color = COLOR.cyan,
  label,
  showValue = true,
  pulse = false,
}: {
  /** 0..1 */
  value: number;
  size?: number;
  thickness?: number;
  color?: string;
  /** Micro caption under the numeral. */
  label?: string;
  showValue?: boolean;
  /** Ring breathes — use while a value is still being resolved. */
  pulse?: boolean;
}) {
  const v = Math.max(0, Math.min(1, value));
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * v;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label ?? 'Confidence'} ${Math.round(v * 100)}%`}
    >
      <svg width={size} height={size} className={pulse ? 'aura-breathe' : undefined}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={COLOR.inert}
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            filter: `drop-shadow(0 0 5px ${color})`,
            transition: 'stroke-dasharray 520ms cubic-bezier(0.16,1,0.3,1), stroke 320ms linear',
          }}
        />
      </svg>
      {showValue && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="aura-mono leading-none"
            style={{ fontSize: size * 0.26, color }}
          >
            {Math.round(v * 100)}
          </span>
          {label && (
            <span className="aura-label mt-0.5" style={{ fontSize: size * 0.13 }}>
              {label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
