"use client";

// Confirmed facts, hazards and — just as loudly — what is still missing.
// Missing critical information must LOOK missing: hollow, dashed, dim.
import { motion, useReducedMotion } from "motion/react";
import { Chip, SectionHeader, type ChipState } from "@/components/ui";
import type { IncidentState } from "@/lib/contracts";
import { dur, easeOut } from "@/lib/motion";
import { useAura } from "@/state/auraStore";
import { humanize } from "@/state/selectors";

type Item = { key: string; label: string; state: ChipState };

export default function FactGrid({ incident }: { incident: IncidentState | null }) {
  const low = useAura((s) => s.quality === "low");
  const reduced = useReducedMotion();
  const still = low || reduced === true;

  const items: Item[] = incident
    ? [
        ...incident.hazards.map((h) => ({ key: `h:${h}`, label: humanize(h), state: "hazard" as const })),
        ...incident.facts.map((f) => ({ key: `f:${f}`, label: humanize(f), state: "confirmed" as const })),
        ...incident.missing_fields.map((m) => ({ key: `m:${m}`, label: humanize(m), state: "missing" as const })),
      ]
    : [];

  const atRisk = incident?.people_at_risk ?? null;
  const meta = incident ? (
    <>
      At risk {atRisk === null ? "—" : atRisk} · Confidence {Math.round(incident.confidence * 100)}%
    </>
  ) : null;

  return (
    <section className="shrink-0" aria-label="Facts">
      <SectionHeader label="Facts" right={meta} />
      {items.length === 0 ? (
        <p className="pt-2.5 text-[14px] text-ink-3">Nothing confirmed yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5 pt-2.5">
          {items.map((item, i) => (
            <motion.li
              key={item.key}
              initial={still ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: still ? 0 : dur.base,
                ease: easeOut,
                delay: still ? 0 : Math.min(i, 8) * 0.04,
              }}
            >
              <Chip state={item.state}>{item.label}</Chip>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
