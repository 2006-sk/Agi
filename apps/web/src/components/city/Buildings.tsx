"use client";

// Every block in San Francisco, as one InstancedMesh of near-black navy volumes plus one merged
// LineSegments of thin glowing edges. The edges carry the look; the faces are almost black.
// SF is low 3–5 storey fabric everywhere except the Financial District / Transbay corner — that
// contrast IS the skyline, and blockHeight() supplies it.
import { useFrame } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  CITY,
  DOWNTOWN_ROTATION,
  blockHeight,
  fromGrid,
  isBuildable,
  isDowntown,
  seeded,
  toGrid,
  type Vec2,
} from "@/lib/geo";
import { palette } from "@/lib/palette";
import { useAura } from "@/state/auraStore";
import { FOG_DENSITY } from "./Water";
import { surfaceY, useLowDetail } from "./Terrain";

const P = CITY.pitch;
const LIM = 62;
/** Buildings are sunk below ground so a block on a slope never shows daylight under a corner. */
const SKIRT = 0.3;

type Block = { x: number; z: number; w: number; d: number; h: number; base: number; rot: number; lit: boolean };

const EDGE = new THREE.Color(palette.edge);
const BODY_LOW = new THREE.Color(palette.navy900);
const BODY_HIGH = new THREE.Color(palette.navy700);

const generate = (low: boolean): { blocks: Block[] } => {
  const rnd = seeded(0x41555241); // "AURA" — the city is byte-identical every reload
  const blocks: Block[] = [];

  const emit = (centre: Vec2, rot: number): void => {
    const base = surfaceY(centre);
    const tall = blockHeight(centre);
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    const push = (ox: number, oz: number, w: number, d: number, h: number): void => {
      blocks.push({
        x: centre[0] + ox * cos - oz * sin,
        z: centre[1] + ox * sin + oz * cos,
        w,
        d,
        h,
        base,
        rot,
        lit: h > 0.55,
      });
    };

    if (tall > 0.35 && !low) {
      const n = tall > 0.9 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        push(
          (rnd() - 0.5) * 0.92,
          (rnd() - 0.5) * 0.92,
          0.32 + rnd() * 0.3,
          0.32 + rnd() * 0.3,
          Math.max(0.12, tall * (0.4 + rnd() * 1.0)),
        );
      }
      return;
    }

    push(0, 0, 1.16 + rnd() * 0.3, 1.16 + rnd() * 0.3, Math.max(0.07, tall * (0.68 + rnd() * 0.8)));
  };

  // --- cardinal blocks ---
  for (let gx = -LIM; gx <= LIM; gx += P) {
    for (let gz = -LIM; gz <= LIM; gz += P) {
      const centre: Vec2 = [gx + P / 2, gz + P / 2];
      if (isDowntown(centre) || !isBuildable(centre)) continue;
      emit(centre, 0);
    }
  }

  // --- rotated downtown / SoMa blocks, walked in grid-local space ---
  const local0 = toGrid([35, -20]);
  const ox = Math.round(local0[0] / P) * P;
  const oz = Math.round(local0[1] / P) * P;
  const R = 50;
  for (let lx = -R; lx <= R; lx += P) {
    for (let lz = -R; lz <= R; lz += P) {
      const centre = fromGrid([ox + lx + P / 2, oz + lz + P / 2], true);
      if (!isDowntown(centre) || !isBuildable(centre)) continue;
      emit(centre, DOWNTOWN_ROTATION);
    }
  }

  return { blocks };
};

const lightsVertex = /* glsl */ `
  attribute float aPhase;
  attribute float aScale;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uFogDensity;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(-mv.z, 1.0);
    float fog = exp(-pow(d * uFogDensity, 2.0));
    float breath = 0.62 + 0.38 * sin(uTime * 0.55 + aPhase);
    vAlpha = fog * breath;
    gl_PointSize = clamp(aScale * uPixelRatio * (130.0 / d), 1.0, 4.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const lightsFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float m = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
    if (m <= 0.002) discard;
    gl_FragColor = vec4(uColor, vAlpha * m * 0.7);
    #include <colorspace_fragment>
  }
`;

// Mutated every frame, so they live outside React entirely (see Water.tsx).
const lightUniforms = {
  uTime: { value: 0 },
  uPixelRatio: { value: typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio, 1.75) },
  uFogDensity: { value: FOG_DENSITY },
  uColor: { value: new THREE.Color("#5d82b8") },
};

export default function Buildings() {
  const low = useLowDetail();
  const quality = useAura((s) => s.quality);
  const reduced = useReducedMotion() === true;
  const still = reduced || quality === "low";

  const edgeMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const breath = useRef(0);

  const built = useMemo(() => {
    const { blocks } = generate(low);
    const rnd = seeded(0x53464f31); // separate stream so edge jitter never shifts the footprints

    // --- volumes ---
    const body = new THREE.BoxGeometry(1, 1, 1);
    const bodyMaterial = new THREE.MeshLambertMaterial({ fog: true });
    const mesh = new THREE.InstancedMesh(body, bodyMaterial, blocks.length);
    mesh.frustumCulled = false;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();
    const tone = new THREE.Color();

    // --- edges: 4 verticals + the roof rectangle, one merged buffer, zero extra draw calls ---
    const edgePos = new Float32Array(blocks.length * 16 * 3);
    const edgeCol = new Float32Array(blocks.length * 16 * 3);
    let e = 0;

    const lightPos: number[] = [];
    const lightPhase: number[] = [];
    const lightScale: number[] = [];

    const write = (x: number, y: number, z: number, c: THREE.Color): void => {
      edgePos[e * 3] = x;
      edgePos[e * 3 + 1] = y;
      edgePos[e * 3 + 2] = z;
      edgeCol[e * 3] = c.r;
      edgeCol[e * 3 + 1] = c.g;
      edgeCol[e * 3 + 2] = c.b;
      e++;
    };

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const h = b.h + SKIRT;
      pos.set(b.x, b.base + b.h / 2 - SKIRT / 2, b.z);
      quat.setFromAxisAngle(axis, b.rot);
      scale.set(b.w, h, b.d);
      m.compose(pos, quat, scale);
      mesh.setMatrixAt(i, m);

      const lift = Math.min(1, b.h / 1.6);
      tone.copy(BODY_LOW).lerp(BODY_HIGH, lift * 0.85);
      mesh.setColorAt(i, tone);

      const k = 0.38 + Math.min(1, b.h / 1.1) * 1.0 + (rnd() - 0.5) * 0.14;
      const ec = EDGE.clone().multiplyScalar(Math.max(0.2, k));

      const cos = Math.cos(b.rot);
      const sin = Math.sin(b.rot);
      const hw = b.w / 2;
      const hd = b.d / 2;
      const corner = (sx: number, sz: number): [number, number] => [
        b.x + sx * hw * cos - sz * hd * sin,
        b.z + sx * hw * sin + sz * hd * cos,
      ];
      const c0 = corner(-1, -1);
      const c1 = corner(1, -1);
      const c2 = corner(1, 1);
      const c3 = corner(-1, 1);
      const quad = [c0, c1, c2, c3];
      const y0 = b.base;
      const y1 = b.base + b.h;

      for (const c of quad) {
        write(c[0], y0, c[1], ec);
        write(c[0], y1, c[1], ec);
      }
      for (let q = 0; q < 4; q++) {
        const a = quad[q];
        const z = quad[(q + 1) % 4];
        write(a[0], y1, a[1], ec);
        write(z[0], y1, z[1], ec);
      }

      if (b.lit && !low) {
        const n = b.h > 1.2 ? 3 : 1 + (rnd() > 0.5 ? 1 : 0);
        for (let l = 0; l < n; l++) {
          const ox = (rnd() - 0.5) * b.w * 0.75;
          const oz = (rnd() - 0.5) * b.d * 0.75;
          lightPos.push(b.x + ox * cos - oz * sin, y1 + 0.02, b.z + ox * sin + oz * cos);
          lightPhase.push(rnd() * Math.PI * 2);
          lightScale.push(0.9 + rnd() * 0.8);
        }
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const edges = new THREE.BufferGeometry();
    edges.setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
    edges.setAttribute("color", new THREE.BufferAttribute(edgeCol, 3));

    const lights = new THREE.BufferGeometry();
    lights.setAttribute("position", new THREE.Float32BufferAttribute(lightPos, 3));
    lights.setAttribute("aPhase", new THREE.Float32BufferAttribute(lightPhase, 1));
    lights.setAttribute("aScale", new THREE.Float32BufferAttribute(lightScale, 1));

    return { mesh, body, bodyMaterial, edges, lights, lightCount: lightPhase.length };
  }, [low]);

  // The idle city breathes: a single, very small global modulation of the edge lines. It explains
  // nothing, so it stays below the threshold where it could be mistaken for a state change, and it
  // stops entirely in reduced-motion / low-quality mode.
  useFrame((_, delta) => {
    if (still) return;
    const dt = Math.min(delta, 0.1);
    breath.current += dt;
    lightUniforms.uTime.value += dt;
    const mat = edgeMaterialRef.current;
    // Brightness, not opacity: the edge material stays opaque so it depth-sorts against the volumes.
    if (mat) mat.color.setScalar(0.94 + Math.sin(breath.current * 0.68) * 0.06);
  });

  // A live drop to low quality has to leave the edges at their resting brightness.
  useEffect(() => {
    if (!still) return;
    const mat = edgeMaterialRef.current;
    if (mat) mat.color.setScalar(1);
  }, [still]);

  useEffect(
    () => () => {
      built.body.dispose();
      built.bodyMaterial.dispose();
      built.edges.dispose();
      built.lights.dispose();
      built.mesh.dispose();
    },
    [built],
  );

  return (
    <group>
      <primitive object={built.mesh} />
      <lineSegments geometry={built.edges} frustumCulled={false}>
        <lineBasicMaterial ref={edgeMaterialRef} vertexColors fog />
      </lineSegments>
      {built.lightCount > 0 && (
        <points geometry={built.lights} frustumCulled={false}>
          <shaderMaterial
            uniforms={lightUniforms}
            vertexShader={lightsVertex}
            fragmentShader={lightsFragment}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </points>
      )}
    </group>
  );
}
