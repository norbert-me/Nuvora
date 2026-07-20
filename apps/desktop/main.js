// Nuvora Desktop — Phase 0.
//
// Ein natives Fenster, das die Nuvora-Weboberflaeche des eigenen Servers laedt.
// Kein eigener Server, keine eigene Datenbank: die App ist eine schlanke Huelle
// um die schon vorhandene PWA. Offline-LESEN funktioniert, weil Nuvoras
// Service-Worker die geladenen Daten cacht (network-first, Cache als Fallback).
// Offline-SCHREIBEN kommt spaeter (Phase 1: Outbox + Auto-Sync).
//
// Die Server-Adresse wird pro Rechner in settings.json (userData) gemerkt.

const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const SETTINGS = path.join(app.getPath("userData"), "settings.json");

function readUrl() {
  // Reihenfolge: ENV (fuer Tests) > gespeicherte Einstellung > leer (Setup).
  if (process.env.NUVORA_URL) return process.env.NUVORA_URL;
  try { return (JSON.parse(fs.readFileSync(SETTINGS, "utf-8")).url || "").trim(); }
  catch { return ""; }
}

function saveUrl(url) {
  try { fs.writeFileSync(SETTINGS, JSON.stringify({ url: url.trim() }), "utf-8"); }
  catch (e) { console.error("settings speichern fehlgeschlagen:", e); }
}

let win = null;

function loadTarget() {
  const url = readUrl();
  if (url) win.loadURL(url);
  else win.loadFile(path.join(__dirname, "setup.html")); // Erststart: Adresse abfragen
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "Nuvora",
    // Persistente Standard-Session: Service-Worker-Cache und der Token im
    // localStorage ueberleben Neustarts (sonst waere jeder Start ausgeloggt
    // und ohne Offline-Cache).
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  // Externe Links (mailto, fremde Hosts) im echten Browser oeffnen, nicht in
  // der App — die App bleibt bei Nuvora.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  loadTarget();
}

// Setup-Seite meldet die eingegebene Adresse hierher.
ipcMain.handle("nuvora:set-url", (_e, url) => {
  const u = (url || "").trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: "Bitte mit http:// oder https:// beginnen." };
  saveUrl(u);
  win.loadURL(u);
  return { ok: true };
});

function buildMenu() {
  const template = [
    { role: "appMenu" },
    {
      label: "Ansicht",
      submenu: [
        { label: "Neu laden", accelerator: "CmdOrCtrl+R", click: () => win && win.reload() },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" }, { role: "togglefullscreen" },
      ],
    },
    {
      label: "Server",
      submenu: [
        {
          label: "Server-Adresse ändern…",
          click: async () => {
            const cur = readUrl();
            // Kleiner Umweg ueber die Setup-Seite, damit kein extra Dialog noetig ist.
            win.loadFile(path.join(__dirname, "setup.html"), { query: cur ? { url: cur } : {} });
          },
        },
        { label: "Zur App", click: () => loadTarget() },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Offline-Hinweis: kann der Server nicht geladen werden, zeigt der
// Service-Worker die gecachte Oberflaeche. Schlaegt schon das erste Laden fehl
// (nie online gewesen), erklaeren wir es kurz.
app.on("web-contents-created", (_e, contents) => {
  contents.on("did-fail-load", (_ev, errorCode, _desc, validatedURL) => {
    // -3 = abgebrochen (z.B. Redirect), ignorieren.
    if (errorCode === -3) return;
    if (validatedURL && validatedURL.startsWith("http")) {
      dialog.showMessageBox(win, {
        type: "info",
        title: "Nuvora offline",
        message: "Der Server ist gerade nicht erreichbar.",
        detail: "War die App schon einmal online, siehst du die zuletzt geladenen Daten (nur Lesen). Sonst später erneut verbinden.",
        buttons: ["OK"],
      });
    }
  });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
