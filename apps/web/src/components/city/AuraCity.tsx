"use client";

// The living city. Full-bleed behind the HUD, orbitable at any moment, and the only place in the
// console where a unit is ever shown moving — and only after a human approved it.
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useRef } from "react";
import IncidentLayer from "@/components/city/IncidentLayer";
import { palette } from "@/lib/palette";
import { useAura } from "@/state/auraStore";
import Atmosphere from "./Atmosphere";
import Buildings from "./Buildings";
import CameraRig from "./CameraRig";
import Landmarks from "./Landmarks";
import Streets from "./Streets";
import Terrain from "./Terrain";
import Water from "./Water";

/**
 * Sustained frame time guard. Two consecutive bad 1.5s windows (after a warm-up window) drop the
 * whole console to low quality: no bloom, no ambient motion, camera cuts instead of flights.
 * It only ever downgrades — oscillating between modes mid-demo would be worse than either.
 */
function PerfGuard() {
  const warm = useRef(false);
  const elapsed = useRef(0);
  const frames = useRef(0);
  const bad = useRef(0);
  const done = useRef(false);

  useFrame((_, delta) => {
    if (done.current) return;
    elapsed.current += Math.min(delta, 0.25);
    frames.current += 1;
    if (elapsed.current < 1.5) return;

    const fps = frames.current / elapsed.current;
    elapsed.current = 0;
    frames.current = 0;

    if (!warm.current) {
      warm.current = true; // the first window includes city generation and shader compiles
      return;
    }
    if (fps >= 45) {
      bad.current = 0;
      return;
    }
    bad.current += 1;
    if (bad.current >= 2) {
      done.current = true;
      if (useAura.getState().quality !== "low") useAura.getState().setQuality("low");
    }
  });

  return null;
}

export default function AuraCity() {
  return (
    <Canvas
      flat
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: 42, near: 1, far: 700, position: [-39.6, 47.6, 36] }}
      onCreated={({ gl }) => {
        gl.setClearColor(palette.void, 1);
      }}
    >
      <color attach="background" args={[palette.void]} />

      <Suspense fallback={null}>
        <Atmosphere />

        {/* Almost no light: the faces stay near-black and the edges do the work. Intensities carry
            the 1/PI of three's Lambert BRDF, which is why they look high for so dark a scene. */}
        <ambientLight intensity={1.4} />
        <directionalLight position={[-40, 60, -55]} intensity={3} color="#9fb6d8" />
        <directionalLight position={[55, 25, 40]} intensity={0.9} color="#4a6a9c" />

        <Water />
        <Terrain />
        <Streets />
        <Buildings />
        <Landmarks />
        <IncidentLayer />

        <CameraRig />
      </Suspense>

      <PerfGuard />
    </Canvas>
  );
}
