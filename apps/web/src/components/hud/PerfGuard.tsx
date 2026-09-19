"use client";

// Keeps the 50-60 FPS promise. Headless: samples real frame time and drops the whole console to
// `quality: "low"` once, permanently, if the scene cannot hold the budget.
//
// The demo panel is 360 Hz, so nothing here assumes 60 Hz: the rolling average is smoothed with the
// delta-time `damp` helper, which gives the same ~1/6s time constant at any refresh rate.
import { useEffect } from "react";
import { damp } from "@/lib/motion";
import { useAura } from "@/state/auraStore";

/** ~45 FPS. Above this for BAD_FOR_MS and we stop paying for bloom and ambient motion. */
const BUDGET_MS = 22;
const BAD_FOR_MS = 2000;
/** Shader compile and the first city frames are always slow — do not judge them. */
const WARMUP_MS = 1200;

export default function PerfGuard() {
  useEffect(() => {
    let raf = 0;
    let dropped = false;

    const drop = () => {
      if (dropped) return;
      dropped = true;
      if (useAura.getState().quality !== "low") useAura.getState().setQuality("low");
    };

    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const forced = new URLSearchParams(window.location.search).get("quality") === "low";
    if (forced || reducedQuery.matches) {
      drop();
      return;
    }

    const onReducedChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        drop();
        cancelAnimationFrame(raf);
      }
    };
    reducedQuery.addEventListener("change", onReducedChange);

    const started = performance.now();
    let last = started;
    let avgMs = 16.7;
    let badSince = 0;

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      raf = requestAnimationFrame(tick);

      // First frame, or the tab was hidden: not a real sample, and the bad-streak must not survive it.
      if (dt <= 0 || dt > 500) {
        badSince = 0;
        return;
      }

      avgMs += (dt - avgMs) * damp(6, dt / 1000);
      if (now - started < WARMUP_MS) return;

      if (avgMs > BUDGET_MS) {
        if (badSince === 0) badSince = now;
        else if (now - badSince >= BAD_FOR_MS) {
          drop();
          cancelAnimationFrame(raf); // once low, stay low — no sampling, no oscillation
        }
      } else {
        badSince = 0;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      reducedQuery.removeEventListener("change", onReducedChange);
    };
  }, []);

  return null;
}
