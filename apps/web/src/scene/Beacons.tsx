import { useShallow } from "zustand/react/shallow";
import { selectSessionList, useAuraStore } from "../store/useAuraStore.ts";
import { IncidentBeacon } from "./IncidentBeacon.tsx";

export function Beacons() {
  const sessions = useAuraStore(useShallow(selectSessionList));
  const focusId = useAuraStore((s) => s.focusId);
  const focus = useAuraStore((s) => s.focus);
  return (
    <>
      {sessions
        .filter((s) => s.state?.location.verified && s.state.location.latitude !== null && s.state.location.longitude !== null)
        .map((s) => (
          <IncidentBeacon key={s.id} session={s} focused={s.id === focusId} onSelect={focus} />
        ))}
    </>
  );
}
