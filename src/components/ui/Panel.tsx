'use client';

import type { ReactNode } from 'react';

/**
 * The only container in the app. Translucent navy glass, hairline neon border,
 * bracketed corners — instrumentation, never a white card.
 */
export function Panel({
  label,
  accent,
  trailing,
  children,
  className = '',
  bodyClassName = '',
  scanlines = false,
}: {
  /** Micro label in the header strip. Omit for a bare panel. */
  label?: string;
  /** Hex colour for the label glow and the header rule. */
  accent?: string;
  /** Right-aligned header content — counts, status, controls. */
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  scanlines?: boolean;
}) {
  return (
    <section
      className={`aura-panel aura-bracket flex min-h-0 flex-col ${scanlines ? 'aura-scanlines' : ''} ${className}`}
    >
      {label !== undefined && (
        <header className="flex shrink-0 items-center justify-between gap-3 px-3.5 pt-3 pb-2">
          <span
            className="aura-label"
            style={accent ? { color: accent, opacity: 0.85 } : undefined}
          >
            {label}
          </span>
          {trailing}
        </header>
      )}
      {label !== undefined && (
        <div
          className="aura-rule shrink-0"
          style={
            accent
              ? {
                  background: `linear-gradient(90deg, transparent, ${accent}55 20%, ${accent}22 80%, transparent)`,
                }
              : undefined
          }
        />
      )}
      <div className={`flex min-h-0 flex-1 flex-col ${bodyClassName}`}>{children}</div>
    </section>
  );
}
