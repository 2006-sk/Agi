"use client";

// Every block in San Francisco, as one InstancedMesh of solid near-black navy volumes plus one
// merged LineSegments of thin glowing edges. The faces carry the mass — they are opaque, they write
// depth and they genuinely occlude — and the edges carry the look. Dark paper models lit from
// within, never a hologram.
//
// SF is low 3–5 storey fabric everywhere except the Financial District / Transbay corner. That
// contrast IS the skyline, so blockHeight() is deliberately re-curved here: the low end is crushed
// flat and regular, the tall end is exaggerated, and the gap between them is the whole point.
import { useEffect, useMemo } from "react";
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
import { FOG_COLOR, FOG_DENSITY } from "./Water";
import { surfaceY, useLowDetail } from "./Terrain";

const P = CITY.pitch;
const LIM = 62;
/** Volumes are sunk below ground so a block on a slope never shows daylight under a corner. */
const SKIRT = 0.3;
/** How much of the 200 m block the built mass covers — the remainder is the street. */
const COVER = 1.74;
/** Alley between two masses inside one block. */
const ALLEY = 0.1;

// ---------------------------------------------------------------------------
// Shared solid-surface shader. Used by the instanced fabric here and by the landmark volumes in
// Landmarks.tsx, so both read as the same material under the same light.
//
// Three's Lambert path would tie the whole city's tone to whatever lights the scene happens to
// carry; this fixes the key/fill directions in world space instead, which is what makes a face
// plane read against its neighbour at these near-black values. Opaque, depth-writing, no blending.
// ---------------------------------------------------------------------------

/** Matches `<directionalLight position={[-40, 60, -55]} />` in AuraCity. */
const KEY_DIR = new THREE.Vector3(-40, 60, -55).normalize();
/** Matches the cool bounce light from the opposite corner. */
const FILL_DIR = new THREE.Vector3(55, 25, 40).normalize();
/** Rooftop / window light. Warm, but desaturated far enough that it can never read as `urgent`. */
const WINDOW = new THREE.Color("#5a554c");

const solidVertex = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform float uHeight;

  #ifdef USE_INSTANCING
    attribute float aSeed;
  #endif

  varying vec3 vNormalW;
  varying vec3 vFace;
  varying vec3 vTone;
  varying float vDepth;
  varying float vUp;
  varying float vSeed;
  varying float vHeight;

  void main() {
    mat4 model = modelMatrix;
    vec3 scale = vec3(1.0);

    vTone = uBaseColor;
    vSeed = 0.0;
    vUp = 0.66;
    vHeight = uHeight;

    #ifdef USE_INSTANCING
      model = modelMatrix * instanceMatrix;
      scale = vec3(
        length(instanceMatrix[0].xyz),
        length(instanceMatrix[1].xyz),
        length(instanceMatrix[2].xyz)
      );
      vSeed = aSeed;
      vUp = position.y + 0.5;
      vHeight = scale.y;
    #endif

    #ifdef USE_INSTANCING_COLOR
      vTone = instanceColor;
    #endif

    vFace = position * scale;
    vNormalW = normalize(mat3(model) * normal);

    vec4 world = model * vec4(position, 1.0);
    vec4 mv = viewMatrix * world;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const solidFragment = /* glsl */ `
  uniform vec3 uKeyDir;
  uniform vec3 uFillDir;
  uniform vec3 uFog;
  uniform float uFogDensity;
  uniform vec3 uWindow;
  uniform float uWindowAmount;

  varying vec3 vNormalW;
  varying vec3 vFace;
  varying vec3 vTone;
  varying float vDepth;
  varying float vUp;
  varying float vSeed;
  varying float vHeight;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(41.37, 289.13))) * 43758.5453);
  }

  void main() {
    vec3 n = normalize(vNormalW);

    float key = max(dot(n, uKeyDir), 0.0);
    float fill = max(dot(n, uFillDir), 0.0);
    float sky = max(n.y, 0.0);

    // Three tonal steps per volume — lit flank, shadowed flank, roof. That separation is the mass.
    float shade = 0.46 + key * 0.86 + fill * 0.26 + sky * 0.24;
    // The base sits down into the pavement instead of floating off it.
    shade *= mix(0.54, 1.16, smoothstep(0.03, 0.55, vUp));

    vec3 col = vTone * shade;

    // A sparse scatter of lit windows, on the vertical faces of the tall stock only. No geometry.
    if (uWindowAmount > 0.001 && vHeight > 0.34 && abs(n.y) < 0.5) {
      vec2 uv = abs(n.x) > 0.5 ? vFace.zy : vFace.xy;
      vec2 cell = vec2(0.062, 0.086);
      vec2 id = floor(uv / cell);
      vec2 f = fract(uv / cell);
      float pane = step(0.2, f.x) * step(f.x, 0.72) * step(0.24, f.y) * step(f.y, 0.78);
      float density = uWindowAmount * smoothstep(0.3, 1.5, vHeight);
      float lit = step(1.0 - density, hash21(id + vSeed * 57.0));
      col += uWindow * pane * lit;
    }

    float f = 1.0 - exp(-pow(vDepth * uFogDensity, 2.0));
    col = mix(col, uFog, clamp(f, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * One opaque, depth-writing surface material. `windows` is the fraction of panes that are lit
 * (0 disables the branch entirely); `height` only matters for non-instanced geometry, where there
 * is no instance scale to read it from.
 */
export const createSolidMaterial = (windows: number, base: string, height = 1): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: new THREE.Color(base) },
      uHeight: { value: height },
      uKeyDir: { value: KEY_DIR.clone() },
      uFillDir: { value: FILL_DIR.clone() },
      uFog: { value: new THREE.Color(FOG_COLOR) },
      uFogDensity: { value: FOG_DENSITY },
      uWindow: { value: WINDOW.clone() },
      uWindowAmount: { value: windows },
    },
    vertexShader: solidVertex,
    fragmentShader: solidFragment,
    transparent: false,
    depthWrite: true,
    depthTest: true,
    toneMapped: false,
  });

// ---------------------------------------------------------------------------
// Block generation
// ---------------------------------------------------------------------------

type Block = { x: number; z: number; w: number; d: number; h: number; base: number; rot: number; punch: number };

// Bodies stay inside the navy-900 → navy-700 band of DESIGN.md §2, but the two ends are pulled
// apart hard: the low fabric sits *below* the ground tone, so at night the blocks are dark mass and
// the street grid is the light between them, and only the downtown stock rises above the ground.
// That inversion is what stops the fabric reading as a circuit board.
const BODY_LOW = new THREE.Color(palette.navy900).multiplyScalar(0.62);
const BODY_HIGH = new THREE.Color(palette.navy700).multiplyScalar(1.75);
const EDGE = new THREE.Color(palette.edge);

/**
 * blockHeight() re-curved. `t` is where a block sits between the 10 m baseline and the 200 m peak;
 * raising it to 1.35 crushes the middle so the avenues stay flat and only the real downtown lifts.
 */
const shape = (p: Vec2): number => Math.pow(Math.max(0, (blockHeight(p) - 0.1) / 1.9), 1.35);

const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const generate = (low: boolean): Block[] => {
  const rnd = seeded(0x41555241); // "AURA" — the city is byte-identical every reload
  const blocks: Block[] = [];

  const emit = (centre: Vec2, rot: number): void => {
    const base = surfaceY(centre);
    const punch = shape(centre);
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);

    const put = (ox: number, oz: number, w: number, d: number, h: number): void => {
      blocks.push({
        x: centre[0] + ox * cos - oz * sin,
        z: centre[1] + ox * sin + oz * cos,
        w,
        d,
        h,
        base,
        rot,
        punch,
      });
    };

    // A block whose centre is buildable can still hang its corners over the bay or into Golden Gate
    // Park. Testing the footprint instead of the point is what keeps the coastline a hard edge and
    // the parks clean holes — one 200 m block overhanging the water undoes both.
    const c = COVER / 2;
    const clear = CORNERS.every(([sx, sz]) =>
      isBuildable([centre[0] + sx * c * cos - sz * c * sin, centre[1] + sx * c * sin + sz * c * cos]),
    );

    if (!clear) {
      // Waterfront and park-edge blocks shrink to one small mass that stays inside the line.
      put(0, 0, 0.78, 0.78, Math.max(0.07, 0.1 + punch * 0.5));
      return;
    }

    // Every block — avenue or downtown — gets the same textured base of two or three masses of
    // different widths. Downtown then grows towers out of it. Giving the dense blocks one flat
    // full-block podium instead was what made SoMa read as plates under a bright street diagram.
    const tall = 0.112 + punch * 0.95;
    const hOf = (): number => Math.max(0.06, tall * (0.68 + rnd() * 0.84));

    const towers = (): void => {
      if (low || punch <= 0.13) return;
      const peak = 0.09 + punch * 2.15;
      const n = punch > 0.5 ? 5 : punch > 0.28 ? 4 : 2;
      for (let i = 0; i < n; i++) {
        // rnd()*rnd() biases low, so most towers are ordinary and a few genuinely spike. The cap
        // keeps every generated tower under Salesforce Tower — the landmark has to stay the peak.
        const share = 0.3 + rnd() * rnd() * 1.4;
        const w = 0.36 + rnd() * 0.34;
        const h = Math.min(3.0, Math.max(0.16, peak * share));
        put((rnd() - 0.5) * 1.02, (rnd() - 0.5) * 1.02, w, w * (0.72 + rnd() * 0.5), h);
      }
    };

    if (low) {
      put(0, 0, COVER, COVER, hOf() * (punch > 0.13 ? 2.4 : 1));
      return;
    }

    const half = COVER / 2;
    const cut = COVER * (0.32 + rnd() * 0.36);
    const rest = COVER - cut;
    const alongX = rnd() < 0.55;

    // one of the two strips is split again about half the time, so footprints never look uniform
    const split = rnd() < 0.45 ? COVER * (0.36 + rnd() * 0.28) : 0;

    const strip = (offset: number, size: number, band: number): void => {
      if (split > 0 && band === 1) {
        const a = split;
        const b = COVER - split;
        if (alongX) {
          put(offset, -half + a / 2, size - ALLEY, a - ALLEY, hOf());
          put(offset, half - b / 2, size - ALLEY, b - ALLEY, hOf());
        } else {
          put(-half + a / 2, offset, a - ALLEY, size - ALLEY, hOf());
          put(half - b / 2, offset, b - ALLEY, size - ALLEY, hOf());
        }
        return;
      }
      if (alongX) put(offset, 0, size - ALLEY, COVER - ALLEY, hOf());
      else put(0, offset, COVER - ALLEY, size - ALLEY, hOf());
    };

    strip(-half + cut / 2, cut, 0);
    strip(half - rest / 2, rest, 1);
    towers();
  };

  // --- cardinal blocks ---
  for (let gx = -LIM; gx <= LIM; gx += P) {
    for (let gz = -LIM; gz <= LIM; gz += P) {
      const centre: Vec2 = [gx + P / 2, gz + P / 2];
      if (isDowntown(centre) || !isBuildable(centre)) continue;
      emit(centre, 0);
    }
  }

  // --- rotated downtown / SoMa blocks, walked in grid-local space so they land on the same
  // intersections snapToIntersection() hands the responder layer ---
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

  return blocks;
};

export default function Buildings() {
  const low = useLowDetail();

  const built = useMemo(() => {
    const blocks = generate(low);
    const rnd = seeded(0x53464f31); // separate stream so edge jitter never shifts the footprints

    const body = new THREE.BoxGeometry(1, 1, 1);
    const material = createSolidMaterial(low ? 0 : 0.065, palette.navy900);
    const mesh = new THREE.InstancedMesh(body, material, blocks.length);
    mesh.frustumCulled = false;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();
    const tone = new THREE.Color();

    const seeds = new Float32Array(blocks.length);

    // 4 verticals + the roof rectangle, one merged buffer, one draw call.
    const edgePos = new Float32Array(blocks.length * 16 * 3);
    const edgeCol = new Float32Array(blocks.length * 16 * 3);
    let e = 0;

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
      seeds[i] = rnd();

      const lift = Math.min(1, b.h / 1.5);
      tone.copy(BODY_LOW).lerp(BODY_HIGH, lift * 0.95);
      mesh.setColorAt(i, tone);

      // Edges brighten with height and with the density of the district, so the Sunset stays a
      // whisper and the Financial District reads as light. The low fabric is deliberately kept
      // near the noise floor: at 12 m an outlined roof turns the city into a circuit board.
      const k = 0.22 + lift * 1.15 + b.punch * 0.6 + (rnd() - 0.5) * 0.09;
      const wall = EDGE.clone().multiplyScalar(Math.max(0.1, k * (0.2 + lift * 0.62)));
      const roof = EDGE.clone().multiplyScalar(Math.max(0.19, k * (0.34 + lift * 1.05)));

      const cos = Math.cos(b.rot);
      const sin = Math.sin(b.rot);
      const hw = b.w / 2;
      const hd = b.d / 2;
      const corner = (sx: number, sz: number): [number, number] => [
        b.x + sx * hw * cos - sz * hd * sin,
        b.z + sx * hw * sin + sz * hd * cos,
      ];
      const quad = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      const y0 = b.base;
      const y1 = b.base + b.h;

      for (const c of quad) {
        write(c[0], y0, c[1], wall);
        write(c[0], y1, c[1], wall);
      }
      for (let q = 0; q < 4; q++) {
        const a = quad[q];
        const z = quad[(q + 1) % 4];
        write(a[0], y1, a[1], roof);
        write(z[0], y1, z[1], roof);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    body.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));

    const edges = new THREE.BufferGeometry();
    edges.setAttribute("position", new THREE.BufferAttribute(edgePos, 3));
    edges.setAttribute("color", new THREE.BufferAttribute(edgeCol, 3));

    const edgeMaterial = new THREE.LineBasicMaterial({ vertexColors: true, fog: true });

    return { mesh, body, material, edges, edgeMaterial };
  }, [low]);

  useEffect(
    () => () => {
      built.body.dispose();
      built.material.dispose();
      built.edges.dispose();
      built.edgeMaterial.dispose();
      built.mesh.dispose();
    },
    [built],
  );

  return (
    <group>
      <primitive object={built.mesh} />
      <lineSegments geometry={built.edges} material={built.edgeMaterial} frustumCulled={false} />
    </group>
  );
}
