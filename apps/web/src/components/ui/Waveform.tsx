'use client';

import { useMemo } from 'react';

/**
 * Live waveform from the rolling `audio.level` window. Mirrored bars, newest on the
 * right, so a speaking caller reads as motion travelling toward now.
 */
export function Waveform({
  levels,
  color,
  width = 132,
  height = 26,
  bars = 30,
  active = true,
}: {
  levels: number[];
  color: string;
  width?: number;
  height?: number;
  bars?: number;
  active?: boolean;
}) {
  const sampled = useMemo(() => {
    const out: number[] = new Array(bars).fill(0);
    if (levels.length === 0) return out;
    // Take the most recent `bars` samples, padding the left with silence.
    const start = Math.max(0, levels.length - bars);
    const recent = levels.slice(start);
    const offset = bars - recent.length;
    for (let i = 0; i < recent.length; i++) out[offset + i] = recent[i];
    return out;
  }, [levels, bars]);

  const gap = 1.5;
  const barW = Math.max(1, (width - gap * (bars - 1)) / bars);
  const mid = height / 2;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 overflow-visible"
      aria-hidden
    >
      {sampled.map((level, i) => {
        // Recent samples read brighter — the trailing history fades out.
        const recency = 0.25 + (i / Math.max(1, bars - 1)) * 0.75;
        const h = Math.max(1.5, level * (height - 2));
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={mid - h / 2}
            width={barW}
            height={h}
            rx={barW / 2}
            fill={color}
            opacity={active ? recency * (0.35 + level * 0.65) : 0.18}
          />
        );
      })}
    </svg>
  );
}
