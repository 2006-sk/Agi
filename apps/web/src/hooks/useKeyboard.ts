import { useEffect } from "react";
import { useAuraStore } from "../store/useAuraStore.ts";
import type { DemoController } from "./useDemoController.ts";

/** Space: start / next turn. Enter: approve. R: reject. Backtick: console. Esc: close console. */
export function useKeyboard(controller: DemoController): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) {
        if (event.key === "Escape") (target as HTMLElement).blur();
        return;
      }
      const store = useAuraStore.getState();
      if (event.code === "Space") {
        event.preventDefault();
        if (!store.ui.demoStarted) void controller.startDemo();
        else if (store.settings.mode === "manual") void controller.advance();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void controller.approve();
        return;
      }
      if (event.key === "r" || event.key === "R") {
        void controller.reject();
        return;
      }
      if (event.key === "`") {
        event.preventDefault();
        store.setUi({ consoleOpen: !store.ui.consoleOpen });
        return;
      }
      if (event.key === "Escape") store.setUi({ consoleOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller]);
}
