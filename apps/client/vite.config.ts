import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.REALTIME_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/ws": { target, ws: true },
      "/api": target,
    },
  },
});
