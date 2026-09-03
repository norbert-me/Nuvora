// Dunkles Design setzen, BEVOR die Seite gezeichnet wird.
//
// Stand als Inline-Script in index.html. Genau dafuer brauchte die
// Content-Security-Policy `script-src 'unsafe-inline'` — und damit war die
// wirksamste Bremse gegen eingeschleustes Javascript fuer die ganze Seite
// ausgehebelt, wegen dieser einen Zeile. Als eigene Datei reicht 'self'.
//
// Weiterhin synchron im <head>: laeuft es spaeter, blitzt die helle Fassung
// einmal auf, bevor umgeschaltet wird.
try {
  if (localStorage.getItem("darkMode") === "true") document.documentElement.classList.add("dark");
} catch (e) { /* privater Modus: dann eben hell */ }
