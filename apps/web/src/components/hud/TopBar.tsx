"use client";

// The top bezel of the instrument: who this is, what mode it is really in, the sponsor pipeline
// strip, and the permanent SIMULATION tag (DESIGN.md §7 — never imply this is a live 911 system).
//
// One 250ms ticker drives BOTH the 24h clock string and the pipeline "hot" window, so there is a
// single interval in this file and nothing here is frame-driven.
import { Fragment, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Chip, StateDot } from "@/components/ui";
import type { PipelineStage } from "@/lib/contracts";
import { dur, easeOut } from "@/lib/motion";
import { cssVar, type SemanticColor } from "@/lib/palette";
import { useAura, type Connection } from "@/state/auraStore";
import { clock } from "@/state/selectors";

/** The sponsor-backed stages, in the order a call actually travels through them. */
const STAGES: { id: PipelineStage; name: string; role: string; color: string }[] = [
  { id: "gradium", name: "Gradium", role: "speech", color: "var(--color-listen)" },
  { id: "pipecat", name: "Pipecat", role: "voice pipeline", color: "var(--color-listen)" },
  { id: "sambanova", name: "SambaNova", role: "reasoning", color: "var(--color-reason)" },
  { id: "gateway", name: "Gateway", role: "integration", color: "var(--color-ink)" },
];

/** A stage reads as hot for this long after its last event. */
const HOT_MS = 600;

const CONNECTION: Record<Connection, { label: string; color: SemanticColor; live: boolean }> = {
  idle: { label: "standby", color: "ink2", live: false },
  mock: { label: "local scenario", color: "ink2", live: false },
  // Only the transient states blink: a permanently blinking bezel is a looping idle animation (§8).
  connecting: { label: "connecting", color: "urgent", live: true },
  live: { label: "live", color: "listen", live: false },
  reconnecting: { label: "reconnecting", color: "urgent", live: true },
  offline: { label: "offline", color: "critical", live: false },
};

// Stable references so motion does not restart the flicker on every ticker render.
const HOT_ANIM = { opacity: [0.25, 1, 0.45, 1] };
const COLD_ANIM = { opacity: 0.55 };
const HOT_T = { duration: 0.24, ease: easeOut, times: [0, 0.18, 0.5, 1] };
const COLD_T = { duration: dur.base, ease: easeOut };

const Divider = () => <span aria-hidden className="h-3 w-px shrink-0 bg-rule-strong" />;

/** One pipeline node. Remounted by its `at` key so each event replays the flicker exactly once. */
function StageDot({ hot, lead, still, color }: { hot: boolean; lead: boolean; still: boolean; color: string }) {
  const base = {
    background: hot ? color : "var(--color-rule-strong)",
    boxShadow: lead && !still ? `0 0 7px ${color}` : undefined,
  };
  if (still) {
    return <span aria-hidden className="size-[5px] shrink-0 rounded-[1px]" style={{ ...base, opacity: hot ? 1 : 0.55 }} />;
  }
  return (
    <motion.span
      aria-hidden
      className="size-[5px] shrink-0 rounded-[1px]"
      style={base}
      initial={{ opacity: hot ? 0.25 : 0.55 }}
      animate={hot ? HOT_ANIM : COLD_ANIM}
      transition={hot ? HOT_T : COLD_T}
    />
  );
}

export default function TopBar() {
  const pipeline = useAura((s) => s.pipeline);
  const connection = useAura((s) => s.connection);
  const degraded = useAura((s) => s.degraded);
  const quality = useAura((s) => s.quality);
  const reduced = useReducedMotion();
  const still = reduced === true || quality === "low";

  // 0 until mounted: the server has no clock, so it renders the hollow state instead of a wrong time.
  const [now, setNow] = useState(0);
  useEffect(() => {
    // The first read is scheduled rather than run inline: a passive effect already lands after the
    // first paint, so this is the same frame, without the synchronous cascading render.
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const id = window.setInterval(() => setNow(Date.now()), still ? 1000 : 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [still]);

  const strip = useMemo(() => {
    const nodes = STAGES.map((s, i) => {
      const at = pipeline[s.id];
      return { ...s, at, hot: at > 0 && now - at < HOT_MS, i };
    });
    // Only the single most recent hot stage glows (DESIGN: max one glowing element per region).
    let leadIdx = -1;
    let leadAt = 0;
    for (const n of nodes) {
      if (n.hot && n.at > leadAt) {
        leadAt = n.at;
        leadIdx = n.i;
      }
    }
    return { nodes, leadIdx };
  }, [pipeline, now]);

  const lead = strip.leadIdx >= 0 ? STAGES[strip.leadIdx] : null;
  const conn = CONNECTION[connection];
  const time = now === 0 ? null : clock(now);

  return (
    <header className="hairline-b grid h-full grid-cols-[1fr_auto_1fr] items-center gap-4 px-6">
      {/* identity + the honest mode line */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="display shrink-0 text-[21px] leading-none text-ink">AURA</span>
        <Divider />
        <span className="label-mono shrink-0">overflow intake</span>
        <Divider />
        {degraded ? (
          <span role="status" className="flex min-w-0 items-center gap-1.5">
            <StateDot color="urgent" />
            <span className="label-mono truncate" style={{ color: "var(--color-urgent)" }}>
              {`${degraded.dependency ?? "dependency"} unavailable`}
            </span>
            <span className="label-mono truncate" style={{ color: "var(--color-ink-3)" }}>
              {`· ${degraded.fallback ?? conn.label}`}
            </span>
          </span>
        ) : (
          <span role="status" className="flex min-w-0 items-center gap-1.5">
            <StateDot color={conn.color} live={conn.live} />
            <span className="label-mono truncate" style={{ color: cssVar(conn.color) }}>
              {conn.label}
            </span>
          </span>
        )}
      </div>

      {/* sponsor pipeline — lights up in sequence as the call flows through the stack */}
      <div className="flex flex-col items-center gap-[3px]">
        <div className="flex items-center" role="group" aria-label="Processing pipeline">
          {strip.nodes.map((n) => (
            <Fragment key={n.id}>
              {n.i > 0 && (
                <span
                  aria-hidden
                  className="h-px w-4 shrink-0 transition-colors duration-200"
                  style={{
                    backgroundColor: n.hot ? `color-mix(in srgb, ${n.color} 60%, transparent)` : "var(--color-rule)",
                  }}
                />
              )}
              <span className="flex items-center gap-1.5">
                <StageDot key={n.at} hot={n.hot} lead={n.i === strip.leadIdx} still={still} color={n.color} />
                <span
                  className="label-mono transition-colors duration-200"
                  style={{ color: n.hot ? "var(--color-ink)" : "var(--color-ink-3)" }}
                >
                  {n.name}
                </span>
                <span className="sr-only">{n.role}</span>
              </span>
            </Fragment>
          ))}
        </div>
        <div className="h-3">
          {lead && (
            <span className="label-mono" style={{ fontSize: 9, lineHeight: "12px", color: "var(--color-ink-3)" }}>
              {`${lead.name} · ${lead.role}`}
            </span>
          )}
        </div>
      </div>

      {/* simulation tag + wall clock */}
      <div className="flex min-w-0 items-center justify-end gap-3">
        <Chip>SIMULATION</Chip>
        <Divider />
        <span className="data-mono shrink-0" style={{ color: "var(--color-ink-2)" }}>
          {time ?? "--:--:--"}
        </span>
      </div>
    </header>
  );
}
