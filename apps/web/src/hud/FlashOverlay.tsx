import { useState } from "react";
import { useCues } from "../hooks/useCues.ts";

/** Full-screen red pulse when the focused incident escalates to critical. */
export function FlashOverlay() {
  const [flashes, setFlashes] = useState<number[]>([]);
  useCues((cue) => {
    if (cue.kind !== "escalation") return;
    const id = Date.now();
    setFlashes((f) => [...f, id]);
    setTimeout(() => setFlashes((f) => f.filter((x) => x !== id)), 1000);
  });
  return (
    <>
      {flashes.map((id) => (
        <div key={id} className="absolute inset-0 pointer-events-none vignette-critical animate-flash-red" />
      ))}
    </>
  );
}
