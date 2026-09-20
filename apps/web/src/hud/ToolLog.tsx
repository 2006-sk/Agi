import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { pct } from "../lib/format.ts";
import { selectFocus, useEchoStore, type ToolCall } from "../store/useEchoStore.ts";
import { Chip, Panel } from "./ui.tsx";

const CONSEQUENTIAL = new Set(["create_cad_draft", "request_specialist"]);

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ")
    .slice(0, 90);
}

function ToolRow({ tool }: { tool: ToolCall }) {
  const gated = CONSEQUENTIAL.has(tool.name);
  const color = tool.status === "failed" ? "#ef4444" : gated ? "#34d399" : "#22d3ee";
  return (
    <motion.li layout initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 400, damping: 30 }} className="flex gap-2.5 py-1.5 border-b hairline last:border-0">
      <span className="mt-[3px] shrink-0 w-3.5 h-3.5 flex items-center justify-center">
        {tool.status === "running" ? (
          <span className="w-3 h-3 rounded-full border-[1.5px] border-echo/30 border-t-echo animate-spin" />
        ) : tool.status === "done" ? (
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M3 7.5l2.5 2.5L11 4.5" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M4 4l6 6M10 4l-6 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="mono text-[11.5px]" style={{ color }}>
            {tool.name}
          </span>
          {gated && (
            <Chip color="#34d399" dim className="!text-[9px]">
              human-approved
            </Chip>
          )}
          {tool.durationMs !== null && <span className="mono text-[9.5px] text-white/35 ml-auto">{tool.durationMs}ms</span>}
        </div>
        {tool.status === "running" && <div className="mono text-[10px] text-white/40 truncate">{summarizeArgs(tool.args) || "running"}</div>}
        {tool.summary && <div className="text-[11px] text-white/70 leading-snug mt-0.5">{tool.summary}</div>}
      </div>
    </motion.li>
  );
}

export function ToolLog() {
  const focus = useEchoStore(selectFocus);
  const tools = focus?.tools ?? [];
  const analysis = focus?.analysis ?? null;
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [tools.length, analysis?.utteranceId]);

  const meta = analysis?.meta ?? null;
  const sourceColor = meta?.source === "model" ? "#22d3ee" : meta?.source === "mock" ? "#a78bfa" : meta?.source === "fallback" ? "#fbbf24" : "#64748b";

  return (
    <Panel
      title="reasoning trace / tool calls"
      right={
        meta ? (
          <span className="flex items-center gap-1.5">
            <Chip color={sourceColor}>{meta.source}</Chip>
            <Chip color="#9ca3af" dim title="validation outcome">
              {meta.validation}
            </Chip>
          </span>
        ) : (
          <span className="label !text-white/30">SambaNova / General Compute</span>
        )
      }
      className="h-[300px] shrink-0"
      bodyClassName="p-0 flex flex-col min-h-0"
    >
      <AnimatePresence mode="wait" initial={false}>
        {analysis && (
          <motion.div
            key={analysis.utteranceId}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="px-3 py-2 border-b hairline bg-white/[0.02] shrink-0"
          >
            <div className="flex items-center gap-3">
              <span className="label !text-white/30">turn</span>
              <span className="mono text-[10.5px] text-white/70">
                conf <span className="text-white">{pct(analysis.confidence)}</span>
              </span>
              <span className="mono text-[10.5px] text-white/70">
                model <span className="text-white">{meta?.model_latency_ms !== null && meta?.model_latency_ms !== undefined ? `${Math.round(meta.model_latency_ms)}ms` : "--"}</span>
              </span>
              <span className="mono text-[10.5px] text-white/70">
                total <span className="text-white">{meta ? `${Math.round(meta.total_latency_ms)}ms` : "--"}</span>
              </span>
            </div>
            <div className="text-[11.5px] text-white/85 leading-snug mt-1">{analysis.explanation}</div>
            {meta && meta.triggers_matched.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                <span className="label !text-white/30 self-center">deterministic triggers</span>
                {meta.triggers_matched.map((t) => (
                  <Chip key={t} color="#fbbf24" className="!text-[9px]">
                    {t}
                  </Chip>
                ))}
              </div>
            )}
            {meta && meta.rejected.length > 0 && <div className="mono text-[9.5px] text-amber-300/70 mt-1 truncate">guard: {meta.rejected.join(" | ")}</div>}
          </motion.div>
        )}
      </AnimatePresence>
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto scroll-thin px-3">
        {tools.length === 0 ? (
          <div className="mono text-[11px] text-white/35 py-3">
            Informational tools (normalize / geocode / units / route) run automatically. Consequential tools wait for a human.
          </div>
        ) : (
          <ul>
            <AnimatePresence initial={false}>
              {tools.map((t) => (
                <ToolRow key={t.id} tool={t} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </Panel>
  );
}
