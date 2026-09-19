'use client';

import { useEffect, useState } from 'react';

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Call timer. Ticks locally at 1Hz rather than being pushed through the store, so a
 * clock never causes a store update or a re-render of anything but itself.
 */
export function Elapsed({
  since,
  frozen = false,
  className = '',
  style,
}: {
  /** Epoch milliseconds. */
  since: number;
  /** Stop counting (call ended). */
  frozen?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (frozen) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [frozen]);

  // Render a stable placeholder until mounted so SSR and the client agree.
  return (
    <span className={`aura-mono ${className}`} style={style}>
      {now === null ? '0:00' : fmt(now - since)}
    </span>
  );
}
