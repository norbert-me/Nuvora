// Nur EINE Regel — und die aus einem echten Vorfall: `no-undef`.
//
// Im Sitzplan blieb beim Entfernen der Aufruf-Ansicht dreimal die Variable
// `abs` stehen. Syntaktisch tadellos, der Build lief durch, der Chunk wurde
// ausgeliefert — und die Seite starb beim Rendern mit „Can't find variable:
// abs". Genau diese Klasse Fehler findet `no-undef`, und dafuer braucht es
// kein Regelwerk mit hundert Stilfragen: Nuvora hat seine Konventionen in
// CLAUDE.md, nicht in einem Linter.
//
// Gegenstueck fuer Python: scripts/pruefe_namen.py (dort kam derselbe Fehler
// einmal aus einem fehlenden Import).
import globals from "globals";

export default [
  {
    // Nur eigener Code: die Vendor-Buendel unter public/lp/js/ (jsPDF, KaTeX)
    // sind UMD-Pakete und melden `require`/`define`/`exports` — das ist ihre
    // Bauform, kein Fehler.
    files: ["src/**/*.{js,jsx}", "public/lp/js/app.js", "public/sw.js", "public/theme.js"],
    ignores: ["public/lp/vendor/**", "public/lp/js/jspdf.umd.min.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        __APP_VERSION__: "readonly",
        // JSX wird von Vite/React automatisch aufgeloest; ohne diese Zeile
        // meldet no-undef in jeder Datei „React is not defined".
        React: "readonly",
        process: "readonly",
      },
    },
    // Im Code stehen `eslint-disable`-Kommentare fuer react-hooks-Regeln, die
    // hier gar nicht geladen sind — ESLint 9 meldet sie sonst als Fehler
    // ("Definition for rule not found"). Wir pruefen genau eine Regel, also
    // werden Inline-Anweisungen ignoriert statt gepflegt.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
    rules: {
      "no-undef": "error",
    },
  },
];
