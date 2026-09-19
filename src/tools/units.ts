import { z } from "zod";
import { type ResponderUnit, Service } from "../schemas/incident.js";
import { estimateEtaMinutes, estimateRoadKm, LatLng } from "./gis.js";

interface RosterUnit {
  unit_id: string;
  service: z.infer<typeof Service>;
  type: string;
  station: string;
  latitude: number;
  longitude: number;
  status: "available" | "en_route" | "busy";
}

/** Fixed simulated roster loosely based on SFFD / SFPD station locations. */
export const UNIT_ROSTER: RosterUnit[] = [
  { unit_id: "M-20", service: "EMS", type: "ALS ambulance", station: "Station 20 - Olympia Way", latitude: 37.7509, longitude: -122.4623, status: "available" },
  { unit_id: "M-24", service: "EMS", type: "ALS ambulance", station: "Station 24 - Hoffman Ave", latitude: 37.7513, longitude: -122.4405, status: "available" },
  { unit_id: "M-12", service: "EMS", type: "ALS ambulance", station: "Station 12 - Stanyan St", latitude: 37.7643, longitude: -122.4531, status: "busy" },
  { unit_id: "M-07", service: "EMS", type: "ALS ambulance", station: "Station 7 - Folsom St", latitude: 37.76, longitude: -122.4147, status: "available" },
  { unit_id: "M-01", service: "EMS", type: "ALS ambulance", station: "Station 1 - Folsom St", latitude: 37.7796, longitude: -122.4059, status: "available" },
  { unit_id: "E-24", service: "FIRE", type: "Engine", station: "Station 24 - Hoffman Ave", latitude: 37.7513, longitude: -122.4405, status: "available" },
  { unit_id: "E-12", service: "FIRE", type: "Engine", station: "Station 12 - Stanyan St", latitude: 37.7643, longitude: -122.4531, status: "available" },
  { unit_id: "T-07", service: "FIRE", type: "Truck", station: "Station 7 - Folsom St", latitude: 37.76, longitude: -122.4147, status: "available" },
  { unit_id: "3A21", service: "POLICE", type: "Patrol", station: "Park Station - Waller St", latitude: 37.7677, longitude: -122.4551, status: "available" },
  { unit_id: "3B12", service: "POLICE", type: "Patrol", station: "Ingleside Station", latitude: 37.7247, longitude: -122.446, status: "available" },
];

export const FindAvailableUnitsArgs = z.object({
  service: Service,
  location: LatLng,
  limit: z.number().int().min(1).max(10).default(3),
});
export type FindAvailableUnitsArgs = z.infer<typeof FindAvailableUnitsArgs>;

export interface FindAvailableUnitsResult {
  service: z.infer<typeof Service>;
  units: ResponderUnit[];
  considered: number;
}

export function findAvailableUnits(args: FindAvailableUnitsArgs): FindAvailableUnitsResult {
  const candidates = UNIT_ROSTER.filter((u) => u.service === args.service);
  const units: ResponderUnit[] = candidates
    .filter((u) => u.status === "available")
    .map((u) => {
      const distance_km = estimateRoadKm(u, args.location);
      return { ...u, distance_km, eta_minutes: estimateEtaMinutes(distance_km) };
    })
    .sort((a, b) => a.eta_minutes - b.eta_minutes || a.distance_km - b.distance_km || a.unit_id.localeCompare(b.unit_id))
    .slice(0, args.limit);
  return { service: args.service, units, considered: candidates.length };
}
