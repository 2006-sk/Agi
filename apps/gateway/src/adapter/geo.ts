/**
 * San Francisco lat/lng -> the frontend's stylized city plane.
 *
 * The intelligence service works in real SF coordinates; the 3D deck works in a
 * 120x120 unit city. A true-scale projection would put most of the unit roster
 * several city-widths off screen, so this is a deliberately compressed linear
 * projection: aspect-correct (so routes still look like routes), anchored so the
 * demo address lands exactly where the mock script put it, and clamped to the
 * city edge so a far-away unit is visible at the rim instead of vanishing.
 */

import type { Vec2 } from "@echo/contracts";

/** `170 St Germain Ave` — the demo address, from the intelligence geocode table. */
export const ANCHOR_LAT = 37.754;
export const ANCHOR_LNG = -122.452;

/** Where the mock script placed the hero incident (`DEMO_INCIDENT` in cityLayout). */
export const ANCHOR_X = 12.5;
export const ANCHOR_Z = -27;

/**
 * Compression factor. 1100 units/degree puts the working SF area (roughly
 * 37.72..37.79, -122.47..-122.40) inside the plane, with the closest EMS station
 * a short hop from the incident.
 */
const UNITS_PER_DEG_LAT = 1100;
/** Aspect-corrected for latitude: 1100 * cos(37.75 deg). */
const UNITS_PER_DEG_LNG = UNITS_PER_DEG_LAT * Math.cos((ANCHOR_LAT * Math.PI) / 180);

/** Half-extent of the city, minus a small margin so pins stay on the plate. */
const LIMIT = 58;

function clamp(v: number, limit = LIMIT): number {
  return v < -limit ? -limit : v > limit ? limit : v;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Project a geographic point onto the city plane. North is -z. */
export function toVec2(latitude: number, longitude: number): Vec2 {
  const x = ANCHOR_X + (longitude - ANCHOR_LNG) * UNITS_PER_DEG_LNG;
  const z = ANCHOR_Z - (latitude - ANCHOR_LAT) * UNITS_PER_DEG_LAT;
  return { x: round(clamp(x)), z: round(clamp(z)) };
}

/** Project a `[lat, lng]` polyline from the intelligence route planner. */
export function polylineToPath(polyline: [number, number][] | undefined | null): Vec2[] {
  if (!Array.isArray(polyline)) return [];
  const out: Vec2[] = [];
  for (const point of polyline) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [lat, lng] = point;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    out.push(toVec2(lat, lng));
  }
  return out;
}

/** The deck shows metres and seconds; the planner speaks km and minutes. */
export function kmToMetres(km: number | undefined | null): number {
  return typeof km === "number" && Number.isFinite(km) ? Math.round(km * 1000) : 0;
}

export function minutesToSeconds(minutes: number | undefined | null): number {
  return typeof minutes === "number" && Number.isFinite(minutes) ? Math.round(minutes * 60) : 0;
}
