// San Francisco, stylised. Real lat/lon projected onto a local world plane so beacons, units and routes
// land where they actually are. World units: 1 unit = 100 m. +x = east, +z = south, y = up (metres/100).
//
// The city must read as SF at a glance. The things that do that work, in order:
//   1. the peninsula silhouette (water on three sides, Ocean Beach straight, the bay edge ragged)
//   2. Market Street cutting diagonally and the downtown grid rotating to meet it
//   3. Golden Gate Park and the Presidio as dark unbuilt rectangles
//   4. the skyline spike at the NE corner (Salesforce/Transamerica) against low hills everywhere else
//   5. Sutro Tower on the ridge above the incident

export const CITY = {
  originLat: 37.76,
  originLon: -122.445,
  metersPerUnit: 100,
  /** distance between street centrelines (200 m ≈ two SF blocks) */
  pitch: 2,
  street: 0.42,
  /** world extent; the peninsula sits inside [-half, +half] on x and z */
  half: 72,
} as const;

const LON_M = 88_200; // metres per degree longitude at SF latitude
const LAT_M = 110_540;

export type Vec2 = [x: number, z: number];

export const project = (lat: number, lon: number): Vec2 => [
  ((lon - CITY.originLon) * LON_M) / CITY.metersPerUnit,
  (-(lat - CITY.originLat) * LAT_M) / CITY.metersPerUnit,
];

export const unproject = ([x, z]: Vec2): { lat: number; lon: number } => ({
  lat: CITY.originLat - (z * CITY.metersPerUnit) / LAT_M,
  lon: CITY.originLon + (x * CITY.metersPerUnit) / LON_M,
});

// ---------------------------------------------------------------------------
// Landmass — simplified SF shoreline, clockwise from the Golden Gate.
// ---------------------------------------------------------------------------
const SHORE_LL: [number, number][] = [
  [37.8105, -122.4775], // Fort Point, under the Golden Gate
  [37.8085, -122.464], // Crissy Field
  [37.807, -122.445], // Fort Mason
  [37.809, -122.426], // Aquatic Park
  [37.8085, -122.405], // Pier 39
  [37.8005, -122.3935], // Ferry Building
  [37.7905, -122.386], // Bay Bridge anchorage
  [37.782, -122.387], // Rincon Hill
  [37.776, -122.389], // South Beach
  [37.7705, -122.383], // Mission Bay
  [37.76, -122.386], // Dogpatch
  [37.748, -122.379], // Islais Creek
  [37.735, -122.383], // Hunters Point
  [37.723, -122.39], // Candlestick
  [37.708, -122.4], // county line, south-east
  [37.708, -122.47],
  [37.708, -122.5045], // Fort Funston
  [37.735, -122.509], // Ocean Beach
  [37.76, -122.5105],
  [37.785, -122.5115], // Ocean Beach, north end
  [37.802, -122.51], // Lands End
  [37.809, -122.49], // Sea Cliff
];

export const SHORELINE: Vec2[] = SHORE_LL.map(([la, lo]) => project(la, lo));

/** Is this world point on land? (ray-casting point-in-polygon) */
export const onLand = ([x, z]: Vec2): boolean => {
  let inside = false;
  for (let i = 0, j = SHORELINE.length - 1; i < SHORELINE.length; j = i++) {
    const [xi, zi] = SHORELINE[i];
    const [xj, zj] = SHORELINE[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

/** Approximate distance to the shoreline in world units — used to fade the street grid at the water. */
export const distanceToShore = ([x, z]: Vec2): number => {
  let best = Infinity;
  for (let i = 0, j = SHORELINE.length - 1; i < SHORELINE.length; j = i++) {
    const [xi, zi] = SHORELINE[i];
    const [xj, zj] = SHORELINE[j];
    const dx = xj - xi;
    const dz = zj - zi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (xi + t * dx), z - (zi + t * dz)));
  }
  return best;
};

// ---------------------------------------------------------------------------
// Unbuilt ground — parks read as dark gaps in the grid and are a big part of the silhouette.
// ---------------------------------------------------------------------------
export type Region = { name: string; min: Vec2; max: Vec2 };

const rect = (name: string, latA: number, lonA: number, latB: number, lonB: number): Region => {
  const a = project(latA, lonA);
  const b = project(latB, lonB);
  return { name, min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
};

export const PARKS: Region[] = [
  rect("Golden Gate Park", 37.7745, -122.5105, 37.7645, -122.454),
  rect("Presidio", 37.81, -122.49, 37.788, -122.445),
  rect("Lake Merced", 37.728, -122.502, 37.709, -122.482),
  rect("McLaren Park", 37.722, -122.425, 37.712, -122.405),
  rect("Lincoln Park", 37.785, -122.51, 37.777, -122.494),
  rect("Mission Bay yards", 37.774, -122.398, 37.768, -122.388),
  rect("Dolores Park", 37.7615, -122.429, 37.7575, -122.425),
];

export const inRegion = ([x, z]: Vec2, r: Region): boolean =>
  x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1];

export const inAnyPark = (p: Vec2): boolean => PARKS.some((r) => inRegion(p, r));

/** Buildable = on land, not in a park. */
export const isBuildable = (p: Vec2): boolean => onLand(p) && !inAnyPark(p);

// ---------------------------------------------------------------------------
// Terrain — SF is hills. Height in world units (1 = 100 m).
// ---------------------------------------------------------------------------
type Hill = { name: string; at: Vec2; height: number; radius: number };

const hill = (name: string, lat: number, lon: number, metres: number, radiusM: number): Hill => ({
  name,
  at: project(lat, lon),
  height: metres / CITY.metersPerUnit,
  radius: radiusM / CITY.metersPerUnit,
});

export const HILLS: Hill[] = [
  hill("Twin Peaks", 37.7544, -122.4477, 281, 1000),
  hill("Mount Sutro", 37.7601, -122.458, 273, 800),
  hill("Mount Davidson", 37.7382, -122.4541, 282, 900),
  hill("Forest Hill", 37.747, -122.468, 120, 750),
  hill("Buena Vista", 37.7685, -122.4415, 175, 450),
  hill("Corona Heights", 37.7655, -122.4383, 156, 350),
  hill("Lone Mountain", 37.7785, -122.452, 134, 450),
  hill("Pacific Heights", 37.7925, -122.4382, 112, 950),
  hill("Nob Hill", 37.793, -122.4161, 103, 650),
  hill("Russian Hill", 37.8014, -122.418, 90, 550),
  hill("Telegraph Hill", 37.8024, -122.4058, 83, 380),
  hill("Bernal Heights", 37.7431, -122.416, 133, 650),
  hill("Potrero Hill", 37.758, -122.398, 91, 750),
  hill("Bayview Hill", 37.7218, -122.3885, 130, 500),
];

/** Ground elevation at a world point (smooth bumps, summed). Water is flat 0. */
export const elevation = ([x, z]: Vec2): number => {
  let h = 0;
  for (const s of HILLS) {
    const d = Math.hypot(x - s.at[0], z - s.at[1]) / s.radius;
    if (d < 1) {
      const f = 1 - d * d;
      h += s.height * f * f; // C1-smooth falloff
    }
  }
  return h;
};

// ---------------------------------------------------------------------------
// Street grids. SF has two: the cardinal grid over most of the city, and the downtown grid
// north-east of Market Street, rotated to meet it. Market is the visible seam between them.
// ---------------------------------------------------------------------------
const MARKET_LL: [number, number][] = [
  [37.7946, -122.3945], // Ferry Building
  [37.7845, -122.4065],
  [37.7752, -122.418], // Civic Center
  [37.7701, -122.4265],
  [37.7625, -122.435], // Castro
];
export const MARKET_ST: Vec2[] = MARKET_LL.map(([la, lo]) => project(la, lo));

/** Rotation of the downtown grid, derived from Market Street's bearing. */
export const DOWNTOWN_ROTATION = (() => {
  const a = MARKET_ST[0];
  const b = MARKET_ST[MARKET_ST.length - 1];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
})();

/** Pivot the downtown grid rotates around (Civic Center end of Market). */
const PIVOT: Vec2 = MARKET_ST[2];

/** Shortest distance from a point to a polyline, in world units. */
export const distanceToPath = ([x, z]: Vec2, path: Vec2[]): number => {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [xi, zi] = path[i - 1];
    const dx = path[i][0] - xi;
    const dz = path[i][1] - zi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - (xi + t * dx), z - (zi + t * dz)));
  }
  return best;
};

/**
 * True inside SoMa — the wedge south-east of Market whose streets run parallel and perpendicular to it.
 * This is the one grid rotation a San Franciscan actually reads: Market is the seam, and the blocks on
 * its south-east side are visibly turned (and much longer) against the cardinal grid everywhere else.
 * North of Market the Financial District is only rotated ~10°, so we leave it cardinal on purpose.
 *
 * Bounded three ways so the rotation cannot leak: the Market line's south-east side, within SoMa's real
 * depth before Division/Potrero (~1.6 km), and east of Church St so the Mission and Noe stay cardinal.
 */
export const isDowntown = (p: Vec2): boolean => {
  const a = MARKET_ST[0];
  const b = MARKET_ST[MARKET_ST.length - 1];
  const side = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (side >= 0) return false;
  if (p[0] < 10) return false; // west of Church St — the Mission grid is cardinal
  return distanceToPath(p, MARKET_ST) < 16;
};

const rot = ([x, z]: Vec2, angle: number, about: Vec2): Vec2 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = x - about[0];
  const dz = z - about[1];
  return [about[0] + dx * c - dz * s, about[1] + dx * s + dz * c];
};

/** World → local coordinates of whichever grid covers this point. */
export const toGrid = (p: Vec2): Vec2 => (isDowntown(p) ? rot(p, -DOWNTOWN_ROTATION, PIVOT) : p);
/** Local grid coordinates → world. */
export const fromGrid = (p: Vec2, downtown: boolean): Vec2 => (downtown ? rot(p, DOWNTOWN_ROTATION, PIVOT) : p);

const snap = (v: number): number => Math.round(v / CITY.pitch) * CITY.pitch;

/** Nearest street intersection, in the grid that covers `p`. */
export const snapToIntersection = (p: Vec2): Vec2 => {
  const downtown = isDowntown(p);
  const g = toGrid(p);
  return fromGrid([snap(g[0]), snap(g[1])], downtown);
};

/** Nearest point on a street centreline (keeps whichever axis is already closest to a street). */
export const snapToStreet = (p: Vec2): Vec2 => {
  const downtown = isDowntown(p);
  const g = toGrid(p);
  const snapped: Vec2 = Math.abs(g[0] - snap(g[0])) < Math.abs(g[1] - snap(g[1])) ? [snap(g[0]), g[1]] : [g[0], snap(g[1])];
  return fromGrid(snapped, downtown);
};

/**
 * Street route between two world points. Staggers across two turns so it reads as a driven route
 * rather than an L, and stays in the destination's grid so it never cuts across Market at a silly angle.
 */
export const streetRoute = (from: Vec2, to: Vec2): Vec2[] => {
  const downtown = isDowntown(to);
  const a = toGrid(snapToIntersection(from));
  const b = toGrid(to);
  const bs: Vec2 = [snap(b[0]), snap(b[1])];
  const midX = snap(a[0] + (bs[0] - a[0]) * 0.55);
  const local: Vec2[] = [a, [midX, a[1]], [midX, bs[1]], bs];
  const world = local.map((p) => fromGrid(p, downtown));
  return world.filter((p, i) => i === 0 || Math.hypot(p[0] - world[i - 1][0], p[1] - world[i - 1][1]) > 0.02);
};

export const routeLength = (pts: Vec2[]): number =>
  pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])), 0);

/** Point at normalised distance t (0..1) along a polyline, plus heading in radians. */
export const pointAlong = (pts: Vec2[], t: number): { pos: Vec2; heading: number } => {
  const total = routeLength(pts);
  if (pts.length < 2 || total === 0) return { pos: pts[0] ?? [0, 0], heading: 0 };
  let remaining = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (remaining <= seg || i === pts.length - 1) {
      const k = seg === 0 ? 0 : Math.min(1, remaining / seg);
      return {
        pos: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k],
        heading: Math.atan2(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
      };
    }
    remaining -= seg;
  }
  return { pos: pts[pts.length - 1], heading: 0 };
};

// ---------------------------------------------------------------------------
// Density & landmarks — the skyline is how you read SF from the air.
// ---------------------------------------------------------------------------
type Centre = { at: Vec2; peak: number; radius: number };

const centre = (lat: number, lon: number, peakM: number, radiusM: number): Centre => ({
  at: project(lat, lon),
  peak: peakM / CITY.metersPerUnit,
  radius: radiusM / CITY.metersPerUnit,
});

/** Where tall buildings cluster. Everything else is 3–5 storey fabric. */
const SKYLINE: Centre[] = [
  centre(37.7915, -122.399, 190, 900), // Financial District
  centre(37.7885, -122.396, 170, 700), // Transbay / Salesforce
  centre(37.7835, -122.404, 120, 800), // SoMa towers
  centre(37.7905, -122.406, 95, 600), // Montgomery / Chinatown edge
  centre(37.7765, -122.393, 80, 700), // Rincon / South Beach
  centre(37.7725, -122.41, 55, 700), // Mid-Market
  centre(37.7795, -122.418, 50, 600), // Civic Center
];

/** Typical building height (world units) for a block at `p`, before per-block variation. */
export const blockHeight = (p: Vec2): number => {
  let h = 0.1; // ~10 m baseline fabric
  for (const c of SKYLINE) {
    const d = Math.hypot(p[0] - c.at[0], p[1] - c.at[1]) / c.radius;
    if (d < 1) {
      const f = 1 - d * d;
      h = Math.max(h, 0.12 + c.peak * f * f);
    }
  }
  return h;
};

export type Landmark = {
  name: string;
  short: string;
  at: Vec2;
  /** structure height above ground, world units */
  height: number;
  kind: "tower" | "spire" | "bridge" | "civic";
};

const landmark = (name: string, short: string, lat: number, lon: number, metres: number, kind: Landmark["kind"]): Landmark => ({
  name,
  short,
  at: project(lat, lon),
  height: metres / CITY.metersPerUnit,
  kind,
});

export const LANDMARKS: Landmark[] = [
  landmark("Salesforce Tower", "SALESFORCE", 37.7897, -122.3972, 326, "tower"),
  landmark("Transamerica Pyramid", "TRANSAMERICA", 37.7952, -122.4028, 260, "spire"),
  landmark("Sutro Tower", "SUTRO", 37.7552, -122.4528, 298, "spire"),
  landmark("Coit Tower", "COIT", 37.8024, -122.4058, 64, "civic"),
  landmark("Ferry Building", "FERRY BLDG", 37.7955, -122.3937, 75, "civic"),
  landmark("City Hall", "CITY HALL", 37.7793, -122.4193, 94, "civic"),
];

/** Deck centreline of the two bridges — drawn as light, not as road. */
export const BRIDGES: { name: string; points: Vec2[] }[] = [
  {
    name: "Golden Gate",
    points: [project(37.8072, -122.4752), project(37.8199, -122.4783), project(37.8324, -122.4795)],
  },
  {
    name: "Bay Bridge",
    points: [project(37.7908, -122.3872), project(37.7983, -122.3778), project(37.8199, -122.3589)],
  },
];

/** Deterministic PRNG so the generated city is identical on every load (mulberry32). */
export const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
