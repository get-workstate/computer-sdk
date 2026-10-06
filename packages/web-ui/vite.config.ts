import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const server = process.env.WORKSTATE_URL ?? "http://127.0.0.1:4780";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4781,
    proxy: {
      "/api": server,
      "/demo": server,
      "/healthz": server,
      "/ws": { target: server, ws: true },
    },
  },
});
