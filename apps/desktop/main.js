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

// Offline-LESEN braucht einen Service-Worker, und den gibt Chromium nur in einem
// "secure context" her: https, oder localhost. Die typische Schulinstallation
// laeuft aber unter http auf einer IP im eigenen Netz — dort meldet der Renderer
// isSecureContext=false und navigator.serviceWorker ist gar nicht erst vorhanden.
// Damit waere das Offline-Versprechen der App auf genau der Adresse tot, fuer die
// sie gedacht ist. Der Browser kann daran nichts aendern, die eigene Huelle schon:
// Chromium nimmt eine ausdruecklich benannte Origin als sicher an.
//
// Eng gehalten, absichtlich:
// - NUR die eine Adresse, die die Lehrkraft selbst eingetragen hat (keine
//   Platzhalter, keine Wildcards, kein pauschales Abschalten der Web-Sicherheit).
// - Bei https:// wird gar nichts gesetzt — dort ist der Kontext schon sicher.
// - Der Schalter muss VOR dem Laden gesetzt sein; Chromium liest ihn beim Start.
//   Wird die Adresse zur Laufzeit ueber das Menue geaendert, greift er erst nach
//   einem Neustart der App (darauf weist das Menue hin).
function secureOriginErlauben() {
  const url = readUrl();
  if (!url || !/^http:\/\//i.test(url)) return null;
  let origin;
  try { origin = new URL(url).origin; } catch { return null; }
  app.commandLine.appendSwitch("unsafely-treat-insecure-origin-as-secure", origin);
  // Chromium verlangt zu diesem Schalter ein ausdrueckliches Nutzerprofil.
  // Wir zeigen auf genau das Verzeichnis, das Electron ohnehin benutzt — die
  // Angabe aendert nichts am Speicherort, sie macht ihn nur explizit.
  app.commandLine.appendSwitch("user-data-dir", app.getPath("userData"));
  return origin;
}

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
  // der App — die App bleibt bei Nuvora. Nur die drei Schemata, die eine
  // Weboberflaeche legitim nach draussen reicht: file: und exotische Schemata
  // (Protokoll-Handler fremder Programme) gehoeren nicht in den Standardbrowser
  // und werden still verworfen.
  win.webContents.setWindowOpenHandler(({ url }) => {
    let schema = "";
    try { schema = new URL(url).protocol; } catch { schema = ""; }
    if (schema === "http:" || schema === "https:" || schema === "mailto:") shell.openExternal(url);
    return { action: "deny" };
  });

  loadTarget();
}

// Setup-Seite meldet die eingegebene Adresse hierher.
ipcMain.handle("nuvora:set-url", (_e, url) => {
  const u = (url || "").trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: "Bitte mit http:// oder https:// beginnen." };
  const vorher = readUrl();
  saveUrl(u);
  win.loadURL(u);
  // Der Secure-Origin-Schalter (siehe secureOriginErlauben) wird beim Start
  // gesetzt. Zeigt die neue Adresse auf http, fehlt das Offline-Lesen bis zum
  // Neustart — das sagen wir der Lehrkraft hier, statt sie raten zu lassen.
  if (u !== vorher && /^http:\/\//i.test(u)) {
    dialog.showMessageBox(win, {
      type: "info",
      title: "Neustart für Offline-Lesen",
      message: "Adresse gespeichert.",
      detail: "Diese Adresse läuft über http. Damit die Daten offline lesbar bleiben, "
            + "starte Nuvora einmal neu — vorher ist nur der Online-Betrieb möglich.",
      buttons: ["OK"],
    });
  }
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

// VOR whenReady: Kommandozeilen-Schalter liest Chromium nur beim Start.
secureOriginErlauben();

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Offline-Hinweis: kann der Server nicht geladen werden, zeigt der
// Service-Worker die gecachte Oberflaeche. Schlaegt schon das erste Laden fehl
// (nie online gewesen), erklaeren wir es kurz — und zeigen eine eigene Seite.
// Ohne die stuende hinter dem Dialog "chrome-error://chromewebdata/" mit null
// Zeichen: ein weisses Fenster ohne Weg zurueck ausser dem Menue.
app.on("web-contents-created", (_e, contents) => {
  contents.on("did-fail-load", (_ev, errorCode, _desc, validatedURL, istHauptrahmen) => {
    // -3 = abgebrochen (z.B. Redirect), ignorieren. Unterrahmen (iframes,
    // Nachladefehler) duerfen die ganze Seite nicht ersetzen.
    if (errorCode === -3) return;
    if (istHauptrahmen === false) return;
    if (!validatedURL || !validatedURL.startsWith("http")) return;
    if (win) win.loadFile(path.join(__dirname, "offline.html"));
    dialog.showMessageBox(win, {
      type: "info",
      title: "Nuvora offline",
      message: "Der Server ist gerade nicht erreichbar.",
      detail: "War die App schon einmal online, siehst du die zuletzt geladenen Daten (nur Lesen). Sonst später erneut verbinden.",
      buttons: ["OK"],
    });
  });
});

// Knopf "Erneut verbinden" auf offline.html.
ipcMain.handle("nuvora:retry", () => { loadTarget(); });

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
