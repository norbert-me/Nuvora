// Nuvoras Startseite: der Rahmen, nicht ein Modul.
// Zeigt die aktivierten Module als Einstieg. Ohne Module fuehrt sie zur
// Modulauswahl statt eine leere Seite zu zeigen.
import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useModules, useAktiv } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";
import { lokal, sichern } from "../core/ansichten.js";
import { StageBadge, Icon, ICONS, MODULE_ICONS, btnSecondary, selectStyle, COLORS as C, pageApp, pageTitle, cardStyle, chipStyle, badge, btnSmall, CONTROL_H, CONTROL_R, toolbarIconBtn } from "../components/Icons.jsx";
import { useEntwurf } from "../components/Speichern.jsx";
import { alsJson, hol } from "../core/melden.js";
import { WIDGETS } from "../components/Widgets.jsx";
import { ZIELE } from "../core/ziele.js";
import { ymd } from "../core/datum.js";
import { stundenZeit } from "../core/stunden";

// Modul-Kachel: dieselbe Karte wie überall, nur als Link (kein eigener Kasten).
// Die frühere Eigenbau-Fassung stand auf `var(--surface)` — die Variable gibt es
// nirgends, die Kacheln hatten dadurch gar keinen Grund.
const card = {
  ...cardStyle,
  display: "block",
  textDecoration: "none",
  color: "var(--text)",
};

// Der Kern der Plattform sichtbar gemacht: schwache Themen aus CardVote-Tests
// der letzten zwei Wochen — mit einem Klick zu Karten-Deck oder Lernpfad-Aufgabe.
// Genau die Brücke zwischen den Modulen, die Nuvora von drei Einzeltools trennt.
function SchwacheWoche({ t, kartenAktiv, lernpfadAktiv, methodenAktiv }) {
  const [rows, setRows] = useState(null); // [{class_id, klasse, topic_id, name, pct}]
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState({});
  const [methodByTopic, setMethodByTopic] = useState({}); // topic_id → erster passender Einstieg
  const [classes, setClasses] = useState([]); // fuer die Klassenwahl bei fachübergreifenden (klassenlosen) Themen
  const [pickFor, setPickFor] = useState({}); // topic_id → gewaehlte class_id (fachübergreifende Zeile)

  useEffect(() => {
    if (!methodenAktiv) return;
    hol("/api/methoden/list").then((d) => {
      const map = {};
      (Array.isArray(d) ? d : []).forEach((m) => { if (m.topic_id != null && !map[m.topic_id]) map[m.topic_id] = m; });
      setMethodByTopic(map);
    });
  }, [methodenAktiv]);

  useEffect(() => {
    let ab = false;
    (async () => {
      const classes = await fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).catch(() => []);
      if (!ab) setClasses(Array.isArray(classes) ? classes : []);
      const all = [];
      for (const c of classes) {
        const d = await fetch(`/api/weak-review?days=14&class_id=${c.id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        (d?.topics || []).forEach((tp) => all.push({ class_id: c.id, klasse: c.name, ...tp }));
      }
      // Fachübergreifend (klassenlos, inkl. Code-Detektiv): nur Themen, die nicht
      // schon über eine Klasse auftauchen. Ohne Klasse → nur Info, keine Knöpfe.
      const seen = new Set(all.map((r) => r.topic_id));
      const dx = await fetch(`/api/weak-review?days=14`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      (dx?.topics || []).forEach((tp) => { if (!seen.has(tp.topic_id)) all.push({ class_id: null, klasse: t("home.crossSubject"), ...tp }); });
      // Ungeübte zuerst (Handlungsbedarf), dann nach Trefferquote.
      all.sort((a, b) => (a.geuebt === b.geuebt ? a.pct - b.pct : a.geuebt ? 1 : -1));
      if (!ab) setRows(all.slice(0, 6));
    })();
    return () => { ab = true; };
  }, []);

  if (!rows || rows.length === 0) return null;

  const run = async (row, art, url, body) => {
    const key = `${row.class_id}:${row.topic_id}:${art}`;
    setBusy(key);
    const r = await fetch(url, alsJson("POST", body)).catch(() => null);
    setBusy(null);
    if (r && r.ok) setDone((d) => ({ ...d, [key]: true }));
  };
  const Btn = ({ row, art, label, onClick }) => {
    const key = `${row.class_id}:${row.topic_id}:${art}`;
    if (done[key]) return <Icon d={ICONS.check} size={16} color={C.success} />;
    return <button onClick={onClick} disabled={busy === key} style={{ ...btnSecondary, ...btnSmall, opacity: busy === key ? 0.6 : 1 }}>{label}</button>;
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 24 }}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{t("home.weakTitle")}</div>
      <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>{t("home.weakHint")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row) => (
          <div key={`${row.class_id}:${row.topic_id}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: CONTROL_R, flexWrap: "wrap" }}>
            <span style={{ flex: 1, fontWeight: 600, minWidth: 130 }}>{row.name} <span style={{ fontWeight: 400, color: "var(--text3)", fontSize: 13 }}>· {row.klasse}</span></span>
            <span style={{ fontSize: 13, fontWeight: 700, color: row.pct < 40 ? C.danger : C.warning }}>{row.pct}%</span>
            {methodByTopic[row.topic_id] && (
              <Link to="/unterrichtsplanung?tab=einstiege" title={methodByTopic[row.topic_id].title} style={{ ...badge(C.info), textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon d={ICONS.bulb} size={13} color={C.info} /> {t("home.weakEinstieg")}
              </Link>
            )}
            {row.geuebt ? (
              <span style={{ fontSize: 13, fontWeight: 700, color: C.success, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon d={ICONS.check} size={14} color={C.success} /> {t("home.weakPracticed")}
              </span>
            ) : (() => {
              // Fachübergreifende (klassenlose) Zeile: erst Klasse waehlen, dann
              // Karten/Lernpfad fuer genau die Klasse erzeugen. Klassenzeilen wie bisher.
              const eff = row.class_id ?? pickFor[row.topic_id] ?? null;
              const r2 = eff === row.class_id ? row : { ...row, class_id: eff };
              return (<>
                {row.class_id == null && (kartenAktiv || lernpfadAktiv) && (
                  <select value={pickFor[row.topic_id] ?? ""} aria-label={t("home.weakPickClass")}
                    onChange={(e) => setPickFor((m) => ({ ...m, [row.topic_id]: e.target.value ? Number(e.target.value) : undefined }))}
                    style={{ ...selectStyle, height: 28, padding: "0 26px 0 8px", fontSize: 13 }}>
                    <option value="">{t("home.weakPickClass")}</option>
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
                {eff != null && kartenAktiv && <Btn row={r2} art="karten" label={t("home.weakDeck")}
                  onClick={() => run(r2, "karten", `/api/karten/classes/${eff}/decks`, { name: row.name, topic_id: row.topic_id })} />}
                {eff != null && lernpfadAktiv && <Btn row={r2} art="lernpfad" label={t("home.weakExercise")}
                  onClick={() => run(r2, "lernpfad", `/api/lernpfad/exercises`, { topic_id: row.topic_id, kategorie: "Basis", aufgabentext: t("weak.repTitle", { thema: row.name }) })} />}
              </>);
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}

// Tages-Dashboard: die heutigen Stunden aus dem Stundenplan + geplante
// Eintraege, direkt auf der Startseite. Nur Anzeige — Klick fuehrt in den
// Kalender. Erscheint nur, wenn das Modul Kalender aktiv ist.
const wochentag = () => (new Date().getDay() + 6) % 7; // Mo=0 … So=6
function HeutePanel({ t, orgaAktiv }) {
  // Ortszeit, nicht UTC: `toISOString()` liefert in +02:00 ab 22 Uhr schon den
  // Folgetag — die Kachel „was ist heute" zeigte abends den morgigen Stundenplan
  // und hielt laufende Ferien fuer beendet.
  const heuteYmd = ymd(new Date());
  const [data, setData] = useState(null); // { slots, times, entries, classes, frei }
  useEffect(() => {
    let ab = false;
    (async () => {
      const heute = new Date();
      const j = (r) => (r.ok ? r.json() : null);
      const [tt, classes, breaks, cancels] = await Promise.all([
        fetch("/api/kalender/timetable").then(j).catch(() => null),
        fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetch("/api/kalender/breaks").then((r) => (r.ok ? r.json() : [])).catch(() => []),
        // Entfallene Stunden: im Kalender sind sie weggewischt, auf der
        // Startseite standen sie trotzdem — dieselbe Frage, zwei Antworten.
        fetch("/api/kalender/slot-cancellations").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      const frm = new Date(heute); frm.setHours(0, 0, 0, 0);
      const to = new Date(heute); to.setHours(23, 59, 59, 0);
      const entries = await fetch(`/api/kalender/entries?frm=${frm.toISOString()}&to=${to.toISOString()}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
      const freiHeute = (Array.isArray(breaks) ? breaks : []).find((b) => ymd(heute) >= b.start_date.slice(0, 10) && ymd(heute) <= b.end_date.slice(0, 10));
      if (!ab) setData({ slots: (tt?.slots || []), times: (tt?.times || []), zero: (tt?.zero || null), entries: Array.isArray(entries) ? entries : [],
                        classes, frei: freiHeute,
                        entfallen: (Array.isArray(cancels) ? cancels : [])
                          .filter((c) => (c.date || "").slice(0, 10) === ymd(heute)).map((c) => c.period) });
    })();
    return () => { ab = true; };
  }, []);

  if (!data) return null;
  // Nur heute gültige Stundenplan-Versionen (valid_from/valid_to grenzen ein).
  // heuteYmd ist oben schon definiert (YYYY-MM-DD).
  const activeToday = (s) => (!s.valid_from || heuteYmd >= s.valid_from) && (!s.valid_to || heuteYmd <= s.valid_to);
  const slots = data.slots
    .filter((s) => s.weekday === wochentag() && activeToday(s) && !(data.entfallen || []).includes(s.period))
    .sort((a, b) => a.period - b.period);
  const extras = data.entries.filter((e) => e.period == null || !slots.some((s) => s.period === e.period));
  if (slots.length === 0 && extras.length === 0 && !data.frei) return null;
  const cname = (id) => data.classes.find((c) => c.id === id)?.name || "";
  const ccolor = (id) => data.classes.find((c) => c.id === id)?.color || "var(--border2)";
  // Die Stundenzeiten heissen {start, end} (so liefert sie /api/kalender/
  // timetable). Hier stand `from`/`to` — beides undefined, und deshalb blieb
  // die Zeile unter der Stundennummer immer leer.
  const zeit = (p) => { const w = stundenZeit(data.times, data.zero, p); return w && (w.start || w.end) ? `${w.start || ""}–${w.end || ""}` : ""; };
  const eintrag = (p) => data.entries.find((e) => e.period === p);
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "long" });

  return (
    <div style={{ ...cardStyle, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 700, textTransform: "capitalize" }}>{dateStr}</div>
        <Link to="/kalender?view=day" style={{ fontSize: 13, color: "var(--accent)", textDecoration: "none", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
          {t("home.toCalendar")} <Icon d={ICONS.open} size={12} color="var(--accent)" />
        </Link>
      </div>
      {data.frei && (
        <div style={{ padding: "8px 12px", borderRadius: CONTROL_R, background: C.warning + "1f", color: C.warning, fontSize: 13, fontWeight: 600 }}>
          {t("kalender.freeDay")}: {data.frei.label || ""}
        </div>
      )}
      {!data.frei && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {slots.map((s) => {
            const e = eintrag(s.period);
            // 1-Klick: mit Klasse + aktivem Orga direkt in die Anwesenheit heute.
            const to = orgaAktiv && s.class_id ? `/orga?tab=anwesenheit&class=${s.class_id}&date=${heuteYmd}` : "/kalender?view=day";
            return (
              <Link key={s.id} to={to} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", border: "1px solid var(--border)", borderLeft: `4px solid ${s.class_id ? ccolor(s.class_id) : "var(--border2)"}`, borderRadius: CONTROL_R, textDecoration: "none", color: "var(--text)" }}>
                <div style={{ minWidth: 42, textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{s.period}.</div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>{zeit(s.period)}</div>
                </div>
                <div style={{ flex: 1, minWidth: 100 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{cname(s.class_id) || s.title || "—"}</div>
                  {e && <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 4 }}>{e.title || t("kalender.planned")}</div>}
                </div>
              </Link>
            );
          })}
          {/* Termine ohne Stundenplan-Stunde: die eigene Uhrzeit gehoert
              dazu. Sie stand am Eintrag und wurde hier verschwiegen — dann
              sieht ein Termin um 8 Uhr aus wie einer um 18 Uhr. */}
          {extras.map((e) => {
            const von = e.start_time || "";
            const bis = e.end_time || "";
            const zeitTxt = von ? (bis ? `${von}–${bis}` : von) : "";
            return (
              <Link key={e.id} to="/kalender?view=day" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", border: "1px dashed var(--border2)", borderRadius: CONTROL_R, textDecoration: "none", color: "var(--text)" }}>
                <div style={{ minWidth: 42, textAlign: "center", color: "var(--text3)", fontSize: 12, whiteSpace: "nowrap" }}>{zeitTxt || "—"}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{e.title || (e.class_id && cname(e.class_id)) || t("kalender.planned")}</div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function NuvoraHome({ user }) {
  const { t } = useLanguage();
  const { active, loading } = useModules();
  // Bewusst useAktiv() statt einer eigenen Zeile: die Fassung hier prueft den
  // Schluessel gegen MODUL_KEYS und meldet Tippfehler in der Konsole. Die
  // fruehere Eigenbau-Variante lieferte bei "methoden" (den Schluessel gibt es
  // nicht, das Modul heisst unterrichtsplanung) stillschweigend false — der
  // Einstiegs-Vorschlag bei schwachen Themen war damit dauerhaft tot.
  const isOn = useAktiv();
  // Die ganze Einrichtung der Startseite in EINEM Eintrag: Reihenfolge der
  // Kacheln, ausgeblendete Kacheln, eingeschaltete Widgets. Drei getrennte
  // Schluessel waeren drei Stellen, an denen ein halb gespeicherter Stand
  // entstehen kann.
  //
  // Weiterhin im Browser und nicht auf dem Server: es ist eine Ansicht, kein
  // Inhalt — wer an einem anderen Rechner arbeitet, soll dort seine eigene
  // Anordnung haben duerfen. (Der frueher benutzte Schluessel
  // `nuvora_modorder_*` wird einmalig uebernommen, damit niemandes Reihenfolge
  // verloren geht.)
  const dashKey = `nuvora_dash_${user?.id ?? "x"}`;
  const orderKey = `nuvora_modorder_${user?.id ?? "x"}`;
  const [dash, setDash] = useState(() => {
    // Reihenfolge der Quellen: was das Konto sagt (core/ansichten.js), sonst
    // der alte Browser-Eintrag, sonst die Voreinstellung. Die beiden alten
    // Schluessel werden weiter gelesen, damit niemandes Anordnung verloren
    // geht — geschrieben wird nur noch ans Konto.
    const vomKonto = lokal("dash");
    if (vomKonto && Array.isArray(vomKonto.order))
      return { order: vomKonto.order, hidden: vomKonto.hidden || [], widgets: vomKonto.widgets ?? null };
    try {
      const roh = JSON.parse(localStorage.getItem(dashKey));
      if (roh && Array.isArray(roh.order)) return { order: roh.order, hidden: roh.hidden || [], widgets: roh.widgets || null };
    } catch { /* kaputt: Voreinstellung */ }
    try {
      const alt = JSON.parse(localStorage.getItem(orderKey));
      if (Array.isArray(alt)) return { order: alt, hidden: [], widgets: null };
    } catch { /* egal */ }
    return { order: [], hidden: [], widgets: null };
  });
  // Kommt der Kontostand erst nach dem ersten Zeichnen an (frisch angemeldet,
  // anderes Geraet), zieht die Seite nach.
  useEffect(() => {
    const vomKonto = user?.ansichten?.dash;
    if (vomKonto && Array.isArray(vomKonto.order))
      setDash({ order: vomKonto.order, hidden: vomKonto.hidden || [], widgets: vomKonto.widgets ?? null });
  }, [user?.ansichten]); // eslint-disable-line
  // widgets === null heisst „nie etwas eingestellt": dann gelten die
  // Voreinstellungen aus dem Register, damit sich fuer niemanden ueber Nacht
  // die Startseite leert.
  const widgetKeys = dash.widgets ?? WIDGETS.filter((w) => w.an).map((w) => w.key);
  const order = dash.order;
  const versteckt = new Set(dash.hidden || []);
  const [edit, setEdit] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);

  const firstName = (user?.name || "").split(" ")[0];
  const name = (m) => (t(`mod.${m.key}.name`) !== `mod.${m.key}.name` ? t(`mod.${m.key}.name`) : m.name);

  // Woraus besteht das Modul? Aus derselben Liste, die auch die Suche
  // durchsucht (core/ziele.js) — ein neuer Reiter gehoert ohnehin dort hinein
  // und steht damit von selbst auf der Kachel. Eine zweite, handgepflegte
  // Liste hier waere nach dem dritten Reiter veraltet.
  //
  // Zwei Ausnahmen: der Weg auf die Modul-Startseite selbst (er wiederholt nur
  // den Titel darueber) und der Marktplatz (der gehoert dem Kern, das Modul
  // verlinkt ihn nur).
  const teile = (m) => ZIELE
    .filter((z) => z.modul === m.key && z.pfad !== m.path && !z.pfad.startsWith("/marktplatz"))
    // Fehlt die Uebersetzung, gibt `t` den Schluessel zurueck — dann lieber
    // nichts zeigen als „orga.tabOptions" auf der Kachel.
    .map((z) => ({ key: z.key, text: t(z.key) }))
    .filter((x) => x.text && x.text !== x.key)
    .map((x) => x.text);
  // Nach gespeicherter Reihenfolge; unbekannte (neue) Module hinten anhaengen.
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? 1000 + active.findIndex((m) => m.key === k) : i; };
  const sortiert = [...active].sort((a, b) => rank(a.key) - rank(b.key));
  // Ausgeblendete Kacheln sind NUR auf der Startseite weg — das Modul bleibt
  // aktiv, die Navigation zeigt es weiter. Wer ein Modul wirklich abschalten
  // will, tut das unter /modules; hier geht es um die eigene Startseite.
  const shown = sortiert.filter((m) => !versteckt.has(m.key));

  const persist = (naechster) => {
    setDash(naechster);
    // Ans Konto (mit lokalem Sofort-Eintrag als Rueckfall) — die Einrichtung
    // gehoert zur Person, nicht zum Geraet.
    sichern("dash", naechster);
  };

  // Auch das Anordnen der Kacheln ist eine Änderung und wartet auf „Speichern".
  // Die Grundlage muss über Rendergrenzen dieselbe bleiben — daher der
  // Schlüssel aus den Modul-Namen. (Hooks stehen vor jedem frühen Return.)
  const basisSchluessel = sortiert.map((m) => m.key).join(",");
  const basisVersteckt = (dash.hidden || []).join(",");
  const basisWidgets = widgetKeys.join(",");
  const basisOrdnung = useMemo(() => ({
    keys: basisSchluessel ? basisSchluessel.split(",") : [],
    hidden: basisVersteckt ? basisVersteckt.split(",") : [],
    widgets: basisWidgets ? basisWidgets.split(",") : [],
  }), [basisSchluessel, basisVersteckt, basisWidgets]);
  const kacheln = useEntwurf(basisOrdnung, (w) => {
    persist({ order: w.keys, hidden: w.hidden, widgets: w.widgets });
  });

  if (loading) return null;

  // Vorschau-Reihenfolge waehrend des Ziehens: die gezogene Kachel sitzt schon
  // dort, wo sie beim Loslassen landen wuerde — man sieht das Ergebnis live.
  const previewKeys = () => {
    const keys = [...kacheln.wert.keys];
    if (!dragKey || !overKey || dragKey === overKey) return keys;
    const from = keys.indexOf(dragKey), to = keys.indexOf(overKey);
    if (from < 0 || to < 0) return keys;
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    return keys;
  };
  const displayList = previewKeys().map((k) => sortiert.find((m) => m.key === k)).filter(Boolean);
  const commit = () => { kacheln.setz({ keys: previewKeys() }); setDragKey(null); setOverKey(null); };

  return (
    <div style={{ ...pageApp }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>
          {firstName ? t("home.welcome", { name: firstName }) : t("home.welcomePlain")}
        </h1>
        {/* Der Knopf richtet jetzt auch die Widgets ein — er gehoert also auch
            dorthin, wo nur ein Modul laeuft. Vorher hing er an „mehr als eine
            Kachel", weil es nur ums Sortieren ging.

            „Fertig" IST der Speichern-Knopf. Das ist die eine begruendete
            Abweichung von der Regel „ueberall ein Speichern-Knopf": hier gibt
            es einen Modus, den man ausdruecklich verlaesst — eine zweite Leiste
            daneben haette bedeutet, dass man erst speichert und dann noch
            einmal „fertig" sagt. Der Grund der Regel (nichts geht still
            verloren, man behaelt die Kontrolle) bleibt erfuellt: nichts wird
            geschrieben, bevor man den Knopf drueckt. */}
        {active.length > 0 && (
          <button onClick={async () => {
            if (edit) {
              if (kacheln.geaendert && (await kacheln.speichern()) === false) return;
              setEdit(false);
              return;
            }
            setEdit(true);
          }} className="icon-btn"
            // `width: undefined` LOESCHT die Breite aus dem Baustein — React
            // laesst undefined weg, der Knopf hatte danach gar keine und schrumpfte
            // auf den Inhalt (19 statt 34 Pixel breit, dabei 36 hoch: ein Oval).
            style={{ ...toolbarIconBtn, width: edit ? "auto" : CONTROL_H, padding: edit ? "0 12px" : 0,
              borderColor: edit ? "var(--accent)" : "var(--border2)" }}
            // Im Bearbeiten-Modus IST dieser Knopf „Fertig" (und damit der
            // Speichern-Knopf). Stand die Beschriftung fest auf „Anordnen",
            // sagte er sichtbar das eine und für Screenreader das andere.
            title={edit ? t("common.done") : t("home.arrange")}
            aria-label={edit ? t("common.done") : t("home.arrange")}>
            {edit ? <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{t("common.done")}</span> : <Icon d={ICONS.edit} size={16} />}
          </button>
        )}
      </div>

      {/* Sucheinstieg: nicht jeder weiss, dass die Ausleihe unter Orga sitzt.
          Klick oder ⌘K oeffnet dieselbe Suche wie die Lupe in der Navigation
          (components/Suche.jsx) — hier steht nur der Knopf dazu. */}
      <button onClick={() => window.dispatchEvent(new Event("nuvora:suche"))} data-suche="startseite"
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", maxWidth: 520, marginBottom: 24,
          padding: "11px 14px", border: "1px solid var(--border2)", borderRadius: CONTROL_R, background: "var(--card)",
          color: "var(--text3)", cursor: "text", fontSize: 14, textAlign: "left" }}>
        <Icon d={ICONS.search} size={16} color="var(--text3)" />
        <span style={{ flex: 1 }}>{t("suche.placeholder")}</span>
        <kbd style={{ ...chipStyle, fontWeight: 500, border: "1px solid var(--border2)" }}>⌘K</kbd>
      </button>

      {active.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: 24 }}>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            {t("home.noModuleTitle")}
          </p>
          <p style={{ color: "var(--text2)", marginBottom: 16 }}>
            {t("home.noModuleText")}
          </p>
          <Link
            to="/modules"
            style={{
              display: "inline-block", padding: "10px 18px", borderRadius: CONTROL_R,
              background: "var(--accent)", color: C.aufAkzent, textDecoration: "none",
              fontWeight: 600, fontSize: 14,
            }}
          >
            {t("home.chooseModules")}
          </Link>
        </div>
      ) : (
        <>
          {/* Widgets in der Reihenfolge des Registers — ein Widget zeigt, eine
              Kachel verlinkt. Beides je Modul frei waehlbar; genau deshalb gibt
              es den Kalender nicht mehr zwangslaeufig doppelt. */}
          {!edit && WIDGETS.filter((w) => kacheln.wert.widgets.includes(w.key) && isOn(w.modul)).map((w) => {
            if (w.key === "heute") return <HeutePanel key={w.key} t={t} orgaAktiv={isOn("orga")} />;
            if (w.key === "schwach") {
              return <SchwacheWoche key={w.key} t={t} kartenAktiv={isOn("karten")} lernpfadAktiv={isOn("lernpfad")} methodenAktiv={isOn("unterrichtsplanung")} />;
            }
            const K = w.komponente;
            return <div key={w.key} style={{ marginBottom: 16 }}><K /></div>;
          })}

          {/* Bearbeiten: was soll die Startseite zeigen? Widgets zum An- und
              Abschalten, Kacheln zum Ausblenden — beides an derselben Stelle,
              weil es dieselbe Frage ist. */}
          {edit && (
            <div style={{ ...card, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{t("home.widgets")}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {WIDGETS.filter((w) => isOn(w.modul)).map((w) => {
                  const an = kacheln.wert.widgets.includes(w.key);
                  return (
                    <button key={w.key} data-widget={w.key} aria-pressed={an}
                      onClick={() => kacheln.setz((v) => ({
                        widgets: an ? v.widgets.filter((x) => x !== w.key) : [...v.widgets, w.key],
                      }))}
                      style={{ ...chipStyle, padding: "7px 12px", cursor: "pointer", border: "1px solid",
                        borderColor: an ? "var(--accent)" : "var(--border2)",
                        background: an ? "var(--accent-bg)" : "var(--bg2)",
                        color: an ? "var(--accent)" : "var(--text2)", fontWeight: 600 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Icon d={an ? ICONS.check : ICONS.plus} size={13} color="currentColor" />
                        {t(w.labelKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {WIDGETS.every((w) => !isOn(w.modul)) && (
                <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("home.widgetsKeine")}</p>
              )}
            </div>
          )}
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {(edit ? displayList : shown).map((m) => {
              // Dashboard braucht keine Erklärung (die steht unter „Module") —
              // nur großes Icon + Name. Höhe bleibt wie zuvor (tileStyle).
              const aus = kacheln.wert.hidden.includes(m.key);
              const inner = (
                <div style={{ fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 12 }}>
                  {edit && <span style={{ color: "var(--text3)", display: "inline-flex" }}><Icon d={ICONS.grip} size={16} /></span>}
                  {MODULE_ICONS[m.key] && (
                    <span style={{ flexShrink: 0, width: 52, height: 52, borderRadius: CONTROL_R, display: "inline-flex", alignItems: "center", justifyContent: "center",
                      background: "var(--bg2, var(--bg))", color: "var(--text)" }}>
                      <Icon d={MODULE_ICONS[m.key]} size={32} color="currentColor" />
                    </span>
                  )}
                  {/* Beta-Badge ÜBER den Namen (nicht dahinter) — läuft sonst bei
                      langen Namen aus der Karte. */}
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minWidth: 0 }}>
                    <StageBadge stage={m.stage} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name(m)}</span>
                    {/* Woraus das Modul besteht. „Orga" sagt niemandem, dass die
                        Ausleihe darin steckt — genau deshalb gibt es die Suche.
                        Auf der Kachel steht es jetzt gleich mit da. */}
                    {teile(m).length > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text3)", lineHeight: 1.4,
                        overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2 }}>
                        {teile(m).join(" · ")}
                      </span>
                    )}
                  </span>
                  {/* Auge = „auf der Startseite zeigen?". Das Modul bleibt
                      aktiv — abschalten geht unter /modules. Wer den Kalender
                      als Widget hat, braucht die Kachel daneben nicht. */}
                  {edit && (
                    <button onClick={(ev) => {
                      ev.preventDefault(); ev.stopPropagation();
                      kacheln.setz((v) => ({
                        hidden: aus ? v.hidden.filter((x) => x !== m.key) : [...v.hidden, m.key],
                      }));
                    }} className="icon-btn"
                      style={{ ...toolbarIconBtn, marginLeft: "auto", border: "none", color: aus ? C.warning : "var(--text3)" }}
                      title={aus ? t("home.tileShow") : t("home.tileHide")}
                      aria-label={aus ? t("home.tileShow") : t("home.tileHide")} aria-pressed={aus}>
                      <Icon d={aus ? ICONS.eyeOff : ICONS.eye} size={16} />
                    </button>
                  )}
                </div>
              );
              const tileStyle = { ...card, minHeight: 100, boxSizing: "border-box", display: "flex", alignItems: "center" };
              if (edit) {
                // Bearbeiten: Karten sind ziehbar. Die gezogene Kachel wird zum
                // gestrichelten Platzhalter, die restlichen weichen live aus —
                // so sieht man die Reihenfolge schon vor dem Loslassen.
                const isDragged = dragKey === m.key;
                return (
                  <div key={m.key} draggable
                    onDragStart={() => setDragKey(m.key)}
                    onDragOver={(e) => e.preventDefault()}
                    // Beim Betreten einer ANDEREN Kachel dorthin einsortieren. Den
                    // gestrichelten Platzhalter (eigene Kachel) bewusst ignorieren:
                    // Nach dem Umsortieren liegt er unter dem Cursor; würde man ihn
                    // auf die Ausgangsreihenfolge zurücksetzen, spränge die Vorschau
                    // sofort zurück und der Cursor stünde wieder überm Nachbarn —
                    // das erzeugte das Flackern.
                    onDragEnter={() => {
                      if (!dragKey || m.key === dragKey) return;
                      if (overKey !== m.key) setOverKey(m.key);
                    }}
                    onDrop={commit}
                    onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                    style={{ ...tileStyle, cursor: "grab", borderStyle: "dashed",
                      // Ausgeblendet: blass, aber weiter da und weiter ziehbar —
                      // sonst muesste man zum Zurueckholen suchen, wo sie hin ist.
                      ...(aus ? { opacity: 0.45 } : {}),
                      ...(isDragged ? { opacity: 0.35, borderColor: "var(--accent)", background: "var(--bg2)" } : {}) }}>
                    {inner}
                  </div>
                );
              }
              // Externe Module leben ausserhalb der React-App — echter Seitenwechsel.
              return m.external
                ? <a key={m.key} href={m.path} style={tileStyle}>{inner}</a>
                : <Link key={m.key} to={m.path} style={tileStyle}>{inner}</Link>;
            })}
          </div>
        </>
      )}
    </div>
  );
}
