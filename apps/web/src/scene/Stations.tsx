import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, Color, DoubleSide, Group } from "three";
import { STATIONS, type Station } from "../mock/scenario.ts";
import { serviceColor } from "../lib/colors.ts";
import { project } from "../lib/geo.ts";
import { selectFocus, useAuraStore } from "../store/useAuraStore.ts";

interface StationMarkerProps {
  station: Station;
  index: number;
  highlighted: boolean;
}

function StationMarker({ station, index, highlighted }: StationMarkerProps) {
  const [x, z] = useMemo(() => project(station.latitude, station.longitude), [station.latitude, station.longitude]);
  const color = useMemo(() => new Color(serviceColor(station.service)), [station.service]);
  const spinner = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (spinner.current) {
      spinner.current.rotation.y = clock.elapsedTime * 0.8 + index;
      spinner.current.position.y = 1.4 + Math.sin(clock.elapsedTime * 2 + index) * 0.15;
    }
  });
  const size = highlighted ? 0.75 : 0.45;
  return (
    <group position={[x, 0, z]}>
      <group ref={spinner}>
        <mesh>
          <octahedronGeometry args={[size, 0]} />
          <meshBasicMaterial color={color} toneMapped={false} transparent opacity={highlighted ? 1 : 0.75} />
        </mesh>
      </group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
        <ringGeometry args={[1.0, 1.15, 40]} />
        <meshBasicMaterial color={color} transparent opacity={highlighted ? 0.7 : 0.28} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} toneMapped={false} />
      </mesh>
      <Html position={[0, 3.2, 0]} center zIndexRange={[3, 0]} style={{ pointerEvents: "none" }}>
        <div className="station-label" style={{ color: highlighted ? serviceColor(station.service) : undefined }}>
          {station.unit_id}
        </div>
      </Html>
    </group>
  );
}

/** Fixed responder roster; a station lights up when it is part of the focused plan. */
export function Stations() {
  const planUnits = useAuraStore((s) => selectFocus(s)?.state?.response_plan?.units.map((u) => u.unit_id).join(",") ?? "");
  const set = useMemo(() => new Set(planUnits.split(",").filter(Boolean)), [planUnits]);
  return (
    <>
      {STATIONS.map((station, index) => (
        <StationMarker key={station.unit_id} station={station} index={index} highlighted={set.has(station.unit_id)} />
      ))}
    </>
  );
}
