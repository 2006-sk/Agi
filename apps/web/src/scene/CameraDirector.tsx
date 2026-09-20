import { CameraControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useCues } from "../hooks/useCues.ts";
import { project } from "../lib/geo.ts";
import { useEchoStore } from "../store/useEchoStore.ts";
import { shake } from "./sceneRefs.ts";

/** Idle view: from the south-west, low, with the downtown skyline on the horizon. */
const HOME = { position: [-105, 64, 150] as const, target: [20, 5, -30] as const };

export function CameraDirector() {
  const controls = useRef<CameraControls>(null);
  const mode = useRef<"idle" | "focused">("idle");
  const userUntil = useRef(0);
  const focusId = useEchoStore((s) => s.focusId);

  const flyTo = (x: number, z: number, dist = 62) => {
    mode.current = "focused";
    void controls.current?.setLookAt(x + dist * 0.42, dist * 0.6, z + dist * 0.72, x, 1.5, z, true);
  };

  const frame = (a: [number, number], b: [number, number]) => {
    mode.current = "focused";
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const span = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const dist = Math.min(150, Math.max(48, span * 1.7));
    void controls.current?.setLookAt(mx + dist * 0.35, dist * 0.7, mz + dist * 0.62, mx, 0.5, mz, true);
  };

  const home = (smooth: boolean) => {
    mode.current = "idle";
    void controls.current?.setLookAt(...HOME.position, ...HOME.target, smooth);
  };

  useEffect(() => {
    home(false);
  }, []);

  const focusLocation = (id: string | null): [number, number] | null => {
    if (!id) return null;
    const s = useEchoStore.getState().sessions[id];
    const loc = s?.state?.location;
    if (!loc?.verified || loc.latitude === null || loc.longitude === null) return null;
    return project(loc.latitude, loc.longitude);
  };

  const unitLocation = (id: string | null): [number, number] | null => {
    if (!id) return null;
    const route = useEchoStore.getState().sessions[id]?.state?.response_plan?.route;
    const first = route?.polyline[0];
    return first ? project(first[0], first[1]) : null;
  };

  useCues((cue) => {
    const state = useEchoStore.getState();
    if (!state.settings.follow) return;
    const current = state.focusId;
    switch (cue.kind) {
      case "located": {
        if (cue.sessionId !== current) return;
        const [x, z] = project(cue.latitude, cue.longitude);
        flyTo(x, z, 62);
        break;
      }
      case "escalation": {
        if (cue.sessionId !== current) return;
        const at = focusLocation(current);
        if (at) flyTo(at[0], at[1], 40);
        shake.trigger(750, 1);
        // hold the punch-in, then pull back to show the prepared route
        window.setTimeout(() => {
          const state = useEchoStore.getState();
          if (state.focusId !== current) return;
          const a = focusLocation(current);
          const b = unitLocation(current);
          if (a && b) frame(a, b);
        }, 2600);
        break;
      }
      case "dispatch_proposed":
      case "dispatched": {
        if (cue.sessionId !== current) return;
        const a = focusLocation(current);
        const b = unitLocation(current);
        if (a && b) frame(a, b);
        break;
      }
      case "reset":
        home(true);
        break;
      default:
        break;
    }
  });

  useEffect(() => {
    if (!focusId) return;
    const at = focusLocation(focusId);
    const unit = unitLocation(focusId);
    if (at && unit && useEchoStore.getState().sessions[focusId]?.state?.response_plan) frame(at, unit);
    else if (at) flyTo(at[0], at[1]);
  }, [focusId]);

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    if (mode.current === "idle" && performance.now() > userUntil.current) {
      c.azimuthAngle += delta * 0.05;
    }
  });

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={1.05}
      draggingSmoothTime={0.12}
      minDistance={10}
      maxDistance={520}
      maxPolarAngle={Math.PI / 2 - 0.07}
      onStart={() => {
        userUntil.current = performance.now() + 15_000;
      }}
    />
  );
}
