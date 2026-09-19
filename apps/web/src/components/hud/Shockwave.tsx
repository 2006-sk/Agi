"use client";

// The single loud moment in the product (DESIGN.md §6): one red shockwave when a call is
// re-classified as critical. One radial wash + one expanding ring, <= 700ms, then gone.
// It never loops, and it never fires twice for the same escalation.
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { easeOut } from "@/lib/motion";
import { useAura } from "@/state/auraStore";

const FULL_MS = 700;
const WASH_MS = 200;

const WASH = [
  "radial-gradient(circle at 50% 52%,",
  "color-mix(in srgb, var(--color-critical) 34%, transparent) 0%,",
  "color-mix(in srgb, var(--color-critical) 13%, transparent) 42%,",
  "transparent 72%)",
].join(" ");

export default function Shockwave() {
  const escalation = useAura((s) => s.escalation);
  const quality = useAura((s) => s.quality);
  const reduced = useReducedMotion();
  const still = reduced === true || quality === "low";

  const [shot, setShot] = useState<number | null>(null);
  const firedAt = useRef<number | null>(null);

  // Keyed on `at`, so a later escalation re-fires and the same one never does.
  useEffect(() => {
    const at = escalation?.at ?? null;
    if (at === null || at === firedAt.current) return;
    firedAt.current = at;
    setShot(at);
  }, [escalation]);

  useEffect(() => {
    if (shot === null) return;
    const id = setTimeout(() => setShot(null), (still ? WASH_MS : FULL_MS) + 60);
    return () => clearTimeout(id);
  }, [shot, still]);

  if (shot === null) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40">
      <motion.div
        key={`wash-${shot}`}
        className="absolute inset-0"
        style={{ background: WASH }}
        initial={{ opacity: 0 }}
        animate={{ opacity: still ? [0, 0.85, 0] : [0, 1, 0.55, 0] }}
        transition={
          still
            ? { duration: WASH_MS / 1000, ease: easeOut, times: [0, 0.35, 1] }
            : { duration: FULL_MS / 1000, ease: easeOut, times: [0, 0.12, 0.45, 1] }
        }
      />
      {!still && (
        <motion.div
          key={`ring-${shot}`}
          className="absolute top-1/2 left-1/2 h-[44vmax] w-[44vmax] rounded-full border-2"
          // Centred with margins, not translate: motion owns `transform` while it animates scale.
          style={{
            marginTop: "-22vmax",
            marginLeft: "-22vmax",
            borderColor: "color-mix(in srgb, var(--color-critical) 72%, transparent)",
          }}
          initial={{ scale: 0.12, opacity: 0.95 }}
          animate={{ scale: 1.85, opacity: 0 }}
          transition={{ duration: 0.66, ease: easeOut }}
        />
      )}
    </div>
  );
}
