"use client";

// The bay and the ocean. Near-black with a faint moving specular — it should read as "not land",
// never as a feature. The distance fade matches the scene's fogExp2 so the water dissolves into the
// horizon instead of ending on a hard line.
import { useFrame } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { useEffect } from "react";
import * as THREE from "three";
import { palette } from "@/lib/palette";
import { useAura } from "@/state/auraStore";

/** Horizon tone and density — shared with Atmosphere so fog, water and backdrop agree. */
export const FOG_COLOR = "#0c1524";
export const FOG_DENSITY = 0.004;

const vertexShader = /* glsl */ `
  varying vec2 vWorld;
  varying float vDepth;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    vec4 mv = viewMatrix * world;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uSheen;
  uniform vec3 uFog;
  uniform float uFogDensity;
  varying vec2 vWorld;
  varying float vDepth;

  void main() {
    float a = sin(vWorld.x * 0.17 + uTime * 0.11) * 0.5 + 0.5;
    float b = sin(vWorld.y * 0.12 - uTime * 0.08 + vWorld.x * 0.05) * 0.5 + 0.5;
    float c = sin((vWorld.x + vWorld.y) * 0.061 + uTime * 0.045) * 0.5 + 0.5;
    float sheen = pow(a * b, 3.0) * 0.6 + pow(c, 9.0) * 0.4;

    vec3 col = uDeep + uSheen * sheen;

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
  uDeep: { value: new THREE.Color(palette.abyss) },
  uSheen: { value: new THREE.Color(palette.navy700) },
  uFog: { value: new THREE.Color(FOG_COLOR) },
  uFogDensity: { value: FOG_DENSITY },
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
    <mesh rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} renderOrder={-2}>
      <planeGeometry args={[1000, 1000, 1, 1]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        toneMapped={false}
      />
    </mesh>
  );
}
