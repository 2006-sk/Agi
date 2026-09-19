'use client';

import { useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { useSignalPulse } from '@/hooks/useSignal';
import { pathLength } from '@/lib/cityLayout';
import { COLOR } from '@/lib/tokens';
import { useAuraStore, type DispatchState, type RouteEntry, type UnitEntry } from '@/state/auraStore';
import type { ResponderKind } from '@/types/events';

type LineHandle = ComponentRef<typeof Line>;

const ROUTE_Y = 0.35;
const DRAW_MS = 1500;
const PULSE_MS = 1200;
const PULSE_LEN = 9;

const KIND_COLOR: Record<ResponderKind, string> = {
  ems: COLOR.cyan,
  fire: COLOR.amber,
  police: COLOR.violet,
};

function isLive(d: DispatchState): boolean {
  return d === 'approved' || d === 'enroute' || d === 'arrived';
}

/**
 * The proposal, and then the go-signal. A route may be drawn the moment it is
 * proposed, but it stays visibly a proposal — cool, thin, dashed — until an
 * operator approves it.
 */
export function ResponderRoute() {
  const route = useAuraStore((s) => s.route);
  const dispatch = useAuraStore((s) => s.dispatch);
  const units = useAuraStore((s) => s.units);
  const critical = useAuraStore((s) => s.incident?.priority === 'critical');
  const still = useAuraStore((s) => s.reducedMotion || s.degraded);

  // The go-signal travels the route once, and only then does the line read green.
  const pulsing = useSignalPulse('approved', PULSE_MS) && !still;
  const live = isLive(dispatch) && !pulsing;

  return (
    <group>
      {route && (
        <RouteLine
          route={route}
          dispatch={dispatch}
          live={live}
          pulsing={pulsing}
          still={still}
        />
      )}
      {units.map((u) => (
        <UnitMarker key={u.id} unit={u} live={live} critical={critical} still={still} />
      ))}
    </group>
  );
}

function RouteLine({
  route,
  dispatch,
  live,
  pulsing,
  still,
}: {
  route: RouteEntry;
  dispatch: DispatchState;
  live: boolean;
  pulsing: boolean;
  still: boolean;
}) {
  const line = useRef<LineHandle>(null);
  const drawnAt = useRef(-1);

  const points = useMemo(
    () => route.path.map((p) => [p.x, ROUTE_Y, p.z] as [number, number, number]),
    [route.path],
  );
  const total = useMemo(() => pathLength(route.path), [route.path]);

  useEffect(() => {
    drawnAt.current = performance.now();
  }, [route.id]);

  const rejected = dispatch === 'rejected';
  const color = rejected ? COLOR.inert : live ? COLOR.green : COLOR.cyan;
  const width = rejected ? 1.3 : live ? 3.2 : 1.7;
  const opacity = rejected ? 0.3 : live ? 0.95 : 0.6;

  useFrame(() => {
    const mat = line.current?.material;
    if (!mat) return;
    if (drawnAt.current < 0) drawnAt.current = performance.now();

    const t = still ? 1 : Math.min(1, (performance.now() - drawnAt.current) / DRAW_MS);

    if (t < 1) {
      // Draw itself: one dash whose length grows to the whole polyline.
      const eased = 1 - Math.pow(1 - t, 3);
      mat.dashSize = total * eased + 0.001;
      mat.gapSize = total * 2 + 100;
      mat.dashOffset = 0;
      return;
    }

    if (live || rejected) {
      mat.dashSize = total * 2;
      mat.gapSize = 0.001;
      mat.dashOffset = 0;
      return;
    }

    // Held proposal: a dashed line that drifts toward the incident.
    mat.dashSize = 2.6;
    mat.gapSize = 1.9;
    mat.dashOffset = still ? 0 : -((performance.now() / 1000) * 2.6) % 4.5;
  });

  return (
    <>
      <Line
        ref={line}
        points={points}
        color={color}
        lineWidth={width}
        dashed
        transparent
        opacity={opacity}
        depthWrite={false}
        toneMapped={false}
        fog={false}
      />
      {pulsing && <GoPulse points={points} total={total} />}
    </>
  );
}

/** The approval travelling the route once, end to end. */
function GoPulse({
  points,
  total,
}: {
  points: [number, number, number][];
  total: number;
}) {
  const line = useRef<LineHandle>(null);
  const startedAt = useRef(-1);

  useFrame(() => {
    const mat = line.current?.material;
    if (!mat) return;
    if (startedAt.current < 0) startedAt.current = performance.now();
    const t = Math.min(1, (performance.now() - startedAt.current) / PULSE_MS);
    // Travels one dash length past the end so the window leaves the line entirely.
    const head = t * (total + PULSE_LEN * 2);
    mat.dashOffset = PULSE_LEN - head;
    mat.opacity = t > 0.85 ? (1 - t) / 0.15 : 1;
  });

  return (
    <Line
      points={points}
      ref={line}
      color={COLOR.green}
      lineWidth={4.4}
      dashed
      dashSize={PULSE_LEN}
      gapSize={total * 2 + 100}
      transparent
      opacity={1}
      depthWrite={false}
      blending={THREE.AdditiveBlending}
      toneMapped={false}
      fog={false}
    />
  );
}

function UnitMarker({
  unit,
  live,
  critical,
  still,
}: {
  unit: UnitEntry;
  live: boolean;
  critical: boolean;
  still: boolean;
}) {
  const halo = useRef<THREE.Mesh>(null);

  // A critical incident lights up every nearby unit, not just the chosen one.
  const intensity = unit.selected ? 1 : critical ? 0.7 : 0.3;
  const color = unit.selected && live ? COLOR.green : KIND_COLOR[unit.kind];

  useFrame(({ clock }) => {
    const m = halo.current;
    if (!m) return;
    if (still) {
      m.scale.setScalar(1.6);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.2 * intensity;
      return;
    }
    const speed = unit.selected ? 0.55 : 0.3;
    const phase = (clock.elapsedTime * speed + unit.coords.x * 0.07) % 1;
    m.scale.setScalar(1 + phase * 2.6);
    (m.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.36 * intensity;
  });

  return (
    <group position={[unit.coords.x, 0, unit.coords.z]}>
      <mesh position={[0, 1.15, 0]}>
        <octahedronGeometry args={[unit.selected ? 0.85 : 0.6, 0]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.35 + intensity * 0.62}
          toneMapped={false}
          fog={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.09, 0]}>
        <ringGeometry args={[1.25, unit.selected ? 1.55 : 1.4, 40]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.25 + intensity * 0.55}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </mesh>
      <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <ringGeometry args={[1.7, 1.9, 40]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </mesh>
    </group>
  );
}
