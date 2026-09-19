"use client";

// The landmass. Everything else in the city agrees with `surfaceY` so streets drape, buildings sit
// and units drive on the same ground. SF's hills are the reason the grid looks the way it does —
// the hills read from the way the street lines bend over them, not from shading.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { CITY, SHORELINE, distanceToShore, elevation, onLand, type Vec2 } from "@/lib/geo";
import { palette } from "@/lib/palette";
import { useAura } from "@/state/auraStore";

/**
 * Ground height every city layer agrees on. Water is the plane y = 0, so land lifts just clear of it
 * and the sea bed drops away: the coastline is exactly where the terrain crosses the water plane.
 */
export const surfaceY = (p: Vec2): number => {
  const d = distanceToShore(p);
  if (!onLand(p)) return -Math.min(0.36, 0.05 + d * 0.55);
  // Kept within 3 m of geo.ts `elevation()` so layers that place themselves straight off
  // elevation() — the incident/responder layer does — sit on this ground, not inside it.
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

export default function Terrain() {
  const low = useLowDetail();

  const { ground, shore } = useMemo(() => {
    const segments = low ? 104 : 152;
    const g = new THREE.PlaneGeometry(EXTENT, EXTENT, segments, segments);
    g.rotateX(-Math.PI / 2);

    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const count = pos.count;
    const colors = new Float32Array(count * 3);

    const bed = new THREE.Color(palette.abyss);
    const flat = new THREE.Color(palette.navy900);
    const ridge = new THREE.Color("#101e33");
    const tmp = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const p: Vec2 = [pos.getX(i), pos.getZ(i)];
      const y = surfaceY(p);
      pos.setY(i, y);
      if (y <= 0) {
        tmp.copy(bed);
      } else {
        // hilltops lighten a hair so the ridges read against the flatlands
        tmp.copy(flat).lerp(ridge, Math.min(1, elevation(p) / 2.2));
      }
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    pos.needsUpdate = true;
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();

    // The peninsula outline, traced as one hairline. This is the single biggest "that is SF" cue,
    // so it gets drawn crisply rather than being left to the tessellation to imply.
    const line: number[] = [];
    const lift = 0.03;
    for (let i = 0; i < SHORELINE.length; i++) {
      const a = SHORELINE[i];
      const b = SHORELINE[(i + 1) % SHORELINE.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.round(len / 2));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        line.push(
          a[0] + (b[0] - a[0]) * t0,
          lift,
          a[1] + (b[1] - a[1]) * t0,
          a[0] + (b[0] - a[0]) * t1,
          lift,
          a[1] + (b[1] - a[1]) * t1,
        );
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(line, 3));

    return { ground: g, shore: sg };
  }, [low]);

  const groundMaterial = useMemo(
    () => new THREE.MeshLambertMaterial({ vertexColors: true, fog: true }),
    [],
  );
  const shoreMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: new THREE.Color(palette.edge).multiplyScalar(0.85), fog: true }),
    [],
  );

  useEffect(
    () => () => {
      ground.dispose();
      shore.dispose();
      groundMaterial.dispose();
      shoreMaterial.dispose();
    },
    [ground, shore, groundMaterial, shoreMaterial],
  );

  return (
    <group>
      <mesh geometry={ground} material={groundMaterial} frustumCulled={false} />
      <lineSegments geometry={shore} material={shoreMaterial} frustumCulled={false} />
    </group>
  );
}
