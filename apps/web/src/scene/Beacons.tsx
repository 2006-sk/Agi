import { useShallow } from "zustand/react/shallow";
import { selectSessionList, useEchoStore } from "../store/useEchoStore.ts";
import { IncidentBeacon } from "./IncidentBeacon.tsx";

export function Beacons() {
  const sessions = useEchoStore(useShallow(selectSessionList));
  const focusId = useEchoStore((s) => s.focusId);
  const focus = useEchoStore((s) => s.focus);
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
