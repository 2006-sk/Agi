// Shared HUD primitives. Every region uses these so the console reads as one instrument. See DESIGN.md.
import type { CSSProperties, ReactNode } from "react";
import type { Category, Priority } from "@/lib/contracts";
import { cssVar, priorityColor, priorityLabel, type SemanticColor } from "@/lib/palette";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Section title: a 10px mono label over a hairline. Never a box. */
export function SectionHeader({ label, right, className }: { label: string; right?: ReactNode; className?: string }) {
  return (
    <header className={cx("hairline-b flex items-baseline justify-between gap-3 pb-1.5", className)}>
      <h2 className="label-mono">{label}</h2>
      {right != null && <div className="data-mono text-ink-3">{right}</div>}
    </header>
  );
}

/** 6px square status light. `live` blinks — reserve it for things that are actually happening now. */
export function StateDot({ color = "ink2", live = false, className }: { color?: SemanticColor; live?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-1.5 shrink-0 rounded-[1px]", live && "animate-blink", className)}
      style={{ background: cssVar(color), boxShadow: live ? `0 0 8px ${cssVar(color)}` : undefined }}
    />
  );
}

export type ChipState = "confirmed" | "missing" | "hazard" | "neutral";

/**
 * Fact chip. `confirmed` is filled and lit; `missing` stays hollow and dim with a dashed edge
 * (missing critical information must look missing); `hazard` is amber.
 */
export function Chip({ state = "neutral", children, className }: { state?: ChipState; children: ReactNode; className?: string }) {
  const tone: Record<ChipState, CSSProperties> = {
    confirmed: {
      color: "var(--color-ink)",
      borderColor: "color-mix(in srgb, var(--state) 45%, transparent)",
      background: "color-mix(in srgb, var(--state) 10%, transparent)",
    },
    missing: { color: "var(--color-ink-3)", borderColor: "var(--color-rule-strong)", borderStyle: "dashed", background: "transparent" },
    hazard: {
      color: "var(--color-urgent)",
      borderColor: "color-mix(in srgb, var(--color-urgent) 50%, transparent)",
      background: "color-mix(in srgb, var(--color-urgent) 9%, transparent)",
    },
    neutral: { color: "var(--color-ink-2)", borderColor: "var(--color-rule-strong)", background: "transparent" },
  };
  return (
    <span
      className={cx("data-mono inline-flex h-6 items-center gap-1.5 rounded-xs border px-2 whitespace-nowrap", className)}
      style={tone[state]}
    >
      {children}
    </span>
  );
}

/** The priority word, set in the display face. `lg` is the one loud type moment in the incident column. */
export function PriorityTag({ priority, size = "sm", className }: { priority: Priority; size?: "sm" | "lg"; className?: string }) {
  const color = cssVar(priorityColor[priority]);
  return (
    <span
      className={cx("display", size === "lg" ? "text-[44px]" : "text-[17px] leading-none", className)}
      style={{ color, textShadow: priority === "critical" ? `0 0 24px color-mix(in srgb, ${color} 55%, transparent)` : undefined }}
    >
      {priorityLabel[priority]}
    </span>
  );
}

/** Keyboard hint, e.g. <Kbd>A</Kbd>. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="data-mono inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-rule-strong px-1 text-[10px] text-ink-2">
      {children}
    </kbd>
  );
}

type GlyphName = Category | "check" | "cross" | "arrow" | "lock" | "phone" | "pin" | "unit";

/** Tiny custom glyphs (14px grid, 1.25 stroke, currentColor). No icon library, no emoji, no icon tiles. */
export function Glyph({ name, size = 14, className }: { name: GlyphName; size?: number; className?: string }) {
  const paths: Record<GlyphName, ReactNode> = {
    medical: <path d="M5.5 1.5h3v4h4v3h-4v4h-3v-4h-4v-3h4z" />,
    fire: <path d="M7 1.5c.4 2.6 3.5 3.9 3.5 7a3.5 3.5 0 0 1-7 0c0-1.4.7-2.3 1.5-3 .1 1.2.7 1.8 1.3 1.8C7.4 7.3 6 4.6 7 1.500z" />,
    police: <path d="M7 1.5 11.5 3v4c0 2.7-1.9 4.6-4.5 5.500C4.400 11.600 2.500 9.700 2.500 7V3z" />,
    traffic: <path d="M2 10.500 5 3.500h4l3 7M4.200 7.500h5.600M7 3.500v1.500M7 7v1.500" />,
    other: <path d="M7 2.500v5.500M7 10.500v1" />,
    unknown: <circle cx="7" cy="7" r="4.500" strokeDasharray="2 2" />,
    check: <path d="m2.500 7.500 3 3 6-7" />,
    cross: <path d="m3 3 8 8M11 3l-8 8" />,
    arrow: <path d="M2 7h10M8.500 3.500 12 7l-3.500 3.500" />,
    lock: <path d="M3.500 6.500h7v5.500h-7zM5 6.500v-2a2 2 0 0 1 4 0v2" />,
    phone: <path d="M3 2.500h2.200l1 2.800-1.400 1a6.500 6.500 0 0 0 2.900 2.900l1-1.400 2.800 1V11a1.500 1.500 0 0 1-1.600 1.500C6.100 12.100 1.900 7.900 1.500 4.100A1.500 1.500 0 0 1 3 2.500z" />,
    pin: <path d="M7 12.500S3 8.700 3 5.800a4 4 0 0 1 8 0c0 2.900-4 6.700-4 6.700zM7 4.500v2.600M5.700 5.800h2.600" />,
    unit: <path d="M1.500 4.500h7v5h-7zM8.500 6h2.300l1.700 1.800v1.700h-4M4 9.500v1.200M10 9.500v1.200" />,
  };
  return (
    <svg
      aria-hidden
      viewBox="0 0 14 14"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={cx("shrink-0", className)}
    >
      {paths[name]}
    </svg>
  );
}

export { cx };
