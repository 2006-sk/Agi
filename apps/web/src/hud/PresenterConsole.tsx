import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { MEDICAL_CARDIAC_SCENARIO } from "../mock/scenario.ts";
import { useController } from "../hooks/useDemoController.ts";
import { transport } from "../lib/client.ts";
import { selectFocus, useAuraStore } from "../store/useAuraStore.ts";
import { Chip, Kbd } from "./ui.tsx";

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex items-center gap-2 group">
      <span className={`w-7 h-4 rounded-full border transition-colors relative ${value ? "bg-aura/30 border-aura/70" : "bg-white/5 border-white/20"}`}>
        <span className={`absolute top-[2px] w-[10px] h-[10px] rounded-full transition-all ${value ? "left-[14px] bg-aura" : "left-[2px] bg-white/40"}`} />
      </span>
      <span className="mono text-[10.5px] text-white/70 group-hover:text-white">{label}</span>
    </button>
  );
}

export function PresenterConsole() {
  const controller = useController();
  const open = useAuraStore((s) => s.ui.consoleOpen);
  const ui = useAuraStore((s) => s.ui);
  const settings = useAuraStore((s) => s.settings);
  const update = useAuraStore((s) => s.updateSettings);
  const setUi = useAuraStore((s) => s.setUi);
  const demo = useAuraStore((s) => selectFocus(s)?.state && s.ui.demoSessionId ? s.sessions[s.ui.demoSessionId]?.transcript.filter((t) => t.speaker === "caller").length ?? 0 : 0);
  const [text, setText] = useState("");
  const scenario = MEDICAL_CARDIAC_SCENARIO;

  const send = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setText("");
    await controller.sendUtterance(trimmed);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="glass pointer-events-auto absolute left-[396px] top-[64px] w-[440px] z-40 flex flex-col"
        >
          <header className="flex items-center justify-between px-3 h-8 border-b hairline">
            <span className="label">presenter console</span>
            <div className="flex items-center gap-2">
              <Chip color={transport.kind === "mock" ? "#a78bfa" : "#22d3ee"} dim title={transport.label}>
                {transport.kind}
              </Chip>
              <Chip color="#9ca3af" dim>
                {ui.demoSessionId ?? "no session"}
              </Chip>
              <button type="button" className="label hover:!text-white" onClick={() => setUi({ consoleOpen: false })}>
                close <Kbd>Esc</Kbd>
              </button>
            </div>
          </header>

          <div className="p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-primary flex-1" disabled={ui.demoStarted || ui.starting} onClick={() => void controller.startDemo()}>
                {ui.starting ? "starting" : ui.demoStarted ? "demo running" : "start demo"} <Kbd>Space</Kbd>
              </button>
              <button
                type="button"
                className="btn"
                disabled={!ui.demoStarted || settings.mode !== "manual" || !transport.capabilities.advance}
                onClick={() => void controller.advance()}
                title="Manual mode: deliver the next caller turn"
              >
                next turn
              </button>
              <button type="button" className="btn btn-reject" onClick={() => void controller.reset()}>
                reset
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <span className="label">mode</span>
                <div className="flex rounded-md border border-white/12 overflow-hidden">
                  {(["auto", "manual"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={ui.demoStarted}
                      onClick={() => update({ mode: m })}
                      className={`flex-1 mono text-[10.5px] py-1.5 uppercase tracking-widest ${settings.mode === m ? "bg-aura/20 text-aura" : "text-white/50 hover:text-white"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="label">pace {settings.pace.toFixed(2)}x</span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={settings.pace}
                  disabled={ui.demoStarted}
                  onChange={(e) => update({ pace: Number(e.target.value) })}
                  className="accent-cyan-400 w-full"
                />
              </div>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <Toggle label="AURA voice" value={settings.ttsAura} onChange={(v) => update({ ttsAura: v })} />
              <Toggle label="caller voice" value={settings.ttsCaller} onChange={(v) => update({ ttsCaller: v })} />
              <Toggle label="sfx" value={settings.sfx} onChange={(v) => update({ sfx: v })} />
              <Toggle label="camera follow" value={settings.follow} onChange={(v) => update({ follow: v })} />
            </div>

            <div className="flex items-center gap-2">
              <span className="label whitespace-nowrap">reviewer</span>
              <input className="input !py-1.5" value={settings.reviewer} onChange={(e) => update({ reviewer: e.target.value })} />
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="label">text-mode fallback / say as the caller</span>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(text);
                }}
              >
                <input className="input" placeholder="Type what the caller says and press Enter" value={text} onChange={(e) => setText(e.target.value)} />
                <button type="submit" className="btn btn-primary">
                  send
                </button>
              </form>
              <div className="flex flex-col gap-1 mt-1 max-h-[130px] overflow-y-auto scroll-thin">
                {scenario.turns.map((turn, i) => (
                  <button
                    key={turn.utterance}
                    type="button"
                    onClick={() => void send(turn.utterance)}
                    className="text-left rounded-md border border-white/[0.08] hover:border-aura/50 hover:bg-aura/[0.06] px-2 py-1.5"
                    title={turn.note}
                  >
                    <div className="flex items-center gap-2">
                      <span className="mono text-[9.5px] text-white/35">{i + 1}</span>
                      <span className="text-[11.5px] text-white/85">{turn.utterance}</span>
                      {turn.barge_in && (
                        <Chip color="#ef4444" dim className="!text-[9px] ml-auto">
                          barge-in
                        </Chip>
                      )}
                      {ui.demoStarted && demo > i && <span className="mono text-[9px] text-emerald-300 ml-auto">sent</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {ui.error && <div className="mono text-[10.5px] text-red-300 border border-red-500/40 rounded-md px-2 py-1.5">{ui.error}</div>}

            <div className="mono text-[9.5px] text-white/35 leading-relaxed">
              <Kbd>Space</Kbd> start / next turn <Kbd>Enter</Kbd> approve <Kbd>R</Kbd> reject <Kbd>`</Kbd> console
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
