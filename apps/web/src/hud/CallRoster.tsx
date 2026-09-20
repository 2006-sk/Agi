import { AnimatePresence, motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { CATEGORY_LABEL, priorityColor } from "../lib/colors.ts";
import { humanize } from "../lib/format.ts";
import { selectSessionList, useAuraStore } from "../store/useAuraStore.ts";
import { Dot, Panel } from "./ui.tsx";

export function CallRoster() {
  const sessions = useAuraStore(useShallow(selectSessionList));
  const focusId = useAuraStore((s) => s.focusId);
  const focus = useAuraStore((s) => s.focus);
  const sorted = [...sessions].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "focus" ? -1 : 1));

  return (
    <Panel
      title={`active calls / ${sessions.length}`}
      right={<span className="label !text-white/30">click to focus</span>}
      className="shrink-0"
      bodyClassName="p-1.5 max-h-[168px] overflow-y-auto scroll-thin"
    >
      {sorted.length === 0 && <div className="mono text-[11px] text-white/35 px-2 py-2">No calls on the overflow queue.</div>}
      <AnimatePresence initial={false}>
        {sorted.map((s) => {
          const state = s.state;
          const color = priorityColor(state?.priority);
          const active = s.id === focusId;
          return (
            <motion.button
              key={s.id}
              type="button"
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              onClick={() => focus(s.id)}
              className={`w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors ${
                active ? "bg-white/[0.07] border border-white/15" : "border border-transparent hover:bg-white/[0.04]"
              }`}
            >
              <Dot color={color} pulse={state?.priority === "critical"} size={8} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-white/90 truncate">{s.caller?.caller_label ?? s.id}</span>
                  {s.kind === "focus" && <span className="label !text-aura">focus</span>}
                  {s.caller?.language && s.caller.language !== "en-US" && <span className="label">{s.caller.language}</span>}
                </div>
                <div className="mono text-[10px] text-white/45 truncate">
                  {state ? `${CATEGORY_LABEL[state.category]} / ${humanize(state.protocol.step) ?? "intake"}` : "connecting"}
                  {state?.location.normalized ? ` / ${state.location.normalized.split(",")[0]}` : ""}
                </div>
              </div>
              <span className="mono text-[10px] uppercase tracking-widest shrink-0" style={{ color }}>
                {state?.status === "dispatched" ? "dispatched" : state?.status === "awaiting_approval" ? "approval" : (state?.priority ?? "new")}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </Panel>
  );
}
