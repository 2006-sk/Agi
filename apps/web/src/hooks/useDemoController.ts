import { createContext, useCallback, useContext, useMemo } from "react";
import { MEDICAL_CARDIAC_SCENARIO } from "../mock/scenario.ts";
import { transport } from "../lib/client.ts";
import { selectFocus, useEchoStore } from "../store/useEchoStore.ts";

export interface DemoController {
  startDemo(): Promise<void>;
  advance(): Promise<void>;
  approve(): Promise<void>;
  reject(): Promise<void>;
  sendUtterance(text: string): Promise<void>;
  reset(): Promise<void>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDemoController(): DemoController {
  const startDemo = useCallback(async () => {
    const store = useEchoStore.getState();
    if (store.ui.starting || store.ui.demoStarted) return;
    store.setUi({ starting: true, error: null });
    try {
      const scenario = MEDICAL_CARDIAC_SCENARIO;
      const { session_id } = await transport.createCall({
        caller_label: scenario.caller.label,
        language: scenario.caller.language,
        channel: scenario.caller.channel,
      });
      await transport.startDemo(session_id, {
        scenario: scenario.id,
        mode: store.settings.mode,
        pace: store.settings.pace,
        ambient: true,
      });
      useEchoStore.getState().setUi({ demoStarted: true, demoSessionId: session_id, starting: false });
    } catch (error) {
      useEchoStore.getState().setUi({ starting: false, error: `Could not start the demo: ${describe(error)}` });
    }
  }, []);

  const advance = useCallback(async () => {
    const { ui } = useEchoStore.getState();
    if (!ui.demoSessionId) return;
    await transport.advance(ui.demoSessionId).catch((error) => useEchoStore.getState().setUi({ error: describe(error) }));
  }, []);

  const decide = useCallback(async (approved: boolean) => {
    const store = useEchoStore.getState();
    const focus = selectFocus(store);
    if (!focus?.approval || focus.approval.resolved) return;
    try {
      await transport.approval(focus.id, { action_id: focus.approval.payload.action_id, approved, reviewer: store.settings.reviewer });
    } catch (error) {
      useEchoStore.getState().setUi({ error: describe(error) });
    }
  }, []);

  const approve = useCallback(() => decide(true), [decide]);
  const reject = useCallback(() => decide(false), [decide]);

  const sendUtterance = useCallback(async (text: string) => {
    const store = useEchoStore.getState();
    let id = store.ui.demoSessionId ?? store.focusId;
    try {
      if (!id || store.sessions[id]?.kind === "ambient") {
        const created = await transport.createCall({ caller_label: "Caller (text)", channel: "text-fallback" });
        id = created.session_id;
        useEchoStore.getState().setUi({ demoStarted: true, demoSessionId: id });
      }
      await transport.utterance(id, text);
    } catch (error) {
      useEchoStore.getState().setUi({ error: describe(error) });
    }
  }, []);

  const reset = useCallback(async () => {
    try {
      await transport.reset();
    } catch (error) {
      useEchoStore.getState().setUi({ error: describe(error) });
    }
    useEchoStore.getState().resetAll();
  }, []);

  return useMemo(() => ({ startDemo, advance, approve, reject, sendUtterance, reset }), [startDemo, advance, approve, reject, sendUtterance, reset]);
}

export const ControllerContext = createContext<DemoController | null>(null);

export function useController(): DemoController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error("ControllerContext missing");
  return controller;
}
