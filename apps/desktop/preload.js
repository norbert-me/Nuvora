// Schmale, sichere Bruecke: die Setup-Seite darf NUR die Server-Adresse melden.
// contextIsolation an, kein Node im Renderer — nichts weiter wird freigegeben.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nuvora", {
  setUrl: (url) => ipcRenderer.invoke("nuvora:set-url", url),
});
