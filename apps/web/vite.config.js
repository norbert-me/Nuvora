import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React und der Router aendern sich nur bei einem Abhaengigkeits-Update,
        // der eigene Code bei jedem Deploy. Getrennt gehalten behaelt der Browser
        // (und der Service-Worker-Cache) das Fundament ueber Deploys hinweg.
        manualChunks: (id) => {
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) return "react";
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
