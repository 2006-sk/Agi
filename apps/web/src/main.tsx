import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { useEchoStore } from "./store/useEchoStore.ts";

if (import.meta.env.DEV) {
  (window as unknown as { __echo: typeof useEchoStore }).__echo = useEchoStore;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
