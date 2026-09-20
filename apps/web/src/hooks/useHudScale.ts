import { useEffect, useState, type CSSProperties } from "react";

export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

function compute(): number {
  const s = Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT);
  return Math.min(1, Math.max(0.6, s));
}

/**
 * The HUD is laid out for a 1920x1080 command-center screen and scaled down
 * uniformly on smaller displays so the panels keep their proportions.
 */
export function useHudScale(): { scale: number; style: CSSProperties } {
  const [scale, setScale] = useState(() => (typeof window === "undefined" ? 1 : compute()));
  useEffect(() => {
    const onResize = () => setScale(compute());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const style: CSSProperties =
    scale >= 1
      ? { position: "absolute", inset: 0 }
      : {
          position: "absolute",
          top: 0,
          left: 0,
          width: `${100 / scale}vw`,
          height: `${100 / scale}vh`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        };
  return { scale, style };
}
