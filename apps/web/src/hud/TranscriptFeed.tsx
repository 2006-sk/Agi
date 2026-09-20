import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { pct } from "../lib/format.ts";
import { selectFocus, useEchoStore, type TranscriptItem } from "../store/useEchoStore.ts";
import { Chip, Panel } from "./ui.tsx";

function Equalizer() {
  return (
    <span className="inline-flex items-end gap-[2px] h-3 ml-1">
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="w-[2px] rounded-sm bg-echo"
          animate={{ height: ["30%", "100%", "45%", "85%", "30%"] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

function Bubble({ item, speaking }: { item: TranscriptItem; speaking: boolean }) {
  const agent = item.speaker === "agent";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={`flex flex-col gap-1 max-w-[92%] ${agent ? "self-end items-end" : "self-start items-start"}`}
    >
      <div className="flex items-center gap-2">
        <span className={`label ${agent ? "!text-echo" : "!text-white/55"}`}>{agent ? "ECHO" : "caller"}</span>
        {!agent && <span className="mono text-[9.5px] text-white/35">stt {pct(item.confidence)}</span>}
        {!agent && item.analysisConfidence !== null && <span className="mono text-[9.5px] text-echo/70">understood {pct(item.analysisConfidence)}</span>}
        {item.interrupted && (
          <Chip color="#ef4444" className="!text-[9px]">
            interrupted
          </Chip>
        )}
        {speaking && <Equalizer />}
      </div>
      <div
        className={`rounded-lg px-3 py-2 text-[13px] leading-snug border ${
          agent
            ? `bg-echo/[0.08] border-echo/30 text-cyan-50 ${speaking ? "shadow-[0_0_24px_rgba(34,211,238,0.25)]" : ""}`
            : "bg-white/[0.05] border-white/10 text-white/90"
        } ${item.interrupted ? "line-through decoration-red-400/70 text-white/50" : ""}`}
      >
        {item.text}
      </div>
    </motion.div>
  );
}

export function TranscriptFeed() {
  const focus = useEchoStore(selectFocus);
  const scroller = useRef<HTMLDivElement>(null);
  const items = focus?.transcript ?? [];
  const partial = focus?.partial ?? null;
  const analyzing = focus?.analyzing ?? false;
  const agent = focus?.agent ?? null;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items.length, partial?.text, analyzing]);

  return (
    <Panel
      title="live transcript"
      right={
        <span className="flex items-center gap-2">
          <span className="label !text-white/30">Gradium STT</span>
          {focus?.caller && <Chip color="#9ca3af" dim>{focus.caller.channel}</Chip>}
        </span>
      }
      className="flex-1"
      bodyClassName="p-0 flex flex-col min-h-0"
    >
      <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto scroll-thin p-3 flex flex-col gap-3">
        {items.length === 0 && !partial && (
          <div className="mono text-[11px] text-white/35 m-auto text-center leading-relaxed">
            Transcript appears here as Gradium finalizes speech.
            <br />
            ECHO replies come only from approved protocol templates.
          </div>
        )}
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <Bubble key={item.id} item={item} speaking={Boolean(agent?.active && agent.utteranceId === item.id)} />
          ))}
          {partial && (
            <motion.div key={`partial-${partial.utteranceId}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="self-start max-w-[92%]">
              <div className="flex items-center gap-2 mb-1">
                <span className="label !text-white/55">caller</span>
                <span className="mono text-[9.5px] text-amber-300/80">partial {pct(partial.confidence)}</span>
              </div>
              <div className="rounded-lg px-3 py-2 text-[13px] leading-snug border border-dashed border-white/20 bg-white/[0.03] text-white/75">
                {partial.text}
                <span className="inline-block w-[7px] h-[14px] ml-1 align-middle bg-white/70 animate-blink" />
              </div>
            </motion.div>
          )}
          {analyzing && (
            <motion.div key="analyzing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="self-end flex items-center gap-2 pr-1">
              <span className="mono text-[10.5px] shimmer-text tracking-[0.12em]">ECHO REASONING / SAMBANOVA VIA GENERAL COMPUTE</span>
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.span key={i} className="w-1 h-1 rounded-full bg-echo" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }} />
                ))}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
