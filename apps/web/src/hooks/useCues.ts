import { useEffect, useRef } from "react";
import { useAuraStore, type Cue } from "../store/useAuraStore.ts";

/** Consume side-effect cues (camera, audio, sfx) exactly once each, outside React renders. */
export function useCues(handler: (cue: Cue) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const lastId = useRef(useAuraStore.getState().cueSeq);

  useEffect(
    () =>
      useAuraStore.subscribe((state, prev) => {
        if (state.cueSeq === prev.cueSeq) return;
        for (const cue of state.cues) {
          if (cue.id > lastId.current) {
            lastId.current = cue.id;
            try {
              handlerRef.current(cue);
            } catch (error) {
              console.warn("[aura] cue handler failed", error);
            }
          }
        }
      }),
    [],
  );
}
