import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import pkg from "./package.json" with { type: "json" };

// Liste aller gebauten Dateien fuer den Service-Worker.
//
// Warum: die Seiten sind lazy geladen (React.lazy je Route), jede liegt in
// einem eigenen Chunk mit Inhalts-Hash im Namen. Der Service-Worker konnte
// bisher nur cachen, was jemand vorher aufgerufen hatte — wer offline ging,
// ohne vorher jede Seite besucht zu haben, bekam ueberall sonst ein weisses
// Fenster. Die Namen stehen erst nach dem Build fest, also schreibt sie der
// Build hier hin: /precache.json, eine Liste von Pfaden. Der Worker laedt sie
// beim Installieren und legt alles auf einmal ab.
function precacheListe() {
  return {
    name: "nuvora-precache-liste",
    apply: "build",
    generateBundle(_optionen, bundle) {
      const dateien = Object.keys(bundle)
        .filter((name) => /\.(js|css|woff2?|png|svg|jpe?g|webp)$/i.test(name))
        .map((name) => "/" + name);
      this.emitFile({ type: "asset", fileName: "precache.json", source: JSON.stringify(dateien) });
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheListe()],
  // Fassungsnummer im Code verfuegbar machen. Gebraucht wird sie als
  // Frischemarke an den Lernpfad-Dateien: `style.scoped.css` und `index.html`
  // liegen als Statik hinter einem Cache. Nach einem Deploy holte der Browser
  // das neue `app.js` (das traegt einen Zeitstempel), behielt aber das alte
  // CSS — sichtbar wurde das an zwei Aufklapp-Pfeilen nebeneinander: der neue
  // aus dem frischen Skript, der alte aus der gecachten `::after`-Regel.
  //
  // Die Marke traegt deshalb einen BUILD-Stempel, nicht die Paketversion:
  // `apps/web/package.json` wurde jahrelang nicht mitgezogen (sie stand auf
  // 4.1.5, waehrend 4.1.7 lief), und eine Frischemarke, die sich nicht
  // aendert, ist keine. Genau daran lief eine geaenderte `app.js` nach dem
  // Deploy weiter mit dem alten Stand: gleiche Adresse, gleicher Cache.
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version}+${Date.now().toString(36)}`) },
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
