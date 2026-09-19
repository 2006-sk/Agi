'use client';

import { useLayoutEffect, useRef } from 'react';
import { Trail } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { pointAt } from '@/lib/cityLayout';
import { COLOR } from '@/lib/tokens';
import { useAuraStore, useResponderMayMove, type RouteEntry } from '@/state/auraStore';

const UNIT_Y = 0.6;
const LOOKAHEAD = 0.02;

const nextPos = new THREE.Vector3();
const heading = new THREE.Vector3();

/**
 * The dispatched unit. It exists only once a human has approved the dispatch —
 * before that there is nothing to move.
 */
export function ResponderUnit() {
  const mayMove = useResponderMayMove();
  const route = useAuraStore((s) => s.route);

  // THE APPROVAL INVARIANT: nothing moves before approval.
  if (!mayMove) return null;
  if (!route) return null;

  return <MovingUnit route={route} />;
}

function MovingUnit({ route }: { route: RouteEntry }) {
  const unit = useRef<THREE.Group>(null);
  const progress = useAuraStore((s) => s.dispatchProgress);
  const arrived = useAuraStore((s) => s.dispatch === 'arrived');
  const still = useAuraStore((s) => s.reducedMotion || s.degraded);

  useLayoutEffect(() => {
    const g = unit.current;
    if (!g) return;
    const p = pointAt(route.path, progress);
    g.position.set(p.x, UNIT_Y, p.z);
    // Only the entry position matters here; the frame loop owns it after this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.path]);

  useFrame((_, delta) => {
    const g = unit.current;
    if (!g) return;

    const here = pointAt(route.path, progress);
    nextPos.set(here.x, UNIT_Y, here.z);
    if (still) {
      g.position.copy(nextPos);
    } else {
      // Progress arrives in steps; the unit glides between them.
      g.position.lerp(nextPos, 1 - Math.exp(-7 * Math.min(delta, 0.05)));
    }

    const ahead = pointAt(route.path, Math.min(1, progress + LOOKAHEAD));
    heading.set(ahead.x - here.x, 0, ahead.z - here.z);
    if (heading.lengthSq() < 1e-6) {
      const behind = pointAt(route.path, Math.max(0, progress - LOOKAHEAD));
      heading.set(here.x - behind.x, 0, here.z - behind.z);
    }
    if (heading.lengthSq() > 1e-6) {
      const want = Math.atan2(heading.x, heading.z);
      const turn = ((want - g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      g.rotation.y += still ? turn : turn * 0.18;
    }
  });

  const body = (
    <group ref={unit}>
      <mesh>
        <boxGeometry args={[1.05, 0.66, 2.1]} />
        <meshStandardMaterial
          color="#0d2033"
          emissive={COLOR.green}
          emissiveIntensity={0.55}
          roughness={0.4}
          metalness={0.35}
        />
      </mesh>
      <mesh position={[0, 0.48, -0.1]}>
        <boxGeometry args={[0.86, 0.16, 0.26]} />
        <meshBasicMaterial color={COLOR.green} toneMapped={false} fog={false} />
      </mesh>
      <mesh position={[0, 0.05, 1.5]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.6, 1.8, 12, 1, true]} />
        <meshBasicMaterial
          color={COLOR.green}
          transparent
          opacity={0.22}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.55, 0]}>
        <ringGeometry args={[0.9, 1.15, 32]} />
        <meshBasicMaterial
          color={COLOR.green}
          transparent
          opacity={0.45}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </mesh>
    </group>
  );

  const destination = route.path[route.path.length - 1];

  return (
    <group>
      {still ? (
        body
      ) : (
        <Trail width={1.3} length={7} decay={1.15} attenuation={(w) => w * w} color={COLOR.green}>
          {body}
        </Trail>
      )}
      {arrived && (
        <LandingPulse x={destination.x} z={destination.z} still={still} />
      )}
    </group>
  );
}

/** Arrival: the unit stops and the ground acknowledges it. */
function LandingPulse({ x, z, still }: { x: number; z: number; still: boolean }) {
  const rings = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(({ clock }) => {
    for (let i = 0; i < 2; i++) {
      const m = rings.current[i];
      if (!m) continue;
      const phase = still ? 0.35 + i * 0.3 : (clock.elapsedTime * 0.7 + i * 0.5) % 1;
      m.scale.setScalar(1 + phase * 4.2);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.6;
    }
  });

  return (
    <group position={[x, 0.2, z]} rotation={[-Math.PI / 2, 0, 0]}>
      {[0, 1].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            rings.current[i] = m;
          }}
        >
          <ringGeometry args={[0.9, 1.05, 56]} />
          <meshBasicMaterial
            color={COLOR.green}
            transparent
            opacity={0}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            fog={false}
          />
        </mesh>
      ))}
    </group>
  );
}
