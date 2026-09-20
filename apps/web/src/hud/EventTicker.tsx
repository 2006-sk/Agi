import { AnimatePresence, motion } from "framer-motion";
import { useNow } from "../hooks/useNow.ts";
import { useAuraStore } from "../store/useAuraStore.ts";

const VISIBLE_MS = 4200;

const TONE: Record<string, string> = {
  "protocol.changed": "#22d3ee",
  "dispatch.proposed": "#fb923c",
  "approval.requested": "#ef4444",
  "approval.resolved": "#34d399",
  "agent.interrupted": "#ef4444",
  "system.degraded": "#fbbf24",
  "incident.updated": "#a3a3a3",
  "tool.completed": "#a78bfa",
  "tool.started": "#a78bfa",
  "call.started": "#e5e7eb",
};

/** Raw event stream for judges: the last few envelope types as they arrive. */
export function EventTicker() {
  const now = useNow(400);
  const ticker = useAuraStore((s) => s.ticker);
  const recent = ticker.filter((t) => now - t.at < VISIBLE_MS && t.type !== "transcript.partial").slice(-6);
  return (
    <div className="absolute right-3 top-2 flex flex-col items-end gap-1 pointer-events-none">
      <AnimatePresence initial={false}>
        {recent.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ duration: 0.25 }}
            className="mono text-[10px] px-2 py-1 rounded-md border bg-black/60 backdrop-blur-md flex items-center gap-2"
            style={{ borderColor: `${TONE[t.type] ?? "#9ca3af"}55` }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: TONE[t.type] ?? "#9ca3af" }} />
            <span style={{ color: TONE[t.type] ?? "#d4d4d4" }}>{t.type}</span>
            <span className="text-white/35">{t.sessionId}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
