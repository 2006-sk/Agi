"use client";

// The landmass. Everything else in the city agrees with `surfaceY` so streets drape, buildings sit
// and units drive on the same ground.
//
// The peninsula is the single strongest "that is San Francisco" cue, so it is built as an actual
// clipped mass rather than a tinted region of a full plane:
//   · the terrain mesh discards every fragment on the seaward side of the shoreline, so the coast is
//     a hard silhouette edge and not an alpha fade,
//   · a skirt hangs from that edge down past the water plane, giving the land visible thickness,
//   · a hairline traced from the exact SHORELINE polygon sits on the lip, so Ocean Beach reads dead
//     straight and the bay side keeps its ragged piers.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { CITY, SHORELINE, distanceToShore, elevation, inAnyPark, onLand, type Vec2 } from "@/lib/geo";
import { palette } from "@/lib/palette";
import { useAura } from "@/state/auraStore";
import { FOG_COLOR, FOG_DENSITY, WATER_Y } from "./Water";

/**
 * Ground height every city layer agrees on.
 *
 * On land this stays within 3 cm (3 m) of geo.ts `elevation()` on purpose: the incident and
 * responder layers place themselves straight off `elevation()` with lifts of 0.05–0.11, so anything
 * larger would bury a beacon inside the hill it is standing on. The peninsula gets its height from
 * the water plane sitting at `WATER_Y` below zero, not from pushing the land up.
 *
 * Off land this returns a sea bed just under `WATER_Y`, so a stray point that lands offshore is
 * hidden beneath the water instead of floating over it.
 */
export const surfaceY = (p: Vec2): number => {
  const d = distanceToShore(p);
  if (!onLand(p)) return WATER_Y - 0.04 - Math.min(0.9, d * 0.6);
  return Math.min(0.03, 0.012 + d * 0.55) + elevation(p);
};

/**
 * Geometry density is decided once, at mount. The perf guard can flip `quality` mid-demo, but
 * rebuilding several thousand instances while a call is live would hitch far worse than the frame
 * it is trying to save — live quality changes only turn effects and ambient motion off.
 */
export const useLowDetail = (): boolean => {
  const [low] = useState(() => {
    const reduced =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    return reduced || useAura.getState().quality === "low";
  });
  return low;
};

const EXTENT = CITY.half * 2 + 16;

/** Lift used by anything drawn on the ground so it never z-fights the tessellated terrain. */
export const GROUND_LIFT = 0.04;

/** How far the coastal cliff hangs below the waterline. Only the top of it is ever visible. */
const SKIRT_BOTTOM = WATER_Y - 1.15;

/**
 * Appends one skirt vertex. This lives at module scope on purpose: declared inside the useMemo it
 * closes over the arrays it mutates, and the React Compiler rewrites that into a form that throws
 * "push is not defined" on hot reload.
 */
const pushVert = (pos: number[], col: number[], p: Vec2, y: number, c: THREE.Color): void => {
  pos.push(p[0], y, p[1]);
  col.push(c.r, c.g, c.b);
};

const terrainVertex = /* glsl */ `
  attribute float aShore;
  attribute float aElev;
  attribute float aPark;
  varying float vShore;
  varying float vElev;
  varying float vPark;
  varying float vDepth;
  varying vec3 vNormal;

  void main() {
    vShore = aShore;
    vElev = aElev;
    vPark = aPark;
    vNormal = normalize(normalMatrix * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * world;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const terrainFragment = /* glsl */ `
  uniform vec3 uLand;
  uniform vec3 uRidge;
  uniform vec3 uRim;
  uniform vec3 uFog;
  uniform float uFogDensity;
  uniform vec3 uKey;
  varying float vShore;
  varying float vElev;
  varying float vPark;
  varying float vDepth;
  varying vec3 vNormal;

  void main() {
    // The coast. aShore is signed — positive inland, negative at sea — so it crosses zero along a
    // line inside each quad. Discarding on that interpolated value reconstructs the shoreline far
    // more finely than the tessellation itself, which is what makes the edge crisp.
    if (vShore < 0.0) discard;

    float ndl = max(dot(normalize(vNormal), uKey), 0.0);
    vec3 col = mix(uLand, uRidge, clamp(vElev / 2.3, 0.0, 1.0));

    // Hill shading. SF's hills are the reason the grid looks the way it does, so the slopes have to
    // separate from the flats — but the faces stay near-black per DESIGN.md §2.
    col *= 0.46 + 0.72 * ndl;

    // Golden Gate Park and the Presidio are meant to read as dark gaps in the grid (geo.ts). Open
    // ground carries no building edges, so without this the unbuilt blocks come out brighter than
    // the built city, which is backwards.
    col *= 1.0 - 0.45 * vPark;

    // A shallow trough just inland of the water darkens the ground so the lip above it reads as an
    // edge rather than as a glow sitting on open land.
    col *= 0.66 + 0.34 * smoothstep(0.0, 3.2, vShore);

    // The lit rim, in two parts. A single thin contour measured out at only ~2px once the coast is
    // 120 units away, which is far too fine to trace; the wide band gives it enough screen presence
    // to survive that distance, and the tight lip keeps the actual edge crisp.
    float lip = 1.0 - smoothstep(0.0, 1.1, vShore);
    float band = 1.0 - smoothstep(0.0, 4.0, vShore);
    col += uRim * (pow(lip, 1.15) + pow(band, 2.2) * 0.34);

    float f = 1.0 - exp(-pow(vDepth * uFogDensity, 2.0));
    gl_FragColor = vec4(mix(col, uFog, clamp(f, 0.0, 1.0)), 1.0);
    #include <colorspace_fragment>
  }
`;

// Key direction matches the scene's key light in AuraCity so the terrain, the buildings and the
// landmarks are all lit from the same place.
const KEY = new THREE.Vector3(-40, 60, -55).normalize();

export default function Terrain() {
  const low = useLowDetail();

  const { ground, shore, skirt } = useMemo(() => {
    // The coastline is reconstructed from the interpolated shore distance rather than from the
    // tessellation, so the grid can stay coarse without the coast going jagged. The discard costs
    // early-Z over a surface that fills most of the frame, which is what this budget is really for.
    const segments = low ? 104 : 148;
    const g = new THREE.PlaneGeometry(EXTENT, EXTENT, segments, segments);
    g.rotateX(-Math.PI / 2);

    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const count = pos.count;
    const shoreAttr = new Float32Array(count);
    const elevAttr = new Float32Array(count);
    const parkAttr = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const p: Vec2 = [pos.getX(i), pos.getZ(i)];
      const land = onLand(p);
      const d = distanceToShore(p);
      shoreAttr[i] = land ? d : -d;
      if (land) {
        const e = elevation(p);
        elevAttr[i] = e;
        parkAttr[i] = inAnyPark(p) ? 1 : 0;
        pos.setY(i, Math.min(0.03, 0.012 + d * 0.55) + e);
      } else {
        elevAttr[i] = 0;
        // Sea-side vertices sit just ABOVE the water plane, not below it. They are all discarded, so
        // their height is invisible — but the quads straddling the coast interpolate towards them,
        // and when they pointed down at the sea bed the surviving rim fragments were dragged under
        // the water plane and occluded. That is what was eating the coastline.
        pos.setY(i, 0);
      }
    }
    pos.needsUpdate = true;
    g.setAttribute("aShore", new THREE.BufferAttribute(shoreAttr, 1));
    g.setAttribute("aElev", new THREE.BufferAttribute(elevAttr, 1));
    g.setAttribute("aPark", new THREE.BufferAttribute(parkAttr, 1));
    g.computeVertexNormals();

    // The peninsula outline, traced as one hairline off the exact polygon. This is the single
    // biggest "that is SF" cue, so it is drawn crisply rather than left to the tessellation.
    const line: number[] = [];
    const lip = (p: Vec2): number => elevation(p) + 0.05;
    for (let i = 0; i < SHORELINE.length; i++) {
      const a = SHORELINE[i];
      const b = SHORELINE[(i + 1) % SHORELINE.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.round(len / 1.2));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const p0: Vec2 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const p1: Vec2 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        line.push(p0[0], lip(p0), p0[1], p1[0], lip(p1), p1[1]);
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(line, 3));

    // The cliff. Land sits ~30 m proud of the water plane, so the coast has a face you can see —
    // this is what stops the peninsula reading as a decal printed on the sea.
    const skirtPos: number[] = [];
    const skirtCol: number[] = [];
    const top = new THREE.Color(palette.navy800);
    const bottom = new THREE.Color(palette.void);
    for (let i = 0; i < SHORELINE.length; i++) {
      const a = SHORELINE[i];
      const b = SHORELINE[(i + 1) % SHORELINE.length];
      const ya = lip(a);
      const yb = lip(b);
      pushVert(skirtPos, skirtCol, a, ya, top);
      pushVert(skirtPos, skirtCol, b, yb, top);
      pushVert(skirtPos, skirtCol, b, SKIRT_BOTTOM, bottom);
      pushVert(skirtPos, skirtCol, a, ya, top);
      pushVert(skirtPos, skirtCol, b, SKIRT_BOTTOM, bottom);
      pushVert(skirtPos, skirtCol, a, SKIRT_BOTTOM, bottom);
    }
    const kg = new THREE.BufferGeometry();
    kg.setAttribute("position", new THREE.Float32BufferAttribute(skirtPos, 3));
    kg.setAttribute("color", new THREE.Float32BufferAttribute(skirtCol, 3));

    return { ground: g, shore: sg, skirt: kg };
  }, [low]);

  const groundMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          // Measured against the shot, not guessed. The ground itself stays near-black (luminance
          // ~22) so the parks read as dark gaps and the light all belongs to edges — push it much
          // past this and the unbuilt blocks glow brighter than the built ones, which is backwards.
          uLand: { value: new THREE.Color(palette.navy800).multiplyScalar(2.0) },
          uRidge: { value: new THREE.Color("#1b3050").multiplyScalar(1.25) },
          uRim: { value: new THREE.Color(palette.edge).multiplyScalar(1.7) },
          uFog: { value: new THREE.Color(FOG_COLOR) },
          uFogDensity: { value: FOG_DENSITY },
          uKey: { value: KEY.clone() },
        },
        vertexShader: terrainVertex,
        fragmentShader: terrainFragment,
        toneMapped: false,
      }),
    [],
  );
  const shoreMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: new THREE.Color(palette.edge).multiplyScalar(1.75), fog: true }),
    [],
  );
  const skirtMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide }),
    [],
  );

  useEffect(
    () => () => {
      ground.dispose();
      shore.dispose();
      skirt.dispose();
      groundMaterial.dispose();
      shoreMaterial.dispose();
      skirtMaterial.dispose();
    },
    [ground, shore, skirt, groundMaterial, shoreMaterial, skirtMaterial],
  );

  return (
    <group>
      <mesh geometry={skirt} material={skirtMaterial} frustumCulled={false} renderOrder={-1} />
      <mesh geometry={ground} material={groundMaterial} frustumCulled={false} />
      <lineSegments geometry={shore} material={shoreMaterial} frustumCulled={false} />
    </group>
  );
}
