import { useEffect } from "react";
import { useSfx } from "./audio/useSfx.ts";
import { useSpeech } from "./audio/useSpeech.ts";
import { ControllerContext, useDemoController } from "./hooks/useDemoController.ts";
import { useHudScale } from "./hooks/useHudScale.ts";
import { useKeyboard } from "./hooks/useKeyboard.ts";
import { FlashOverlay } from "./hud/FlashOverlay.tsx";
import { Hud } from "./hud/Hud.tsx";
import { PresenterConsole } from "./hud/PresenterConsole.tsx";
import { Standby } from "./hud/Standby.tsx";
import { transport } from "./lib/client.ts";
import { CityCanvas } from "./scene/CityCanvas.tsx";
import { useEchoStore } from "./store/useEchoStore.ts";

export default function App() {
  const controller = useDemoController();
  const hud = useHudScale();
  useSpeech();
  useSfx();
  useKeyboard(controller);

  useEffect(() => {
    const store = useEchoStore.getState();
    return transport.connect(store.applyEvents, store.setConnection);
  }, []);

  return (
    <ControllerContext.Provider value={controller}>
      <div className="relative h-full w-full bg-black overflow-hidden select-none">
        <div className="absolute inset-0">
          <CityCanvas />
        </div>
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55)_100%)]" />
        <div className="pointer-events-none z-10" style={hud.style}>
          <Hud />
          <PresenterConsole />
          <Standby />
        </div>
        <div className="absolute inset-0 pointer-events-none z-20">
          <FlashOverlay />
        </div>
      </div>
    </ControllerContext.Provider>
  );
}
