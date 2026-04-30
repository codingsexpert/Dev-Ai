import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.VITE_PROXY_TARGET || "http://localhost:3000";
const wsProxyTarget = process.env.VITE_WS_PROXY_TARGET || "ws://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiProxyTarget,
      "/ws": {
        target: wsProxyTarget,
        ws: true,
      },
    },
  },
});
