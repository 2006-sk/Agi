import { Grid } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, Color, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, ShaderMaterial, Vector3 } from "three";
import { DEMO_CITY } from "../mock/scenario.ts";
import { CITY_HALF, DOWNTOWN, project } from "../lib/geo.ts";
import { FOG_DENSITY } from "./sceneRefs.ts";

const CELL = 3.2;
const STREET = 0.95;

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

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320 * Math.cos((DEMO_CITY.center.latitude * Math.PI) / 180);
const WORLD_SCALE = 0.028;

function unproject(x: number, z: number): { latitude: number; longitude: number } {
  return {
    longitude: DEMO_CITY.center.longitude + x / (M_PER_DEG_LNG * WORLD_SCALE),
    latitude: DEMO_CITY.center.latitude - z / (M_PER_DEG_LAT * WORLD_SCALE),
  };
}

const TWIN_PEAKS = project(37.7535, -122.4468);
const SOMA = project(37.776, -122.412);

function isOpenSpace(x: number, z: number): boolean {
  const { latitude, longitude } = unproject(x, z);
  // the bay
  if (longitude > -122.388 && latitude > 37.742) return true;
  if (latitude > 37.803) return true;
  // Golden Gate Park (east end)
  if (latitude > 37.7663 && latitude < 37.7727 && longitude < -122.4545) return true;
  // Twin Peaks
  if (Math.hypot(x - TWIN_PEAKS[0], z - TWIN_PEAKS[1]) < 6.5) return true;
  // Dolores Park
  if (latitude > 37.7583 && latitude < 37.7607 && longitude > -122.4287 && longitude < -122.4253) return true;
  return false;
}

const vertexShader = /* glsl */ `
  attribute float aSeed;
  varying vec2 vUv;
  varying float vSeed;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vHeight;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vHeight = length(instanceMatrix[1].xyz);
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uFogDensity;
  uniform vec3 uEdgeColor;
  uniform vec3 uWindowColor;
  uniform float uWindowIntensity;
  varying vec2 vUv;
  varying float vSeed;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying float vHeight;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec3 color = vec3(0.010, 0.012, 0.018);
    float side = 1.0 - abs(vNormal.y);

    // neon edges on every face, brighter on the skyline
    vec2 d = min(vUv, 1.0 - vUv);
    float edge = 1.0 - smoothstep(0.0, 0.03, min(d.x, d.y));
    float tall = smoothstep(3.0, 26.0, vHeight);
    color += uEdgeColor * edge * (0.7 + 0.5 * side + 0.9 * tall);
    // faint vertical facade lines
    float facade = 1.0 - smoothstep(0.0, 0.02, abs(fract(vUv.x * 5.0) - 0.5) - 0.48);
    color += uEdgeColor * facade * side * 0.12;

    // windows: fixed grid per face, rows by world height
    float cols = floor(vUv.x * 5.0);
    float rows = floor(vWorldPos.y / 0.7);
    float cell = hash(vec2(cols + vSeed * 91.0, rows + vSeed * 17.0));
    float slow = floor(uTime * 0.08 + cell * 40.0);
    float lit = step(0.58, cell) * step(0.3, hash(vec2(cell * 7.0, slow)));
    vec2 cellUv = vec2(fract(vUv.x * 5.0), fract(vWorldPos.y / 0.7));
    float win = step(0.28, cellUv.x) * step(cellUv.x, 0.72) * step(0.3, cellUv.y) * step(cellUv.y, 0.72);
    float top = step(0.35, vWorldPos.y);
    vec3 windowTint = mix(uWindowColor, vec3(1.0, 0.85, 0.6), step(0.85, hash(vec2(vSeed, cols))));
    color += windowTint * lit * win * side * top * uWindowIntensity;

    // rooftops catch a little sky light
    color += vec3(0.02, 0.05, 0.07) * max(0.0, vNormal.y) * (0.4 + 0.6 * smoothstep(2.0, 30.0, vHeight));

    // exponential fog to black, same density as the scene fog
    float dist = length(vWorldPos - cameraPosition);
    float fogF = 1.0 - exp(-dist * dist * uFogDensity * uFogDensity);
    color = mix(color, vec3(0.0), clamp(fogF, 0.0, 1.0));
    gl_FragColor = vec4(color, 1.0);
  }
`;

interface CityProps {
  density?: number;
}

export function City({ density = 1 }: CityProps) {
  const meshRef = useRef<InstancedMesh>(null);

  const { geometry, count, matrices, seeds } = useMemo(() => {
    const rng = mulberry32(20260919);
    const geometry = new BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const position = new Vector3();
    const scale = new Vector3();
    const matrices: number[] = [];
    const seeds: number[] = [];
    const nx = Math.ceil((CITY_HALF.x * 2) / CELL);
    const nz = Math.ceil((CITY_HALF.z * 2) / CELL);
    for (let i = 0; i < nx; i += 1) {
      for (let j = 0; j < nz; j += 1) {
        const cx = -CITY_HALF.x + i * CELL + CELL / 2;
        const cz = -CITY_HALF.z + j * CELL + CELL / 2;
        const r = rng();
        if (isOpenSpace(cx, cz)) continue;
        if (r < 0.08 + (1 - density) * 0.4) continue;

        const n = valueNoise(cx * 0.05 + 10, cz * 0.05 + 10);
        const dd = Math.hypot(cx - DOWNTOWN[0], cz - DOWNTOWN[1]);
        const downtown = Math.max(0, 1 - dd / 36);
        const ds = Math.hypot(cx - SOMA[0], cz - SOMA[1]);
        const soma = Math.max(0, 1 - ds / 24);
        let h = 0.9 + n * 3.4 + rng() * 1.1;
        h += downtown * downtown * (12 + rng() * 30);
        h += soma * soma * (4 + rng() * 10);
        if (rng() < 0.03) h *= 1.8; // the odd tower

        const w = CELL - STREET - rng() * 0.7;
        const d = CELL - STREET - rng() * 0.7;
        position.set(cx + (rng() - 0.5) * 0.35, 0, cz + (rng() - 0.5) * 0.35);
        scale.set(w, h, d);
        matrix.compose(position, quaternion, scale);
        matrices.push(...matrix.elements);
        seeds.push(rng());
      }
    }
    return { geometry, count: seeds.length, matrices, seeds };
  }, [density]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uFogDensity: { value: FOG_DENSITY },
          uEdgeColor: { value: new Color("#137f95") },
          uWindowColor: { value: new Color("#9fdcff") },
          uWindowIntensity: { value: 1.15 },
        },
      }),
    [],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    for (let k = 0; k < count; k += 1) {
      matrix.fromArray(matrices, k * 16);
      mesh.setMatrixAt(k, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.setAttribute("aSeed", new InstancedBufferAttribute(new Float32Array(seeds), 1));
    mesh.computeBoundingSphere();
  }, [count, matrices, seeds]);

  useFrame(({ clock }) => {
    material.uniforms.uTime!.value = clock.elapsedTime;
  });

  return (
    <group>
      <instancedMesh key={count} ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />
      <Grid
        position={[0, 0.02, 0]}
        args={[CITY_HALF.x * 2.4, CITY_HALF.z * 2.4]}
        cellSize={CELL}
        cellThickness={0.6}
        cellColor="#0a3a45"
        sectionSize={CELL * 5}
        sectionThickness={1.1}
        sectionColor="#0f6275"
        fadeDistance={620}
        fadeStrength={1.6}
        infiniteGrid
      />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.05}>
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
    </group>
  );
}
