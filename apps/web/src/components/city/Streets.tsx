"use client";

// The street lattice. Two grids — the cardinal one over most of the city and the rotated
// downtown/SoMa one — meeting along Market Street, which is drawn brighter and wider because it is
// the visible seam. The grid is clipped to the shoreline and to the parks, so the peninsula and the
// dark rectangles of Golden Gate Park and the Presidio are drawn by what is *missing*.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  CITY,
  MARKET_ST,
  PARKS,
  blockHeight,
  distanceToShore,
  fromGrid,
  inAnyPark,
  isDowntown,
  onLand,
  toGrid,
  type Vec2,
} from "@/lib/geo";
import { GROUND_LIFT, surfaceY, useLowDetail } from "./Terrain";

const P = CITY.pitch;
/** Half-extent of the grid walk — comfortably past every shoreline point. */
const LIM = 62;

const BASE = new THREE.Color("#22385c");
const PARK_EDGE = new THREE.Color("#15243c");
const MARKET_COLOR = new THREE.Color("#5c82ba");

type Acc = { pos: number[]; col: number[] };
type Node = { x: number; y: number; z: number; r: number; g: number; b: number; ok: boolean };

const DEAD: Node = { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, ok: false };

/** Streets dim towards the water and brighten where the blocks get tall. Colour stays navy. */
const tint = (p: Vec2, out: THREE.Color): void => {
  const fade = Math.min(1, 0.2 + distanceToShore(p) * 0.9);
  const dens = Math.min(1, blockHeight(p) / 1.3);
  out.copy(BASE).multiplyScalar(fade * (0.55 + dens * 0.95));
};

const node = (p: Vec2, ok: boolean, tmp: THREE.Color): Node => {
  if (!ok) return DEAD;
  tint(p, tmp);
  return { x: p[0], y: surfaceY(p) + GROUND_LIFT, z: p[1], r: tmp.r, g: tmp.g, b: tmp.b, ok: true };
};

const flat = (p: Vec2, ok: boolean, c: THREE.Color): Node =>
  ok ? { x: p[0], y: surfaceY(p) + GROUND_LIFT, z: p[1], r: c.r, g: c.g, b: c.b, ok: true } : DEAD;

const link = (acc: Acc, a: Node, b: Node): void => {
  if (!a.ok || !b.ok) return;
  acc.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  acc.col.push(a.r, a.g, a.b, b.r, b.g, b.b);
};

const buildGrid = (step: number): THREE.BufferGeometry => {
  const acc: Acc = { pos: [], col: [] };
  const tmp = new THREE.Color();

  // --- cardinal grid: everything that is not downtown ---
  for (let k = -LIM; k <= LIM; k += P) {
    let prev: Node | null = null;
    for (let z = -LIM; z <= LIM; z += step) {
      const p: Vec2 = [k, z];
      const n = node(p, onLand(p) && !inAnyPark(p) && !isDowntown(p), tmp);
      if (prev) link(acc, prev, n);
      prev = n;
    }
    prev = null;
    for (let x = -LIM; x <= LIM; x += step) {
      const p: Vec2 = [x, k];
      const n = node(p, onLand(p) && !inAnyPark(p) && !isDowntown(p), tmp);
      if (prev) link(acc, prev, n);
      prev = n;
    }
  }

  // --- downtown grid: same pitch, rotated to meet Market. Walked in grid-local space so it lands
  // on exactly the intersections snapToIntersection() will hand the responder layer. ---
  const local0 = toGrid([35, -20]); // a point that is unambiguously inside the rotated grid
  const ox = Math.round(local0[0] / P) * P;
  const oz = Math.round(local0[1] / P) * P;
  const R = 50;
  const downtownOk = (w: Vec2): boolean => isDowntown(w) && onLand(w) && !inAnyPark(w);

  for (let k = -R; k <= R; k += P) {
    let prev: Node | null = null;
    for (let t = -R; t <= R; t += step) {
      const w = fromGrid([ox + k, oz + t], true);
      const n = node(w, downtownOk(w), tmp);
      if (prev) link(acc, prev, n);
      prev = n;
    }
    prev = null;
    for (let t = -R; t <= R; t += step) {
      const w = fromGrid([ox + t, oz + k], true);
      const n = node(w, downtownOk(w), tmp);
      if (prev) link(acc, prev, n);
      prev = n;
    }
  }

  // --- park boundaries: one dim hairline so the unbuilt rectangles read as intentional ---
  for (const park of PARKS) {
    const corners: Vec2[] = [
      [park.min[0], park.min[1]],
      [park.max[0], park.min[1]],
      [park.max[0], park.max[1]],
      [park.min[0], park.max[1]],
    ];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.round(len / 2));
      let prev: Node | null = null;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const n = flat(p, onLand(p), PARK_EDGE);
        if (prev) link(acc, prev, n);
        prev = n;
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(acc.col, 3));
  return g;
};

/** Market Street: three parallel traces so it reads wider than a block street on any GPU. */
const buildMarket = (step: number): THREE.BufferGeometry => {
  const pos: number[] = [];
  const offsets = [-0.15, 0, 0.15];

  for (let i = 0; i < MARKET_ST.length - 1; i++) {
    const a = MARKET_ST[i];
    const b = MARKET_ST[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const steps = Math.max(1, Math.round(len / step));

    for (const o of offsets) {
      let prev: Vec2 | null = null;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p: Vec2 = [a[0] + dx * t + nx * o, a[1] + dz * t + nz * o];
        if (prev) {
          pos.push(
            prev[0],
            surfaceY(prev) + GROUND_LIFT * 1.6,
            prev[1],
            p[0],
            surfaceY(p) + GROUND_LIFT * 1.6,
            p[1],
          );
        }
        prev = p;
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
};

export default function Streets() {
  const low = useLowDetail();

  const { grid, market } = useMemo(() => {
    const step = low ? 1.5 : 1;
    return { grid: buildGrid(step), market: buildMarket(step) };
  }, [low]);

  const gridMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, fog: true }),
    [],
  );
  const marketMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: MARKET_COLOR, fog: true }),
    [],
  );

  useEffect(
    () => () => {
      grid.dispose();
      market.dispose();
      gridMaterial.dispose();
      marketMaterial.dispose();
    },
    [grid, market, gridMaterial, marketMaterial],
  );

  return (
    <group>
      <lineSegments geometry={grid} material={gridMaterial} frustumCulled={false} />
      <lineSegments geometry={market} material={marketMaterial} frustumCulled={false} />
    </group>
  );
}
