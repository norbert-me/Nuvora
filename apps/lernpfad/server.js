// Lernpfad — reiner Statik-Server.
//
// Frueher lag hier das ganze Modul: eigene Konten (scrypt, Sessions), eigene
// SQLite-Datei, eigene Klassen und Schueler. Das ist alles entfallen — Nuvoras
// Kern haelt Konten, Klassen, Schueler und Themen, die Fachdaten liegen unter
// /api/lernpfad. Die App im Browser (js/app.js) spricht diese API direkt an.
//
// Uebrig bleibt: Dateien ausliefern. Der Nuvora-Proxy haengt sie unter
// /lernpfad-app/ ein, das React-Modul bettet sie unter /lernpfad/ ein.
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Sensible Dateien nie ausliefern ───
// Der Guard bleibt, auch wenn es keine eigene DB mehr gibt: im Verzeichnis
// koennen Reste alter Staende liegen (lernpfad.db, backups/), und frueher war
// genau hier die komplette Datenbank ohne Login abrufbar.
// Verzeichnisse mit Slash-Grenze pruefen, sonst wuerde "/daten" auch
// "/datenschutz.html" blocken.
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  const inDir = d => p === d || p.startsWith(d + '/');
  if (p.endsWith('.db') || p.endsWith('.db-shm') || p.endsWith('.db-wal') ||
      inDir('/backups') || inDir('/config') || inDir('/data') ||
      inDir('/daten') || inDir('/node_modules') ||
      p === '/server.js' || p.endsWith('.htpasswd') ||
      p === '/package.json' || p === '/package-lock.json') {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(path.join(__dirname, '.'), { index: 'index.html', extensions: [] }));

// Kein eigenes Backend mehr. Landet doch eine API-Anfrage hier, ist das ein
// Fehler und soll sichtbar sein, statt still ins Leere zu laufen.
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Lernpfad hat kein eigenes Backend mehr — die API liegt im Nuvora-Kern (/api/lernpfad).'
  });
});

app.listen(PORT, () => {
  console.log(`Lernpfad (Statik) läuft auf Port ${PORT}`);
});
