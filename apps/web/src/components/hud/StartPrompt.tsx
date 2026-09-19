"use client";

// The idle state, etched over a calm city. One sentence, one control, one quiet shortcut line.
// The global key handler in useAuraSocket owns D / A / R — this file adds no key listeners.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Kbd } from "@/components/ui";
import { startSession } from "@/lib/auraClient";
import { dur, easeIn, easeOut } from "@/lib/motion";
import { useAura } from "@/state/auraStore";

export default function StartPrompt() {
  const active = useAura((s) => s.activeSessionId);
  const connection = useAura((s) => s.connection);
  const quality = useAura((s) => s.quality);
  const reduced = useReducedMotion();
  const still = reduced === true || quality === "low";

  // Visible only before a session exists, or after the gateway gave up — never over a running call.
  const show = active === null && (connection === "idle" || connection === "offline");

  return (
    <div className="pointer-events-none absolute inset-0">
      <AnimatePresence>
        {show && (
          <motion.div
            key="start-prompt"
            className="absolute inset-x-0 top-[56%] flex justify-center px-6"
            initial={{ opacity: 0, y: still ? 0 : 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: still ? dur.fast : dur.base, ease: easeOut } }}
            exit={{ opacity: 0, y: still ? 0 : -4, transition: { duration: dur.fast, ease: easeIn } }}
          >
            <div className="w-[min(384px,100%)]">
              <p className="label-mono">Standby</p>

              <p className="mt-2 text-[14px] leading-[1.45] text-ink-2">
                No call in progress. AURA answers the overflow line; every dispatch still stops at a human.
              </p>

              <button
                type="button"
                onClick={() => void startSession()}
                style={{
                  borderColor: "color-mix(in srgb, var(--state) 45%, transparent)",
                  background: "color-mix(in srgb, var(--state) 10%, transparent)",
                }}
                className="group pointer-events-auto relative mt-4 inline-flex h-10 items-center gap-3 rounded-xs border px-4"
              >
                {/* hover deepens the state tint — core opacity utilities only, no arbitrary colour parsing */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  style={{ background: "color-mix(in srgb, var(--state) 12%, transparent)" }}
                />
                <span className="display relative text-[17px] leading-none text-ink">Start demo call</span>
                <span className="relative">
                  <Kbd>D</Kbd>
                </span>
              </button>

              <p className="hairline-t label-mono mt-4 pt-2.5" style={{ color: "var(--color-ink-3)" }}>
                D restart · A approve · R reject
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
