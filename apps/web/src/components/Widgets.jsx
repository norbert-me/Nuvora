// Widgets der Startseite — kleine Ansichten, die zeigen statt zu verlinken.
//
// Der Unterschied zur Kachel ist der ganze Punkt: eine Kachel sagt „hier geht
// es zum Kalender", ein Widget sagt „heute ist Sommerferien". Deshalb kann man
// je Modul beides haben, eins von beiden oder keins — und deshalb stand hier
// vorher ein Widerspruch: der Kalender war Widget UND Kachel, doppelt auf
// derselben Seite, ohne dass man eins davon loswerden konnte.
//
// Regel 3 gilt auch hier: jedes Widget nennt sein Modul, und die Startseite
// zeigt nur die, deren Modul läuft. Ein Widget, das ins Leere zeigt, ist
// schlimmer als keins.
//
// Wer eins ergänzt, trägt es in WIDGETS ein — mehr ist nicht nötig; die
// Startseite und der Bearbeiten-Bereich zählen die Liste zur Laufzeit durch.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { COLORS as C, cardStyle, chipStyle, Icon, ICONS, linkBtn, Skeleton } from "./Icons.jsx";
import { hol } from "../core/melden.js";
import { ymd } from "../core/datum.js";
import { useLanguage } from "../i18n/index.jsx";

// ── Platz fuer ein Widget, bevor es da ist ──
// Die Widgets holen ihre Daten selbst und zeichneten bis dahin NICHTS: beim Laden der Startseite
// sprang jede Kachel erst auf, und alles darunter rutschte mit. Dieser Rahmen merkt sich, wie hoch
// das Widget beim letzten Mal war (localStorage, je Geraet), und haelt genau diesen Platz frei —
// mit einem Skeleton darin, bis der Inhalt da ist. War es beim letzten Mal leer (Hoehe 0), bleibt
// auch jetzt kein Platz stehen: dann springt nichts, denn es kommt auch nichts.
// Beim allerersten Besuch gibt es noch keine Erinnerung; dort bleibt alles wie vorher, danach springt nichts mehr.
const HOEHE_KEY = (id) => `nuvora_widget_h_${id}`;
const gemerkteHoehe = (id) => {
  try { const v = localStorage.getItem(HOEHE_KEY(id)); return v == null ? null : Number(v); } catch { return null; }
};
const LEER_NACH_MS = 2500; // so lange gilt „null Hoehe" noch als „laedt", erst danach als „leer"

export function WidgetPlatz({ id, children, abstand = 16 }) {
  const innen = useRef(null);
  const [h, setH] = useState(() => gemerkteHoehe(id));   // zuletzt bekannte Hoehe, null = unbekannt
  const [inhalt, setInhalt] = useState(false);           // ist der Inhalt da?
  const [abgelaufen, setAbgelaufen] = useState(false);   // Wartezeit fuer „leer" vorbei

  useEffect(() => { const z = setTimeout(() => setAbgelaufen(true), LEER_NACH_MS); return () => clearTimeout(z); }, []);

  useLayoutEffect(() => {
    const el = innen.current;
    if (!el) return undefined;
    let timer = null;
    const messen = () => {
      const nh = Math.round(el.offsetHeight);
      setInhalt(nh > 0);
      clearTimeout(timer);
      // Entprellt: eine Kachel waehrend des Aufbaus nicht bei jedem Zwischenstand merken.
      timer = setTimeout(() => {
        if (nh > 0) { try { localStorage.setItem(HOEHE_KEY(id), String(nh + abstand)); } catch { /* egal */ } }
      }, 400);
    };
    messen();
    const beob = new ResizeObserver(messen);
    beob.observe(el);
    return () => { clearTimeout(timer); beob.disconnect(); };
  }, [id, abstand]);

  // Leer gemeldet: Hoehe 0 erinnern, sobald die Wartezeit um ist und noch immer nichts kam.
  useEffect(() => {
    if (abgelaufen && !inhalt) { try { localStorage.setItem(HOEHE_KEY(id), "0"); } catch { /* egal */ } }
  }, [abgelaufen, inhalt, id]);

  // Platz halten, solange der Inhalt fehlt — und nur, wenn beim letzten Mal einer da war.
  // Ohne Erinnerung (erster Besuch) wird nichts geraten: ein falsch geschaetzter Platz springt genauso.
  const reserviert = !inhalt && !abgelaufen && h != null && h > 0;
  const platz = h ?? 0;
  // EIN Container: das Skeleton liegt HINTER dem Inhalt (absolut), nicht davor. Lagen beide
  // untereinander, standen sie einen Frame lang zusammen da — genau der Sprung, den es zu
  // vermeiden gilt. Der Inhalt deckt das Skeleton ab, sobald er etwas zeichnet.
  return (
    <div style={{ position: "relative", minHeight: reserviert ? platz : undefined }}>
      {reserviert && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: abstand }} aria-hidden="true">
          <div style={{ ...cardStyle, padding: 16, height: "100%", boxSizing: "border-box", overflow: "hidden" }}>
            <Skeleton rows={Math.max(1, Math.floor((platz - abstand - 32) / 40))} height={28} gap={12} />
          </div>
        </div>
      )}
      <div ref={innen} style={{ position: "relative" }}>{children}</div>
    </div>
  );
}

// Gemeinsamer Rahmen: Überschrift mit Weg ins Modul, darunter der Inhalt.
// Ohne den hätte jedes Widget seinen eigenen Kasten erfunden — genau das, was
// bei den Werkzeugleisten schon einmal passiert ist.
export function WidgetKarte({ titel, zu, zuLabel, children, leer }) {
  return (
    <div style={{ ...cardStyle, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 700, flex: 1, minWidth: 0 }}>{titel}</span>
        {zu && (
          <Link to={zu} style={{ ...linkBtn, textDecoration: "none", fontSize: 13, whiteSpace: "nowrap" }}>
            {zuLabel} →
          </Link>
        )}
      </div>
      {children || <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{leer}</p>}
    </div>
  );
}

const zeile = {
  display: "flex", alignItems: "center", gap: 10, padding: "7px 0",
  borderTop: "1px solid var(--border)", fontSize: 14, color: "var(--text)",
  textDecoration: "none",
};

// ── Nächste Klassenarbeit ──
// Die Übersicht rechnet ohnehin schon, wie viele Stunden bis dahin bleiben —
// das ist die Zahl, die man morgens wissen will, und dafür soll man nicht in
// einen Reiter wechseln müssen.
function NaechsteArbeit() {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  useEffect(() => { hol("/api/kalender/klassenarbeiten/uebersicht").then((d) => setRows(Array.isArray(d) ? d : [])); }, []);
  if (rows === null) return null;
  const naechste = rows.slice(0, 3);
  return (
    <WidgetKarte titel={t("widget.arbeit")} zu="/kalender?view=klassenarbeit" zuLabel={t("widget.zumPlan")}
      leer={t("widget.arbeitLeer")}>
      {naechste.length > 0 && (
        <div>
          {naechste.map((e) => (
            <Link key={e.id} to="/kalender?view=klassenarbeit" style={zeile}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.kurs || e.klasse || "—"}{e.title ? ` · ${e.title}` : ""}
              </span>
              <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>
                {new Date(e.date).toLocaleDateString()}
              </span>
              {/* Die Reststunden sind der eigentliche Befund: „in 3 Wochen"
                  sagt weniger als „noch 4 Stunden". */}
              <span style={{ ...chipStyle, fontWeight: 700, color: e.stunden <= 2 ? C.danger : "var(--text2)" }}>
                {t("widget.arbeitStunden", { n: e.stunden })}
              </span>
            </Link>
          ))}
        </div>
      )}
    </WidgetKarte>
  );
}

// ── Offene Aufgaben ──
function OffeneTodos() {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  useEffect(() => { hol("/api/todo").then((d) => setRows(Array.isArray(d) ? d : [])); }, []);
  if (rows === null) return null;
  const heute = ymd(new Date());
  const inEinerWoche = ymd(new Date(Date.now() + 7 * 86400000));
  // Fällige zuerst, dann der Rest — und höchstens fünf: eine Liste, die man
  // scrollen muss, liest morgens niemand.
  const offen = rows.filter((x) => !x.done)
    .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"))
    .slice(0, 5);
  return (
    // Beide Wege fuehren auf den Reiter AUFGABEN, nicht auf die Notizen: das
    // Widget zeigt offene Aufgaben, und wer darauf klickt, will sie abhaken —
    // bisher landete er auf den Notizzetteln und musste noch einmal wechseln.
    <WidgetKarte titel={t("widget.todo")} zu="/notizbrett?tab=aufgaben" zuLabel={t("notizbrett.tabTodos")}
      leer={t("widget.todoLeer")}>
      {offen.length > 0 && (
        <div>
          {offen.map((x) => {
            // Dieselbe Ampel wie auf der Aufgabenseite (pages/Todo.jsx): vorbei
            // = rot, innerhalb einer Woche = gelb, sonst neutral. Zwei Regeln
            // fuer dasselbe Datum hiessen, dass der Punkt hier anders aussieht
            // als dort, wo man ihn abhakt.
            const faellig = x.due_date && x.due_date < heute;
            const bald = x.due_date && !faellig && x.due_date <= inEinerWoche;
            const farbe = faellig ? C.danger : bald ? C.warning : "var(--text3)";
            return (
              <Link key={x.id} to="/notizbrett?tab=aufgaben" style={zeile}>
                <Icon d={ICONS.check} size={14} color={farbe} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.text}</span>
                {x.due_date && (
                  <span style={{ fontSize: 12, color: farbe, whiteSpace: "nowrap" }}>
                    {new Date(x.due_date).toLocaleDateString()}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </WidgetKarte>
  );
}

// ── Notizbrett ──
function Notizen() {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  useEffect(() => { hol("/api/notizblock").then((d) => setRows(Array.isArray(d) ? d : [])); }, []);
  if (rows === null) return null;
  const drei = rows.slice(0, 3);
  return (
    <WidgetKarte titel={t("widget.notiz")} zu="/notizbrett" zuLabel={t("widget.zumNotizbrett")}
      leer={t("widget.notizLeer")}>
      {drei.length > 0 && (
        <div>
          {drei.map((n) => (
            <Link key={n.id} to="/notizbrett" style={{ ...zeile, alignItems: "flex-start", flexDirection: "column", gap: 2 }}>
              {n.title && <span style={{ fontWeight: 600 }}>{n.title}</span>}
              {/* Nur die erste Zeile: das Brett ist der Ort zum Lesen, das
                  Widget der Ort zum Erinnern, dass da etwas steht. */}
              <span style={{ fontSize: 13, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                {(n.content || "").split("\n")[0] || t("widget.notizOhneText")}
              </span>
            </Link>
          ))}
        </div>
      )}
    </WidgetKarte>
  );
}

// ── Ausleihe: was ist noch draußen? ──
function Ausleihe() {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  useEffect(() => { hol("/api/ausleihe/loans?open=true").then((d) => setRows(Array.isArray(d) ? d : [])); }, []);
  if (rows === null) return null;
  const offen = rows.slice(0, 5);
  return (
    <WidgetKarte titel={t("widget.ausleihe")} zu="/orga?tab=ausleihe" zuLabel={t("widget.zurAusleihe")}
      leer={t("widget.ausleiheLeer")}>
      {offen.length > 0 && (
        <div>
          {offen.map((l) => (
            <Link key={l.id} to="/orga?tab=ausleihe" style={zeile}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.borrower || "—"}</span>
              {l.out_at && (
                <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>
                  {t("widget.seit", { d: new Date(l.out_at).toLocaleDateString() })}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </WidgetKarte>
  );
}

/**
 * Das Register der Widgets.
 *
 * `modul` ist der Schlüssel aus MODUL_KEYS (core/modules.js) — die Startseite
 * blendet ein Widget aus, wenn sein Modul nicht läuft. `an` ist die
 * Voreinstellung für Konten, die noch nie etwas eingestellt haben: die beiden
 * bisherigen Ansichten bleiben an, damit sich für niemanden über Nacht die
 * Startseite leert.
 */
// `option` haengt ein Widget zusaetzlich an einen abschaltbaren TEIL seines
// Moduls (dieselben Schluessel wie in core/ziele.js). Ohne das stand ein Widget
// weiter auf der Startseite, obwohl der Teil, aus dem es seine Zahlen holt, im
// Zahnrad abgeschaltet war — eine Kachel, die auf etwas zeigt, das es fuer
// dieses Konto nicht gibt.
// ── Schwache Lernende (Fruehwarnung) ──
// Auf Wunsch (Voreinstellung: AUS): die Kinder, die ueber mehrere Tests und Arbeiten hinweg hinter der
// Klasse zurueckliegen. Die Rechnung steht in app/fruehwarnung.py; hier wird nur gezeigt, was sie meldet.
// Sie laeuft je Klasse und ist nicht billig — deshalb ist das Widget ausgeschaltet, bis jemand es will,
// und fragt die Klassen nacheinander statt alle auf einmal. Es ist eine Beobachtung, nie eine Diagnose.
function SchwacheSuS() {
  const { t } = useLanguage();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let weg = false;
    (async () => {
      const klassen = await hol("/api/classes", []);
      const liste = (Array.isArray(klassen) ? klassen : []).filter((k) => !k.archived && !k.archived_at).slice(0, 8);
      const aus = [];
      for (const k of liste) {
        const d = await hol(`/api/classes/${k.id}/fruehwarnung`, null);
        (d?.schueler || []).filter((s) => s.status === "melden").forEach((s) => aus.push({ klasse: k, kind: s }));
      }
      aus.sort((a, b) => (a.kind.abstand_median ?? 0) - (b.kind.abstand_median ?? 0));
      if (!weg) setRows(aus);
    })();
    return () => { weg = true; };
  }, []);
  // Meldet die Fruehwarnung niemanden, steht hier nichts: eine Kachel „zurzeit niemand" ist nur Platz.
  if (rows === null || rows.length === 0) return null;
  return (
    <WidgetKarte titel={t("widget.schwacheSus")}>
      {rows.slice(0, 8).map(({ klasse, kind }) => (
        <Link key={`${klasse.id}-${kind.card_id}`} to={`/cardvote/student-evaluation/${klasse.id}/${kind.card_id}`} style={zeile} title={kind.begruendung || ""}>
          <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{kind.name}</span>
          {kind.abstand_median != null && (
            <span style={{ color: C.danger, fontWeight: 700, fontSize: 13 }}>{kind.abstand_median > 0 ? "+" : "\u2212"}{Math.abs(Math.round(kind.abstand_median))} Pp</span>
          )}
          <span style={{ ...chipStyle, fontSize: 12 }}>{klasse.name}</span>
        </Link>
      ))}
    </WidgetKarte>
  );
}

export const WIDGETS = [
  { key: "heute", modul: "kalender", labelKey: "widget.heute", an: true },
  { key: "schwach", modul: "cardvote", labelKey: "widget.schwach", an: true },
  { key: "arbeit", modul: "kalender", labelKey: "widget.arbeit", an: false, komponente: NaechsteArbeit },
  { key: "todo", modul: "notizbrett", option: "aufgaben", labelKey: "widget.todo", an: false, komponente: OffeneTodos },
  { key: "notiz", modul: "notizbrett", option: "notizen", labelKey: "widget.notiz", an: false, komponente: Notizen },
  { key: "ausleihe", modul: "orga", option: "ausleihe", labelKey: "widget.ausleihe", an: false, komponente: Ausleihe },
  { key: "schwacheSus", modul: "cardvote", labelKey: "widget.schwacheSus", an: false, sensibel: true, komponente: SchwacheSuS },
];
