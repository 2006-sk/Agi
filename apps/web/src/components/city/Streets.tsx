"use client";

// The street lattice. Two grids — the cardinal one over most of the city and the rotated
// downtown/SoMa one — meeting along Market Street, which is drawn wider and brighter because it is
// the visible seam between them.
//
// The grid is the peninsula's outline. Every line is bisected against `onLand` where it leaves the
// coast, so the lattice *stops exactly at the water* instead of fading out near it or running over
// it — that termination is what draws Ocean Beach straight and the bay side ragged. Parks are
// clipped the same way, which leaves Golden Gate Park and the Presidio as clean dark holes.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  CITY,
  MARKET_ST,
  PARKS,
  blockHeight,
  fromGrid,
  inAnyPark,
  isDowntown,
  onLand,
  toGrid,
  type Vec2,
} from "@/lib/geo";
import { palette } from "@/lib/palette";
import { GROUND_LIFT, surfaceY, useLowDetail } from "./Terrain";

const P = CITY.pitch;
/** Half-extent of the grid walk — comfortably past every shoreline point. */
const LIM = 62;

const BASE = new THREE.Color(palette.edge);
const PARK_EDGE = new THREE.Color(palette.edge).multiplyScalar(0.34);
const MARKET_DECK = new THREE.Color(palette.edge).multiplyScalar(0.85);
const MARKET_KERB = new THREE.Color(palette.edge).multiplyScalar(2.1);

type Acc = { pos: number[]; col: number[] };
type Node = { x: number; y: number; z: number; r: number; g: number; b: number };
type Ok = (p: Vec2) => boolean;

/**
 * Streets brighten where the blocks get tall and stay a whisper out in the avenues. They do NOT
 * fade towards the water: the shoreline is drawn by where the grid ends, so dimming it there would
 * erase the one silhouette the whole city is read from.
 */
const tint = (p: Vec2, out: THREE.Color): void => {
  const dens = Math.min(1, Math.max(0, (blockHeight(p) - 0.1) / 1.45));
  out.copy(BASE).multiplyScalar(0.36 + Math.pow(dens, 0.8) * 0.82);
};

const node = (p: Vec2, tmp: THREE.Color, dim: number): Node => {
  tint(p, tmp);
  return { x: p[0], y: surfaceY(p) + GROUND_LIFT, z: p[1], r: tmp.r * dim, g: tmp.g * dim, b: tmp.b * dim };
};

const flat = (p: Vec2, c: THREE.Color): Node => ({
  x: p[0],
  y: surfaceY(p) + GROUND_LIFT,
  z: p[1],
  r: c.r,
  g: c.g,
  b: c.b,
});

const link = (acc: Acc, a: Node, b: Node): void => {
  acc.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  acc.col.push(a.r, a.g, a.b, b.r, b.g, b.b);
};

/** Bisect between a point that passes `ok` and one that does not — this is the coastline. */
const boundary = (inside: Vec2, outside: Vec2, ok: Ok): Vec2 => {
  let lo: Vec2 = [inside[0], inside[1]];
  let hi: Vec2 = [outside[0], outside[1]];
  for (let i = 0; i < 10; i++) {
    const mid: Vec2 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
};

/** Walk one street from `a` to `b`, emitting only the stretches that are actually built on. */
const run = (acc: Acc, a: Vec2, b: Vec2, steps: number, ok: Ok, tmp: THREE.Color, dim: number): void => {
  let prevP: Vec2 = a;
  let prevNode: Node | null = ok(a) ? node(a, tmp, dim) : null;

  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const p: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const n = ok(p) ? node(p, tmp, dim) : null;

    if (prevNode && n) link(acc, prevNode, n);
    else if (prevNode) link(acc, prevNode, node(boundary(prevP, p, ok), tmp, dim));
    else if (n) link(acc, node(boundary(p, prevP, ok), tmp, dim), n);

    prevP = p;
    prevNode = n;
  }
};

const buildGrid = (step: number): THREE.BufferGeometry => {
  const acc: Acc = { pos: [], col: [] };
  const tmp = new THREE.Color();
  const steps = Math.max(2, Math.round((LIM * 2) / step));

  // --- cardinal grid: everything that is not downtown ---
  const cardinal: Ok = (p) => onLand(p) && !inAnyPark(p) && !isDowntown(p);
  for (let k = -LIM; k <= LIM; k += P) {
    run(acc, [k, -LIM], [k, LIM], steps, cardinal, tmp, 1);
    run(acc, [-LIM, k], [LIM, k], steps, cardinal, tmp, 1);
  }

  // --- downtown grid: same pitch, rotated to meet Market, walked in grid-local space so it lands
  // on exactly the intersections snapToIntersection() will hand the responder layer ---
  const local0 = toGrid([35, -20]); // a point that is unambiguously inside the rotated grid
  const ox = Math.round(local0[0] / P) * P;
  const oz = Math.round(local0[1] / P) * P;
  const R = 50;
  const rsteps = Math.max(2, Math.round((R * 2) / step));
  const downtown: Ok = (w) => isDowntown(w) && onLand(w) && !inAnyPark(w);

  for (let k = -R; k <= R; k += P) {
    // Streets perpendicular to Market — the numbered streets. SoMa's blocks are famously long in
    // this direction, so only every second one carries full weight and the one between it is a
    // ghost. The geometry still exists at every pitch, because streetRoute() snaps to all of them.
    const long = Math.round(k / P) % 2 === 0 ? 1 : 0.28;
    run(acc, fromGrid([ox + k, oz - R], true), fromGrid([ox + k, oz + R], true), rsteps, downtown, tmp, long);
    // Streets parallel to Market — Mission, Howard, Folsom. Normal spacing, full weight.
    run(acc, fromGrid([ox - R, oz + k], true), fromGrid([ox + R, oz + k], true), rsteps, downtown, tmp, 1);
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
      const n = Math.max(1, Math.round(len / 1.5));
      let prevP: Vec2 = a;
      let prevNode: Node | null = onLand(a) ? flat(a, PARK_EDGE) : null;
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        const p: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const ok = onLand(p);
        const cur = ok ? flat(p, PARK_EDGE) : null;
        if (prevNode && cur) link(acc, prevNode, cur);
        else if (prevNode) link(acc, prevNode, flat(boundary(prevP, p, onLand), PARK_EDGE));
        else if (cur) link(acc, flat(boundary(p, prevP, onLand), PARK_EDGE), cur);
        prevP = p;
        prevNode = cur;
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(acc.pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(acc.col, 3));
  return g;
};

/**
 * Market Street as an actual deck rather than a bundle of hairlines.
 *
 * It is the seam the SoMa grid turns against, so it has to read as a boulevard from every angle —
 * including the ones where it runs straight away from the camera and parallel hairlines would
 * collapse into a dashed smear. A 38 m ribbon with two lit kerbs holds up at any bearing.
 */
const buildMarket = (low: boolean): { deck: THREE.BufferGeometry; kerb: THREE.BufferGeometry } => {
  const curve = new THREE.CatmullRomCurve3(MARKET_ST.map((p) => new THREE.Vector3(p[0], 0, p[1])));
  const N = low ? 70 : 150;
  const half = 0.26;
  const lift = GROUND_LIFT * 2.2;

  const deckPos: number[] = [];
  const kerbPos: number[] = [];

  type Rail = { l: [number, number, number]; r: [number, number, number] };
  let prev: Rail | null = null;

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const c = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const len = Math.hypot(tan.x, tan.z) || 1;
    const nx = -tan.z / len;
    const nz = tan.x / len;

    const lp: Vec2 = [c.x + nx * half, c.z + nz * half];
    const rp: Vec2 = [c.x - nx * half, c.z - nz * half];
    const cur: Rail = {
      l: [lp[0], surfaceY(lp) + lift, lp[1]],
      r: [rp[0], surfaceY(rp) + lift, rp[1]],
    };

    if (prev) {
      deckPos.push(...prev.l, ...prev.r, ...cur.r, ...prev.l, ...cur.r, ...cur.l);
      kerbPos.push(...prev.l, ...cur.l, ...prev.r, ...cur.r);
    }
    prev = cur;
  }

  const deck = new THREE.BufferGeometry();
  deck.setAttribute("position", new THREE.Float32BufferAttribute(deckPos, 3));
  const kerb = new THREE.BufferGeometry();
  kerb.setAttribute("position", new THREE.Float32BufferAttribute(kerbPos, 3));
  return { deck, kerb };
};

export default function Streets() {
  const low = useLowDetail();

  const built = useMemo(() => {
    const { deck, kerb } = buildMarket(low);
    return {
      grid: buildGrid(low ? 1.6 : 1),
      deck,
      kerb,
      gridMaterial: new THREE.LineBasicMaterial({ vertexColors: true, fog: true }),
      deckMaterial: new THREE.MeshBasicMaterial({
        color: MARKET_DECK,
        fog: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      kerbMaterial: new THREE.LineBasicMaterial({ color: MARKET_KERB, fog: true }),
    };
  }, [low]);

  useEffect(
    () => () => {
      built.grid.dispose();
      built.deck.dispose();
      built.kerb.dispose();
      built.gridMaterial.dispose();
      built.deckMaterial.dispose();
      built.kerbMaterial.dispose();
    },
    [built],
  );

  return (
    <group>
      <lineSegments geometry={built.grid} material={built.gridMaterial} frustumCulled={false} />
      <mesh geometry={built.deck} material={built.deckMaterial} frustumCulled={false} />
      <lineSegments geometry={built.kerb} material={built.kerbMaterial} frustumCulled={false} />
    </group>
  );
}
