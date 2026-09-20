import { motion } from "framer-motion";
import { PROTOCOL_NAMES, PROTOCOL_STEPS, STEP_LABELS } from "../contracts/index.ts";
import { selectFocus, useEchoStore } from "../store/useEchoStore.ts";
import { Chip, Panel } from "./ui.tsx";

const ROW = 36;
const DOT_X = 12;

type StepState = "done" | "current" | "pending" | "skipped";

export function ProtocolTree() {
  const focus = useEchoStore(selectFocus);
  const state = focus?.state ?? null;
  const protocolId = state?.protocol.id ?? "MED_CARDIAC_01";
  const steps = PROTOCOL_STEPS[protocolId] ?? PROTOCOL_STEPS.MED_CARDIAC_01!;
  const currentIndex = state?.protocol.step ? steps.indexOf(state.protocol.step) : -1;
  const dispatched = state?.status === "dispatched";
  const escalation = focus?.protocolChanges.filter((c) => c.escalation && c.protocolId === protocolId).at(-1) ?? null;
  const escFrom = escalation?.from ? steps.indexOf(escalation.from) : -1;
  const escTo = escalation ? steps.indexOf(escalation.to) : -1;

  const stateOf = (i: number): StepState => {
    if (dispatched) return "done";
    if (currentIndex === -1) return "pending";
    if (i === currentIndex) return "current";
    if (i < currentIndex) {
      if (escFrom >= 0 && escTo > escFrom && i > escFrom && i < escTo) return "skipped";
      return "done";
    }
    return "pending";
  };

  const height = steps.length * ROW;

  return (
    <Panel
      title={`protocol / ${state?.protocol.id ?? "awaiting classification"}`}
      right={escalation ? <Chip color="#ef4444">escalation</Chip> : state?.human_required ? <Chip color="#fbbf24">human required</Chip> : null}
      className="shrink-0"
      bodyClassName="p-3 pt-2"
    >
      <div className="label !text-white/30 mb-2 truncate">{PROTOCOL_NAMES[protocolId] ?? protocolId}</div>
      <div className="relative" style={{ height }}>
        <svg className="absolute inset-0 pointer-events-none overflow-visible" width="100%" height={height}>
          <line x1={DOT_X} y1={ROW / 2} x2={DOT_X} y2={height - ROW / 2} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
          {currentIndex > 0 && (
            <motion.line
              x1={DOT_X}
              y1={ROW / 2}
              x2={DOT_X}
              initial={{ y2: ROW / 2 }}
              animate={{ y2: (dispatched ? steps.length - 1 : currentIndex) * ROW + ROW / 2 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              stroke={dispatched ? "#34d399" : "#22d3ee"}
              strokeWidth={1.5}
              style={{ filter: "drop-shadow(0 0 4px rgba(34,211,238,0.8))" }}
            />
          )}
          {escFrom >= 0 && escTo > escFrom + 1 && (
            <motion.path
              d={`M ${DOT_X} ${escFrom * ROW + ROW / 2} C ${DOT_X - 30} ${escFrom * ROW + ROW / 2}, ${DOT_X - 30} ${escTo * ROW + ROW / 2}, ${DOT_X} ${escTo * ROW + ROW / 2}`}
              fill="none"
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="4 3"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.7, ease: "easeInOut" }}
              style={{ filter: "drop-shadow(0 0 6px rgba(239,68,68,0.9))" }}
            />
          )}
        </svg>
        <ol className="relative">
          {steps.map((id, i) => {
            const s = stateOf(i);
            const isCurrent = s === "current";
            const color = s === "done" ? (dispatched ? "#34d399" : "#22d3ee") : isCurrent ? (state?.priority === "critical" ? "#ef4444" : "#22d3ee") : s === "skipped" ? "#ef4444" : "rgba(255,255,255,0.25)";
            return (
              <li key={id} className="flex items-center gap-3" style={{ height: ROW }}>
                <span className="relative flex items-center justify-center shrink-0" style={{ width: DOT_X * 2, height: DOT_X * 2 }}>
                  {isCurrent && <span className="absolute inset-1 rounded-full animate-ping opacity-60" style={{ background: color }} />}
                  <span
                    className="relative rounded-full border"
                    style={{
                      width: isCurrent ? 12 : 8,
                      height: isCurrent ? 12 : 8,
                      background: s === "pending" ? "transparent" : color,
                      borderColor: color,
                      boxShadow: s === "pending" ? "none" : `0 0 10px ${color}`,
                    }}
                  />
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div
                    className={`text-[12.5px] ${isCurrent ? "text-white font-medium" : s === "done" ? "text-white/80" : s === "skipped" ? "text-red-300/70 line-through" : "text-white/40"}`}
                  >
                    {STEP_LABELS[id] ?? id}
                  </div>
                  <div className="mono text-[9.5px] text-white/30">{id}</div>
                </div>
                {isCurrent && state?.human_required && !dispatched && <Chip color="#ef4444">gate</Chip>}
                {s === "skipped" && (
                  <Chip color="#ef4444" dim>
                    skipped
                  </Chip>
                )}
                {i === steps.length - 1 && dispatched && <Chip color="#34d399">approved</Chip>}
              </li>
            );
          })}
        </ol>
      </div>
      {escalation && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2 border border-red-500/40 bg-red-500/10 rounded-md px-2.5 py-1.5">
          <div className="label !text-red-300">escalation / {escalation.from ?? "-"} to {escalation.to}</div>
          <div className="text-[11.5px] text-red-100/90 mt-0.5 leading-snug">{escalation.reason}</div>
        </motion.div>
      )}
    </Panel>
  );
}
