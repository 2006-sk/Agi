'use client';

import { AnimatePresence, motion } from 'framer-motion';

import { useSignalPulse } from '@/hooks/useSignal';
import { useAuraStore } from '@/state/auraStore';

const FLASH_MS = 600;

/**
 * One short red beat per escalation to critical — never a loop, never a lingering
 * tint. The signal is a counter, so a second escalation fires a second flash.
 */
export function CriticalFlash() {
  const flash = useSignalPulse('critical', FLASH_MS);
  const still = useAuraStore((s) => s.reducedMotion || s.degraded);

  return (
    <AnimatePresence>
      {flash && !still && (
        <motion.div
          key="critical-flash"
          className="aura-critical-flash"
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.4, 0] }}
          exit={{ opacity: 0 }}
          transition={{
            duration: FLASH_MS / 1000,
            times: [0, 0.1, 0.42, 1],
            ease: 'easeOut',
          }}
        />
      )}
    </AnimatePresence>
  );
}
