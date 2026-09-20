import { DEMO_CITY } from "../mock/scenario.ts";

/** World units per metre: 1 km = 28 units. */
export const WORLD_SCALE = 0.028;

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG = 111_320 * Math.cos((DEMO_CITY.center.latitude * Math.PI) / 180);

/** Map lat/lng to the scene's XZ plane (x east, z south so north is -z). */
export function project(latitude: number, longitude: number): [number, number] {
  const x = (longitude - DEMO_CITY.center.longitude) * M_PER_DEG_LNG * WORLD_SCALE;
  const z = -(latitude - DEMO_CITY.center.latitude) * M_PER_DEG_LAT * WORLD_SCALE;
  return [x, z];
}

export const CITY_HALF = {
  x: DEMO_CITY.half_extent.longitude * M_PER_DEG_LNG * WORLD_SCALE,
  z: DEMO_CITY.half_extent.latitude * M_PER_DEG_LAT * WORLD_SCALE,
};

export const DOWNTOWN = project(DEMO_CITY.downtown.latitude, DEMO_CITY.downtown.longitude);

export function kmToUnits(km: number): number {
  return km * 1000 * WORLD_SCALE;
}
