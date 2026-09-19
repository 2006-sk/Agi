'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';
import * as THREE from 'three';

import { useSignalCount } from '@/hooks/useSignal';
import { CATEGORY_COLOR, COLOR } from '@/lib/tokens';
import { useAuraStore, type Quality } from '@/state/auraStore';
import type { IncidentCategory, Priority } from '@/types/events';

const BEAM_H = 44;
const RING_COUNT = 3;
const LOCK_MS = 560;
const SHOCK_MS = 680;

const PARTICLES: Record<Quality, number> = { high: 240, medium: 120, low: 0 };

function incidentHex(category: IncidentCategory, priority: Priority): string {
  if (priority === 'critical') return COLOR.red;
  if (priority === 'high') return COLOR.amber;
  return CATEGORY_COLOR[category];
}

/** Deterministic noise — the city layout has no Math.random and neither does this. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Marker = {
  id: string;
  x: number;
  z: number;
  color: string;
  ended: boolean;
};

/**
 * Where the call is, on the plate. The active incident gets a beam, radar rings,
 * a locking pin and a category signature; every other live call gets a quiet
 * marker so the whole load is visible at once.
 */
export function IncidentBeacon() {
  const location = useAuraStore((s) => s.location);
  const incident = useAuraStore((s) => s.incident);
  const quality = useAuraStore((s) => s.quality);
  const still = useAuraStore((s) => s.reducedMotion || s.degraded);

  // Primitives only: the active call's entry churns at 20Hz while audio streams.
  const callX = useAuraStore((s) => {
    const c = s.activeCallId ? s.calls[s.activeCallId] : null;
    return c?.coords?.x ?? null;
  });
  const callZ = useAuraStore((s) => {
    const c = s.activeCallId ? s.calls[s.activeCallId] : null;
    return c?.coords?.z ?? null;
  });

  // Encoded as strings so the shallow compare never sees a fresh object.
  const encoded = useAuraStore(
    useShallow((s) =>
      s.callIds.flatMap((id) => {
        const c = s.calls[id];
        if (!c || !c.coords || id === s.activeCallId) return [];
        return [`${id}|${c.coords.x}|${c.coords.z}|${c.category}|${c.priority}|${c.status}`];
      }),
    ),
  );

  const markers = useMemo<Marker[]>(
    () =>
      encoded.map((row) => {
        const [id, x, z, category, priority, status] = row.split('|');
        return {
          id,
          x: Number(x),
          z: Number(z),
          color: incidentHex(category as IncidentCategory, priority as Priority),
          ended: status === 'ended',
        };
      }),
    [encoded],
  );

  const x = location?.coords.x ?? callX;
  const z = location?.coords.z ?? callZ;

  const category = incident?.category ?? 'unknown';
  const priority = incident?.priority ?? 'unknown';
  const color = incidentHex(category, priority);
  const particles = PARTICLES[quality];

  return (
    <group>
      {x !== null && z !== null && (
        <group position={[x, 0, z]}>
          <Beam color={color} still={still} />
          <RadarRings
            color={color}
            verified={location?.verified ?? false}
            confidence={location?.confidence ?? 0}
            still={still}
          />
          <LockPin
            color={color}
            verified={location?.verified ?? false}
            confidence={location?.confidence ?? 0}
            still={still}
          />
          <CategorySignature
            category={category}
            color={color}
            count={particles}
            still={still}
          />
          {!still && <Shockwave />}
        </group>
      )}

      {markers.map((m) => (
        <CallMarker key={m.id} marker={m} still={still} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Beam                                                                */
/* ------------------------------------------------------------------ */

function Beam({ color, still }: { color: string; still: boolean }) {
  const sleeve = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const mat = sleeve.current;
    if (!mat) return;
    mat.opacity = still ? 0.15 : 0.15 + Math.sin(clock.elapsedTime * 1.6) * 0.045;
  });

  return (
    <group position={[0, BEAM_H / 2, 0]}>
      <mesh>
        <cylinderGeometry args={[1.05, 0.26, BEAM_H, 20, 1, true]} />
        <meshBasicMaterial
          ref={sleeve}
          color={color}
          transparent
          opacity={0.15}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          fog={false}
        />
      </mesh>
      <mesh>
        <cylinderGeometry args={[0.15, 0.05, BEAM_H, 8, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.8}
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

/* ------------------------------------------------------------------ */
/* Radar rings                                                         */
/* ------------------------------------------------------------------ */

function RadarRings({
  color,
  verified,
  confidence,
  still,
}: {
  color: string;
  verified: boolean;
  confidence: number;
  still: boolean;
}) {
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const spread = verified ? 7 : 7 + (1 - confidence) * 16;

  useFrame(({ clock }) => {
    for (let i = 0; i < RING_COUNT; i++) {
      const mesh = rings.current[i];
      if (!mesh) continue;
      const phase = still
        ? (i + 1) / (RING_COUNT + 1)
        : (clock.elapsedTime * 0.36 + i / RING_COUNT) % 1;
      mesh.scale.setScalar(0.6 + phase * spread);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - phase) * (still ? 0.3 : 0.46);
    }
  });

  return (
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]}>
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            rings.current[i] = m;
          }}
        >
          <ringGeometry args={[0.93, 1, 64]} />
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
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Pin — provisional until the address is verified, then it locks       */
/* ------------------------------------------------------------------ */

const BRACKETS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function LockPin({
  color,
  verified,
  confidence,
  still,
}: {
  color: string;
  verified: boolean;
  confidence: number;
  still: boolean;
}) {
  const pin = useRef<THREE.Group>(null);
  const bracket = useRef<THREE.Group>(null);
  const area = useRef<THREE.Group>(null);

  const locked = useSignalCount('locationLocked');
  const seen = useRef(locked);
  const startedAt = useRef(-1);
  const sized = useRef(false);

  // Uncertainty is a radius: a weak fix is visibly a wide area, not a dot.
  const areaRadius = verified ? 2.4 : 4 + (1 - confidence) * 13;

  useEffect(() => {
    if (seen.current === locked) return;
    seen.current = locked;
    startedAt.current = performance.now();
  }, [locked]);

  useFrame(({ clock }) => {
    const group = pin.current;
    const brackets = bracket.current;
    const ring = area.current;
    if (!group || !brackets || !ring) return;

    const t =
      startedAt.current < 0 || still
        ? 1
        : Math.min(1, (performance.now() - startedAt.current) / LOCK_MS);

    // Decisive snap: overshoot on arrival, ringing down to exactly 1.
    let scale = 1 + 0.85 * Math.exp(-6 * t) * Math.cos(11 * t);
    if (!verified && !still) scale *= 1 + Math.sin(clock.elapsedTime * 2.1) * 0.05;
    group.scale.setScalar(scale);

    brackets.rotation.y = verified
      ? (1 - t) * Math.PI * 0.4
      : still
        ? Math.PI * 0.25
        : clock.elapsedTime * 0.5;
    brackets.scale.setScalar(1 + (1 - t) * 0.5);

    // The uncertainty area contracts toward the fix rather than jumping.
    if (!sized.current || still) {
      ring.scale.setScalar(areaRadius);
      sized.current = true;
    } else {
      const r = ring.scale.x;
      ring.scale.setScalar(r + (areaRadius - r) * 0.08);
    }
  });

  return (
    <group>
      {/* The area the address could be in. */}
      <group ref={area}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <circleGeometry args={[1, 48]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={verified ? 0.05 : 0.09}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            fog={false}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
          <ringGeometry args={[0.975, 1, 72]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={verified ? 0.5 : 0.28}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            fog={false}
          />
        </mesh>
      </group>

      <group ref={pin}>
        {/* Hollow and breathing while provisional, solid once locked. */}
        <mesh position={[0, 2.5, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.7, 2, 4, 1, !verified]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={verified ? 0.95 : 0.4}
            wireframe={!verified}
            side={THREE.DoubleSide}
            toneMapped={false}
            fog={false}
          />
        </mesh>
        <mesh position={[0, 3.35, 0]}>
          <octahedronGeometry args={[0.46, 0]} />
          <meshBasicMaterial
            color={verified ? '#ffffff' : color}
            transparent
            opacity={verified ? 1 : 0.55}
            toneMapped={false}
            fog={false}
          />
        </mesh>

        <group ref={bracket} position={[0, 0.9, 0]}>
          {BRACKETS.map(([bx, bz], i) => (
            <mesh key={i} position={[bx * 1.9, 0, bz * 1.9]}>
              <boxGeometry args={[bx === 0 ? 1.5 : 0.09, 0.09, bz === 0 ? 1.5 : 0.09]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={verified ? 0.95 : 0.45}
                toneMapped={false}
                fog={false}
              />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Critical shockwave — one fast red ring, under 700ms, never a loop    */
/* ------------------------------------------------------------------ */

function Shockwave() {
  const mesh = useRef<THREE.Mesh>(null);
  const count = useSignalCount('critical');
  const seen = useRef(count);
  const startedAt = useRef(-1);

  useEffect(() => {
    if (seen.current === count) return;
    seen.current = count;
    startedAt.current = performance.now();
  }, [count]);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    if (startedAt.current < 0) {
      m.visible = false;
      return;
    }
    const t = (performance.now() - startedAt.current) / SHOCK_MS;
    if (t >= 1) {
      m.visible = false;
      return;
    }
    m.visible = true;
    const eased = 1 - Math.pow(1 - t, 2.4);
    m.scale.setScalar(1 + eased * 58);
    (m.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - t, 1.7) * 0.9;
  });

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]} visible={false}>
      <ringGeometry args={[0.88, 1, 96]} />
      <meshBasicMaterial
        color={COLOR.red}
        transparent
        opacity={0}
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        fog={false}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Category signature — fire, medical and police never look alike       */
/* ------------------------------------------------------------------ */

function CategorySignature({
  category,
  color,
  count,
  still,
}: {
  category: IncidentCategory;
  color: string;
  count: number;
  still: boolean;
}) {
  if (category === 'medical') {
    return (
      <>
        <MedicalCross color={color} still={still} />
        <ParticleColumn
          color={color}
          count={count}
          radius={1.5}
          height={11}
          speed={2.6}
          still={still}
          seed={0x6d17}
        />
      </>
    );
  }
  if (category === 'fire') {
    return (
      <ParticleColumn
        color={color}
        count={count}
        radius={3.4}
        height={13}
        speed={3.6}
        still={still}
        seed={0xf17e}
      />
    );
  }
  if (category === 'police') {
    return <PoliceBars color={color} still={still} />;
  }
  return null;
}

function MedicalCross({ color, still }: { color: string; still: boolean }) {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g || still) return;
    g.position.y = 7.4 + Math.sin(clock.elapsedTime * 1.1) * 0.35;
  });

  return (
    <group ref={group} position={[0, 7.4, 0]}>
      <mesh>
        <boxGeometry args={[2.4, 0.62, 0.16]} />
        <meshBasicMaterial color={color} toneMapped={false} fog={false} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.62, 2.4, 0.16]} />
        <meshBasicMaterial color={color} toneMapped={false} fog={false} />
      </mesh>
    </group>
  );
}

function PoliceBars({ color, still }: { color: string; still: boolean }) {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g || still) return;
    g.rotation.y = clock.elapsedTime * 2.2;
  });

  return (
    <group ref={group} position={[0, 2.2, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} rotation={[0, (i * Math.PI * 2) / 3, 0]} position={[0, 0, 0]}>
          <boxGeometry args={[0.16, 0.5, 5.2]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.8}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
            fog={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function ParticleColumn({
  color,
  count,
  radius,
  height,
  speed,
  still,
  seed,
}: {
  color: string;
  count: number;
  radius: number;
  height: number;
  speed: number;
  still: boolean;
  seed: number;
}) {
  const points = useRef<THREE.Points>(null);

  const { geometry, rates } = useMemo(() => {
    const rnd = mulberry32(seed);
    const position = new Float32Array(Math.max(count, 1) * 3);
    const rate = new Float32Array(Math.max(count, 1));
    for (let i = 0; i < count; i++) {
      const angle = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * radius;
      position[i * 3] = Math.cos(angle) * r;
      position[i * 3 + 1] = rnd() * height;
      position[i * 3 + 2] = Math.sin(angle) * r;
      rate[i] = 0.55 + rnd() * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
    return { geometry: geo, rates: rate };
  }, [count, radius, height, seed]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, delta) => {
    if (still || count === 0) return;
    const p = points.current;
    if (!p) return;
    const attr = p.geometry.getAttribute('position') as THREE.BufferAttribute;
    const array = attr.array as Float32Array;
    const step = Math.min(delta, 0.05) * speed;
    for (let i = 0; i < count; i++) {
      const y = i * 3 + 1;
      array[y] += step * rates[i];
      if (array[y] > height) array[y] -= height;
    }
    attr.needsUpdate = true;
  });

  if (count === 0) return null;

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        color={color}
        size={0.26}
        sizeAttenuation
        transparent
        opacity={0.72}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        fog={false}
      />
    </points>
  );
}

/* ------------------------------------------------------------------ */
/* Background calls                                                    */
/* ------------------------------------------------------------------ */

function CallMarker({ marker, still }: { marker: Marker; still: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const dim = marker.ended ? 0.22 : 0.55;

  useFrame(({ clock }) => {
    const m = ring.current;
    if (!m || still || marker.ended) return;
    const phase = (clock.elapsedTime * 0.3 + marker.x * 0.05) % 1;
    m.scale.setScalar(1 + phase * 3.4);
    (m.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.34;
  });

  return (
    <group position={[marker.x, 0, marker.z]}>
      <mesh position={[0, 1.4, 0]}>
        <octahedronGeometry args={[0.62, 0]} />
        <meshBasicMaterial
          color={marker.color}
          transparent
          opacity={dim}
          toneMapped={false}
          fog={false}
        />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
        <ringGeometry args={[1.4, 1.62, 40]} />
        <meshBasicMaterial
          color={marker.color}
          transparent
          opacity={dim * 0.6}
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
