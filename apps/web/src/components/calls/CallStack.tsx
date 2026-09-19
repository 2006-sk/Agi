"use client";

// The room's live calls. The active call is the hero AURA is handling; the rest are ambient calls a human
// dispatcher already has — that contrast is the story, so `handledBy` is never hidden.
// Not cards: hairlines, alignment and one accent rule. See DESIGN.md §4.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import VoiceOrb from "@/components/calls/VoiceOrb";
import { Glyph, PriorityTag, SectionHeader, StateDot, cx } from "@/components/ui";
import { dur, easeOut, enter, layoutSpring } from "@/lib/motion";
import { cssVar, priorityColor, priorityLabel } from "@/lib/palette";
import { useAura, type CallState } from "@/state/auraStore";
import { agentMode, elapsed, useSortedCalls, type AgentMode } from "@/state/selectors";

const MODE_WORD: Record<AgentMode, string> = {
  idle: "standing by",
  listening: "listening",
  speaking: "speaking",
  reasoning: "reasoning",
};

const MODE_COLOR: Record<AgentMode, string> = {
  idle: "var(--color-ink-3)",
  listening: "var(--color-listen)",
  speaking: "var(--color-reason)",
  reasoning: "var(--color-reason)",
};

function CallRow({ call, active, now, calm }: { call: CallState; active: boolean; now: number; calm: boolean }) {
  const ended = call.status === "ended";
  const mode: AgentMode = call.ambient ? "idle" : agentMode(call);
  const stateColor = cssVar(priorityColor[call.priority]);

  // One-shot edge flare when this call is re-classified. `seen` starts at the mounted value so a
  // call that is already urgent when it appears does not flare on entry.
  const [flare, setFlare] = useState(0);
  const seen = useRef(call.priorityChangedAt);
  useEffect(() => {
    if (seen.current === call.priorityChangedAt) return;
    seen.current = call.priorityChangedAt;
    setFlare((n) => n + 1);
  }, [call.priorityChangedAt]);

  // Who has this call. Ambient calls belong to a person; the overflow call belongs to AURA.
  const handler = call.ambient
    ? call.handledBy
      ? `Held by ${call.handledBy}`
      : null
    : ended
      ? "Call ended"
      : `AURA ${MODE_WORD[mode]}`;
  const handlerColor = call.ambient || ended ? "var(--color-ink-3)" : MODE_COLOR[mode];

  return (
    <button
      type="button"
      onClick={() => useAura.getState().setActive(call.sessionId)}
      aria-current={active ? "true" : undefined}
      aria-label={`${call.callerLabel}, ${priorityLabel[call.priority]}, ${call.channel}`}
      className="pointer-events-auto relative block w-full cursor-pointer rounded-xs py-2.5 pr-2 pl-3 text-left transition-colors duration-150 hover:bg-ink/5"
      style={active ? { background: "color-mix(in srgb, var(--state) 7%, transparent)" } : undefined}
    >
      {/* the active call earns the accent rule */}
      {active && (
        <span aria-hidden className="absolute inset-y-1.5 left-0 block w-[2px]" style={{ background: "var(--state)" }} />
      )}

      {/* re-classification: one flare in the new colour, then gone */}
      {flare > 0 && (
        <motion.span
          key={flare}
          aria-hidden
          className="pointer-events-none absolute inset-0 block rounded-xs"
          style={{
            background: `color-mix(in srgb, ${stateColor} 12%, transparent)`,
            borderLeft: `2px solid ${stateColor}`,
          }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: calm ? dur.base : dur.slow, ease: easeOut }}
        />
      )}

      <span className="relative block">
        <span className="flex items-center gap-2">
          <span style={{ color: active ? "var(--color-ink-2)" : "var(--color-ink-3)" }}>
            <Glyph name={call.category} size={13} />
          </span>
          <span className={cx("min-w-0 flex-1 truncate text-[13px] leading-tight", active ? "text-ink" : "text-ink-2")}>
            {call.callerLabel}
          </span>
          <span className={cx("data-mono shrink-0", active ? "text-ink-2" : "text-ink-3")}>
            {ended ? "ENDED" : elapsed(call.startedAt, now)}
          </span>
        </span>

        <span className="mt-1.5 flex items-center gap-2">
          <StateDot color={priorityColor[call.priority]} live={active && !ended} />
          {active ? (
            <PriorityTag priority={call.priority} />
          ) : (
            <span className="label-mono" style={{ color: stateColor }}>
              {priorityLabel[call.priority]}
            </span>
          )}
          <span className="label-mono min-w-0 flex-1 truncate text-right" style={{ color: "var(--color-ink-3)" }}>
            {call.channel}
          </span>
        </span>

        {handler && (
          <span className="mt-1 block truncate">
            <span className="label-mono" style={{ color: handlerColor }}>
              {handler}
            </span>
          </span>
        )}

        <VoiceOrb
          sessionId={call.sessionId}
          mode={mode}
          live={active && !ended}
          calm={calm}
          height={active ? 32 : 12}
          className="mt-2"
        />
      </span>
    </button>
  );
}

export default function CallStack() {
  const calls = useSortedCalls();
  const activeId = useAura((s) => s.activeSessionId);
  const quality = useAura((s) => s.quality);
  const reduced = useReducedMotion();
  const calm = reduced === true || quality === "low";

  // ONE interval for every timer in the column.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const onLine = calls.filter((c) => c.status === "active").length;

  return (
    <div className="flex h-full min-h-0 flex-col pr-4">
      <SectionHeader label="Calls" right={onLine > 0 ? `${onLine} ON LINE` : "—"} />

      {calls.length === 0 ? (
        <p className="label-mono mt-3" style={{ color: "var(--color-ink-3)" }}>
          Awaiting intake
        </p>
      ) : (
        <ul className="scroll-quiet mt-1 min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence initial={false}>
            {calls.map((call) => (
              <motion.li
                key={call.sessionId}
                className="hairline-b"
                layout={calm ? false : "position"}
                transition={layoutSpring}
                initial={calm ? false : enter.initial}
                animate={enter.animate}
                exit={enter.exit}
              >
                <CallRow call={call} active={call.sessionId === activeId} now={now} calm={calm} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
