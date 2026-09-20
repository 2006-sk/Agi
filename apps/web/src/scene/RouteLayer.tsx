import { Html, Line, Trail } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { AdditiveBlending, DoubleSide, Group, Mesh, Vector3 } from "three";
import type { Line2 } from "three/examples/jsm/lines/Line2.js";
import { useShallow } from "zustand/react/shallow";
import { serviceColor } from "../lib/colors.ts";
import { project } from "../lib/geo.ts";
import { selectSessionList, useEchoStore, type SessionView } from "../store/useEchoStore.ts";

const SAMPLES = 96;
const DRAW_IN_MS = 1600;

function resample(points: Vector3[], n: number): Vector3[] {
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1]! + points[i]!.distanceTo(points[i - 1]!));
  const total = lengths[lengths.length - 1] ?? 0;
  const out: Vector3[] = [];
  for (let k = 0; k < n; k += 1) {
    const target = (k / (n - 1)) * total;
    let seg = 1;
    while (seg < lengths.length - 1 && lengths[seg]! < target) seg += 1;
    const a = points[seg - 1]!;
    const b = points[seg]!;
    const segLen = lengths[seg]! - lengths[seg - 1]!;
    const t = segLen > 0 ? (target - lengths[seg - 1]!) / segLen : 0;
    out.push(a.clone().lerp(b, t));
  }
  return out;
}

function sampleAt(points: Vector3[], progress: number): { position: Vector3; direction: Vector3 } {
  const f = Math.min(points.length - 1.0001, Math.max(0, progress * (points.length - 1)));
  const i = Math.floor(f);
  const t = f - i;
  const a = points[i]!;
  const b = points[Math.min(points.length - 1, i + 1)]!;
  const position = a.clone().lerp(b, t);
  const direction = b.clone().sub(a);
  if (direction.lengthSq() < 1e-6 && i > 0) direction.copy(a).sub(points[i - 1]!);
  return { position, direction: direction.normalize() };
}

interface RouteLineProps {
  points: Vector3[];
  startedAt: number;
  color: string;
}

function RouteLine({ points, startedAt, color }: RouteLineProps) {
  const dashRef = useRef<Line2>(null);
  const glowRef = useRef<Line2>(null);
  useFrame((_, delta) => {
    const p = Math.min(1, (Date.now() - startedAt) / DRAW_IN_MS);
    const eased = 1 - (1 - p) ** 3;
    const count = Math.max(1, Math.round(eased * (SAMPLES - 1)));
    for (const ref of [dashRef, glowRef]) {
      const line = ref.current;
      if (!line) continue;
      line.geometry.instanceCount = count;
    }
    if (dashRef.current) dashRef.current.material.dashOffset -= delta * 2.2;
  });
  return (
    <>
      <Line ref={glowRef} points={points} color={color} lineWidth={9} transparent opacity={0.14} depthWrite={false} depthTest={false} toneMapped={false} renderOrder={10} />
      <Line
        ref={dashRef}
        points={points}
        color={color}
        lineWidth={2.4}
        dashed
        dashSize={1.4}
        gapSize={0.7}
        transparent
        opacity={0.95}
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
        renderOrder={11}
      />
    </>
  );
}

interface AmbulanceProps {
  points: Vector3[];
  startedAt: number;
  durationMs: number;
  color: string;
  unitId: string;
}

function Ambulance({ points, startedAt, durationMs, color, unitId }: AmbulanceProps) {
  const group = useRef<Group>(null);
  const red = useRef<Mesh>(null);
  const blue = useRef<Mesh>(null);
  const body = useRef<Mesh>(null);
  const [arrived, setArrived] = useState(false);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const raw = Math.min(1, Math.max(0, (Date.now() - startedAt) / durationMs));
    const eased = raw < 0.12 ? (raw / 0.12) ** 2 * 0.12 : raw;
    const { position, direction } = sampleAt(points, eased);
    group.current.position.set(position.x, 0, position.z);
    if (direction.lengthSq() > 0) group.current.rotation.y = Math.atan2(direction.x, direction.z);
    const strobe = Math.floor(clock.elapsedTime * 7) % 2 === 0;
    if (red.current) red.current.visible = strobe;
    if (blue.current) blue.current.visible = !strobe;
    if (raw >= 1 && !arrived) setArrived(true);
    if (arrived && body.current) body.current.position.y = 0.45 + Math.sin(clock.elapsedTime * 3) * 0.05;
  });
  return (
    <group ref={group}>
      <Trail width={1.8} length={7} color={color} attenuation={(t) => t * t} local={false}>
        <mesh ref={body} position-y={0.45}>
          <boxGeometry args={[1.6, 0.72, 0.84]} />
          <meshStandardMaterial color="#e5e7eb" emissive="#93c5fd" emissiveIntensity={0.35} roughness={0.35} metalness={0.1} />
        </mesh>
      </Trail>
      <mesh position={[0, 0.98, 0.18]} ref={red}>
        <boxGeometry args={[0.55, 0.16, 0.22]} />
        <meshBasicMaterial color="#ff2a2a" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.98, -0.18]} ref={blue}>
        <boxGeometry args={[0.55, 0.16, 0.22]} />
        <meshBasicMaterial color="#5aa9ff" toneMapped={false} />
      </mesh>
      <mesh position={[0.82, 0.45, 0]}>
        <boxGeometry args={[0.06, 0.5, 0.8]} />
        <meshBasicMaterial color="#ff5c5c" toneMapped={false} />
      </mesh>
      <pointLight color="#ff4d4d" intensity={35} distance={16} decay={2} position-y={1.6} />
      <Html position={[0, 2.6, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
        <div className="beacon-label flex items-center gap-2" style={{ borderColor: `${color}aa` }}>
          <span className="text-white/90">{unitId}</span>
          <span className={arrived ? "text-emerald-300" : "text-amber-300"}>{arrived ? "ON SCENE" : "EN ROUTE"}</span>
        </div>
      </Html>
    </group>
  );
}

function SessionRoute({ session }: { session: SessionView }) {
  const state = session.state!;
  const plan = state.response_plan!;
  const route = plan.route!;
  const points = useMemo(() => {
    const raw = route.polyline.map(([lat, lng]) => {
      const [x, z] = project(lat, lng);
      return new Vector3(x, 0.4, z);
    });
    return resample(raw, SAMPLES);
  }, [route]);
  const dispatched = state.status === "dispatched";
  const color = dispatched ? "#34d399" : serviceColor(plan.services[0] ?? "EMS");
  const startedAt = session.dispatchProposedAt ?? Date.now();
  const origin = points[0]!;
  const durationMs = Math.min(30_000, Math.max(12_000, route.eta_minutes * 60_000 * 0.1));
  return (
    <group>
      <RouteLine points={points} startedAt={startedAt} color={color} />
      <mesh position={[origin.x, 0.05, origin.z]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[1.3, 1.5, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} toneMapped={false} />
      </mesh>
      {dispatched && session.dispatchedAt && (
        <Ambulance points={points} startedAt={session.dispatchedAt} durationMs={durationMs} color={color} unitId={route.unit_id} />
      )}
    </group>
  );
}

export function RouteLayer() {
  const sessions = useEchoStore(useShallow(selectSessionList));
  return (
    <>
      {sessions
        .filter((s) => s.state?.response_plan?.route)
        .map((s) => (
          <SessionRoute key={s.id} session={s} />
        ))}
    </>
  );
}
