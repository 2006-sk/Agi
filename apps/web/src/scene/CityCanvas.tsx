import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useState, type ReactNode } from "react";
import { FogExp2, Group } from "three";
import { Beacons } from "./Beacons.tsx";
import { CameraDirector } from "./CameraDirector.tsx";
import { City } from "./City.tsx";
import { Effects } from "./Effects.tsx";
import { RouteLayer } from "./RouteLayer.tsx";
import { FOG_DENSITY, shake } from "./sceneRefs.ts";
import { Stations } from "./Stations.tsx";

/** Camera shake is applied to the whole world so CameraControls stays authoritative. */
function ShakeGroup({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const remaining = shake.until - performance.now();
    if (remaining > 0) {
      const k = (remaining / 750) * shake.intensity;
      g.position.set((Math.random() - 0.5) * 1.2 * k, (Math.random() - 0.5) * 0.5 * k, (Math.random() - 0.5) * 1.2 * k);
      g.rotation.z = (Math.random() - 0.5) * 0.01 * k;
    } else if (g.position.lengthSq() > 0) {
      g.position.set(0, 0, 0);
      g.rotation.z = 0;
    }
  });
  return <group ref={group}>{children}</group>;
}

export function CityCanvas() {
  const [quality, setQuality] = useState(2);
  const dpr: number | [number, number] = quality === 2 ? [1, 1.75] : quality === 1 ? [1, 1.25] : 1;
  return (
    <Canvas
      dpr={dpr}
      gl={{ antialias: false, powerPreference: "high-performance", alpha: false, stencil: false }}
      camera={{ fov: 42, near: 0.5, far: 1400, position: [-105, 64, 150] }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor("#000000", 1);
        scene.fog = new FogExp2("#000000", FOG_DENSITY);
      }}
    >
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => setQuality((q) => Math.max(0, q - 1))}
        onIncline={() => setQuality((q) => Math.min(2, q + 1))}
        onFallback={() => setQuality(0)}
      />
      <color attach="background" args={["#000000"]} />
      <ambientLight intensity={0.3} />
      <directionalLight position={[90, 140, 70]} intensity={0.7} color="#bfe9ff" />
      <ShakeGroup>
        <City density={quality === 0 ? 0.7 : 1} />
        <Stations />
        <Beacons />
        <RouteLayer />
      </ShakeGroup>
      <CameraDirector />
      {quality > 0 && <Effects quality={quality} />}
    </Canvas>
  );
}
