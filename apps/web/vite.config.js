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
  // Testnetz fuer die Logikdateien unter src/core (Wertung, Notenskala,
  // Modul-Schluessel). Node reicht: keine der geprueften Stellen braucht ein
  // DOM — die eine Hook-Pruefung laeuft ueber renderToString.
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,jsx}"],
  },
  server: {
    port: 3000,
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
