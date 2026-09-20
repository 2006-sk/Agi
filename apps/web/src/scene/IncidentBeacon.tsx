import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, Color, DoubleSide, Mesh, MeshBasicMaterial, ShaderMaterial } from "three";
import { PRIORITY_PERIOD_S, priorityColor } from "../lib/colors.ts";
import { project } from "../lib/geo.ts";
import { readLevel } from "../store/audioLevels.ts";
import type { SessionView } from "../store/useAuraStore.ts";

const columnVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const columnFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uBoost;
  varying vec2 vUv;
  void main() {
    float a = pow(1.0 - vUv.y, 2.4) * 0.6;
    float band = 0.5 + 0.5 * sin(vUv.y * 26.0 - uTime * 3.5);
    a *= 0.65 + 0.35 * band;
    a *= 1.0 + uBoost;
    gl_FragColor = vec4(uColor * (1.0 + uBoost * 0.6), a);
  }
`;

interface IncidentBeaconProps {
  session: SessionView;
  focused: boolean;
  onSelect: (id: string) => void;
}

export function IncidentBeacon({ session, focused, onSelect }: IncidentBeaconProps) {
  const state = session.state!;
  const latitude = state.location.latitude!;
  const longitude = state.location.longitude!;
  const [x, z] = useMemo(() => project(latitude, longitude), [latitude, longitude]);
  const color = useMemo(() => new Color(priorityColor(state.priority)), [state.priority]);
  const period = PRIORITY_PERIOD_S[state.priority];
  const mul = focused ? 1 : 0.62;
  const height = focused ? 24 : 12;
  const dispatched = state.status === "dispatched";

  const rings = useRef<Mesh[]>([]);
  const shock = useRef<Mesh>(null);
  const core = useRef<Mesh>(null);
  const columnMaterial = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: columnVertex,
        fragmentShader: columnFragment,
        uniforms: { uColor: { value: color.clone() }, uTime: { value: 0 }, uBoost: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    [color],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const level = focused ? readLevel(session.id, "caller") : 0;
    for (let i = 0; i < rings.current.length; i += 1) {
      const ring = rings.current[i];
      if (!ring) continue;
      const phase = (t / period + i / 3) % 1;
      const r = (1.2 + phase * 9.5) * mul;
      ring.scale.set(r, r, 1);
      (ring.material as MeshBasicMaterial).opacity = (1 - phase) ** 1.7 * (dispatched ? 0.45 : 0.9);
    }
    columnMaterial.uniforms.uTime!.value = t;
    columnMaterial.uniforms.uBoost!.value = level * 1.4;
    if (core.current) {
      const pulse = 1 + 0.15 * Math.sin(t * (6.28 / period)) + level * 0.8;
      core.current.scale.setScalar(pulse);
    }
    if (shock.current) {
      const since = session.escalatedAt ? (Date.now() - session.escalatedAt) / 1000 : 99;
      if (since < 1.6) {
        const p = since / 1.6;
        const r = 2 + p * 70;
        shock.current.visible = true;
        shock.current.scale.set(r, r, 1);
        (shock.current.material as MeshBasicMaterial).opacity = (1 - p) ** 1.2 * 0.95;
      } else {
        shock.current.visible = false;
      }
    }
  });

  const label = state.location.normalized?.split(",")[0] ?? state.location.raw ?? session.id;

  return (
    <group position={[x, 0, z]}>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) rings.current[i] = el;
          }}
          rotation-x={-Math.PI / 2}
          position-y={0.06 + i * 0.015}
        >
          <ringGeometry args={[0.9, 1, 72]} />
          <meshBasicMaterial color={color} transparent opacity={0.8} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={shock} rotation-x={-Math.PI / 2} position-y={0.12} visible={false}>
        <ringGeometry args={[0.965, 1, 128]} />
        <meshBasicMaterial color="#ff3131" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} side={DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position-y={height / 2} material={columnMaterial}>
        <cylinderGeometry args={[0.26 * mul, 1.15 * mul, height, 28, 1, true]} />
      </mesh>
      <mesh ref={core} position-y={0.55 * mul}>
        <sphereGeometry args={[0.5 * mul, 20, 20]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <circleGeometry args={[1.6 * mul, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.16} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      {focused && <pointLight color={color} intensity={90} distance={30} decay={2} position-y={4} />}
      <Html position={[0, focused ? 6.5 : 4.5, 0]} center zIndexRange={[4, 0]} style={{ pointerEvents: "auto" }}>
        <button
          type="button"
          onClick={() => onSelect(session.id)}
          className={`beacon-label ${focused ? "" : "beacon-label--ambient"} flex items-center gap-2 cursor-pointer hover:border-white/40`}
          style={{ borderColor: `${priorityColor(state.priority)}88` }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: priorityColor(state.priority), boxShadow: `0 0 8px ${priorityColor(state.priority)}` }} />
          <span className="uppercase tracking-widest" style={{ color: priorityColor(state.priority) }}>
            {state.priority === "unknown" ? "intake" : state.priority}
          </span>
          <span className="text-white/85">{label}</span>
          {dispatched && <span className="text-emerald-300">DISPATCHED</span>}
        </button>
      </Html>
    </group>
  );
}
