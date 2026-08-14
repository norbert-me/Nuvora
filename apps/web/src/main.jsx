import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
// Inter lokal gebundelt statt Google Fonts (DSGVO: keine IP-Uebermittlung an Google)
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import { LanguageProvider, useLanguage } from "./i18n/index.jsx";
import { enqueue, classify, newTmp, flush as flushOutbox } from "./core/outbox.js";
// Jeder Speicherzugriff im Rahmen laeuft ueber core/speicher.js: in Safaris
// privatem Modus wirft `localStorage` schon beim Zugriff, und ein Wurf HIER
// (im globalen fetch) haette jeden einzelnen API-Aufruf mitgerissen.
import { lies, liesJson, schreib, schreibJson, loesche, schluessel, speicherNutzbar } from "./core/speicher.js";

// Global fetch interceptor: add auth token to all /api/ requests
const _origFetch = window.fetch;
window.fetch = function(input, init) {
  const url = typeof input === "string" ? input : input?.url;
  if (url && url.startsWith("/api/") && !url.includes("/auth/login") && !url.includes("/auth/register")) {
    const token = lies("token");
    if (token) {
      init = init || {};
      const h = new Headers(init.headers || {});
      if (!h.has("Authorization")) h.set("Authorization", `Bearer ${token}`);
      init = { ...init, headers: h };
    }
  }
  const isApi = url && url.startsWith("/api/");
  // 429 (Rate-Limit) ist meist ein kurzer Engpass: bis zu 3 Versuche mit
  // kleinem Backoff, bevor der Aufrufer den Status sieht — sonst poppen bei
  // kleinen Aussetzern staendig Fehler auf. Netzwerkfehler (throw) gehen direkt
  // in die Offline-Behandlung unten, ohne Retry.
  const withRetry = (n) => _origFetch.call(this, input, init).then((res) => {
    if (isApi && res.status === 429 && n < 2) {
      return new Promise((r) => setTimeout(r, 350 * (n + 1))).then(() => withRetry(n + 1));
    }
    return res;
  });
  return withRetry(0).then((res) => {
    // Server ist erreichbar (auch bei 4xx/5xx) → online.
    // ABER: der Service-Worker beantwortet API-Aufrufe offline aus seinem
    // Zwischenspeicher, und zwar mit HTTP 200. Die waren hier bisher nicht von
    // einer echten Antwort zu unterscheiden — jede gecachte Antwort meldete
    // "online" und loeschte den Offline-Balken wieder weg. Genau der Fall, vor
    // dem der Balken warnen soll: die Lehrkraft liest alte Daten und haelt sie
    // fuer aktuell. Der Worker kennzeichnet solche Antworten deshalb (sw.js).
    if (isApi) {
      const gecacht = res.headers.get("X-Nuvora-Cache");
      window.dispatchEvent(new CustomEvent(gecacht ? "cardvote:offline" : "cardvote:online"));
    }
    // Sliding-Renewal: schickt der Server einen frischen Token, uebernehmen.
    // So bleibt ein aktiver Nutzer angemeldet, statt nach fester Frist rauszufliegen.
    if (isApi) { try { const rt = res.headers.get("X-Refresh-Token"); if (rt) schreib("token", rt); } catch { /* egal */ } }
    if (res.status === 401 && isApi && !url.includes("/auth/")) {
      loesche("token");
      loesche("user");
      location.reload();
    }
    return res;
  }).catch(async (err) => {
    // Netzwerkfehler (Server nicht erreichbar) → offline melden.
    if (isApi) window.dispatchEvent(new CustomEvent("cardvote:offline"));
    // Offline-Outbox (Phase 1): gefahrlose Writes puffern statt zu verlieren.
    // Der Aufrufer bekommt eine synthetische OK-Antwort und macht optimistisch
    // weiter; bei Verbindung wird der Eintrag automatisch nachgespielt.
    const method = (init && init.method) || "GET";
    let bodyObj = null;
    try { bodyObj = init && typeof init.body === "string" ? JSON.parse(init.body) : null; } catch { /* kein JSON */ }
    const kind = isApi ? classify(method, url, bodyObj) : null;
    if (kind) {
      const hdr = { "Content-Type": "application/json", "X-Nuvora-Queued": "1" };
      if (kind === "create") {
        // Behelfs-ID vergeben; die Seite arbeitet optimistisch damit weiter.
        // Beim Sync vergibt der Server die echte ID (siehe outbox.flush).
        const tmp = newTmp();
        await enqueue(method, url, bodyObj, { kind: "create", tmp });
        return new Response(JSON.stringify({ id: tmp, queued: true }), { status: 200, headers: hdr });
      }
      await enqueue(method, url, bodyObj, { kind });
      return new Response(JSON.stringify({ queued: true }), { status: 200, headers: hdr });
    }
    throw err;
  });
};

// Auto-Sync der Outbox: bei echtem Reconnect (window online), beim Start (Reste
// aus der letzten Sitzung) und beim Übergang offline→online, der über die
// API-Aufrufe erkannt wird. flush nutzt den Original-fetch (keine Endlosschleife).
let _wasOffline = false;
const _flush = () => flushOutbox(_origFetch);
window.addEventListener("online", _flush);
window.addEventListener("cardvote:offline", () => { _wasOffline = true; });
window.addEventListener("cardvote:online", () => { if (_wasOffline) { _wasOffline = false; _flush(); } });
setTimeout(_flush, 2000);
import { BrowserRouter, Routes, Route, NavLink, Link, Navigate, useLocation, useNavigate } from "react-router-dom";
// Statisch bleibt nur, was fuer das erste Bild gebraucht wird: Rahmen, Landing,
// Login und die Startseite. Alles andere wuerde beim Start einen Ladezustand
// aufblitzen lassen, ohne dass jemand die Seite ueberhaupt sehen will.
import Login from "./pages/Login.jsx";
import Landing from "./pages/Landing.jsx";
import NuvoraHome from "./pages/NuvoraHome.jsx";
import GuidedTour, { PATH_TOUR, tourFor } from "./components/GuidedTour.jsx";
import { useModules } from "./core/modules.js";
import { istAdmin } from "./core/admin.js";
import { DialogHost } from "./core/dialog.jsx";
import { UndoHost } from "./core/undo.jsx";
import { OutboxHost } from "./core/OutboxHost.jsx";
import { btnPrimary, btnSecondary, btnSmall, Skeleton, Modal, pageForm, pageTitle, pageIntro } from "./components/Icons.jsx";

// Alle uebrigen Seiten kommen erst beim Aufruf ueber die Leitung. Vorher lag
// jedes Modul im selben Bundle: wer nur den Kalender oeffnet, lud auch Scanner,
// Karten und Code-Detektiv (samt @dnd-kit und lzma) mit.
const Dashboard = React.lazy(() => import("./pages/Dashboard.jsx"));
const Session = React.lazy(() => import("./pages/Session.jsx"));
const Scanner = React.lazy(() => import("./pages/Scanner.jsx"));
const Classes = React.lazy(() => import("./pages/Classes.jsx"));
const Kurse = React.lazy(() => import("./pages/Kurse.jsx"));
const Tests = React.lazy(() => import("./pages/Tests.jsx"));
const Evaluation = React.lazy(() => import("./pages/Evaluation.jsx"));
const ClassEvaluation = React.lazy(() => import("./pages/ClassEvaluation.jsx"));
const StudentEvaluation = React.lazy(() => import("./pages/StudentEvaluation.jsx"));
const Profile = React.lazy(() => import("./pages/Profile.jsx"));
const Legal = React.lazy(() => import("./pages/Legal.jsx"));
const Marketplace = React.lazy(() => import("./pages/Marketplace.jsx"));
const ResetPassword = React.lazy(() => import("./pages/ResetPassword.jsx"));
const VerifyEmail = React.lazy(() => import("./pages/VerifyEmail.jsx"));
const ConfirmEmailChange = React.lazy(() => import("./pages/ConfirmEmailChange.jsx"));
const Contact = React.lazy(() => import("./pages/Contact.jsx"));
const Help = React.lazy(() => import("./pages/Help.jsx"));
const Modules = React.lazy(() => import("./pages/Modules.jsx"));
const Topics = React.lazy(() => import("./pages/Topics.jsx"));
const Papierkorb = React.lazy(() => import("./pages/Papierkorb.jsx"));
// Sicherungen: Serververwaltung, KEIN Modul — deshalb kein REGISTRY-Eintrag
// und kein ModuleGate, sondern nur fuer die Administration (Nutzer-ID 1),
// genau wie der Administrationsteil in /profile.
const Backup = React.lazy(() => import("./pages/Backup.jsx"));
const ThemaAnsicht = React.lazy(() => import("./pages/ThemaAnsicht.jsx"));
const LernpfadModule = React.lazy(() => import("./pages/LernpfadModule.jsx"));
const CodeDetektiv = React.lazy(() => import("./codedetektiv/CodeDetektiv.jsx"));
const PublicCd = React.lazy(() => import("./codedetektiv/PublicCd.jsx"));
const Cards = React.lazy(() => import("./pages/Cards.jsx"));
const Tutorial = React.lazy(() => import("./pages/Tutorial.jsx"));
const Auswertung = React.lazy(() => import("./pages/Auswertung.jsx"));
const Lernen = React.lazy(() => import("./pages/Lernen.jsx"));
const Karten = React.lazy(() => import("./pages/Karten.jsx"));
const Kalender = React.lazy(() => import("./pages/Kalender.jsx"));
const Unterrichtsplanung = React.lazy(() => import("./pages/Unterrichtsplanung.jsx"));
const Zufall = React.lazy(() => import("./pages/Zufall.jsx"));
const Orga = React.lazy(() => import("./pages/Orga.jsx"));
// Benannter Export — lazy will ein default, deshalb hier umgehaengt.
const KlassenarbeitVergleich = React.lazy(() => import("./pages/Klassenarbeit.jsx").then((m) => ({ default: m.KlassenarbeitVergleich })));
const Notizbrett = React.lazy(() => import("./pages/Notizbrett.jsx"));
const Notizen = React.lazy(() => import("./pages/Notizen.jsx"));
const Elternlog = React.lazy(() => import("./pages/Elternlog.jsx"));
const Mathefussball = React.lazy(() => import("./pages/Mathefussball.jsx"));
const Tafel = React.lazy(() => import("./pages/Tafel.jsx"));
const NichtGefunden = React.lazy(() => import("./pages/NichtGefunden.jsx"));

// Ladezustand fuer nachgeladene Seiten: dieselben pulsierenden Balken wie beim
// Datenladen — eine Textzeile „laedt…" wuerde die Seite kurz zusammenfallen lassen.
const PageFallback = () => <Skeleton rows={4} height={56} />;

// Seiten werden erst beim Aufruf nachgeladen. Faellt so ein Nachladen aus —
// neue Version ist ausgerollt und die alte Datei gibt es nicht mehr, oder das
// Schul-WLAN hakt kurz —, warf React bisher den ganzen Baum weg: weisse Seite,
// keine Navigation, nichts anklickbar. Die Lehrkraft haette raten muessen, dass
// ein Neuladen hilft.
// Deshalb: einmal automatisch neu laden (danach liegt die neue Datei vor), und
// falls das auch nicht hilft, wenigstens eine Erklaerung mit Knopf zeigen.
class LadeFehler extends React.Component {
  constructor(props) { super(props); this.state = { fehler: null }; }
  static getDerivedStateFromError(fehler) { return { fehler }; }
  componentDidCatch(fehler) {
    // Nur ein fehlgeschlagenes Nachladen rechtfertigt einen Reload — ein echter
    // Fehler in der Seite wuerde sonst in einer Schleife enden.
    const nachladefehler = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(fehler?.message || "");
    let schonProbiert = true;
    try { schonProbiert = sessionStorage.getItem("nuvora_chunk_reload") === "1"; } catch { /* egal */ }
    if (nachladefehler && !schonProbiert) {
      try { sessionStorage.setItem("nuvora_chunk_reload", "1"); } catch { /* egal */ }
      window.location.reload();
    }
  }
  componentDidUpdate(prev) {
    // Andere Seite aufgerufen: nochmal versuchen, statt den Fehler kleben zu lassen.
    if (prev.pfad !== this.props.pfad && this.state.fehler) this.setState({ fehler: null });
  }
  render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <div style={{ padding: "48px 16px", textAlign: "center" }}>
        <p style={{ fontSize: 15, color: "var(--text2)", marginBottom: 16, lineHeight: 1.6 }}>
          Diese Seite konnte nicht geladen werden. Meist liegt es an einer neuen Version oder einer kurzen Netzstörung.
        </p>
        <button onClick={() => { try { sessionStorage.removeItem("nuvora_chunk_reload"); } catch { /* egal */ } window.location.reload(); }} style={btnPrimary}>Neu laden</button>
      </div>
    );
  }
}
// Navigation ist modulbezogen: die Shell zeigt die Punkte des Moduls, in dem
// man gerade ist. Ausserhalb eines Moduls navigiert Nuvora selbst.
const CV = "/cardvote";

// Bereich fuer die kontextsensitive Hilfe aus dem aktuellen Pfad.
function helpArea(pathname) {
  if (pathname.startsWith("/cardvote")) return "cardvote";
  if (pathname.startsWith("/lernpfad")) return "lernpfad";
  if (pathname.startsWith("/auswertung")) return "auswertung";
  if (pathname.startsWith("/unterrichtsplanung")) return "unterrichtsplanung";
  if (pathname.startsWith("/karten")) return "karten";
  if (pathname.startsWith("/kalender")) return "kalender";
  if (pathname.startsWith("/code-detektiv")) return "code-detektiv";
  if (pathname.startsWith("/orga")) return "orga";
  if (pathname.startsWith("/zufall")) return "zufall";
  if (pathname.startsWith("/notizbrett")) return "notizbrett";
  if (pathname.startsWith("/klassenleitung")) return "klassenleitung";
  if (pathname.startsWith("/notizen")) return "notizen";
  if (pathname.startsWith("/tafel")) return "tafel";
  if (pathname.startsWith("/mathespiele")) return "mathespiele";
  return "core";
}
const LP = "/lernpfad";
const AUSW = "/auswertung";
const CD = "/code-detektiv";
const KA = "/karten";
const KAL = "/kalender";
const UPLAN = "/unterrichtsplanung";
const ZUF = "/zufall";
const ORG = "/orga";
const NOTIZBRETT = "/notizbrett";
const NOTIZEN = "/notizen";
const KLASSENLEITUNG = "/klassenleitung";
const MATHEF = "/mathespiele";
const TAFEL = "/tafel";

// Menue passend zum Bereich. Man soll im Modul-Menue bleiben, auch auf
// modulneutralen Seiten (Hilfe, Impressum), solange man aus einem Modul kam —
// dafuer traegt der Hilfe-Link ?area, sonst greift der Pfad.
const getModuleNavItems = (t, location, user) => {
  const { pathname, search } = location;
  const params = new URLSearchParams(search);
  const area = pathname.startsWith(CV) ? "cardvote"
    : pathname.startsWith(LP) ? "lernpfad"
    : pathname.startsWith(AUSW) ? "auswertung"
    : pathname.startsWith(CD) ? "code-detektiv"
    : pathname.startsWith(KAL) ? "kalender"
    : pathname.startsWith(UPLAN) ? "unterrichtsplanung"
    : pathname.startsWith(ZUF) ? "zufall"
    : pathname.startsWith(ORG) ? "orga"
    : pathname.startsWith(NOTIZBRETT) ? "notizbrett"
    : pathname.startsWith(NOTIZEN) ? "notizen"
    : pathname.startsWith(KLASSENLEITUNG) ? "klassenleitung"
    : pathname.startsWith(MATHEF) ? "mathespiele"
    : pathname.startsWith(TAFEL) ? "tafel"
    : pathname.startsWith(KA) ? "karten"
    // Bereich aus der Query (Hilfe, Marktplatz). Der Einstiege-Marktplatz nutzt
    // weiterhin area=methoden — auf die Navbar von „Unterrichtsplanung" mappen.
    : (params.get("area") === "methoden" ? "unterrichtsplanung" : params.get("area"));

  if (area === "cardvote") {
    return [
      { to: `${CV}/questions`, label: t("nav.questions") },
      { to: `${CV}/session`, label: t("nav.session") },
      { to: `${CV}/tests`, label: t("nav.tests") },
      { to: `${CV}/cards`, label: t("nav.cards") },
      { to: `${CV}/marketplace`, label: t("nav.marketplace") },
    ];
  }
  if (area === "lernpfad") {
    // Tabs der eingebetteten App: steuern das iframe per ?tab. Aktiv = tab-Query.
    const cur = params.get("tab") || "aufgaben";
    return [
      { to: `${LP}?tab=aufgaben`, label: t("nav.exercises"), active: cur === "aufgaben" },
      { to: `${LP}?tab=generator`, label: "Lernleiter generieren", active: cur === "generator" },
      { to: `${LP}?tab=lernpfade`, label: "Lernpfade", active: cur === "lernpfade" },
    ];
  }
  if (area === "auswertung") {
    const cur = params.get("tab");
    const verg = pathname.startsWith(`${AUSW}/vergleich`);
    return [
      { to: `${AUSW}?tab=noten`, label: t("auswertung.tabGrades"), active: !verg && cur !== "klassenarbeit" },
      { to: `${AUSW}?tab=klassenarbeit`, label: t("auswertung.tabWorks"), active: !verg && cur === "klassenarbeit" },
      { to: `${AUSW}/vergleich`, label: t("klassenarbeit.navCompare"), active: verg },
    ];
  }
  if (area === "kalender") {
    const cur = params.get("view");
    return [
      { to: KAL, label: t("kalender.title"), active: cur !== "timetable" && cur !== "breaks" && cur !== "klassenarbeit" },
      { to: `${KAL}?view=timetable`, label: t("kalender.timetable"), active: cur === "timetable" },
      { to: `${KAL}?view=breaks`, label: t("kalender.breaksTab"), active: cur === "breaks" },
      { to: `${KAL}?view=klassenarbeit`, label: t("kalender.examsTab"), active: cur === "klassenarbeit" },
    ];
  }
  if (area === "unterrichtsplanung") {
    const markt = pathname.startsWith("/marktplatz");
    return [
      { to: UPLAN, label: t("unterrichtsplanung.tabEinstiege"), active: !markt },
      { to: "/marktplatz?area=methoden&kind=method", label: t("nav.marketplace"), active: markt },
    ];
  }
  if (area === "zufall") {
    const cur = params.get("tab");
    return [
      { to: ZUF, label: t("zufall.navDraw"), active: cur !== "gruppen" },
      { to: `${ZUF}?tab=gruppen`, label: t("zufall.navGroups"), active: cur === "gruppen" },
    ];
  }
  if (area === "notizbrett") {
    const cur = params.get("tab");
    return [
      { to: `${NOTIZBRETT}?tab=notizen`, label: t("notizbrett.tabNotes"), active: cur !== "aufgaben" },
      { to: `${NOTIZBRETT}?tab=aufgaben`, label: t("notizbrett.tabTodos"), active: cur === "aufgaben" },
    ];
  }
  if (area === "notizen") return [{ to: NOTIZEN, label: t("notizen.title") }];
  if (area === "klassenleitung") return [{ to: KLASSENLEITUNG, label: t("klassenleitung.title") }];
  if (area === "mathespiele") return [{ to: MATHEF, label: t("mathefussball.title") }];
  if (area === "tafel") return [{ to: TAFEL, label: t("tafel.title") }];
  if (area === "orga") {
    const tab = params.get("tab");
    const items = [
      { key: "checklisten", to: `${ORG}?tab=checklisten`, label: t("orga.tabChecklists"), active: !["anwesenheit", "ausleihe", "sitzplan", "optionen"].includes(tab) },
      { key: "anwesenheit", to: `${ORG}?tab=anwesenheit`, label: t("anwesenheit.title"), active: tab === "anwesenheit" },
      { key: "ausleihe", to: `${ORG}?tab=ausleihe`, label: t("ausleihe.title"), active: tab === "ausleihe" },
      { key: "sitzplan", to: `${ORG}?tab=sitzplan`, label: t("sitzplan.title"), active: tab === "sitzplan" },
    ];
    // Vom Modul-Zahnrad (Orga-Optionen) ausgeblendete Reiter raus — aber den aktiven
    // nie verstecken, und nie eine leere Leiste erzeugen (Fallback Checklisten).
    let hidden = [];
    try { hidden = JSON.parse(localStorage.getItem("orga_hidden_tabs") || "[]"); } catch { /* egal */ }
    const vis = items.filter((i) => !hidden.includes(i.key) || i.active);
    const list = vis.length ? vis : [items[0]];
    // „Optionen" immer ganz rechts, nie ausblendbar (dort schaltet man die Reiter).
    return [...list, { key: "optionen", to: `${ORG}?tab=optionen`, label: t("orga.tabOptions"), active: tab === "optionen" }];
  }
  if (area === "code-detektiv") {
    // Nativ eingebunden: die Nuvora-Navbar steuert die Bereiche der App direkt.
    // Beim Öffnen (Index) startet die App im Erstellen-Bereich — den heben wir
    // dann auch in der Navbar hervor.
    const p = pathname.replace(/\/$/, "");
    const create = p === CD || p.startsWith(`${CD}/admin`);
    return [
      { to: `${CD}/admin`, label: t("cd.create"), active: create },
      { to: `${CD}/home?join=1`, label: t("cd.join"), active: p.startsWith(`${CD}/home`) },
      { to: `${CD}/solo`, label: t("cd.solo"), active: p.startsWith(`${CD}/solo`) },
    ];
  }
  if (area === "karten") {
    // Tabs der Kartenseite laufen ueber die Nuvora-Navbar (?tab). Auf dem
    // Marktplatz darf KEIN Karten-Tab aktiv sein — sonst leuchtet „Karten".
    const markt = pathname.startsWith("/marktplatz");
    const cur = markt ? null : params.get("tab") || "cards";
    return [
      { to: `${KA}?tab=cards`, label: t("karten.tabCards"), active: cur === "cards" },
      { to: `${KA}?tab=progress`, label: t("karten.tabProgress"), active: cur === "progress" },
      { to: `${KA}?tab=qr`, label: t("karten.tabQr"), active: cur === "qr" },
      { to: "/marktplatz?area=karten&kind=karten_deck", label: t("nav.marketplace"), active: markt },
    ];
  }
  // Kern: der Nuvora-Schriftzug links fuehrt zur Startseite.
  return [
    { to: "/classes", label: t("nav.classes") },
    { to: "/kurse", label: t("kurse.title") },
    { to: "/topics", label: t("nav.topics") },
    { to: "/modules", label: t("nav.modules") },
    // Der Papierkorb ist gemeinsam (Kern) — kein Modul hat einen eigenen.
    { to: "/papierkorb", label: t("nav.trash") },
    // Sicherungen enthalten die Daten ALLER Konten (inkl. DSGVO Art. 9) —
    // nur die Administration sieht den Punkt ueberhaupt. Die Schranke sitzt
    // trotzdem im Server (_require_admin), nicht hier.
    ...(istAdmin(user) ? [{ to: "/backup", label: t("nav.backup") }] : []),
  ];
};

// Ein Modul ist nur erreichbar, wenn es aktiviert ist — sonst waere das
// Register reine Anzeige. Wer eine Modul-Adresse aufruft ohne es aktiviert zu
// haben, landet bei der Modulauswahl statt auf einer kaputten Seite.
function ModuleGate({ moduleKey, children }) {
  const { modules, loading, bekannt } = useModules();
  // Beim ersten Besuch (noch kein Modul-Cache) und auf langsamer Verbindung
  // stand hier ein leerer Bereich unter der Navigation. Dieselben Ladebalken wie
  // beim Nachladen der Seite: die Lehrkraft sieht, dass etwas kommt.
  if (loading) return <PageFallback />;
  // Konnte die Modulliste gar nicht geladen werden, ist "nicht aktiviert" eine
  // Vermutung — und die falsche. Frueher warf ein kurzer 429 oder eine Sekunde
  // ohne Netz die Lehrkraft aus ihrer Modulseite auf /modules, als haette sie
  // das Modul nie eingeschaltet. Lieber ehrlich sagen, dass es klemmt.
  if (!bekannt) return <ModulstandUnklar />;
  const mod = modules.find((m) => m.key === moduleKey);
  if (!mod?.active) return <Navigate to="/modules" replace />;
  return children;
}

function ModulstandUnklar() {
  return (
    <div style={{ ...pageForm, textAlign: "center", padding: "40px 0" }}>
      <h1 style={{ ...pageTitle, marginBottom: 10 }}>Modulliste nicht erreichbar</h1>
      <p style={{ ...pageIntro, marginBottom: 18 }}>
        Ob dieses Modul für dich eingeschaltet ist, lässt sich gerade nicht
        feststellen — die Verbindung zum Server hat nicht geantwortet. Deine
        Einstellungen sind davon nicht betroffen.
      </p>
      <button onClick={() => window.location.reload()} style={btnPrimary}>
        Erneut versuchen
      </button>
    </div>
  );
}

// Ruhige Auskunft statt leerem Bereich: wer ohne Recht auf eine Adresse der
// Administration geht, soll wissen, woran es liegt — und einen Weg zurueck haben.
function NurAdministration() {
  return (
    <div style={{ ...pageForm, textAlign: "center", padding: "40px 0" }}>
      <h1 style={{ ...pageTitle, marginBottom: 10 }}>Nur für die Administration</h1>
      <p style={{ ...pageIntro, marginBottom: 18 }}>
        Dieser Bereich gehört der Administration dieser Installation. Mit deinem
        Konto ist er nicht zugänglich — an deinen eigenen Daten ändert das nichts.
      </p>
      {/* Als Link abgeleitet, nicht neu gebaut: `btnPrimary` ist fuer <button>
          gedacht, ein <a> braucht zusaetzlich inline-block. */}
      <Link to="/" style={{ ...btnPrimary, display: "inline-block", textDecoration: "none" }}>Zur Startseite</Link>
    </div>
  );
}

function ConnectionMonitor() {
  // Startwert aus dem Browser: nach einem Neuladen OHNE Netz gibt es kein
  // "offline"-Ereignis mehr (das feuert nur beim Wechsel), und die erste Probe
  // braucht ihre Zeit. Bis dahin stand der Balken auf "alles gut".
  const [online, setOnline] = useState(navigator.onLine !== false);
  const [reason, setReason] = useState("server"); // "server" | "db"

  const check = async (aliveRef) => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000); // toter Host darf nicht in den langen TCP-Timeout laufen
    try {
      const r = await _origFetch("/api/health", { cache: "no-store", signal: ctrl.signal });
      if (aliveRef && !aliveRef.alive) return;
      // 429 = Server ist da, nur rate-limited — NICHT offline melden (sonst
      // pollt der Monitor schneller und heizt den Sturm weiter an).
      if (r.ok || r.status === 429) { setOnline(true); return; }
      // Server antwortet, aber nicht ok → z.B. Datenbank down (503 db_down)
      let body = {};
      try { body = await r.json(); } catch {}
      setReason(body.status === "db_down" ? "db" : "server");
      setOnline(false);
    } catch {
      if (aliveRef && !aliveRef.alive) return;
      setReason("server");
      setOnline(false);
    } finally {
      clearTimeout(to);
    }
  };

  useEffect(() => {
    const ref = { alive: true };
    check(ref);
    // 30 s statt 5 s, und im verborgenen Tab gar nicht.
    //
    // Solange alles laeuft, sagt diese Abfrage jedes Mal dasselbe — sie ist nur
    // dafuer da, einen Ausfall zu bemerken. Bei 5 s waren das rund 17.000
    // Anfragen je offenem Tab und Tag; ein Kollegium mit einem Dutzend offenen
    // Tabs erzeugte damit dauerhaft Grundlast auf Server und Netz, rund um die
    // Uhr, auch nachts im vergessenen Browserfenster. Einen echten Ausfall
    // meldet ohnehin der erste fehlgeschlagene API-Aufruf sofort (Interceptor
    // oben) — und sobald wir offline sind, prueft der zweite Effekt unten weiter
    // alle 4 s, damit die Rueckkehr schnell auffaellt.
    const iv = setInterval(() => { if (!document.hidden) check(ref); }, 30000);
    // Beim Zurueckkehren in den Tab einmal sofort nachsehen, statt bis zum
    // naechsten Takt einen veralteten Zustand zu zeigen.
    const onVis = () => { if (!document.hidden) check(ref); };
    document.addEventListener("visibilitychange", onVis);
    const goOff = () => { setReason("server"); setOnline(false); };
    const goOn = () => setOnline(true);
    const onBrowserOffline = () => { setReason("server"); setOnline(false); };
    const onBrowserOnline = () => check(ref);
    window.addEventListener("cardvote:offline", goOff);
    window.addEventListener("cardvote:online", goOn);
    window.addEventListener("offline", onBrowserOffline);
    window.addEventListener("online", onBrowserOnline);
    return () => {
      ref.alive = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("cardvote:offline", goOff);
      window.removeEventListener("cardvote:online", goOn);
      window.removeEventListener("offline", onBrowserOffline);
      window.removeEventListener("online", onBrowserOnline);
    };
  }, []);

  // Im Offline-Zustand schneller nachprüfen (bestätigt DB-/Server-Status live)
  useEffect(() => {
    if (online) return;
    const ref = { alive: true };
    const fast = setInterval(() => check(ref), 4000);
    return () => { ref.alive = false; clearInterval(fast); };
  }, [online]);

  // Kein Auto-Reload mehr bei Reconnect: offline getippte Änderungen werden von
  // der Outbox gepuffert und beim Wiederverbinden nachgespielt (siehe _flush /
  // cardvote:online). Ein ganzseitiger Reload riss laufende Eingaben unnötig raus.
  // Der Offline-Banner unten bleibt als Info; er verschwindet, sobald wieder online.

  // Nav-Header per CSS-Variable unter den Offline-Balken schieben (statt zu überdecken)
  useEffect(() => {
    const root = document.documentElement;
    if (!online) root.style.setProperty("--offline-banner-h", "34px");
    else root.style.removeProperty("--offline-banner-h");
    return () => root.style.removeProperty("--offline-banner-h");
  }, [online]);

  if (online) return null;

  const text = reason === "db"
    ? "Datenbank nicht erreichbar — Neuversuch läuft…"
    : "Keine Verbindung — Neuversuch läuft…";

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 200, minHeight: 34,
      background: "#d1350f", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
      padding: "6px 14px", fontSize: 13, fontWeight: 600, textAlign: "center",
      boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
    }}>
      <style>{`@keyframes cmspin{to{transform:rotate(360deg)}}`}</style>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "cmspin 0.9s linear infinite", flexShrink: 0 }}>
        <path d="M21 12a9 9 0 1 1-6.2-8.5"/>
      </svg>
      <span>{text}</span>
    </div>
  );
}

function DarkModeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    schreib("darkMode", String(next));
  };
  return (
    <button onClick={toggle} style={{
      background: "none", border: "none", cursor: "pointer", padding: 6,
      lineHeight: 1, borderRadius: 8, flexShrink: 0, color: "var(--text2)",
    }} title={dark ? "Light Mode" : "Dark Mode"}>
      {dark ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  );
}

function Nav({ user, onLogout }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useLanguage();
  // Re-Render, wenn ein Modul-Zahnrad die sichtbaren Reiter ändert (localStorage).
  const [, setTick] = useState(0);
  useEffect(() => {
    const h = () => setTick((x) => x + 1);
    window.addEventListener("nuvora:settings", h);
    return () => window.removeEventListener("nuvora:settings", h);
  }, []);

  // Geführte Touren: Kern-Tour (Navbar) und je-Modul-Touren. Über ein Event
  // startbar (detail.tour), das Onboarding-Modal/Tutorial dispatchen "kern".
  // Modul-Touren starten zusätzlich einmalig beim ersten Besuch der Modulseite.
  const [tourId, setTourId] = useState(null);
  const doneKey = (id) => (id === "kern" ? "nuvora_kerntour_done" : `nuvora_tour_${id}_done`);
  useEffect(() => {
    const h = (e) => setTourId((e.detail && e.detail.tour) || "kern");
    window.addEventListener("nuvora:start-tour", h);
    return () => window.removeEventListener("nuvora:start-tour", h);
  }, []);
  useEffect(() => {
    if (!user) return;
    const hit = PATH_TOUR.find(([p]) => location.pathname.startsWith(p));
    if (!hit) return;
    const id = hit[1];
    try { if (localStorage.getItem(doneKey(id))) return; } catch { /* egal */ }
    const timer = setTimeout(() => setTourId((cur) => cur || id), 900);
    return () => clearTimeout(timer);
  }, [location.pathname, user]);
  const endTour = () => { const id = tourId; setTourId(null); try { localStorage.setItem(doneKey(id), "1"); } catch { /* egal */ } };

  const navItems = getModuleNavItems(t, location, user);
  const allPages = [...navItems, { to: "/tutorial", label: t("nav.tutorial") }, { to: `${CV}/scan`, label: t("nav.scanner") }, { to: "/profile", label: t("nav.profile") }, { to: `${CV}/evaluation`, label: t("nav.evaluation") }, { to: "/login", label: t("nav.login") }];
  const pageTitle = allPages.find((item) => location.pathname.startsWith(item.to))?.label || "";

  const showNav = !!user;

  return (
    <>
      <style>{`
        @media (max-width: 640px) {
          .nav-links-desktop { display: none !important; }
          .nav-burger { display: flex !important; }
          .nav-profile-name { display: none !important; }
          .nav-page-title { display: block !important; }
          .page-title { display: none !important; }
        }
        @media (min-width: 641px) {
          .nav-links-desktop { display: flex !important; }
          .nav-burger { display: none !important; }
          .nav-profile-name { display: inline !important; }
          .nav-page-title { display: none !important; }
          .nav-mobile-menu { display: none !important; }
        }
      `}</style>
      <nav data-tour="nav" style={{
        padding: "0 16px",
        borderBottom: "1px solid var(--nav-border)",
        background: "var(--nav-bg)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        position: "sticky",
        top: "var(--offline-banner-h, 0px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        height: 52,
        gap: 4,
      }}>
        <NavLink to="/" data-tour="home" onClick={() => setMenuOpen(false)} style={{ textDecoration: "none", flexShrink: 0 }}>
          <div style={{
            fontWeight: 700,
            fontSize: 20,
            marginRight: 8,
            color: "var(--text)",
            letterSpacing: "-0.5px",
          }}>
            Nuvora
          </div>
        </NavLink>

        {showNav && (
          <button
            className="nav-burger"
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              display: "none", background: "none", border: "none", cursor: "pointer",
              padding: 6, fontSize: 20, color: "var(--text)", lineHeight: 1, borderRadius: 8,
            }}
          >
            {menuOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            )}
          </button>
        )}

        {showNav && (
          <span className="nav-page-title" style={{
            display: "none", fontSize: 15, fontWeight: 600, color: "var(--text)",
            flex: 1, textAlign: "center",
          }}>
            {pageTitle}
          </span>
        )}

        <div data-tour="modules" className={showNav ? "nav-links-desktop" : ""} style={{ display: showNav ? "flex" : "block", gap: 2, overflow: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", msOverflowStyle: "none", flex: 1, minWidth: 0, marginLeft: 8 }}>
          {showNav && navItems.map((item) => {
            const isActive = item.active !== undefined ? item.active : location.pathname.startsWith(item.to.split("?")[0]) && !item.to.includes("?");
            return (
              <NavLink
                key={item.to}
                to={item.to}
                style={{
                  padding: "6px 12px",
                  borderRadius: 980,
                  textDecoration: "none",
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? "var(--text)" : "var(--text2)",
                  background: isActive ? "var(--bg2)" : "transparent",
                  transition: "all 0.2s ease",
                  letterSpacing: "-0.1px",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {item.label}
              </NavLink>
            );
          })}
        </div>

        <DarkModeToggle />
        <NavLink to={user ? "/profile" : "/login"} data-tour="profile" onClick={() => { setMenuOpen(false); if (!user) window.dispatchEvent(new Event("cardvote:reset-login-mode")); }} style={{
          padding: 6,
          borderRadius: 980,
          textDecoration: "none",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--text2)",
          background: "transparent",
          whiteSpace: "nowrap",
          flexShrink: 0,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
          </svg>
          <span className="nav-profile-name">{user ? t("nav.profile") : t("nav.login")}</span>
        </NavLink>
      </nav>

      {showNav && menuOpen && (
        <div className="nav-mobile-menu" style={{
          position: "fixed", top: 52, left: 0, right: 0, bottom: 0, zIndex: 99,
          background: "var(--nav-bg)", backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          padding: "8px 16px",
        }}>
          {navItems.map((item) => {
            const isActive = item.active !== undefined ? item.active : location.pathname.startsWith(item.to.split("?")[0]) && !item.to.includes("?");
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                style={{
                  display: "block", padding: "14px 16px", borderRadius: 12,
                  textDecoration: "none", fontSize: 17, fontWeight: isActive ? 700 : 500,
                  color: isActive ? "var(--text)" : "var(--text2)",
                  background: isActive ? "var(--bg2)" : "transparent",
                  marginBottom: 2,
                }}
              >
                {item.label}
              </NavLink>
            );
          })}
        </div>
      )}
      {tourId && user && tourFor(tourId) && <GuidedTour steps={tourFor(tourId)} t={t} onDone={endTour} />}
    </>
  );
}

const footerLink = { color: "var(--text3)", textDecoration: "none", whiteSpace: "nowrap" };
const footerSep = { color: "var(--text3)" };

function ContentWrapper({ children }) {
  const location = useLocation();
  const p = location.pathname;
  // Die Live-Session laeuft voll ueber die Breite (Beamer). Alles andere ist
  // einheitlich zentriert — dieselbe Spaltenbreite auf jeder Seite, damit die
  // Oberflaeche nicht je Modul anders links klebt.
  const isSession = p.startsWith("/session") || p.startsWith("/cardvote/session");
  if (isSession) return <div style={{ padding: "24px 16px 64px" }}>{children}</div>;
  // Code-Detektiv laeuft ohne Nuvora-Navbar im Vollbild — kein Padding, keine
  // Spaltenbreite, damit das Spiel den ganzen Platz nutzt.
  if (p.startsWith(CD)) return children;
  return (
    <>
      <style>{`@media (max-width: 640px) { .content-wrap { padding: 16px 12px 64px !important; } }`}</style>
      <div className="content-wrap" style={{ padding: "32px 32px 64px", maxWidth: 1080, margin: "0 auto" }}>{children}</div>
    </>
  );
}

// Einmaliges Willkommen nach dem allerersten Login. Merkt sich pro Konto im
// Browser, dass es gezeigt wurde — danach nie wieder.
function FirstRun({ user }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const key = `nuvora_onboarded_${user?.id ?? "x"}`;
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (!user) return;
    try { if (!localStorage.getItem(key)) setShow(true); } catch { /* egal */ }
  }, [user, key]);

  const done = (go) => {
    try { localStorage.setItem(key, "1"); } catch { /* egal */ }
    setShow(false);
    if (go) navigate(go);
  };
  if (!show) return null;

  // „Tour" startet die geführte Kern-Tour direkt hier (Spotlight über die Navbar),
  // statt auf die Tutorial-Seite zu springen.
  const startGuided = () => { done(); setTimeout(() => window.dispatchEvent(new Event("nuvora:start-tour")), 60); };

  return (
    // Der allererste Dialog einer neuen Lehrkraft — deshalb ueber dieselbe
    // Modal-Komponente wie alle anderen: Fokus faengt darin, Escape schliesst,
    // der Hintergrund scrollt nicht.
    <Modal onClose={() => done()} width={440} title={t("onboard.title")} titleStyle={{ fontSize: 20, marginBottom: 8 }}
      style={{ borderRadius: 20, padding: 28 }} overlayStyle={{ zIndex: 300 }}>
      <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6, marginBottom: 20 }}>{t("onboard.text")}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={startGuided} style={btnPrimary}>{t("onboard.tour")}</button>
        <button onClick={() => done("/help")} style={btnSecondary}>{t("onboard.help")}</button>
        <button onClick={() => done()} style={{ ...btnSecondary, marginLeft: "auto" }}>{t("onboard.later")}</button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 14 }}>{t("onboard.note")}</p>
    </Modal>
  );
}

function AppRoutes({ user, setUser, logout }) {
  const location = useLocation();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const handleLogin = (u) => {
    setUser(u);
    navigate("/");
  };

  return (
    <>
      <Nav user={user} onLogout={logout} />
      {user && <FirstRun user={user} />}
      <ContentWrapper>
        <LadeFehler pfad={location.pathname}>
        <React.Suspense fallback={<PageFallback />}>
        <Routes>
          {/* ─── Nuvora-Rahmen ─── */}
          <Route path="/" element={user ? <NuvoraHome user={user} /> : <Landing />} />
          <Route path="/modules" element={user ? <Modules /> : <Landing />} />
          <Route path="/classes" element={user ? <Classes /> : <Landing />} />
          <Route path="/kurse" element={user ? <Kurse /> : <Landing />} />
          <Route path="/topics" element={user ? <Topics /> : <Landing />} />
          <Route path="/papierkorb" element={user ? <Papierkorb /> : <Landing />} />
          {/* Der Navigationspunkt war bereits auf die Administration beschraenkt,
              die Route nicht: jede Lehrkraft sah eine Seite voller Absagen der
              API. Dieselbe Quelle (`istAdmin`) entscheidet jetzt beides. */}
          <Route path="/backup" element={user ? (istAdmin(user) ? <Backup /> : <NurAdministration />) : <Landing />} />
          <Route path="/thema/:id" element={user ? <ThemaAnsicht /> : <Landing />} />
          <Route path="/login" element={user ? <NuvoraHome user={user} /> : <Login onLogin={handleLogin} />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/confirm-email-change" element={<ConfirmEmailChange />} />
          <Route path="/profile" element={user ? <Profile user={user} onLogout={logout} onUserUpdate={setUser} /> : <Landing />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/help" element={<Help />} />

          {/* ─── Modul Noten ─── */}
          <Route path={AUSW} element={user ? <ModuleGate moduleKey="auswertung"><Auswertung /></ModuleGate> : <Landing />} />

          {/* ─── Modul Karten ─── */}
          <Route path={KA} element={user ? <ModuleGate moduleKey="karten"><Karten /></ModuleGate> : <Landing />} />
          <Route path={KAL} element={user ? <ModuleGate moduleKey="kalender"><Kalender /></ModuleGate> : <Landing />} />
          <Route path={UPLAN} element={user ? <ModuleGate moduleKey="unterrichtsplanung"><Unterrichtsplanung /></ModuleGate> : <Landing />} />
          <Route path={ZUF} element={user ? <ModuleGate moduleKey="zufall"><Zufall /></ModuleGate> : <Landing />} />
          <Route path={NOTIZBRETT} element={user ? <ModuleGate moduleKey="notizbrett"><Notizbrett /></ModuleGate> : <Landing />} />
          <Route path={NOTIZEN} element={user ? <ModuleGate moduleKey="notizen"><Notizen /></ModuleGate> : <Landing />} />
          <Route path={KLASSENLEITUNG} element={user ? <ModuleGate moduleKey="klassenleitung"><Elternlog /></ModuleGate> : <Landing />} />
          <Route path={MATHEF} element={user ? <ModuleGate moduleKey="mathespiele"><Mathefussball /></ModuleGate> : <Landing />} />
          <Route path={TAFEL} element={user ? <ModuleGate moduleKey="tafel"><Tafel /></ModuleGate> : <Landing />} />
          <Route path={`${AUSW}/vergleich`} element={user ? <ModuleGate moduleKey="auswertung"><KlassenarbeitVergleich /></ModuleGate> : <Landing />} />
          <Route path={ORG} element={user ? <ModuleGate moduleKey="orga"><Orga /></ModuleGate> : <Landing />} />

          {/* ─── Modul Code-Detektiv ─── */}
          <Route path={`${CD}/*`} element={user ? <ModuleGate moduleKey="code-detektiv"><CodeDetektiv /></ModuleGate> : <Landing />} />

          {/* ─── Modul Lernpfad ─── */}
          {/* Die App laeuft eingebettet (siehe LernpfadModule) — nicht in React
              nachgebaut. Ihre eigene Navigation bleibt darin erhalten. */}
          <Route path={LP} element={user ? <ModuleGate moduleKey="lernpfad"><LernpfadModule /></ModuleGate> : <Landing />} />

          {/* ─── Modul CardVote ─── */}
          <Route path={CV} element={user ? <Navigate to={`${CV}/questions`} replace /> : <Landing />} />
          <Route path={`${CV}/questions`} element={user ? <ModuleGate moduleKey="cardvote"><Dashboard /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/session`} element={user ? <ModuleGate moduleKey="cardvote"><Session /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/session/:id`} element={user ? <ModuleGate moduleKey="cardvote"><Session /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/tests`} element={user ? <ModuleGate moduleKey="cardvote"><Tests /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/evaluation/:id`} element={user ? <ModuleGate moduleKey="cardvote"><Evaluation /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/class-evaluation/:id`} element={user ? <ModuleGate moduleKey="cardvote"><ClassEvaluation /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/student-evaluation/:classId/:cardId`} element={user ? <ModuleGate moduleKey="cardvote"><StudentEvaluation /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/scan`} element={user ? <ModuleGate moduleKey="cardvote"><Scanner /></ModuleGate> : <Landing />} />
          <Route path="/tutorial" element={user ? <Tutorial /> : <Landing />} />
          <Route path={`${CV}/cards`} element={user ? <ModuleGate moduleKey="cardvote"><Cards /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/marketplace`} element={user ? <ModuleGate moduleKey="cardvote"><Marketplace fixedKind="cardvote_questionset" /></ModuleGate> : <Landing />} />
          {/* Marktplatz teilt Quizze, Karten und Einstiege — modulübergreifend, nur Login nötig. */}
          <Route path="/marktplatz" element={user ? <Marketplace /> : <Landing />} />

          {/* Alte CardVote-Adressen (Lesezeichen, Links in Mails) umleiten. */}
          <Route path={`${CV}/classes`} element={<Navigate to="/classes" replace />} />
          {["questions", "session", "tests", "scan", "marketplace"].map((p) => (
            <Route key={p} path={`/${p}/*`} element={<Navigate to={`${CV}/${p}${location.search}`} replace />} />
          ))}

          {/* Alles, was keine Route oben getroffen hat: eigene 404-Seite statt
              Navigation ueber einer leeren Flaeche. Steht bewusst ganz unten —
              die oeffentlichen Wege (/lernen/:token, /cd/:code) liegen ausserhalb
              dieses Routers und werden davon nicht beruehrt. */}
          <Route path="*" element={<NichtGefunden user={user} />} />
        </Routes>
        </React.Suspense>
        </LadeFehler>
      </ContentWrapper>
      <footer style={{ textAlign: "center", padding: "16px 0 24px", fontSize: 12, color: "var(--text3)" }}>
        {/* Rueckmeldungs-Hinweis: stand frueher nur auf der Landing- und der
            CardVote-Startseite. In der Fussleiste laeuft er auf jeder Seite mit. */}
        <p style={{ margin: "0 auto 12px", lineHeight: 1.6, padding: "0 16px" }}>
          {t("home.contribute").split("{{link}}")[0]}
          <Link to="/contact" style={{ color: "var(--accent)", textDecoration: "none" }}>{t("footer.contact")}</Link>
          {t("home.contribute").split("{{link}}")[1]}
        </p>
        {/* Auf schmalen Bildschirmen brach "Impressum & Datenschutz" mitten im
            Link um und las sich wie zwei Eintraege — es ist aber eine Seite.
            Deshalb umbruchfest, und die Trenner duerfen umbrechen statt der
            Beschriftungen. Kontakt steht vor den Rechtsseiten: er wird
            haeufiger gebraucht. */}
        <span style={{ display: "inline-flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "0 8px", padding: "0 16px" }}>
          <Link to={`/help?area=${helpArea(location.pathname)}`} style={footerLink}>{t("footer.help")}</Link>
          <span style={footerSep}>·</span>
          <Link to="/tutorial" style={footerLink}>Tutorial</Link>
          <span style={footerSep}>·</span>
          <Link to="/contact" style={footerLink}>{t("footer.contact")}</Link>
          <span style={footerSep}>·</span>
          <Link to="/legal" style={footerLink}>{t("footer.legal")}</Link>
          <span style={footerSep}>·</span>
          <a href="https://github.com/norbert-me/Nuvora" target="_blank" rel="noopener noreferrer" style={footerLink}>GitHub</a>
        </span>
      </footer>
    </>
  );
}

// Eine neue Fassung liegt fertig im Browser, darf aber erst nach dem Neuladen
// uebernehmen — sonst risse sie laufende Eingaben raus. Deshalb nur eine
// schmale Leiste unten statt eines Modals: wer gerade arbeitet, arbeitet weiter.
function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const regRef = useRef(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let alive = true;
    const offer = (reg) => {
      // Ohne bisherigen Controller ist es die Erstinstallation, kein Update.
      if (!navigator.serviceWorker.controller) return;
      regRef.current = reg;
      if (alive) setReady(true);
    };
    navigator.serviceWorker.ready.then((reg) => {
      if (!reg) return;
      if (reg.waiting) offer(reg);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => { if (sw.state === "installed") offer(reg); });
      });
    }).catch(() => { /* egal */ });
    return () => { alive = false; };
  }, []);

  if (!ready) return null;

  const reload = () => {
    // Der wartende Worker uebernimmt erst auf Zuruf; sobald er das Ruder hat,
    // laedt die Seite genau einmal neu (controllerchange).
    const sw = regRef.current?.waiting;
    let done = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!done) { done = true; location.reload(); } });
    if (sw) sw.postMessage({ type: "SKIP_WAITING" });
    // Kein wartender Worker (schon aktiv): direkt neu laden.
    else { done = true; location.reload(); }
    setTimeout(() => { if (!done) { done = true; location.reload(); } }, 1500);
  };

  return (
    <div style={{
      position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 250,
      maxWidth: 460, margin: "0 auto",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      padding: "10px 14px", borderRadius: 14,
      background: "var(--card)", border: "1px solid var(--border)",
      boxShadow: "0 6px 24px rgba(0,0,0,0.14)",
      fontSize: 13, color: "var(--text2)",
    }}>
      <span style={{ flex: 1, minWidth: 160 }}>Eine neue Version steht bereit.</span>
      <button onClick={reload} style={{ ...btnPrimary, ...btnSmall }}>Neu laden</button>
      <button onClick={() => setReady(false)} style={{ ...btnSecondary, ...btnSmall }}>Später</button>
    </div>
  );
}

/**
 * Hinweisstreifen, wenn der Browser nichts speichern darf.
 *
 * Safari im privaten Modus (und blockierte Website-Daten) lassen `localStorage`
 * werfen. Nuvora arbeitet dann weiter — der Token liegt im Arbeitsspeicher und
 * traegt die Sitzung, solange der Tab offen bleibt. Was NICHT geht, ist
 * angemeldet zu bleiben: nach dem Neuladen ist alles weg. Genau das steht hier,
 * ohne Fachbegriffe und mit einem Weg heraus. Ohne diesen Streifen wuerde die
 * Lehrkraft beim naechsten Neuladen ein zweites Mal ueberrascht.
 */
function SpeicherHinweis() {
  const { t } = useLanguage();
  const [gesperrt, setGesperrt] = useState(() => !speicherNutzbar());
  const [weg, setWeg] = useState(false);

  useEffect(() => {
    // Die Anmeldung meldet sich, falls das Ablegen erst dort auffliegt.
    const merken = () => setGesperrt(true);
    window.addEventListener("nuvora:speicher-gesperrt", merken);
    return () => window.removeEventListener("nuvora:speicher-gesperrt", merken);
  }, []);

  if (!gesperrt || weg) return null;

  return (
    <div role="status" style={{
      position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 260,
      maxWidth: 520, margin: "0 auto",
      display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap",
      padding: "12px 14px", borderRadius: 14,
      background: "var(--card)", border: "1px solid var(--border)",
      boxShadow: "0 6px 24px rgba(0,0,0,0.14)",
      fontSize: 13, color: "var(--text2)", lineHeight: 1.5,
    }}>
      <span style={{ flex: 1, minWidth: 200 }}>
        <strong style={{ color: "var(--text)" }}>{t("speicher.titel")}</strong>{" "}
        {t("speicher.text")}
      </span>
      <button onClick={() => setWeg(true)} style={{ ...btnSecondary, ...btnSmall }}>{t("speicher.verstanden")}</button>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(() => liesJson("user"));
  // Token beim Laden gegen den Server prüfen: localStorage allein beweist nichts
  // (abgelaufen, widerrufen, manuell gesetzt). Erst wenn /auth/me den Token
  // bestätigt, gilt der Nutzer als eingeloggt — bis dahin keine geschützte Seite.
  const hasToken = !!lies("token");
  const [checking, setChecking] = useState(hasToken);

  useEffect(() => {
    if (!hasToken) { setChecking(false); return; }
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (!alive) return;
        if (u) { setUser(u); schreibJson("user", u); }
        else { loesche("token"); loesche("user"); setUser(null); }
      })
      .catch(() => { /* offline: Interceptor kickt bei 401, sonst optimistisch */ })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []); // eslint-disable-line

  const logout = () => {
    loesche("token");
    loesche("user");
    // Zwischengespeicherte Kerndaten des Nutzers loeschen (kein Rest fuer den
    // naechsten Login am selben Browser).
    schluessel("nuvora_cache_").forEach(loesche);
    setUser(null);
  };

  // Solange der Token noch gegen /auth/me geprüft wird, keine geschützte Seite
  // zeigen (checking ist nur bei vorhandenem Token true).
  if (checking) return null;

  return (
    <LanguageProvider>
      <BrowserRouter>
        <ConnectionMonitor />
        <DialogHost />
        <UndoHost />
        <OutboxHost />
        <UpdateBanner />
        <SpeicherHinweis />
        {/* Die beiden oeffentlichen Seiten liegen ausserhalb des Rahmens und
            brauchen deshalb ihre eigene Ladehuelle. */}
        <LadeFehler>
          <React.Suspense fallback={<div style={{ padding: "32px 16px" }}><PageFallback /></div>}>
            <Routes>
              {/* Kartenlernen der Schueler: oeffentlich, ohne Login, ueber Token. */}
              <Route path="/lernen/:token" element={<Lernen />} />
              {/* Code-Detektiv: öffentliches Beitreten der Schüler ohne Login. */}
              <Route path="/cd/:code/*" element={<PublicCd />} />
              <Route path="/*" element={<AppRoutes user={user} setUser={setUser} logout={logout} />} />
            </Routes>
          </React.Suspense>
        </LadeFehler>
      </BrowserRouter>
    </LanguageProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    // Ein Tab bleibt oft tagelang offen. Ohne Nachfrage merkt er von einem
    // Deploy nichts; beim Zurueckwechseln pruefen wir deshalb einmal nach.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  }).catch(() => {});
}
