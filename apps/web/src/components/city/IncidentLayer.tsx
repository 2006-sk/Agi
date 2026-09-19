"use client";

// Everything that happens ON the city. Rendered inside the existing <Canvas> by AuraCity —
// this is a pure R3F subtree, driven entirely by the store.
//
// Discipline (DESIGN.md §2, §6): one glowing hero at a time. The active call is the only bright
// thing on the map; ambient calls are dim and slow and must never steal attention. A call with no
// coordinates yet gets no presence at all — we never invent a location.

import { useMemo } from "react";
import { useReducedMotion } from "motion/react";
import { project, streetRoute, type Vec2 } from "@/lib/geo";
import { useAura, type CallState } from "@/state/auraStore";
import { useActiveCall, useSortedCalls } from "@/state/selectors";
import IncidentBeacon from "./IncidentBeacon";
import ResponderRoute, { type RouteStatus } from "./ResponderRoute";
import ResponderUnits from "./ResponderUnits";

const JOIN_EPS = 0.06; // world units (6 m) — below this two points are the same place

export default function IncidentLayer() {
  const calls = useSortedCalls();
  const active = useActiveCall();
  const quality = useAura((s) => s.quality);
  const reduced = useReducedMotion();
  const quiet = quality === "low" || reduced === true;
  const activeId = active?.sessionId ?? null;

  return (
    <group name="incidents">
      {calls.map((call) => (
        <CallPresence
          key={call.sessionId}
          call={call}
          hero={!call.ambient && call.sessionId === activeId}
          quiet={quiet}
        />
      ))}
    </group>
  );
}

function CallPresence({ call, hero, quiet }: { call: CallState; hero: boolean; quiet: boolean }) {
  const lat = call.incident?.location.latitude ?? null;
  const lon = call.incident?.location.longitude ?? null;

  const at = useMemo<Vec2 | null>(() => (lat === null || lon === null ? null : project(lat, lon)), [lat, lon]);

  const dispatch = call.dispatch;

  // The route. The gateway may send an explicit polyline; the demo scenario sends an empty array
  // on purpose, in which case we derive a path that follows the real SF street grid ourselves.
  const routePoints = useMemo<Vec2[] | null>(() => {
    if (!at || !dispatch) return null;
    const selected = dispatch.units.find((u) => u.selected) ?? dispatch.units[0] ?? null;
    const given = dispatch.route?.points ?? [];

    let pts: Vec2[] = given.length >= 2 ? given.map(([la, lo]) => project(la, lo)) : [];

    if (pts.length < 2) {
      if (!selected) return null;
      const from = project(selected.latitude, selected.longitude);
      const street = streetRoute(from, at);
      pts = [];
      if (street.length === 0 || Math.hypot(street[0][0] - from[0], street[0][1] - from[1]) > JOIN_EPS) {
        pts.push(from); // start exactly where the unit is standing, so it never teleports on approval
      }
      pts.push(...street);
    }

    const tail = pts[pts.length - 1];
    if (tail && Math.hypot(tail[0] - at[0], tail[1] - at[1]) > JOIN_EPS) pts.push(at);

    return pts.length >= 2 ? pts : null;
  }, [at, dispatch]);

  if (!at) return null; // no coordinates yet — no beacon, no crash

  const status: RouteStatus =
    call.approval.status === "approved" ? "approved" : call.approval.status === "rejected" ? "rejected" : "proposed";

  return (
    <group>
      <IncidentBeacon call={call} at={at} hero={hero} quiet={quiet} />

      {routePoints ? <ResponderRoute points={routePoints} status={status} quiet={quiet} /> : null}

      {dispatch ? (
        <ResponderUnits call={call} units={dispatch.units} routePoints={routePoints} hero={hero} quiet={quiet} />
      ) : null}
    </group>
  );
}
