"use client";

// Air. A very slight vertical navy gradient at the horizon, ground fog that thickens towards the
// edge of the world so the map has no visible rim, and just enough bloom to make the building edges
// and the incident beacons read as light. No coloured haze, no purple/blue gradient.
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { useEffect } from "react";
import * as THREE from "three";
import { palette } from "@/lib/palette";
import { useAura } from "@/state/auraStore";
import { FOG_COLOR, FOG_DENSITY } from "./Water";

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uTop;
  varying vec3 vDir;
  void main() {
    // A wide, faint vertical navy gradient. The band has to be broad, or the horizon tone is a
    // hard seam instead of air — but it never brightens enough to become a gradient blob (§8).
    float t = smoothstep(-0.06, 0.92, vDir.y);
    gl_FragColor = vec4(mix(uHorizon, uTop, t * t), 1.0);
    #include <colorspace_fragment>
  }
`;

const hazeVertex = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const hazeFragment = /* glsl */ `
  uniform float uTime;
  uniform float uDensity;
  uniform vec3 uColor;
  varying vec2 vWorld;
  void main() {
    float n = sin(vWorld.x * 0.05 + uTime * 0.06) * sin(vWorld.y * 0.043 - uTime * 0.045)
            + 0.6 * sin((vWorld.x + vWorld.y) * 0.031 + uTime * 0.03);
    float haze = 0.45 + 0.55 * (n * 0.5 + 0.5);
    // Radius is tuned to the viewing distance: at 150 the outer fade cut across the middle of the
    // frame and laid a flat wash over the whole city, which collapsed land, water and sky into one
    // ten-level band. It has to sit outside what the camera can see.
    float r = length(vWorld) / 260.0;
    float rim = smoothstep(0.25, 1.0, r);
    float edge = 1.0 - smoothstep(0.9, 1.0, r);
    float a = uDensity * haze * (0.18 + rim * 1.6) * edge;
    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

// Kept low and thin. SF's night fog pools in the valleys, so the hills (which reach ~2.8) have to
// stand clear of it — and the densities stay small because haze over the whole frame is just a
// contrast tax on everything underneath it.
//
// Two layers, not three: each one is a near-full-screen transparent pass, and the third cost a
// measurable slice of the frame budget for a difference that did not survive a screenshot.
const LAYERS: { y: number; density: number }[] = [
  { y: 0.1, density: 0.12 },
  { y: 0.52, density: 0.06 },
];

// Mutated every frame, so they live outside React entirely (see Water.tsx).
const sky = {
  // Clearly above the fog tone. Distant water fades towards the fog colour, so if the sky sits at
  // that same value the sea and the air meet at identical luminance and the horizon disappears —
  // which is exactly what the measurements showed. This gap is the horizon line.
  uHorizon: { value: new THREE.Color(FOG_COLOR).multiplyScalar(1.55) },
  uTop: { value: new THREE.Color(palette.void) },
};

const haze = LAYERS.map((layer) => ({
  uTime: { value: 0 },
  uDensity: { value: layer.density },
  uColor: { value: new THREE.Color(palette.navy900) },
}));

export default function Atmosphere() {
  const quality = useAura((s) => s.quality);
  const reduced = useReducedMotion() === true;
  const plain = reduced || quality === "low";

  useEffect(() => {
    if (plain) for (const u of haze) u.uTime.value = 7;
  }, [plain]);

  useFrame((_, delta) => {
    if (plain) return;
    const dt = Math.min(delta, 0.1);
    for (const u of haze) u.uTime.value += dt;
  });

  return (
    <>
      <fogExp2 attach="fog" args={[FOG_COLOR, FOG_DENSITY]} />

      <mesh renderOrder={-3} frustumCulled={false}>
        <sphereGeometry args={[450, 32, 18]} />
        <shaderMaterial
          uniforms={sky}
          vertexShader={skyVertex}
          fragmentShader={skyFragment}
          side={THREE.BackSide}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>

      {LAYERS.map((layer, i) => (
        <mesh key={layer.y} rotation={[-Math.PI / 2, 0, 0]} position={[0, layer.y, 0]} frustumCulled={false}>
          <planeGeometry args={[560, 560, 1, 1]} />
          <shaderMaterial
            uniforms={haze[i]}
            vertexShader={hazeVertex}
            fragmentShader={hazeFragment}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}

      {!plain && (
        <EffectComposer multisampling={0}>
          {/* Thresholds are linear-space luminance, and this city is near-black: navy edges sit
              around 0.05, Market and the bridge decks around 0.2–0.35, a critical beacon far above.
              A low threshold with a soft knee is what makes that a gradient instead of a switch. */}
          <Bloom
            intensity={0.95}
            luminanceThreshold={0.032}
            luminanceSmoothing={0.28}
            mipmapBlur
            radius={0.7}
          />
        </EffectComposer>
      )}
    </>
  );
}
