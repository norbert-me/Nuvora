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
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { COLORS as C, cardStyle, chipStyle, Icon, ICONS } from "./Icons.jsx";
import { hol } from "../core/melden.js";
import { ymd } from "../core/datum.js";
import { useLanguage } from "../i18n/index.jsx";

// Gemeinsamer Rahmen: Überschrift mit Weg ins Modul, darunter der Inhalt.
// Ohne den hätte jedes Widget seinen eigenen Kasten erfunden — genau das, was
// bei den Werkzeugleisten schon einmal passiert ist.
export function WidgetKarte({ titel, zu, zuLabel, children, leer }) {
  return (
    <div style={{ ...cardStyle, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 16, fontWeight: 700, flex: 1, minWidth: 0 }}>{titel}</span>
        {zu && (
          <Link to={zu} style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
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
export const WIDGETS = [
  { key: "heute", modul: "kalender", labelKey: "widget.heute", an: true },
  { key: "schwach", modul: "cardvote", labelKey: "widget.schwach", an: true },
  { key: "arbeit", modul: "kalender", labelKey: "widget.arbeit", an: false, komponente: NaechsteArbeit },
  { key: "todo", modul: "orga", labelKey: "widget.todo", an: false, komponente: OffeneTodos },
  { key: "notiz", modul: "notizbrett", labelKey: "widget.notiz", an: false, komponente: Notizen },
  { key: "ausleihe", modul: "orga", labelKey: "widget.ausleihe", an: false, komponente: Ausleihe },
];
