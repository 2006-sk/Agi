"use client";

// The action rail — DESIGN.md §5: "a transit line with stations", never five cards.
// One continuous line runs from the call (left edge) through four machine stations and stops dead
// at a gate. Tool calls travel the line as packets. Nothing crosses the gate without a human.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Glyph, StateDot } from "@/components/ui";
import { dur, easeOut } from "@/lib/motion";
import { useAura } from "@/state/auraStore";
import {
  RAIL_ORDER,
  humanize,
  railLabels,
  railStatus,
  stageOfTool,
  useActiveCall,
  type RailStageStatus,
} from "@/state/selectors";

/** Station positions as a fraction of the track. 0 is where the call enters, 1 is the city. */
const X = [0.06, 0.28, 0.5, 0.72, 0.9];
const LINE_Y = 22; // px from the top of the track to the centre of the line
const GATE_STOP = 15; // the line stops this far short of the gate — it may not touch it
const PACKET = 5;

/** motion wants a mutable bezier tuple; lib/motion exports a readonly one. */
const EASE: [number, number, number, number] = [...easeOut];

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

type Tone = "done" | "active" | "dim" | "rejected";

function Segment({ left, width, tone, still }: { left: string; width: string; tone: Tone; still: boolean }) {
  const fill =
    tone === "rejected"
      ? "color-mix(in srgb, var(--color-critical) 55%, transparent)"
      : tone === "done"
        ? "color-mix(in srgb, var(--state) 62%, transparent)"
        : tone === "active"
          ? `color-mix(in srgb, var(--state) ${still ? 62 : 22}%, transparent)`
          : "var(--color-rule)";
  return (
    <div className="absolute h-0.5 overflow-hidden" style={{ left, width, top: LINE_Y - 1 }}>
      <div className="absolute inset-0" style={{ background: fill }} />
      {tone === "active" && !still && (
        <motion.div
          className="absolute inset-y-0 w-1/4"
          style={{ background: "linear-gradient(90deg, transparent, var(--state), transparent)" }}
          animate={{ x: ["-100%", "400%"] }}
          transition={{ duration: 1.9, repeat: Infinity, ease: "linear" }}
        />
      )}
    </div>
  );
}

function Station({ x, status }: { x: number; status: RailStageStatus }) {
  const tone: CSSProperties =
    status === "rejected"
      ? { background: "var(--color-critical)" }
      : status === "active"
        ? { background: "var(--state)", boxShadow: "0 0 12px color-mix(in srgb, var(--state) 75%, transparent)" }
        : status === "done"
          ? { background: "color-mix(in srgb, var(--state) 70%, transparent)" }
          : { background: "var(--color-void)", border: "1px solid var(--color-rule-strong)" };
  return (
    <div aria-hidden className="absolute" style={{ left: pct(x), top: LINE_Y, transform: "translate(-50%,-50%)" }}>
      <motion.span
        className="block size-[9px]"
        style={tone}
        animate={{ scale: status === "active" ? 1 : 0.82 }}
        transition={{ duration: dur.base, ease: EASE }}
      />
    </div>
  );
}

/** The last station is a barrier, not a dot: the line has to physically stop at it. */
function Gate({ status, still }: { status: RailStageStatus; still: boolean }) {
  const open = status === "done";
  const color =
    status === "rejected" ? "var(--color-critical)" : status === "idle" ? "var(--color-rule-strong)" : "var(--state)";
  return (
    <div aria-hidden className="absolute" style={{ left: pct(X[4]), top: LINE_Y, transform: "translate(-50%,-50%)" }}>
      <div className="flex items-center gap-[7px]">
        {[-1, 1].map((side) => (
          <motion.span
            key={side}
            className="block h-[26px] w-[2px]"
            style={{ background: color, boxShadow: status === "active" && !still ? `0 0 14px ${color}` : undefined }}
            animate={{ x: open ? side * 6 : 0, opacity: status === "idle" ? 0.75 : 1 }}
            transition={{ duration: still ? 0 : dur.slow, ease: EASE }}
          />
        ))}
      </div>
    </div>
  );
}

const gateNote = (status: RailStageStatus): { text: string; glyph: "lock" | "check" | "cross"; color: string } => {
  if (status === "done") return { text: "APPROVED", glyph: "check", color: "var(--state)" };
  if (status === "rejected") return { text: "REJECTED", glyph: "cross", color: "var(--color-critical)" };
  if (status === "active") return { text: "AWAITING DECISION", glyph: "lock", color: "var(--state)" };
  return { text: "LOCKED", glyph: "lock", color: "var(--color-ink-3)" };
};

export default function ToolRail() {
  const call = useActiveCall();
  const quality = useAura((s) => s.quality);
  const reduced = useReducedMotion();
  const still = reduced === true || quality === "low";

  const statuses = railStatus(call);
  const labels = railLabels(call);
  const crossed = statuses.approval === "done";
  const note = gateNote(statuses.approval);

  // Track width, measured once per resize — packets need pixels, not percentages.
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackW, setTrackW] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    setTrackW(el.clientWidth);
    const ro = new ResizeObserver(() => setTrackW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Only animate packets for tool calls we actually watched start.
  // Lazy state, not a ref: the mount stamp is read during render, and a state initialiser is the
  // one place render may call a clock. Same value, captured once, for the component's lifetime.
  const [mountedAt] = useState(() => Date.now());
  const tools = call?.tools ?? [];
  const packets =
    trackW > 0
      ? tools
          .filter((t) => t.startedAt >= mountedAt)
          .slice(-5)
          .map((t) => {
            const i = RAIL_ORDER.indexOf(stageOfTool(t.name));
            const station = X[i < 0 ? 3 : i] * trackW;
            const done = t.status === "done";
            return { key: `${t.id}_${t.startedAt}`, x: done ? station : Math.max(0, station - 20), done };
          })
      : [];

  const running = tools.find((t) => t.status === "running") ?? null;
  const lastResult = tools.findLast((t) => t.result !== null) ?? null;

  return (
    <div className="hairline-t flex h-full flex-col pt-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="label-mono shrink-0">Action rail</h2>
        <div className="data-mono flex min-w-0 items-center gap-2 text-ink-3">
          {running && (
            <span className="flex shrink-0 items-center gap-1.5 text-reason">
              <StateDot color="reason" live />
              {humanize(running.name)}
            </span>
          )}
          {lastResult && (
            <>
              {running && <span aria-hidden>·</span>}
              <span className="shrink-0 text-ink-2">{humanize(lastResult.name)}</span>
              <span aria-hidden>·</span>
              <span className="truncate text-ink">{lastResult.result}</span>
            </>
          )}
          {!running && !lastResult && <span>No tool output yet</span>}
        </div>
      </div>

      <div ref={trackRef} className="relative mt-2.5 mr-3 ml-1 min-h-0 flex-1">
        {/* the line: lead-in from the call, then one segment per pair of stations */}
        <Segment
          left="0%"
          width={pct(X[0])}
          tone={!call ? "dim" : statuses.locate === "active" ? "active" : "done"}
          still={still}
        />
        {RAIL_ORDER.slice(0, -1).map((id, i) => {
          const a = statuses[id];
          const b = statuses[RAIL_ORDER[i + 1]];
          const tone: Tone = b === "rejected" ? "rejected" : b === "active" ? "active" : a === "done" ? "done" : "dim";
          const last = i === RAIL_ORDER.length - 2;
          return (
            <Segment
              key={id}
              left={pct(X[i])}
              width={last && !crossed ? `calc(${pct(X[i + 1] - X[i])} - ${GATE_STOP}px)` : pct(X[i + 1] - X[i])}
              tone={tone}
              still={still}
            />
          );
        })}

        {/* the stop: the line ends short of the gate and waits there */}
        {!crossed && (
          <div
            aria-hidden
            className="absolute"
            style={{ left: `calc(${pct(X[4])} - ${GATE_STOP}px)`, top: LINE_Y, transform: "translate(-50%,-50%)" }}
          >
            <span className="block h-[9px] w-px" style={{ background: "var(--color-rule-strong)" }} />
          </div>
        )}

        {/* the release: only ever drawn once a human approved */}
        {crossed && (
          <>
            <Segment
              left={`calc(${pct(X[4])} + 10px)`}
              width={`calc(${pct(1 - X[4])} - 24px)`}
              tone="done"
              still={still}
            />
            <div
              aria-hidden
              className="absolute"
              style={{ right: 0, top: LINE_Y, transform: "translateY(-50%)", color: "var(--state)" }}
            >
              <Glyph name="arrow" size={13} />
            </div>
          </>
        )}

        {/* packets: one per tool call, gliding to the station that owns it */}
        <AnimatePresence initial={false}>
          {packets.map((p) => (
            <motion.span
              key={p.key}
              aria-hidden
              className="absolute block"
              style={{
                left: 0,
                top: LINE_Y - PACKET / 2,
                width: PACKET,
                height: PACKET,
                background: "var(--state)",
                boxShadow: "0 0 10px var(--state)",
              }}
              initial={{ x: 0, opacity: 0 }}
              animate={{ x: p.x, opacity: p.done ? 0 : 1 }}
              exit={{ opacity: 0 }}
              transition={
                still
                  ? { duration: 0 }
                  : p.done
                    ? { x: { duration: 0.34, ease: EASE }, opacity: { delay: 0.3, duration: 0.18 } }
                    : { x: { duration: 1.1, ease: EASE }, opacity: { duration: dur.fast } }
              }
            />
          ))}
        </AnimatePresence>

        {RAIL_ORDER.slice(0, -1).map((id, i) => (
          <Station key={id} x={X[i]} status={statuses[id]} />
        ))}
        <Gate status={statuses.approval} still={still} />

        {/* station names */}
        {RAIL_ORDER.map((id, i) => {
          const s = statuses[id];
          const color =
            s === "rejected"
              ? "var(--color-critical)"
              : s === "active" || s === "done"
                ? "var(--state)"
                : "var(--color-ink-3)";
          return (
            <div
              key={id}
              className="label-mono absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: pct(X[i]), top: LINE_Y + 16, color, opacity: s === "idle" ? 0.85 : 1 }}
            >
              {labels[id]}
            </div>
          );
        })}

        <div
          aria-live="polite"
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: pct(X[4]), top: LINE_Y + 32 }}
        >
          <span
            className="data-mono inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em]"
            style={{ color: note.color }}
          >
            <Glyph name={note.glyph} size={11} />
            {note.text}
          </span>
        </div>
      </div>
    </div>
  );
}
