"use client";

// The bay and the ocean.
//
// The water plane sits *below* zero on purpose. Land cannot be pushed up — the incident and
// responder layers place themselves off geo.ts `elevation()` and would end up buried — so the
// peninsula gets its ~30 m of freeboard by dropping the sea instead. That one offset is what turns
// the coastline from a tint change into a lit cliff edge.
//
// Character: darker and flatter than land, near-black, with long slow swells and a single broad
// specular band. It must read as a surface rather than as a hole, and never as a feature.
import { useFrame } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { useEffect } from "react";
import * as THREE from "three";
import { palette } from "@/lib/palette";
import { useAura } from "@/state/auraStore";

/**
 * Horizon tone and density — shared with Atmosphere so fog, water and backdrop agree.
 *
 * The density is deliberately gentle. Fog is depth, but past about 0.005 it swallows the bay whole
 * and the peninsula loses the water on three sides that makes it recognisable. At this value the
 * near and middle bay stay clearly darker than the sky and only the far distance blends away.
 */
export const FOG_COLOR = "#0c1727";
export const FOG_DENSITY = 0.0045;

/**
 * Height of the sea surface. Land sits at/above y = 0, so this is the peninsula's freeboard:
 * the coastal cliff is exactly this deep. Terrain hangs its skirt past it.
 */
export const WATER_Y = -0.3;

const vertexShader = /* glsl */ `
  varying vec2 vWorld;
  varying float vDepth;
  varying vec3 vView;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    vView = normalize(cameraPosition - world.xyz);
    vec4 mv = viewMatrix * world;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uSheen;
  uniform vec3 uSky;
  uniform vec3 uFog;
  uniform float uFogDensity;
  uniform vec3 uKey;
  varying vec2 vWorld;
  varying float vDepth;
  varying vec3 vView;

  void main() {
    // Long anisotropic swells — stretched far more across the bay than along it, so the sea has a
    // direction and does not read as a tiled noise field.
    float s1 = sin(vWorld.x * 0.085 + vWorld.y * 0.021 + uTime * 0.09);
    float s2 = sin(vWorld.y * 0.063 - vWorld.x * 0.017 - uTime * 0.065);
    float s3 = sin((vWorld.x * 0.4 + vWorld.y) * 0.028 + uTime * 0.041);
    float swell = (s1 * 0.5 + s2 * 0.34 + s3 * 0.16) * 0.5 + 0.5;

    vec3 col = uDeep + uSheen * (0.12 + 0.34 * pow(swell, 2.4));

    // Water seen at a grazing angle reflects the sky, which is why the far bay is lighter than the
    // water at your feet. This is the cue that does the real work: without it the distance is a flat
    // dark field indistinguishable from the backdrop, and the bay reads as a hole in the world.
    // Capped below 1 so the sea stays a shade under the sky and the horizon is still a line.
    // A very low frequency term that still has wavelength left at 200 units out, so the far bay
    // keeps some broad banding instead of going completely flat once the swells compress away.
    float far = sin(vWorld.x * 0.011 - vWorld.y * 0.008 + uTime * 0.02) * 0.5 + 0.5;

    float graze = pow(1.0 - clamp(vView.y, 0.0, 1.0), 4.0);
    col = mix(col, uSky, graze * 0.40 * (0.86 + 0.14 * far));

    // One broad, soft specular band where the key light lies down the water. Slow and low contrast:
    // enough to say "surface", not enough to become a feature.
    vec3 h = normalize(uKey + vView);
    float spec = pow(max(h.y, 0.0), 42.0);
    col += uSheen * spec * (0.5 + 0.5 * swell) * 1.3;

    float f = 1.0 - exp(-pow(vDepth * uFogDensity, 2.0));
    col = mix(col, uFog, clamp(f, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

// Shader uniforms live outside the component: they are mutated every frame, which is exactly what
// React values must never be. There is one city per document, so module scope is the right home.
const uniforms = {
  uTime: { value: 0 },
  // Dark enough to sit well under the land, light enough to separate from the sky so the horizon
  // is a line rather than a blur. Pure black reads as a hole in the world, not as the Pacific.
  uDeep: { value: new THREE.Color(palette.navy900).multiplyScalar(0.45) },
  uSheen: { value: new THREE.Color(palette.navy700).multiplyScalar(0.85) },
  // Matches Atmosphere's horizon tone — the water is reflecting that sky, so they have to agree.
  uSky: { value: new THREE.Color(FOG_COLOR).multiplyScalar(1.55) },
  uFog: { value: new THREE.Color(FOG_COLOR) },
  uFogDensity: { value: FOG_DENSITY },
  uKey: { value: new THREE.Vector3(-40, 60, -55).normalize() },
};

export default function Water() {
  const quality = useAura((s) => s.quality);
  const reduced = useReducedMotion() === true;
  const still = reduced || quality === "low";

  // A still sea still needs a shape, just a frozen one.
  useEffect(() => {
    if (still) uniforms.uTime.value = 12;
  }, [still]);

  useFrame((_, delta) => {
    if (still) return;
    uniforms.uTime.value += Math.min(delta, 0.1);
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_Y, 0]} frustumCulled={false} renderOrder={-2}>
      <planeGeometry args={[1400, 1400, 1, 1]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        toneMapped={false}
      />
    </mesh>
  );
}
