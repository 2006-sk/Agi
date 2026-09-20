import { AnimatePresence, motion } from "framer-motion";
import { useController } from "../hooks/useDemoController.ts";
import { useEchoStore } from "../store/useEchoStore.ts";
import { Kbd } from "./ui.tsx";

export function Standby() {
  const controller = useController();
  const show = useEchoStore((s) => s.order.length === 0 && !s.ui.demoStarted);
  const starting = useEchoStore((s) => s.ui.starting);
  const error = useEchoStore((s) => s.ui.error);
  const connection = useEchoStore((s) => s.connection);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="standby"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04, filter: "blur(6px)" }}
          transition={{ duration: 0.6 }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div className="pointer-events-auto flex flex-col items-center gap-6 text-center">
            <div className="relative">
              <motion.div
                className="absolute -inset-16 rounded-full border border-echo/20"
                animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.div
                className="absolute -inset-16 rounded-full border border-echo/20"
                animate={{ scale: [1, 1.6], opacity: [0.5, 0] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: "easeOut", delay: 1.3 }}
              />
              <h1 className="font-display font-semibold text-[88px] leading-none tracking-[0.42em] pl-[0.42em] text-white drop-shadow-[0_0_40px_rgba(34,211,238,0.45)]">ECHO</h1>
            </div>
            <div className="flex flex-col items-center gap-1.5">
              <p className="mono text-[12px] tracking-[0.3em] text-echo uppercase">human-supervised emergency intake</p>
              <p className="text-[13px] text-white/55 max-w-[520px] leading-relaxed">
                Answers overflow calls, understands chaotic speech, follows approved protocols, prepares the response and stops at a human gate before anything consequential happens.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className="btn btn-primary !text-[12px] !px-6 !py-3 flex items-center gap-3" disabled={starting || connection !== "open"} onClick={() => void controller.startDemo()}>
                {starting ? "connecting the call" : connection !== "open" ? "connecting to gateway" : "answer the overflow queue"} <Kbd>Space</Kbd>
              </button>
              <button type="button" className="btn !py-3" onClick={() => useEchoStore.getState().setUi({ consoleOpen: true })}>
                presenter console
              </button>
            </div>
            {error && <p className="mono text-[11px] text-red-300 max-w-[520px]">{error}</p>}
            <p className="label !text-white/25">Gradium / Pipecat / SambaNova / General Compute / simulation, not a production 911 system</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
