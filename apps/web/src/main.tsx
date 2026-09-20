import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { useAuraStore } from "./store/useAuraStore.ts";

if (import.meta.env.DEV) {
  (window as unknown as { __aura: typeof useAuraStore }).__aura = useAuraStore;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
