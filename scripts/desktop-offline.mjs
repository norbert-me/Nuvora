/**
 * Nuvora Desktop — das Offline-Versprechen nachhalten (Playwright + Electron).
 *
 * Die Desktop-App verspricht in README und `apps/desktop/main.js` genau eine
 * Sache, die die Weboberflaeche allein nicht kann: **offline lesen**. Dieses
 * Skript prueft dieses Versprechen und sonst nichts — der Rundgang durch Start,
 * Seiten, Menue und Handgriffe steht in `scripts/desktop-test.mjs`.
 *
 * Warum es das gibt: auf der real konfigurierten Adresse (http auf einer IP im
 * Schulnetz) gab es lange gar keinen Service-Worker — `navigator.serviceWorker`
 * war nicht vorhanden, weil Chromium ihn nur im "secure context" herausgibt.
 * Das Offline-Lesen hat es dort also nie gegeben, und niemand hat es gemerkt.
 * Ein Versprechen, das niemand prueft, ist keins.
 *
 * Geprueft wird in dieser Reihenfolge:
 *   1. Ist ueberhaupt ein Service-Worker da? (secure context, Registrierung,
 *      Nuvora-Caches) — schlaegt das fehl, ist alles Weitere gegenstandslos.
 *   2. Offline lesen: online anmelden, Seiten besuchen, Netz kappen, neu laden.
 *   3. Deep-Link offline: eine Adresse, die online NIE besucht wurde.
 *   4. Echte Inhaltsdaten offline: Klasse + zwei Kinder, Namen muessen bleiben.
 *   5. Fehlerfall tote Adresse: erkennbare deutsche Auskunft, kein leeres Fenster.
 *
 * Nutzung:  node scripts/desktop-offline.mjs --url … --email … --passwort …
 *           (oder SELFTEST_URL/SITE_URL, SELFTEST_EMAIL, SELFTEST_PASSWORD)
 * Rueckgabewert: 0 = gruen, 1 = mindestens ein Fehler, 2 = Aufruf unbrauchbar.
 *
 * Testdaten tragen das Praefix ZZ-Desktop-Offline, werden vor dem Aufbau und am
 * Ende abgeraeumt (inklusive Papierkorb); was bleibt, steht unter „Reste".
 */
import { _electron } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  zugang, macheBericht, druckeBericht, abbruchBremse, macheFetchApi, anmeldenApi,
  dialogeAnnehmen, tourWegklicken, mitFrist, warte, kurz,
} from "./browser-gemeinsam.mjs";

const HIER = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HIER, "..", "apps", "desktop");

const { basis: URL_BASIS, email: EMAIL, passwort: PASSWORT } = zugang();

// Electron liegt in apps/desktop/node_modules, Playwright in scripts/node_modules
// — zwei getrennte Projekte, also findet Playwright die Binaerdatei nicht von
// selbst. `path.txt` ist der vom electron-Paket vorgesehene Weg dorthin.
function electronPfad() {
  const wurzel = path.join(APP_DIR, "node_modules", "electron");
  try {
    const rel = fs.readFileSync(path.join(wurzel, "path.txt"), "utf-8").trim();
    const voll = path.join(wurzel, "dist", rel);
    return fs.existsSync(voll) ? voll : null;
  } catch { return null; }
}

const MARKE = "ZZ-Desktop-Offline";
const KIND_A = `${MARKE} Kind Eins`;
const KIND_B = `${MARKE} Kind Zwei`;

// Ausgabe: Ton und Aufbau kommen aus browser-gemeinsam.mjs — dieselbe Quelle
// wie bei den drei anderen Tests.
const { ergebnisse, notiere } = macheBericht();

// ── API ohne Browser ───────────────────────────────────────────────────────
let token = null;
const { api } = macheFetchApi(URL_BASIS, () => token);
/**
 * JSON holen und bei jedem Nicht-2xx WERFEN.
 *
 * Anders als die stille Fassung in browser-gemeinsam.mjs: hier ist eine
 * misslungene Abfrage ein Befund, der im Bericht unter „Reste" landen soll —
 * ein `null`, das drei Zeilen weiter als „nichts gefunden" durchgeht, waere
 * eine falsche Entwarnung.
 */
const apiJson = async (pfad) => {
  const r = await api(pfad);
  if (!r.ok) throw new Error(`GET ${pfad}: HTTP ${r.status}`);
  return r.json();
};

/**
 * Reste abraeumen — vor dem Aufbau und am Ende.
 *
 * Sicherheitsnetz wie in scripts/aufraeumen.py: geprueft wird die Marke
 * unmittelbar vor dem Loeschen, nicht nur bei der Auswahl. Geloescht wird weich
 * UND aus dem Papierkorb, sonst sammelt sich der Testmuell dort an.
 * Rueckgabe: { weg, reste } — `reste` ist ein Befund, kein Rauschen.
 */
async function abraeumen() {
  let weg = 0;
  const reste = [];
  for (const pfad of ["/api/classes", "/api/classes/trash"]) {
    let liste;
    try { liste = await apiJson(pfad); } catch (e) { reste.push(`${pfad}: ${kurz(e, 60)}`); continue; }
    for (const k of liste) {
      if (!String(k.name || "").includes(MARKE)) continue;   // Marke direkt vor dem Loeschen
      try {
        if (pfad === "/api/classes") await api(`/api/classes/${k.id}`, "DELETE");  // weich -> Papierkorb
        const p = await api(`/api/classes/${k.id}/purge`, "DELETE");               // endgueltig
        if (p.ok || p.status === 204) weg++;
        else reste.push(`${k.name}: purge HTTP ${p.status}`);
      } catch (e) { reste.push(`${k.name}: ${kurz(e, 60)}`); }
    }
  }
  return { weg, reste };
}

// Abbruch: die Testklasse darf nicht im fremden Konto liegen bleiben.
abbruchBremse(abraeumen, "räume die Testdaten weg …");

/** Sichtbarer Text des Fensters, robust auch wenn gerade nichts gerendert ist. */
const text = (seite) => seite.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "");

async function starteApp(url, exe, profil = null) {
  return _electron.launch({
    // Ohne `profil` laeuft die App im DAUERHAFTEN Profil der Lehrkraft — das ist
    // der Alltagsfall (Service-Worker und Cache aus der letzten Sitzung). Mit
    // `profil` bekommt sie ein leeres Verzeichnis: die frische Installation.
    args: profil ? [".", `--user-data-dir=${profil}`] : ["."],
    executablePath: exe,
    cwd: APP_DIR,
    // NUVORA_URL hat in main.js Vorrang vor der gespeicherten Einstellung —
    // der Test fasst die Einstellung der Lehrkraft nicht an.
    env: { ...process.env, NUVORA_URL: url },
  });
}

/**
 * Den Service-Worker auf die ausgelieferte Fassung zwingen — so, wie es die
 * Oberflaeche auch tut.
 *
 * Warum das sein muss: der Test laeuft im dauerhaften Profil, dort steuert nach
 * einem Deploy weiter der ALTE Worker. Die neue Fassung wird zwar geholt, bleibt
 * aber im Wartezustand, bis kein Client mehr vom alten gesteuert wird. Ohne
 * diesen Schritt prueft der Test auf Dauer eine Fassung, die auf dem Server
 * laengst nicht mehr liegt — und waere nach dem naechsten echten sw.js-Fehler
 * still gruen. Genau die Scheinsicherheit, gegen die er gebaut ist.
 *
 * Der Weg ist derselbe wie in der Update-Leiste (apps/web/src/main.jsx):
 * registration.update(), dann dem Wartenden `{type:"SKIP_WAITING"}` schicken und
 * auf `controllerchange` warten — mit Frist, nicht endlos.
 */
async function swWechselErzwingen(seite) {
  return seite.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { reg: false };
    try { await reg.update(); } catch (e) { return { reg: true, fehler: String(e.message || e) }; }
    // Nach update() steht die neue Fassung entweder in `waiting` oder sie ist
    // noch am Installieren — kurz nachfassen, sonst verpasst der Test sie.
    let wartend = reg.waiting;
    for (let i = 0; i < 10 && !wartend; i++) {
      if (!reg.installing) break;
      await new Promise((r) => setTimeout(r, 500));
      wartend = reg.waiting;
    }
    if (!wartend) return { reg: true, wartend: false };
    const gewechselt = await new Promise((fertig) => {
      const uhr = setTimeout(() => fertig(false), 20000);
      navigator.serviceWorker.addEventListener("controllerchange",
        () => { clearTimeout(uhr); fertig(true); }, { once: true });
      wartend.postMessage({ type: "SKIP_WAITING" });
    });
    return { reg: true, wartend: true, gewechselt };
  });
}

async function main() {
  const exe = electronPfad();
  if (!exe) {
    notiere("Vorbereitung", "Electron gefunden", false,
      `keine Binärdatei in ${path.join(APP_DIR, "node_modules", "electron")} — vorher „npm install" in apps/desktop`);
    return drucke();
  }
  notiere("Vorbereitung", "Electron gefunden", true, path.relative(HIER, exe));

  // ── Anmelden (wie die Shell: Token in den localStorage) ──
  let user;
  try {
    const angemeldet = await anmeldenApi(URL_BASIS, EMAIL, PASSWORT);
    token = angemeldet.token;
    user = angemeldet.user;
  } catch (e) {
    notiere("Vorbereitung", "Anmeldung", false, kurz(e));
    return drucke();
  }
  notiere("Vorbereitung", "Anmeldung", true, `als ${user.email}`);

  // ── Reste des letzten Laufs ──
  const vorher = await abraeumen();
  notiere("Vorbereitung", "Reste des letzten Laufs", !vorher.reste.length,
    vorher.reste.length ? `Reste: ${vorher.reste.slice(0, 3).join(" | ")}`
      : vorher.weg ? `${vorher.weg} Reste eines abgebrochenen Laufs abgeräumt` : "keine");

  // ── Testklasse anlegen: erst damit heisst „offline lesbar" mehr als „rendert" ──
  let klasse = null;
  try {
    const r = await api("/api/classes", "POST", {
      name: `${MARKE} Klasse`,
      students: [{ card_id: 1, name: KIND_A }, { card_id: 2, name: KIND_B }],
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    klasse = await r.json();
    notiere("Vorbereitung", "Testklasse angelegt", true, `„${klasse.name}" mit 2 Kindern`);
  } catch (e) {
    notiere("Vorbereitung", "Testklasse angelegt", false, kurz(e));
  }

  // Zwei Durchgaenge, weil es zwei verschiedene Faelle sind und sie sich sonst
  // gegenseitig verdecken:
  //
  //  - „bestehende Installation": das dauerhafte Profil der Lehrkraft, mit
  //    Service-Worker und Cache aus der letzten Sitzung. Hier steuert nach einem
  //    Deploy weiter die alte Fassung — der Test zwingt den Wechsel (siehe
  //    swWechselErzwingen) und meldet, ob einer noetig war.
  //  - „frische Installation": leeres Profil, nichts im Cache. Hier laeuft die
  //    ausgelieferte Fassung von Anfang an; das ist der erste Start auf einem
  //    neuen Rechner.
  //
  // Faellt eine Pruefung nur in einem Durchgang um, sagt schon die Zeile, welcher
  // Fall gemeint ist.
  const frischesProfil = fs.mkdtempSync(path.join(os.tmpdir(), "nuvora-desktop-offline-"));
  try {
    await mitFrist(offlineProbe(exe, user, "bestehende Installation", null), 5 * 60 * 1000, "Offline-Probe (bestehendes Profil)")
      .catch((e) => notiere("Ablauf", "Offline-Probe (bestehende Installation)", false, kurz(e)));
    await mitFrist(offlineProbe(exe, user, "frische Installation", frischesProfil), 5 * 60 * 1000, "Offline-Probe (frisches Profil)")
      .catch((e) => notiere("Ablauf", "Offline-Probe (frische Installation)", false, kurz(e)));
    await mitFrist(toteAdresse(exe), 2 * 60 * 1000, "Fehlerfall tote Adresse")
      .catch((e) => notiere("Ablauf", "Fehlerfall tote Adresse", false, kurz(e)));
  } finally {
    try { fs.rmSync(frischesProfil, { recursive: true, force: true }); } catch { /* Temp-Profil, faellt nicht ins Gewicht */ }
    const nach = await abraeumen();
    notiere("Aufräumen", "Testdaten", !nach.reste.length,
      nach.reste.length ? `Reste: ${nach.reste.slice(0, 3).join(" | ")}` : `${nach.weg} Testdaten restlos entfernt`);
  }
  drucke();
}

/**
 * Netz kappen — und BEWEISEN, dass es gekappt ist.
 *
 * Drei Wege standen zur Wahl, gemessen wurde an der laufenden App:
 *
 *  - `session.enableNetworkEmulation({offline:true})` im Hauptprozess: sieht
 *    richtig aus, hat aber NICHTS gekappt — die Sonde bekam weiter HTTP 200.
 *    Damit waere jeder Offline-Test still gruen geworden, ohne je offline zu sein.
 *  - eigener TCP-Weiterleiter auf 127.0.0.1, Verbindungen zerstoeren: kappt
 *    sicher, aendert aber die Herkunft auf loopback — und loopback gilt Chromium
 *    als sicherer Kontext. Genau die Frage aus Pruefung 1 (gibt es auf http-IP
 *    ueberhaupt einen Service-Worker?) waere damit weggemogelt.
 *  - `page.context().setOffline(true)`: kappt, und zwar bis in den
 *    Service-Worker hinein — die Sonde unten geht durch dessen fetch-Handler und
 *    scheitert. Deshalb dieser Weg.
 *
 * Die Sonde bleibt trotzdem stehen: sie fragt einen cachebaren, aber nie
 * gecachten API-Pfad. Antwortet der noch, ist das Netz nicht wirklich weg —
 * dann sind die folgenden Pruefungen wertlos, und das sagt der Bericht.
 */
async function netzKappen(seite, G) {
  await seite.context().setOffline(true);
  await warte(500);
  const sonde = await seite.evaluate(async () => {
    try { const r = await fetch(`/api/classes?offline-sonde=${Math.random()}`); return `HTTP ${r.status}`; }
    catch (e) { return `Fehler: ${e.message}`; }
  });
  const gekappt = !/^HTTP 2/.test(sonde);
  notiere(G("Offline lesen"), "Verbindung wirklich gekappt", gekappt,
    gekappt ? `Sonde durch den Service-Worker: ${sonde}` : `Sonde antwortet weiter (${sonde}) — alles Folgende ist wertlos`);
  return gekappt;
}

async function offlineProbe(exe, user, lauf, profil) {
  // Jede Zeile traegt den Durchgang, sonst ist bei zwei Laeufen nicht zu sehen,
  // welcher Fall gemeint war.
  const G = (name) => `${lauf} · ${name}`;
  const app = await starteApp(URL_BASIS, exe, profil);
  let seite;
  try {
    seite = await app.firstWindow();
    dialogeAnnehmen(seite);
    await seite.waitForLoadState("domcontentloaded").catch(() => {});
    // Bei einem frischen Profil laedt die Huelle noch waehrend der Pruefung um
    // (setup.html -> Server-Adresse -> Shell). Wer dazwischen `evaluate` ruft,
    // bekommt „Execution context was destroyed" — ein Rennen, kein Befund.
    // Also erst Ruhe abwarten.
    await seite.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
    const geladen = seite.url().startsWith(URL_BASIS);
    notiere(G("Start"), "Fenster lädt die konfigurierte Adresse", geladen, geladen ? seite.url() : `stattdessen: ${seite.url()}`);

    // Anmeldung wie die Shell, dann neu laden, damit React sie sieht.
    // Zweimal versuchen: navigiert die Seite genau dazwischen, ist der Kontext
    // weg und der Aufruf scheitert — beim zweiten Mal steht sie still.
    for (let versuch = 0; versuch < 2; versuch++) {
      const ok = await seite.evaluate(([tok, usr]) => {
        localStorage.setItem("token", tok);
        localStorage.setItem("user", usr);
        return true;
      }, [token, JSON.stringify(user)]).catch(() => false);
      if (ok) break;
      await seite.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    }
    await seite.goto(`${URL_BASIS}/`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await tourWegklicken(seite);

    // ── 1. Ist ueberhaupt ein Service-Worker da? ──
    //
    // Die Kernfrage. Ohne ihn gibt es kein Offline-Lesen — dann ist alles
    // Weitere gegenstandslos, und der Bericht sagt genau das, samt Grund.
    const sw = await seite.evaluate(async () => {
      const vorhanden = !!navigator.serviceWorker;
      let regs = -1;
      if (vorhanden) {
        try {
          await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 15000))]);
          // Beim ERSTEN Start (frisches Profil) uebernimmt der Worker die Seite
          // erst mit clients.claim() — kurz nachfassen, sonst meldet der Test
          // faelschlich „wird NICHT gesteuert".
          for (let i = 0; i < 10 && !navigator.serviceWorker.controller; i++)
            await new Promise((r) => setTimeout(r, 500));
          regs = (await navigator.serviceWorker.getRegistrations()).length;
        } catch { regs = -1; }
      }
      let namen = [];
      try { namen = await caches.keys(); } catch { namen = []; }
      return { vorhanden, secure: isSecureContext, protokoll: location.protocol, regs, namen, controller: vorhanden && !!navigator.serviceWorker.controller };
    });

    if (!sw.vorhanden) {
      notiere(G("Service-Worker"), "vorhanden", false,
        `Es gibt auf dieser Adresse gar keinen Service-Worker (${sw.protokoll}//…, isSecureContext=${sw.secure}) — ohne ihn kann die App nichts offline lesen; alle folgenden Offline-Prüfungen sind damit gegenstandslos.`);
      for (const w of ["Offline lesen", "Deep-Link offline", "Inhaltsdaten offline"])
        notiere(G(w), "entfällt", false, "ohne Service-Worker gegenstandslos");
      return;
    }
    notiere(G("Service-Worker"), "vorhanden", true, `isSecureContext=${sw.secure}, ${sw.protokoll}//…`);
    notiere(G("Service-Worker"), "sicherer Kontext", sw.secure,
      sw.secure ? "ja" : "nein — Chromium gibt hier keinen Worker heraus");
    notiere(G("Service-Worker"), "Registrierung aktiv", sw.regs > 0 && sw.controller,
      sw.regs > 0 ? `${sw.regs} Registrierung(en), Seite ${sw.controller ? "wird gesteuert" : "wird NICHT gesteuert"}` : "keine Registrierung");
    const nuvoraCaches = sw.namen.filter((n) => n.startsWith("nuvora"));
    notiere(G("Service-Worker"), "Nuvora-Caches angelegt", nuvoraCaches.length > 0,
      nuvoraCaches.length ? nuvoraCaches.join(", ") : `keine (gefunden: ${sw.namen.join(", ") || "gar nichts"})`);

    // ── Auf die ausgelieferte Fassung zwingen ──
    const wechsel = await swWechselErzwingen(seite);
    const wechselOk = wechsel.reg && !wechsel.fehler && (!wechsel.wartend || wechsel.gewechselt);
    notiere(G("Service-Worker"), "läuft die ausgelieferte Fassung", wechselOk,
      !wechsel.reg ? "keine Registrierung zum Aktualisieren"
        : wechsel.fehler ? `update() fehlgeschlagen: ${wechsel.fehler.slice(0, 80)}`
        : !wechsel.wartend ? "keine wartende Fassung — der laufende Worker ist schon der ausgelieferte"
        : wechsel.gewechselt ? "wartende Fassung gefunden und übernommen (SKIP_WAITING) — die Installation lief vorher auf einer ÄLTEREN"
        : "wartende Fassung gefunden, aber sie übernimmt nicht (kein controllerchange in 20 s) — geprüft würde weiter die alte");

    // ── Taugt die Ablösung überhaupt? ──
    //
    // Meistens gibt es gar keine wartende Fassung, dann laeuft der Zweig oben
    // ins Leere — und ob er funktioniert, wuesste man erst nach dem naechsten
    // Deploy. Also wird hier einmal eine wartende Fassung PROVOZIERT: dieselbe
    // Datei unter anderer Adresse ist fuer den Browser eine neue Fassung und
    // landet im Wartezustand, weil der alte Worker die Seite noch steuert.
    // NUR im Wegwerf-Profil — die Registrierung der Lehrkraft fasst der Test
    // nicht an (main.jsx registriert ohnehin bei jedem Laden wieder "/sw.js").
    if (profil) {
      const wartetProvoziert = await seite.evaluate(async () => {
        const reg = await navigator.serviceWorker.register(`/sw.js?wartetest=${Math.random().toString(36).slice(2)}`);
        for (let i = 0; i < 20 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 500));
        return !!reg.waiting;
      }).catch(() => false);
      const abloesung = wartetProvoziert ? await swWechselErzwingen(seite) : null;
      const ok = wartetProvoziert && abloesung && abloesung.wartend && abloesung.gewechselt;
      notiere(G("Service-Worker"), "wartende Fassung lässt sich ablösen", ok,
        !wartetProvoziert ? "es liess sich keine wartende Fassung erzeugen — der Ablöse-Weg bleibt ungeprüft"
          : ok ? "provoziert, per SKIP_WAITING übernommen (controllerchange) — der Weg oben funktioniert wirklich"
          : "wartende Fassung übernimmt nicht — nach einem Deploy prüfte der Test weiter die alte Fassung");
    }

    // ── Online ein paar Seiten besuchen (das fuellt den Cache) ──
    // /papierkorb wird BEWUSST ausgelassen — das ist gleich der Deep-Link.
    for (const pfad of ["/", "/classes", "/topics"]) {
      await seite.goto(`${URL_BASIS}${pfad}`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
      await tourWegklicken(seite);
    }
    // Die Klasse muss ONLINE sichtbar sein, sonst prueft der Offline-Teil nichts.
    await seite.goto(`${URL_BASIS}/classes`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await tourWegklicken(seite);
    const onlineDa = (await text(seite)).includes(`${MARKE} Klasse`);
    notiere(G("Inhaltsdaten offline"), "Testklasse online sichtbar", onlineDa,
      onlineDa ? "Voraussetzung erfüllt" : "die Klasse steht schon online nicht auf /classes — der Offline-Vergleich sagt dann nichts");
    await warte(1500);  // dem Worker Zeit geben, die Antwort in den Cache zu legen

    // ── Netz kappen ──
    if (!await netzKappen(seite, G)) {
      for (const w of ["Offline lesen", "Deep-Link offline", "Inhaltsdaten offline"])
        notiere(G(w), "entfällt", false, "Verbindung liess sich nicht kappen");
      return;
    }

    // ── Beweis, dass wirklich die AUSGELIEFERTE Fassung antwortet ──
    //
    // Ein controllerchange sagt nur „ein anderer Worker steuert jetzt", nicht
    // welcher. Also wird inhaltlich nachgefragt, an der Stelle, die beide
    // Fassungen unterscheidet: der Navigations-Zweig faellt in der neuen Fassung
    // auf /index.html zurueck, in der alten auf nichts. sw.js behandelt jeden
    // Pfad auf ".html" als Navigation — damit laesst sich das per fetch pruefen,
    // ohne eine echte Navigation (und ohne main.js' Ersatzseite dazwischen).
    // Der Zufallsname kann in keinem Cache liegen.
    const fassung = await seite.evaluate(async () => {
      try {
        const r = await fetch(`/nie-vorhanden-${Math.random().toString(36).slice(2)}.html`);
        if (!r.ok) return { ok: false, wie: `HTTP ${r.status}` };
        const t = await r.text();
        return { ok: /<div id="root"|<!doctype html/i.test(t), wie: `HTTP ${r.status}, ${t.length} Zeichen` };
      } catch (e) { return { ok: false, wie: `Fehler: ${e.message}` }; }
    });
    notiere(G("Service-Worker"), "ausgelieferte Fassung antwortet wirklich", fassung.ok,
      fassung.ok ? `Rückfall auf die Shell greift (${fassung.wie})`
        : `kein Rückfall auf die Shell (${fassung.wie}) — es läuft weiter eine Fassung ohne diesen Zweig`);

    // ── 2. Offline lesen: neu laden, Oberflaeche muss stehen ──
    let fehlerLaden = null;
    await seite.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => { fehlerLaden = kurz(e, 80); });
    await warte(2500);
    const nachReload = await text(seite);
    const shellSteht = !seite.url().startsWith("file:") && nachReload.length > 100 && /Klassen|Module|Profil/.test(nachReload);
    notiere(G("Offline lesen"), "Oberfläche steht nach dem Neuladen", shellSteht,
      shellSteht ? `${nachReload.length} Zeichen, Navigation da`
        : `${seite.url().startsWith("file:") ? "Ersatzseite statt App: " + seite.url() : `${nachReload.length} Zeichen`}${fehlerLaden ? ` (${fehlerLaden})` : ""}`);

    // Der Offline-Hinweis der Shell (main.jsx pollt /api/health alle 5 s).
    let hinweis = false;
    for (let i = 0; i < 8 && !hinweis; i++) {
      hinweis = /Keine Verbindung|Datenbank nicht erreichbar/.test(await text(seite));
      if (!hinweis) await warte(1500);
    }
    notiere(G("Offline lesen"), "Offline-Hinweis sichtbar", hinweis,
      hinweis ? "Balken „Keine Verbindung“" : "kein Hinweis — die Lehrkraft hält veraltete Daten für aktuell");

    // ── 3. Deep-Link offline: Adresse, die online NIE besucht wurde ──
    //
    // Das Zufallsanhaengsel ist Absicht: der Cache-Schluessel ist die volle
    // Adresse, also kann kein frueherer Lauf diese Navigation schon gecacht
    // haben. Geprueft wird damit wirklich der Rueckfall auf die Shell (SPA:
    // index.html kann jede Route rendern), nicht ein Zufallstreffer.
    let deepFehler = null;
    await seite.goto(`${URL_BASIS}/papierkorb?offline-deeplink=${Math.random().toString(36).slice(2)}`,
      { waitUntil: "domcontentloaded", timeout: 45000 }).catch((e) => { deepFehler = kurz(e, 80); });
    await warte(2500);
    const deepText = await text(seite);
    const deepOk = !seite.url().startsWith("file:") && deepText.length > 100 && /Klassen|Module|Profil/.test(deepText);
    notiere(G("Deep-Link offline"), "nie besuchte Seite rendert die Shell", deepOk,
      deepOk ? `${deepText.length} Zeichen`
        : seite.url().startsWith("file:")
          ? `Ersatzseite „${deepText.split("\n")[0]}" statt der App — der Navigations-Zweig in sw.js fällt auf nichts zurück${deepFehler ? ` (${deepFehler})` : ""}`
          : `${deepText.length} Zeichen${deepFehler ? ` (${deepFehler})` : ""}`);

    // ── 4. Echte Inhaltsdaten offline ──
    let datenFehler = null;
    await seite.goto(`${URL_BASIS}/classes`, { waitUntil: "domcontentloaded", timeout: 45000 })
      .catch((e) => { datenFehler = kurz(e, 80); });
    await warte(2500);
    await tourWegklicken(seite);
    const klasseDa = (await text(seite)).includes(`${MARKE} Klasse`);
    notiere(G("Inhaltsdaten offline"), "Klasse nach dem Neuladen noch da", klasseDa,
      klasseDa ? `„${MARKE} Klasse"` : `nicht gefunden${datenFehler ? ` (${datenFehler})` : ""}`);

    // Die Namen stehen im Bearbeiten-Formular; eine Lehrkraft klickt die Klasse
    // dafuer an. Genau das ist der Unterschied zwischen „die Seite rendert" und
    // „meine Daten sind noch da".
    let namen = { a: false, b: false };
    if (klasseDa) {
      await seite.getByRole("button", { name: new RegExp(`${MARKE} Klasse`) }).first().click({ timeout: 8000 }).catch(() => {});
      await warte(1200);
      namen = await seite.evaluate(([a, b]) => {
        const werte = [...document.querySelectorAll("input")].map((i) => i.value).join("") + "" + document.body.innerText;
        return { a: werte.includes(a), b: werte.includes(b) };
      }, [KIND_A, KIND_B]);
    }
    notiere(G("Inhaltsdaten offline"), "beide Namen offline lesbar", namen.a && namen.b,
      namen.a && namen.b ? "beide Kinder da"
        : `gefunden: ${[namen.a ? "Kind Eins" : null, namen.b ? "Kind Zwei" : null].filter(Boolean).join(", ") || "keiner"}`);

    await seite.context().setOffline(false).catch(() => {});
  } finally {
    // Erst wieder online schalten, dann schliessen: sonst bleibt eine
    // gekappte Verbindung an einem Kontext haengen, der gleich stirbt.
    if (seite) await seite.context().setOffline(false).catch(() => {});
    await app.close().catch(() => {});
  }
}

/**
 * 5. Fehlerfall tote Adresse.
 *
 * 127.0.0.1:9 ist der Discard-Port — garantiert tot, ohne Netz zu brauchen.
 * Erwartet wird eine erkennbare deutsche Auskunft MIT Weg zurueck, kein leeres
 * Fenster: ohne eigene Seite steht hinter dem Dialog chrome-error://chromewebdata
 * mit null Zeichen.
 */
async function toteAdresse(exe) {
  const app = await starteApp("http://127.0.0.1:9", exe);
  try {
    const seite = await app.firstWindow();
    dialogeAnnehmen(seite);
    let inhalt = "";
    for (let i = 0; i < 10; i++) {
      inhalt = await text(seite);
      if (inhalt.trim().length > 20) break;
      await warte(1000);
    }
    const leer = inhalt.trim().length === 0;
    notiere("Fehlerfall tote Adresse", "kein leeres Fenster", !leer,
      leer ? `${seite.url()} zeigt null Zeichen` : `${inhalt.trim().length} Zeichen`);
    const deutsch = /nicht erreichen|nicht erreichbar|kein kontakt|keine verbindung|server/i.test(inhalt);
    notiere("Fehlerfall tote Adresse", "deutsche Auskunft", deutsch,
      deutsch ? `„${inhalt.split("\n")[0].slice(0, 60)}"` : `Text sagt nichts über den Grund: „${inhalt.slice(0, 60)}"`);
    // Weg zurueck: ein Knopf zum erneuten Verbinden ODER der Hinweis aufs Menue.
    const knopf = await seite.getByRole("button").count().catch(() => 0);
    const wegZurueck = knopf > 0 || /Server-Adresse ändern|erneut verbinden/i.test(inhalt);
    notiere("Fehlerfall tote Adresse", "Weg zurück angeboten", wegZurueck,
      wegZurueck ? `${knopf} Knopf/Knöpfe, Hinweis auf das Menü` : "keine Bedienmöglichkeit — die Lehrkraft sitzt fest");
  } finally {
    // Der Hinweis-Dialog aus main.js ist modal; ohne Frist haengt close().
    await Promise.race([app.close().catch(() => {}), warte(10000)]);
  }
}

/**
 * Zusammenfassung — hier BEWUSST ungebuendelt (`gruppiert: false`): der Lauf
 * hat unter 40 Zeilen, und jeder Befund traegt eine eigene Erklaerung, die sich
 * nicht mit einer anderen zusammenfassen laesst.
 */
function drucke() {
  const rot = druckeBericht(ergebnisse, { titel: "Desktop-Offline", gruppiert: false });
  process.exit(rot ? 1 : 0);
}

main();
