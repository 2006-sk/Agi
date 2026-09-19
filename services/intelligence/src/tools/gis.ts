import { z } from "zod";

/**
 * Simulated GIS tools. Everything is deterministic sample data centred on San Francisco;
 * no real geocoder or routing engine is called.
 */

export const SF_CENTER = { latitude: 37.7749, longitude: -122.4194 };

const SUFFIXES: Record<string, string> = {
  street: "St",
  st: "St",
  avenue: "Ave",
  ave: "Ave",
  boulevard: "Blvd",
  blvd: "Blvd",
  road: "Rd",
  rd: "Rd",
  drive: "Dr",
  dr: "Dr",
  lane: "Ln",
  ln: "Ln",
  way: "Way",
  court: "Ct",
  ct: "Ct",
  place: "Pl",
  pl: "Pl",
  terrace: "Ter",
  ter: "Ter",
  highway: "Hwy",
  hwy: "Hwy",
  parkway: "Pkwy",
  pkwy: "Pkwy",
  circle: "Cir",
  cir: "Cir",
};

interface KnownAddress {
  key: string;
  normalized: string;
  latitude: number;
  longitude: number;
}

/** Sample table around the demo address (master_plan.md: 170 St Germain Ave, 37.754 / -122.452). */
const KNOWN_ADDRESSES: KnownAddress[] = [
  { key: "170 st germain ave", normalized: "170 St Germain Ave, San Francisco, CA 94114", latitude: 37.754, longitude: -122.452 },
  { key: "150 st germain ave", normalized: "150 St Germain Ave, San Francisco, CA 94114", latitude: 37.7538, longitude: -122.4512 },
  { key: "100 hoffman ave", normalized: "100 Hoffman Ave, San Francisco, CA 94114", latitude: 37.7513, longitude: -122.4405 },
  { key: "1145 stanyan st", normalized: "1145 Stanyan St, San Francisco, CA 94117", latitude: 37.7643, longitude: -122.4531 },
  { key: "285 olympia way", normalized: "285 Olympia Way, San Francisco, CA 94131", latitude: 37.7509, longitude: -122.4623 },
  { key: "1001 potrero ave", normalized: "1001 Potrero Ave, San Francisco, CA 94110", latitude: 37.7561, longitude: -122.4048 },
  { key: "2425 geary blvd", normalized: "2425 Geary Blvd, San Francisco, CA 94115", latitude: 37.7826, longitude: -122.4437 },
  { key: "3555 cesar chavez st", normalized: "3555 Cesar Chavez St, San Francisco, CA 94110", latitude: 37.7483, longitude: -122.4183 },
  { key: "1800 market st", normalized: "1800 Market St, San Francisco, CA 94102", latitude: 37.7719, longitude: -122.4247 },
  { key: "555 market st", normalized: "555 Market St, San Francisco, CA 94105", latitude: 37.7898, longitude: -122.3998 },
  { key: "100 larkin st", normalized: "100 Larkin St, San Francisco, CA 94102", latitude: 37.7793, longitude: -122.4159 },
  { key: "935 folsom st", normalized: "935 Folsom St, San Francisco, CA 94107", latitude: 37.7796, longitude: -122.4059 },
];

export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function titleCase(word: string): string {
  if (!word) return word;
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

export const NormalizeAddressArgs = z.object({
  raw_address: z.string().min(1),
});
export type NormalizeAddressArgs = z.infer<typeof NormalizeAddressArgs>;

export interface NormalizedAddress {
  normalized: string;
  key: string;
  components: {
    number: string | null;
    street: string | null;
    unit: string | null;
    city: string;
    state: string;
  };
  confidence: number;
}

export function normalizeAddress(args: NormalizeAddressArgs): NormalizedAddress {
  let text = args.raw_address.replace(/\s+/g, " ").trim().replace(/[.,;]+$/, "");
  // Strip leading conversational filler ("we're at", "it's").
  text = text.replace(/^(?:we'?re|we are|i'?m|i am|it'?s|it is|at|the address is|address is)\s+(?:at\s+)?/i, "");

  // Drop a trailing city/state/zip so re-normalizing an already-normalized address is stable.
  text = text.replace(/,?\s*(?:san francisco|sf)?(?:,\s*ca)?(?:\s*\d{5})?\s*$/i, "").trim().replace(/[.,]+$/, "");

  let unit: string | null = null;
  const unitMatch = text.match(/(?:,?\s*(?:apt\.?|apartment|unit|suite|#)\s*)([\w-]+)\s*$/i);
  if (unitMatch?.[1]) {
    unit = unitMatch[1].toUpperCase();
    text = text.slice(0, unitMatch.index).trim().replace(/[.,]+$/, "");
  }

  const tokens = text
    .replace(/\./g, "")
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      const lower = token.toLowerCase();
      return SUFFIXES[lower] ?? titleCase(token);
    });

  const number = tokens[0] && /^\d+[a-z]?$/i.test(tokens[0]) ? tokens[0] : null;
  const streetTokens = number ? tokens.slice(1) : tokens;
  const street = streetTokens.length ? streetTokens.join(" ") : null;
  const key = [number, street].filter(Boolean).join(" ").toLowerCase();

  const known = KNOWN_ADDRESSES.find((entry) => entry.key === key);
  const hasSuffix = streetTokens.some((t) => Object.values(SUFFIXES).includes(t));

  let normalized: string;
  let confidence: number;
  if (known) {
    normalized = known.normalized;
    confidence = 0.96;
  } else {
    const line = [number, street].filter(Boolean).join(" ");
    normalized = line ? `${line}, San Francisco, CA` : args.raw_address.trim();
    confidence = number && hasSuffix ? 0.82 : number ? 0.6 : 0.35;
  }
  if (unit) normalized = normalized.replace(/(, San Francisco)/, ` Apt ${unit}$1`);

  return {
    normalized,
    key,
    components: { number, street, unit, city: "San Francisco", state: "CA" },
    confidence,
  };
}

export const GeocodeAddressArgs = z.object({
  normalized_address: z.string().min(1),
});
export type GeocodeAddressArgs = z.infer<typeof GeocodeAddressArgs>;

export interface GeocodeResult {
  latitude: number | null;
  longitude: number | null;
  confidence: number;
  verified: boolean;
  source: "sample_table" | "deterministic_estimate" | "unresolved";
}

export function geocodeAddress(args: GeocodeAddressArgs): GeocodeResult {
  const normalized = normalizeAddress({ raw_address: args.normalized_address });
  const known = KNOWN_ADDRESSES.find((entry) => entry.key === normalized.key);
  if (known) {
    return { latitude: known.latitude, longitude: known.longitude, confidence: 0.96, verified: true, source: "sample_table" };
  }
  if (normalized.components.number && normalized.components.street) {
    // Deterministic pseudo-geocode: the same address always lands on the same point in SF.
    const hash = fnv1a(normalized.key);
    const latOffset = ((hash & 0xffff) / 0xffff - 0.5) * 0.06;
    const lngOffset = (((hash >>> 16) & 0xffff) / 0xffff - 0.5) * 0.08;
    return {
      latitude: Number((SF_CENTER.latitude + latOffset).toFixed(5)),
      longitude: Number((SF_CENTER.longitude + lngOffset).toFixed(5)),
      confidence: 0.72,
      verified: true,
      source: "deterministic_estimate",
    };
  }
  return { latitude: null, longitude: null, confidence: 0.2, verified: false, source: "unresolved" };
}

export const LatLng = z.object({
  latitude: z.number(),
  longitude: z.number(),
});
export type LatLng = z.infer<typeof LatLng>;

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Road distance approximated as 1.3x straight line; ~36 km/h with lights plus 1.5 min turnout. */
export function estimateRoadKm(a: LatLng, b: LatLng): number {
  return Number((haversineKm(a, b) * 1.3).toFixed(2));
}

export function estimateEtaMinutes(roadKm: number): number {
  return Math.max(2, Math.round(roadKm / 0.6 + 1.5));
}

export const CalculateRouteArgs = z.object({
  unit: z.object({ unit_id: z.string().min(1), latitude: z.number(), longitude: z.number() }),
  incident_location: LatLng,
});
export type CalculateRouteArgs = z.infer<typeof CalculateRouteArgs>;

export interface RouteResult {
  unit_id: string;
  distance_km: number;
  eta_minutes: number;
  polyline: [number, number][];
}

/** A street-like polyline: alternating latitude / longitude legs from the unit to the incident. */
export function calculateRoute(args: CalculateRouteArgs): RouteResult {
  const u = args.unit;
  const i = args.incident_location;
  const dLat = i.latitude - u.latitude;
  const dLng = i.longitude - u.longitude;
  const round = (n: number) => Number(n.toFixed(5));
  const polyline: [number, number][] = [
    [round(u.latitude), round(u.longitude)],
    [round(u.latitude + dLat * 0.35), round(u.longitude)],
    [round(u.latitude + dLat * 0.35), round(u.longitude + dLng * 0.6)],
    [round(i.latitude), round(u.longitude + dLng * 0.6)],
    [round(i.latitude), round(i.longitude)],
  ];
  const distance = estimateRoadKm(u, i);
  return { unit_id: u.unit_id, distance_km: distance, eta_minutes: estimateEtaMinutes(distance), polyline };
}
