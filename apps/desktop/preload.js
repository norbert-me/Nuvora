// Schmale, sichere Bruecke: die Setup-Seite darf NUR die Server-Adresse melden,
// die Offline-Seite NUR einen neuen Verbindungsversuch anstossen. Beides ohne
// Argumente aus der Seite, die irgendwo hin zeigen koennten.
// contextIsolation an, kein Node im Renderer — nichts weiter wird freigegeben.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nuvora", {
  setUrl: (url) => ipcRenderer.invoke("nuvora:set-url", url),
  retry: () => ipcRenderer.invoke("nuvora:retry"),
});
