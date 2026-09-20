import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const gateway = process.env.GATEWAY_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: gateway, changeOrigin: true },
      "/ws": { target: gateway.replace(/^http/, "ws"), ws: true, changeOrigin: true },
    },
  },
  preview: {
    port: 5173,
    proxy: {
      "/api": { target: gateway, changeOrigin: true },
      "/ws": { target: gateway.replace(/^http/, "ws"), ws: true, changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
});
