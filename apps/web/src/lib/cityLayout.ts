/**
 * Deterministic stylized city geometry.
 *
 * Generated, not fetched — the demo must never depend on live map data. Everything
 * here is computed from a fixed seed at module load, so the mock event script, the
 * 3D scene and the 2D fallback all agree on the same coordinates.
 *
 * Coordinate system: XZ plane, Y is up. The city spans -HALF..HALF on both axes.
 */

import type { Vec2 } from '@/types/events';

/* ------------------------------------------------------------------ */
/* Grid constants                                                      */
/* ------------------------------------------------------------------ */

/** Street pitch — distance between street centerlines. */
export const BLOCK = 20;
/** Number of blocks per axis. */
export const BLOCKS = 6;
/** Half-extent of the city in world units. */
export const HALF = (BLOCK * BLOCKS) / 2; // 60
/** Street corridor width (buildings are inset from centerlines by half of this). */
export const STREET_W = 6.5;

/** Street centerline positions, shared by both axes. */
export const STREET_LINES: number[] = Array.from(
  { length: BLOCKS + 1 },
  (_, i) => -HALF + i * BLOCK,
);

/* ------------------------------------------------------------------ */
/* Seeded PRNG — mulberry32. Deterministic, no Math.random anywhere.   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */

export type Building = {
  /** Center on the city plane. */
  x: number;
  z: number;
  /** Footprint. */
  w: number;
  d: number;
  /** Height in world units. */
  h: number;
  /** 0..1 — how brightly this building's windows breathe. */
  glow: number;
  /** Distance from city center, cached for falloff effects. */
  radius: number;
};

function buildCity(): Building[] {
  const rnd = mulberry32(0x41555241); // "AURA"
  const out: Building[] = [];
  const inset = STREET_W / 2;

  for (let bx = 0; bx < BLOCKS; bx++) {
    for (let bz = 0; bz < BLOCKS; bz++) {
      // Block interior bounds (between two street centerlines, inset by the road).
      const x0 = -HALF + bx * BLOCK + inset;
      const x1 = -HALF + (bx + 1) * BLOCK - inset;
      const z0 = -HALF + bz * BLOCK + inset;
      const z1 = -HALF + (bz + 1) * BLOCK - inset;

      // Subdivide each block into a 2x2 or 3x3 lot grid.
      const lots = rnd() > 0.55 ? 4 : 3;
      const lotW = (x1 - x0) / lots;
      const lotD = (z1 - z0) / lots;

      for (let lx = 0; lx < lots; lx++) {
        for (let lz = 0; lz < lots; lz++) {
          // Leave occasional gaps — plazas and parks keep the skyline from reading as a wall.
          if (rnd() < 0.10) continue;

          const cx = x0 + lotW * (lx + 0.5);
          const cz = z0 + lotD * (lz + 0.5);
          const radius = Math.hypot(cx, cz);

          // Downtown core is tall; the outskirts flatten out.
          const coreFalloff = Math.max(0, 1 - radius / (HALF * 1.15));
          const base = 2.5 + coreFalloff * coreFalloff * 26;
          const h = base * (0.55 + rnd() * 0.95);

          const pad = 0.55 + rnd() * 0.7;
          out.push({
            x: cx,
            z: cz,
            w: Math.max(1.6, lotW - pad),
            d: Math.max(1.6, lotD - pad),
            h: Math.max(1.8, h),
            glow: 0.25 + rnd() * 0.75,
            radius,
          });
        }
      }
    }
  }
  return out;
}

/** All buildings. Stable across reloads — same order, same values. */
export const BUILDINGS: Building[] = buildCity();

/* ------------------------------------------------------------------ */
/* Landmarks — named places the demo script refers to                  */
/* ------------------------------------------------------------------ */

export type Landmark = {
  id: string;
  label: string;
  kind: 'hospital' | 'fire_station' | 'police' | 'ems_post';
  x: number;
  z: number;
};

export const LANDMARKS: Landmark[] = [
  { id: 'mercy-general', label: 'Mercy General', kind: 'hospital', x: -40, z: 20 },
  { id: 'station-7', label: 'Fire Station 7', kind: 'fire_station', x: 40, z: 40 },
  { id: 'precinct-3', label: 'Precinct 3', kind: 'police', x: -20, z: -40 },
  { id: 'ems-post-4', label: 'EMS Post 4', kind: 'ems_post', x: 20, z: 0 },
];

/** The scripted demo incident: 1420 Alder St, Apt 3B. */
export const DEMO_INCIDENT: Vec2 = { x: 12.5, z: -27 };

/* ------------------------------------------------------------------ */
/* Street routing                                                      */
/* ------------------------------------------------------------------ */

function nearestLine(v: number): number {
  let best = STREET_LINES[0];
  let bestD = Math.abs(v - best);
  for (const line of STREET_LINES) {
    const d = Math.abs(v - line);
    if (d < bestD) {
      bestD = d;
      best = line;
    }
  }
  return best;
}

/** Snap an arbitrary point onto the nearest street centerline intersection-ish point. */
export function snapToStreet(p: Vec2): Vec2 {
  const lx = nearestLine(p.x);
  const lz = nearestLine(p.z);
  // Snap along whichever axis is closer to a street, keeping the other coordinate.
  return Math.abs(p.x - lx) <= Math.abs(p.z - lz)
    ? { x: lx, z: p.z }
    : { x: p.x, z: lz };
}

function pushIfNew(path: Vec2[], p: Vec2) {
  const last = path[path.length - 1];
  if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.z - p.z) > 1e-6) {
    path.push(p);
  }
}

/**
 * Manhattan route between two points, riding street centerlines.
 * Produces an L/Z-shaped polyline that visibly follows the grid.
 */
export function streetRoute(from: Vec2, to: Vec2): Vec2[] {
  const path: Vec2[] = [];
  pushIfNew(path, from);

  const fromLineZ = nearestLine(from.z);
  const toLineX = nearestLine(to.x);

  // Leave the origin along its block, join the nearest E/W street.
  pushIfNew(path, { x: from.x, z: fromLineZ });
  // Ride that street across to the destination's N/S street.
  pushIfNew(path, { x: toLineX, z: fromLineZ });

  // Step toward the destination's street row, one block at a time so the line
  // reads as "following streets" rather than cutting across.
  const toLineZ = nearestLine(to.z);
  if (Math.abs(toLineZ - fromLineZ) > 1e-6) {
    const dir = Math.sign(toLineZ - fromLineZ);
    for (let z = fromLineZ + dir * BLOCK; ; z += dir * BLOCK) {
      pushIfNew(path, { x: toLineX, z });
      if (Math.abs(z - toLineZ) < 1e-6) break;
      if (Math.abs(z) > HALF + BLOCK) break; // safety
    }
  }

  // Final approach off the street into the destination.
  pushIfNew(path, { x: toLineX, z: to.z });
  pushIfNew(path, to);
  return path;
}

/** Total polyline length in world units. */
export function pathLength(path: Vec2[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
  }
  return total;
}

/** Point at normalized distance t (0..1) along a polyline. */
export function pointAt(path: Vec2[], t: number): Vec2 {
  if (path.length === 0) return { x: 0, z: 0 };
  if (path.length === 1) return path[0];
  const total = pathLength(path);
  if (total === 0) return path[0];
  const target = Math.max(0, Math.min(1, t)) * total;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    if (walked + seg >= target) {
      const local = seg === 0 ? 0 : (target - walked) / seg;
      return {
        x: path[i - 1].x + (path[i].x - path[i - 1].x) * local,
        z: path[i - 1].z + (path[i].z - path[i - 1].z) * local,
      };
    }
    walked += seg;
  }
  return path[path.length - 1];
}

/** World units → metres, for human-readable distances. */
export const METRES_PER_UNIT = 18;
