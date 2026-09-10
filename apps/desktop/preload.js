// Schmale, sichere Bruecke: die Setup-Seite darf NUR die Server-Adresse melden,
// die Offline-Seite NUR einen neuen Verbindungsversuch anstossen. Beides ohne
// Argumente aus der Seite, die irgendwo hin zeigen koennten.
// contextIsolation an, kein Node im Renderer — nichts weiter wird freigegeben.
const { contextBridge, ipcRenderer } = require("electron");

// Die Fassung der Huelle kommt als Startargument herein (siehe main.js) und
// geht nur LESEND hinaus: die Seite soll wissen, welche App laeuft, damit sie
// auf eine neuere hinweisen kann — mehr nicht.
const fassung = (process.argv.find((a) => a.startsWith("--nuvora-version=")) || "").split("=")[1] || "";

contextBridge.exposeInMainWorld("nuvora", {
  setUrl: (url) => ipcRenderer.invoke("nuvora:set-url", url),
  retry: () => ipcRenderer.invoke("nuvora:retry"),
  appVersion: fassung,
  platform: process.platform,
  // Neue Fassung DRUEBERLEGEN statt verlinken. Die Adresse wird im Haupt-
  // prozess geprueft (Schema, Host, Endung) — die Seite kann hier also nicht
  // irgendeine Datei hereinreichen. `beiFortschritt` bekommt 0..100; danach
  // startet die App von selbst neu.
  updateInstall: (url, beiFortschritt) => {
    const horcher = (_e, p) => { try { beiFortschritt && beiFortschritt(p); } catch { /* egal */ } };
    ipcRenderer.on("nuvora:update-fortschritt", horcher);
    return ipcRenderer.invoke("nuvora:update", url)
      .finally(() => ipcRenderer.removeListener("nuvora:update-fortschritt", horcher));
  },
});
