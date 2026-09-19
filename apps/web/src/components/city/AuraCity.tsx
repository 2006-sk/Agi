'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { BUILDINGS, HALF, STREET_LINES } from '@/lib/cityLayout';
import { CATEGORY_COLOR, COLOR } from '@/lib/tokens';
import { useAuraStore } from '@/state/auraStore';
import { priorityRank, type IncidentCategory, type Priority } from '@/types/events';

/** Scratch objects — nothing in this file allocates per frame. */
const dummy = new THREE.Object3D();
const scratchColor = new THREE.Color();
const mixColor = new THREE.Color();

const BODY = new THREE.Color('#0a1628');
const EMISSIVE = new THREE.Color('#0d2a4a');

const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const GROUND = HALF * 7;
const BASE_EMISSIVE = 0.42;

/** How far the city tints toward the incident colour, by priority. */
const TINT: Record<Priority, number> = {
  unknown: 0.03,
  low: 0.05,
  medium: 0.09,
  high: 0.16,
  critical: 0.24,
};

function incidentHex(category: IncidentCategory, priority: Priority): string {
  if (priority === 'critical') return COLOR.red;
  if (priority === 'high') return COLOR.amber;
  return CATEGORY_COLOR[category];
}

export function AuraCity() {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);

  const incident = useAuraStore((s) => s.incident);
  const still = useAuraStore((s) => s.reducedMotion || s.degraded);

  const category = incident?.category ?? 'unknown';
  const priority = incident?.priority ?? 'unknown';

  const tint = useMemo(
    () => new THREE.Color(incidentHex(category, priority)),
    [category, priority],
  );
  const tintAmount = TINT[priority];
  const heat = priorityRank(priority) >= 3 ? 0.14 : 0;

  /* One matrix pass, at mount. 418 boxes, one draw call. */
  useEffect(() => {
    const mesh = bodies.current;
    if (!mesh) return;
    for (let i = 0; i < BUILDINGS.length; i++) {
      const b = BUILDINGS[i];
      dummy.position.set(b.x, b.h / 2, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // Baked-in variation so the skyline is not one flat tone.
      const v = 0.72 + b.glow * 0.52;
      scratchColor.setRGB(v * 0.86, v * 0.96, v * 1.16);
      mesh.setColorAt(i, scratchColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, []);

  /* Every building's corner posts + roof outline, merged into one lineSegments. */
  const edges = useMemo(() => {
    const segments = BUILDINGS.length * 8;
    const position = new Float32Array(segments * 6);
    const color = new Float32Array(segments * 6);
    const post = new THREE.Color(COLOR.edge);
    const crown = new THREE.Color(COLOR.edge).lerp(new THREE.Color(COLOR.cyan), 0.36);

    let p = 0;
    let c = 0;
    const vertex = (x: number, y: number, z: number, tone: THREE.Color, k: number) => {
      position[p++] = x;
      position[p++] = y;
      position[p++] = z;
      color[c++] = tone.r * k;
      color[c++] = tone.g * k;
      color[c++] = tone.b * k;
    };

    for (const b of BUILDINGS) {
      const hw = b.w / 2;
      const hd = b.d / 2;
      const lit = 0.5 + b.glow * 0.6;

      for (const [sx, sz] of CORNERS) {
        const x = b.x + hw * sx;
        const z = b.z + hd * sz;
        vertex(x, 0, z, post, 0.14 * lit);
        vertex(x, b.h, z, post, lit);
      }

      for (let i = 0; i < 4; i++) {
        const a = CORNERS[i];
        const n = CORNERS[(i + 1) % 4];
        vertex(b.x + hw * a[0], b.h, b.z + hd * a[1], crown, lit);
        vertex(b.x + hw * n[0], b.h, b.z + hd * n[1], crown, lit);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    return geometry;
  }, []);

  /* The street grid, also one merged lineSegments. */
  const streets = useMemo(() => {
    const position = new Float32Array(STREET_LINES.length * 2 * 2 * 3);
    let p = 0;
    const vertex = (x: number, z: number) => {
      position[p++] = x;
      position[p++] = 0;
      position[p++] = z;
    };
    for (const v of STREET_LINES) {
      vertex(-HALF, v);
      vertex(HALF, v);
      vertex(v, -HALF);
      vertex(v, HALF);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    return geometry;
  }, []);

  useEffect(() => () => edges.dispose(), [edges]);
  useEffect(() => () => streets.dispose(), [streets]);

  useFrame(({ clock }) => {
    const mat = material.current;
    if (!mat) return;

    if (still) {
      mat.emissiveIntensity = BASE_EMISSIVE + heat;
    } else {
      const t = clock.elapsedTime;
      const breath = Math.sin(t * 0.52) * 0.1 + Math.sin(t * 0.19 + 1.3) * 0.05;
      mat.emissiveIntensity = BASE_EMISSIVE + heat + breath;
    }

    // One colour write per frame for the whole city, never per instance.
    mixColor.copy(BODY).lerp(tint, tintAmount);
    mat.color.lerp(mixColor, 0.06);
    mixColor.copy(EMISSIVE).lerp(tint, tintAmount * 1.6);
    mat.emissive.lerp(mixColor, 0.06);
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <planeGeometry args={[GROUND, GROUND]} />
        <meshStandardMaterial color={COLOR.ground} roughness={0.94} metalness={0.06} />
      </mesh>

      <lineSegments geometry={streets} position={[0, 0.03, 0]} frustumCulled={false}>
        <lineBasicMaterial color="#123a5e" transparent opacity={0.55} />
      </lineSegments>

      <instancedMesh
        ref={bodies}
        args={[undefined, undefined, BUILDINGS.length]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          ref={material}
          color={BODY}
          emissive={EMISSIVE}
          emissiveIntensity={BASE_EMISSIVE}
          roughness={0.64}
          metalness={0.24}
        />
      </instancedMesh>

      <lineSegments geometry={edges} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.62} toneMapped={false} />
      </lineSegments>
    </group>
  );
}
