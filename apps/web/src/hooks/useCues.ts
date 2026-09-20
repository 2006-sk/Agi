import { useEffect, useRef } from "react";
import { useEchoStore, type Cue } from "../store/useEchoStore.ts";

/** Consume side-effect cues (camera, audio, sfx) exactly once each, outside React renders. */
export function useCues(handler: (cue: Cue) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const lastId = useRef(useEchoStore.getState().cueSeq);

  useEffect(
    () =>
      useEchoStore.subscribe((state, prev) => {
        if (state.cueSeq === prev.cueSeq) return;
        for (const cue of state.cues) {
          if (cue.id > lastId.current) {
            lastId.current = cue.id;
            try {
              handlerRef.current(cue);
            } catch (error) {
              console.warn("[echo] cue handler failed", error);
            }
          }
        }
      }),
    [],
  );
}
