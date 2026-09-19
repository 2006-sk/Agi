"use client";

// Location confidence as a ring, never a bare number (DESIGN.md §5).
// When the geocoder verifies the address the arc closes and locks — demo beat 4.
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Glyph } from "@/components/ui";
import type { IncidentLocation } from "@/lib/contracts";
import { dur, easeOut } from "@/lib/motion";
import { useAura } from "@/state/auraStore";

const SIZE = 56;
const R = 22;
const C = 2 * Math.PI * R;

export default function LocationRing({ location }: { location: IncidentLocation | null }) {
  const low = useAura((s) => s.quality === "low");
  const reduced = useReducedMotion();
  const still = low || reduced === true;

  const verified = location?.verified === true;
  const confidence = location ? Math.max(0, Math.min(1, location.confidence)) : 0;
  // Verified is a boolean truth: the ring closes. The real number stays in the caption.
  const progress = verified ? 1 : confidence;

  // Only celebrate a lock we actually watched happen — not one that was already true on mount.
  const [bornVerified] = useState(verified);
  const celebrate = verified && !still && !bornVerified;

  const normalized = location?.normalized ?? null;
  const raw = location?.raw ?? null;
  const tone = verified ? "var(--state)" : "var(--color-ink-3)";

  return (
    <section className="flex shrink-0 items-center gap-3" aria-label="Location">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg aria-hidden viewBox="0 0 56 56" width={SIZE} height={SIZE}>
          <circle cx="28" cy="28" r={R} fill="none" stroke="var(--color-rule-strong)" strokeWidth={2} />
          <motion.circle
            cx="28"
            cy="28"
            r={R}
            fill="none"
            stroke={tone}
            strokeWidth={verified ? 3 : 2}
            strokeLinecap="butt"
            transform="rotate(-90 28 28)"
            strokeDasharray={C}
            initial={false}
            animate={{ strokeDashoffset: C * (1 - progress) }}
            transition={{ duration: still ? 0 : dur.slow, ease: easeOut }}
          />
          {celebrate && (
            <motion.circle
              cx="28"
              cy="28"
              r={R}
              fill="none"
              stroke="var(--state)"
              strokeWidth={1}
              initial={{ opacity: 0.75, scale: 1 }}
              animate={{ opacity: 0, scale: 1.35 }}
              transition={{ duration: dur.slow, ease: easeOut }}
              style={{ transformBox: "view-box", transformOrigin: "28px 28px" }}
            />
          )}
        </svg>
        <motion.span
          key={verified ? "locked" : "open"}
          className="absolute inset-0 grid place-items-center"
          style={{ color: tone }}
          initial={still ? false : { scale: 0.72, opacity: 0.4 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: still ? 0 : dur.base, ease: easeOut }}
        >
          <Glyph name="pin" size={15} />
        </motion.span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="label-mono" style={verified ? { color: "var(--state)" } : undefined}>
            {verified ? "Address locked" : "Unverified"}
          </span>
          <span className="data-mono text-ink-3">{location ? `${Math.round(confidence * 100)}%` : "—"}</span>
        </div>

        {normalized ? (
          <p className="mt-1 text-[14px] leading-[1.35] break-words text-ink">{normalized}</p>
        ) : raw ? (
          <p className="mt-1 text-[14px] leading-[1.35] break-words text-ink-3 italic">{raw}</p>
        ) : (
          <p className="mt-1 text-[14px] leading-[1.35] text-ink-3">No address yet.</p>
        )}

        {normalized && raw && raw !== normalized && (
          <p className="data-mono mt-0.5 truncate text-ink-3">Caller said: {raw}</p>
        )}
      </div>
    </section>
  );
}
