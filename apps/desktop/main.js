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

// Alle offenen Fenster. Auf macOS liegen sie als NATIVE Tabs in einem Fenster
// (`tabbingIdentifier`) — Cmd+T legt einen an, die Tableiste kommt vom System.
// Ein selbst gebautes Tab-Band waere eine zweite, schlechtere Fassung davon:
// ohne Ziehen zwischen Fenstern, ohne Tastaturwege, ohne Vollbild-Verhalten.
let win = null;          // zuletzt benutztes Fenster (fuer Menue und Setup)
const fenster = new Set();
const aktiv = () => BrowserWindow.getFocusedWindow() || win;

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

function loadTarget(ziel = null) {
  const w = ziel || aktiv();
  if (!w) return;
  const url = readUrl();
  if (url) w.loadURL(url);
  else w.loadFile(path.join(__dirname, "setup.html")); // Erststart: Adresse abfragen
}

function createWindow() {
  const neu = new BrowserWindow({
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
      // Die Fassung der Huelle als Startargument: die Weboberflaeche kann
      // daraus sehen, ob eine neuere App vorliegt, und es sagen. Ueber ein
      // Argument und nicht ueber einen ipc-Aufruf, weil der Renderer die
      // Antwort schon beim ersten Rendern braucht und ein `app.getVersion()`
      // im Renderer nicht zu haben ist (kein Node dort, und das ist gut so).
      additionalArguments: [`--nuvora-version=${app.getVersion()}`],
    },
    // macOS legt Fenster mit derselben Kennung als Tabs zusammen.
    tabbingIdentifier: "nuvora",
  });
  win = neu;
  fenster.add(neu);
  neu.on("focus", () => { win = neu; });
  neu.on("closed", () => { fenster.delete(neu); if (win === neu) win = [...fenster][0] || null; });

  // Externe Links (mailto, fremde Hosts) im echten Browser oeffnen, nicht in
  // der App — die App bleibt bei Nuvora. Nur die drei Schemata, die eine
  // Weboberflaeche legitim nach draussen reicht: file: und exotische Schemata
  // (Protokoll-Handler fremder Programme) gehoeren nicht in den Standardbrowser
  // und werden still verworfen.
  neu.webContents.setWindowOpenHandler(({ url }) => {
    let schema = "";
    try { schema = new URL(url).protocol; } catch { schema = ""; }
    if (schema === "http:" || schema === "https:" || schema === "mailto:") shell.openExternal(url);
    return { action: "deny" };
  });

  loadTarget(neu);
  return neu;
}

// Ein weiterer Tab auf dieselbe Installation. `addTabbedWindow` haengt ihn an
// die Tableiste des aktuellen Fensters; ohne das oeffnete macOS ein zweites
// freistehendes Fenster.
function neuerTab() {
  const vorher = aktiv();
  const t = createWindow();
  if (vorher && !vorher.isDestroyed() && process.platform === "darwin") {
    try { vorher.addTabbedWindow(t); } catch { /* aelteres macOS: dann eben ein eigenes Fenster */ }
  }
  return t;
}

// Setup-Seite meldet die eingegebene Adresse hierher.
ipcMain.handle("nuvora:set-url", (_e, url) => {
  const u = (url || "").trim();
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: "Bitte mit http:// oder https:// beginnen." };
  const vorher = readUrl();
  saveUrl(u);
  const w = aktiv();
  if (w) w.loadURL(u);
  // Der Secure-Origin-Schalter (siehe secureOriginErlauben) wird beim Start
  // gesetzt. Zeigt die neue Adresse auf http, fehlt das Offline-Lesen bis zum
  // Neustart — das sagen wir der Lehrkraft hier, statt sie raten zu lassen.
  if (u !== vorher && /^http:\/\//i.test(u)) {
    dialog.showMessageBox(aktiv(), {
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

// Ein Schritt im Verlauf des gerade sichtbaren Tabs. Electron 44 fuehrt den
// Verlauf unter `webContents.navigationHistory`; die alten Methoden
// (`goBack`/`canGoBack`) gibt es dort nicht mehr.
function verlauf(w) {
  const c = w && !w.isDestroyed() ? w.webContents : null;
  return c ? (c.navigationHistory || c) : null;
}
function zurueck() {
  const h = verlauf(aktiv());
  if (h && h.canGoBack()) h.goBack();
}
function vorwaerts() {
  const h = verlauf(aktiv());
  if (h && h.canGoForward()) h.goForward();
}

function buildMenu() {
  const template = [
    { role: "appMenu" },
    {
      label: "Datei",
      submenu: [
        { label: "Neuer Tab", accelerator: "CmdOrCtrl+T", click: () => neuerTab() },
        { role: "close" },
      ],
    },
    {
      // Zurueck und Vorwaerts gibt es in der App sonst nirgends: es gibt keine
      // Adressleiste, und die Weboberflaeche ist eine SPA — wer sich verklickt
      // hat, kam bisher nur ueber die Navigation zurueck. Die Tasten sind die
      // des Browsers (Cmd+[ / Cmd+]) plus die Pfeile, die auf dem Mac ebenso
      // gelaeufig sind.
      label: "Verlauf",
      submenu: [
        { label: "Zurück", accelerator: "CmdOrCtrl+[", click: () => zurueck() },
        { label: "Zurück ", accelerator: "CmdOrCtrl+Left", visible: false, click: () => zurueck() },
        { label: "Vorwärts", accelerator: "CmdOrCtrl+]", click: () => vorwaerts() },
        { label: "Vorwärts ", accelerator: "CmdOrCtrl+Right", visible: false, click: () => vorwaerts() },
      ],
    },
    {
      label: "Ansicht",
      submenu: [
        { label: "Neu laden", accelerator: "CmdOrCtrl+R", click: () => { const w = aktiv(); if (w) w.reload(); } },
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
            const w = aktiv();
            // Kleiner Umweg ueber die Setup-Seite, damit kein extra Dialog noetig ist.
            if (w) w.loadFile(path.join(__dirname, "setup.html"), { query: cur ? { url: cur } : {} });
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
    const w = aktiv();
    if (w) w.loadFile(path.join(__dirname, "offline.html"));
    dialog.showMessageBox(w, {
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

// ── Update: die neue Fassung wird DRUEBERGELEGT, nicht verlinkt ──
//
// Vorher fuehrte der Hinweis „es gibt eine neue Fassung" auf die GitHub-Seite:
// dort dann die richtige Datei suchen, laden, DMG oeffnen, App ins Programme-
// Verzeichnis ziehen, alte ersetzen bestaetigen. Fuenf Schritte fuer etwas, das
// ein Klick sein soll.
//
// Warum NICHT `electron-updater`: Squirrel.Mac verlangt eine signierte App.
// Nuvoras DMG ist unsigniert (bewusst — eine Entwicklerlizenz ist fuer eine
// Schul-Installation ein hoher Preis), und der Updater bricht dann mit „Could
// not get code signature for running application" ab. Also von Hand: laden,
// mounten, das Bundle ueber das laufende kopieren, neu starten.
//
// Die Adresse kommt aus der Seite — geprueft wird sie HIER: nur https, nur die
// Hosts, auf denen unsere Release-Dateien liegen, und nur die Endung, die zur
// Plattform passt. Die Huelle darf sich nicht von einer Seite dazu bringen
// lassen, irgendeine Datei zu laden und auszufuehren.
const UPDATE_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
const UPDATE_MAX = 800 * 1024 * 1024;   // 800 MB: darueber stimmt etwas nicht

function updateZielGeprueft(roh) {
  let u;
  try { u = new URL(String(roh || "")); } catch { return null; }
  if (u.protocol !== "https:" || !UPDATE_HOSTS.has(u.hostname)) return null;
  const endung = process.platform === "darwin" ? ".dmg"
    : process.platform === "win32" ? ".exe"
    : ".AppImage";
  if (!u.pathname.toLowerCase().endsWith(endung)) return null;
  return u.toString();
}

function laden(url, ziel, melde) {
  // `net` statt https: es nimmt die Proxy-Einstellungen des Systems mit — im
  // Schulnetz ist das oft der Unterschied zwischen „laedt" und „haengt".
  const { net } = require("electron");
  return new Promise((fertig, fehler) => {
    const anfrage = net.request({ url, redirect: "follow" });
    anfrage.on("response", (antwort) => {
      if (antwort.statusCode !== 200) { fehler(new Error(`HTTP ${antwort.statusCode}`)); return; }
      const gesamt = Number(antwort.headers["content-length"] || 0);
      if (gesamt > UPDATE_MAX) { fehler(new Error("Datei zu gross")); return; }
      const datei = fs.createWriteStream(ziel);
      let geladen = 0;
      antwort.on("data", (stueck) => {
        geladen += stueck.length;
        if (geladen > UPDATE_MAX) { anfrage.abort(); datei.destroy(); fehler(new Error("Datei zu gross")); return; }
        datei.write(stueck);
        if (gesamt) melde(Math.round((geladen / gesamt) * 100));
      });
      antwort.on("end", () => datei.end(() => fertig(ziel)));
      antwort.on("error", fehler);
    });
    anfrage.on("error", fehler);
    anfrage.end();
  });
}

// Das Bundle der LAUFENDEN App: /Applications/Nuvora.app/Contents/MacOS/Nuvora
// -> /Applications/Nuvora.app. Dorthin wird kopiert; die laufende Fassung
// stoert das nicht, sie haelt ihre Dateien bereits geoeffnet.
function eigenesBundle() {
  const teil = process.execPath.split("/Contents/MacOS/")[0];
  return teil.endsWith(".app") ? teil : null;
}

async function installiereMac(dmg) {
  const { execFile } = require("child_process");
  const lauf = (befehl, args) => new Promise((ok, nein) => {
    execFile(befehl, args, { maxBuffer: 8 * 1024 * 1024 }, (e, out) => (e ? nein(e) : ok(String(out || ""))));
  });
  const ziel = eigenesBundle();
  if (!ziel) throw new Error("Die laufende App liegt nicht als .app vor.");
  // Ohne das Entfernen der Quarantaene startet die kopierte App nicht: die
  // geladene Datei traegt die Marke, und sie vererbt sich beim Kopieren.
  await lauf("/usr/bin/xattr", ["-dr", "com.apple.quarantine", dmg]).catch(() => {});
  const aus = await lauf("/usr/bin/hdiutil", ["attach", "-nobrowse", "-noverify", "-plist", dmg]);
  const treffer = aus.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
  const punkt = treffer && treffer[1];
  if (!punkt) throw new Error("DMG liess sich nicht einhaengen.");
  try {
    const app_ = fs.readdirSync(punkt).find((x) => x.endsWith(".app"));
    if (!app_) throw new Error("Im DMG liegt keine App.");
    // `ditto` statt cp: es nimmt Rechte, Symlinks und erweiterte Attribute mit
    // — ein mit cp kopiertes Bundle startet unter macOS oft gar nicht.
    await lauf("/usr/bin/ditto", [path.join(punkt, app_), ziel]);
    await lauf("/usr/bin/xattr", ["-dr", "com.apple.quarantine", ziel]).catch(() => {});
  } finally {
    await lauf("/usr/bin/hdiutil", ["detach", punkt, "-quiet"]).catch(() => {});
  }
}

ipcMain.handle("nuvora:update", async (e, url) => {
  const ziel = updateZielGeprueft(url);
  if (!ziel) return { ok: false, error: "Diese Adresse gehört nicht zu einer Nuvora-Fassung." };
  const fenster = BrowserWindow.fromWebContents(e.sender);
  const melde = (p) => { if (fenster && !fenster.isDestroyed()) fenster.webContents.send("nuvora:update-fortschritt", p); };
  const datei = path.join(app.getPath("temp"), `nuvora-update-${Date.now()}${path.extname(new URL(ziel).pathname)}`);
  try {
    await laden(ziel, datei, melde);
    if (process.platform === "darwin") {
      melde(100);
      await installiereMac(datei);
      // Neu starten, damit die eben kopierte Fassung laeuft. Ohne das laeuft
      // die alte weiter und der Hinweis kaeme beim naechsten Start wieder.
      app.relaunch();
      app.exit(0);
      return { ok: true };
    }
    // Windows/Linux gibt es noch nicht als Build. Bis dahin ehrlich: die
    // geladene Datei oeffnen und den Rest dem System ueberlassen.
    await shell.openPath(datei);
    return { ok: true, manuell: true };
  } catch (fehler) {
    try { fs.unlinkSync(datei); } catch { /* egal */ }
    return { ok: false, error: String(fehler && fehler.message ? fehler.message : fehler) };
  } finally {
    if (process.platform === "darwin") { try { fs.unlinkSync(datei); } catch { /* egal */ } }
  }
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
