"use client";

// The current protocol step AND why it changed. The reason sentence is what makes AURA
// look like it is reasoning rather than pattern-matching, so it gets body type and room.
import { useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Glyph, SectionHeader, StateDot } from "@/components/ui";
import { dur, easeOut } from "@/lib/motion";
import type { SemanticColor } from "@/lib/palette";
import { useAura, type ProtocolChange } from "@/state/auraStore";
import { humanize } from "@/state/selectors";

type Node = {
  key: string;
  family: string | null;
  step: string;
  reason: string | null;
  /** Set when this change moved to a different protocol family (e.g. chest pain → cardiac). */
  switchedFrom: string | null;
};

/** History entries are either "FAMILY_ID/step" or a bare "step". */
const split = (ref: string | null): { family: string | null; step: string } => {
  if (!ref) return { family: null, step: "" };
  const i = ref.indexOf("/");
  return i === -1 ? { family: null, step: ref } : { family: ref.slice(0, i), step: ref.slice(i + 1) };
};

const build = (history: ProtocolChange[]): Node[] => {
  let carried: string | null = null;
  return history.map((h) => {
    const cur = split(h.current);
    const prev = split(h.previous);
    const family = cur.family ?? carried;
    const from = prev.family ?? carried;
    const switchedFrom = family && from && family !== from ? from : null;
    carried = family;
    return { key: `${h.at}-${h.current}`, family, step: cur.step, reason: h.reason, switchedFrom };
  });
};

type Props = {
  history: ProtocolChange[];
  protocol: { id: string; step: string } | null;
  tone: SemanticColor;
  live: boolean;
};

export default function ProtocolFlow({ history, protocol, tone, live }: Props) {
  const low = useAura((s) => s.quality === "low");
  const reduced = useReducedMotion();
  const still = low || reduced === true;

  const nodes = useMemo(() => build(history), [history]);
  const active = nodes.length > 0 ? nodes[nodes.length - 1] : null;
  const done = nodes.slice(0, -1);
  const lastDone = done.length > 0 ? done[done.length - 1] : null;

  // The switch that put us on the current family stays visible as provenance, not just for one frame.
  const lastSwitch = useMemo(() => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.switchedFrom) return n;
    }
    return null;
  }, [nodes]);
  const shownSwitch = lastSwitch && active && lastSwitch.family === active.family ? lastSwitch : null;

  const step = active ? humanize(active.step) : protocol && protocol.step ? humanize(protocol.step) : null;

  return (
    <section className="shrink-0" aria-label="Protocol">
      <SectionHeader label="Protocol" />
      {step === null ? (
        <p className="pt-2.5 text-[14px] text-ink-3">No protocol selected yet.</p>
      ) : (
        <div className="pt-2.5">
          {lastDone && (
            <div className="flex items-center gap-2 pb-2">
              <Glyph name="check" size={11} className="text-ink-3" />
              <span className="data-mono min-w-0 truncate text-ink-3">{humanize(lastDone.step)}</span>
              {done.length > 1 && <span className="label-mono ml-auto shrink-0">+{done.length - 1} earlier</span>}
            </div>
          )}

          {shownSwitch && (
            <motion.div
              key={shownSwitch.key}
              initial={still ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: still ? 0 : dur.base, ease: easeOut }}
              className="mb-2.5 border-l-2 pl-2.5"
              style={{ borderColor: "var(--state)" }}
            >
              <span className="label-mono" style={{ color: "var(--state)" }}>
                Protocol switched
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="data-mono min-w-0 truncate text-ink-3 line-through">{shownSwitch.switchedFrom}</span>
                <Glyph name="arrow" size={12} className="text-ink-3" />
                <span className="data-mono min-w-0 truncate text-ink">{shownSwitch.family}</span>
              </div>
            </motion.div>
          )}

          <div className="flex items-center gap-2">
            <StateDot color={tone} live={live} />
            <span className="min-w-0 truncate text-[15px] leading-tight text-ink">{step}</span>
          </div>

          {active?.reason && (
            <motion.p
              key={`${active.key}-reason`}
              initial={still ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: still ? 0 : dur.base, ease: easeOut }}
              className="mt-1.5 text-[14px] leading-[1.45] text-ink-2"
            >
              {active.reason}
            </motion.p>
          )}
        </div>
      )}
    </section>
  );
}
