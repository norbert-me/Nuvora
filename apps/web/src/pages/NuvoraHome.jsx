// Nuvoras Startseite: der Rahmen, nicht ein Modul.
// Zeigt die aktivierten Module als Einstieg. Ohne Module fuehrt sie zur
// Modulauswahl statt eine leere Seite zu zeigen.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useModules } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";
import { StageBadge, Icon, ICONS, iconBtn, btnSecondary, selectStyle, COLORS as C } from "../components/Icons.jsx";
import { pageTitle } from "../components/Icons.jsx";

const card = {
  display: "block",
  textDecoration: "none",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 20,
  background: "var(--surface)",
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
    fetch("/api/methoden/list").then((r) => (r.ok ? r.json() : [])).then((d) => {
      const map = {};
      (Array.isArray(d) ? d : []).forEach((m) => { if (m.topic_id != null && !map[m.topic_id]) map[m.topic_id] = m; });
      setMethodByTopic(map);
    }).catch(() => {});
  }, [methodenAktiv]);

  useEffect(() => {
    let ab = false;
    (async () => {
      const classes = await fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).catch(() => []);
      if (!ab) setClasses(Array.isArray(classes) ? classes : []);
      const to = new Date();
      const frm = new Date(Date.now() - 14 * 86400000);
      const q = `frm=${frm.toISOString()}&to=${to.toISOString()}`;
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
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(null);
    if (r && r.ok) setDone((d) => ({ ...d, [key]: true }));
  };
  const Btn = ({ row, art, label, onClick }) => {
    const key = `${row.class_id}:${row.topic_id}:${art}`;
    if (done[key]) return <span style={{ fontSize: 12.5, color: C.success, fontWeight: 700 }}>✓</span>;
    return <button onClick={onClick} disabled={busy === key} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 12.5, opacity: busy === key ? 0.6 : 1 }}>{label}</button>;
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 18, marginBottom: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{t("home.weakTitle")}</div>
      <div style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 12 }}>{t("home.weakHint")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((row) => (
          <div key={`${row.class_id}:${row.topic_id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 10, flexWrap: "wrap" }}>
            <span style={{ flex: 1, fontWeight: 600, minWidth: 130 }}>{row.name} <span style={{ fontWeight: 400, color: "var(--text3)", fontSize: 12.5 }}>· {row.klasse}</span></span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: row.pct < 40 ? C.danger : C.warning }}>{row.pct}%</span>
            {methodByTopic[row.topic_id] && (
              <Link to="/methoden" title={methodByTopic[row.topic_id].title} style={{ fontSize: 12, fontWeight: 700, color: C.info, textDecoration: "none", padding: "3px 9px", borderRadius: 980, background: "rgba(37,99,235,0.12)" }}>
                💡 {t("home.weakEinstieg")}
              </Link>
            )}
            {row.geuebt ? (
              <span style={{ fontSize: 12.5, fontWeight: 700, color: C.success, display: "inline-flex", alignItems: "center", gap: 4 }}>✓ {t("home.weakPracticed")}</span>
            ) : (() => {
              // Fachübergreifende (klassenlose) Zeile: erst Klasse waehlen, dann
              // Karten/Lernpfad fuer genau die Klasse erzeugen. Klassenzeilen wie bisher.
              const eff = row.class_id ?? pickFor[row.topic_id] ?? null;
              const r2 = eff === row.class_id ? row : { ...row, class_id: eff };
              return (<>
                {row.class_id == null && (kartenAktiv || lernpfadAktiv) && (
                  <select value={pickFor[row.topic_id] ?? ""} aria-label={t("home.weakPickClass")}
                    onChange={(e) => setPickFor((m) => ({ ...m, [row.topic_id]: e.target.value ? Number(e.target.value) : undefined }))}
                    style={{ ...selectStyle, padding: "5px 8px", fontSize: 12.5 }}>
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
  const heuteYmd = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(null); // { slots, times, entries, classes, frei }
  useEffect(() => {
    let ab = false;
    (async () => {
      const heute = new Date();
      const j = (r) => (r.ok ? r.json() : null);
      const [tt, classes, breaks] = await Promise.all([
        fetch("/api/kalender/timetable").then(j).catch(() => null),
        fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).catch(() => []),
        fetch("/api/kalender/breaks").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      ]);
      const ymd = (d) => d.toISOString().slice(0, 10);
      const frm = new Date(heute); frm.setHours(0, 0, 0, 0);
      const to = new Date(heute); to.setHours(23, 59, 59, 0);
      const entries = await fetch(`/api/kalender/entries?frm=${frm.toISOString()}&to=${to.toISOString()}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
      const freiHeute = (Array.isArray(breaks) ? breaks : []).find((b) => ymd(heute) >= b.start_date.slice(0, 10) && ymd(heute) <= b.end_date.slice(0, 10));
      if (!ab) setData({ slots: (tt?.slots || []), times: (tt?.times || []), entries: Array.isArray(entries) ? entries : [], classes, frei: freiHeute });
    })();
    return () => { ab = true; };
  }, []);

  if (!data) return null;
  const slots = data.slots.filter((s) => s.weekday === wochentag()).sort((a, b) => a.period - b.period);
  const extras = data.entries.filter((e) => e.period == null || !slots.some((s) => s.period === e.period));
  if (slots.length === 0 && extras.length === 0 && !data.frei) return null;
  const cname = (id) => data.classes.find((c) => c.id === id)?.name || "";
  const ccolor = (id) => data.classes.find((c) => c.id === id)?.color || "var(--border2)";
  const zeit = (p) => { const w = data.times[p - 1]; return w && (w.from || w.to) ? `${w.from || ""}–${w.to || ""}` : ""; };
  const eintrag = (p) => data.entries.find((e) => e.period === p);
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "long" });

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 18, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 700, textTransform: "capitalize" }}>{dateStr}</div>
        <Link to="/kalender" style={{ fontSize: 12.5, color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>{t("home.toCalendar")} ↗</Link>
      </div>
      {data.frei && (
        <div style={{ padding: "8px 12px", borderRadius: 10, background: "rgba(184,134,11,0.12)", color: "#8a6d00", fontSize: 13, fontWeight: 600 }}>
          {t("kalender.freeDay")}: {data.frei.label || ""}
        </div>
      )}
      {!data.frei && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {slots.map((s) => {
            const e = eintrag(s.period);
            // 1-Klick: mit Klasse + aktivem Orga direkt in die Anwesenheit heute.
            const to = orgaAktiv && s.class_id ? `/orga?tab=anwesenheit&class=${s.class_id}&date=${heuteYmd}` : "/kalender";
            return (
              <Link key={s.id} to={to} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", border: "1px solid var(--border)", borderLeft: `4px solid ${s.class_id ? ccolor(s.class_id) : "var(--border2)"}`, borderRadius: 10, textDecoration: "none", color: "var(--text)" }}>
                <div style={{ minWidth: 42, textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 800 }}>{s.period}.</div>
                  <div style={{ fontSize: 10, color: "var(--text3)" }}>{zeit(s.period)}</div>
                </div>
                <div style={{ flex: 1, minWidth: 100 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{cname(s.class_id) || s.title || "—"}</div>
                  {e && <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 2 }}>{e.title || t("kalender.planned")}</div>}
                </div>
              </Link>
            );
          })}
          {extras.map((e) => (
            <Link key={e.id} to="/kalender" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", border: "1px dashed var(--border2)", borderRadius: 10, textDecoration: "none", color: "var(--text)" }}>
              <div style={{ minWidth: 42, textAlign: "center", color: "var(--text3)", fontSize: 12 }}>—</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{e.title || (e.class_id && cname(e.class_id)) || t("kalender.planned")}</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NuvoraHome({ user }) {
  const { t } = useLanguage();
  const { active, loading } = useModules();
  const isOn = (k) => active.some((m) => m.key === k);
  const orderKey = `nuvora_modorder_${user?.id ?? "x"}`;
  const [order, setOrder] = useState(() => { try { return JSON.parse(localStorage.getItem(orderKey)) || []; } catch { return []; } });
  const [edit, setEdit] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);

  if (loading) return null;

  const firstName = (user?.name || "").split(" ")[0];
  const name = (m) => (t(`mod.${m.key}.name`) !== `mod.${m.key}.name` ? t(`mod.${m.key}.name`) : m.name);
  const desc = (m) => (t(`mod.${m.key}.desc`) !== `mod.${m.key}.desc` ? t(`mod.${m.key}.desc`) : m.description);
  // Nach gespeicherter Reihenfolge; unbekannte (neue) Module hinten anhaengen.
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? 1000 + active.findIndex((m) => m.key === k) : i; };
  const shown = [...active].sort((a, b) => rank(a.key) - rank(b.key));

  const persist = (keys) => { setOrder(keys); try { localStorage.setItem(orderKey, JSON.stringify(keys)); } catch { /* egal */ } };

  // Vorschau-Reihenfolge waehrend des Ziehens: die gezogene Kachel sitzt schon
  // dort, wo sie beim Loslassen landen wuerde — man sieht das Ergebnis live.
  const previewKeys = () => {
    const keys = shown.map((m) => m.key);
    if (!dragKey || !overKey || dragKey === overKey) return keys;
    const from = keys.indexOf(dragKey), to = keys.indexOf(overKey);
    if (from < 0 || to < 0) return keys;
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    return keys;
  };
  const displayList = (dragKey && overKey ? previewKeys() : shown.map((m) => m.key)).map((k) => shown.find((m) => m.key === k));
  const commit = () => { persist(previewKeys()); setDragKey(null); setOverKey(null); };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>
          {firstName ? t("home.welcome", { name: firstName }) : t("home.welcomePlain")}
        </h1>
        {active.length > 1 && (
          <button onClick={() => setEdit((e) => !e)} className="icon-btn" style={{ ...iconBtn, border: edit ? "1px solid var(--accent)" : "1px solid var(--border2)", borderRadius: 10, padding: 8 }} title={t("home.arrange")}>
            {edit ? <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", padding: "0 4px" }}>{t("common.done")}</span> : <Icon d={ICONS.edit} size={17} />}
          </button>
        )}
      </div>
      <p style={{ color: "var(--text2)", marginBottom: 28, marginTop: 8 }}>
        {edit ? t("home.arrangeHint") : t("home.intro")}
      </p>

      {active.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: 36 }}>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            {t("home.noModuleTitle")}
          </p>
          <p style={{ color: "var(--text2)", marginBottom: 20 }}>
            {t("home.noModuleText")}
          </p>
          <Link
            to="/modules"
            style={{
              display: "inline-block", padding: "10px 18px", borderRadius: 980,
              background: "var(--accent)", color: "#fff", textDecoration: "none",
              fontWeight: 600, fontSize: 14,
            }}
          >
            {t("home.chooseModules")}
          </Link>
        </div>
      ) : (
        <>
          {!edit && isOn("kalender") && <HeutePanel t={t} orgaAktiv={isOn("orga")} />}
          {!edit && isOn("cardvote") && <SchwacheWoche t={t} kartenAktiv={isOn("karten")} lernpfadAktiv={isOn("lernpfad")} methodenAktiv={isOn("methoden")} />}
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {(edit ? displayList : shown).map((m) => {
              const inner = (<>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  {edit && <span style={{ color: "var(--text3)", display: "inline-flex" }}><Icon d={ICONS.grip} size={16} /></span>}
                  <span>{name(m)}</span> <StageBadge stage={m.stage} />
                </div>
                <div style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.6 }}>{desc(m)}</div>
              </>);
              if (edit) {
                // Bearbeiten: Karten sind ziehbar. Die gezogene Kachel wird zum
                // gestrichelten Platzhalter, die restlichen weichen live aus —
                // so sieht man die Reihenfolge schon vor dem Loslassen.
                const isDragged = dragKey === m.key;
                return (
                  <div key={m.key} draggable
                    onDragStart={() => setDragKey(m.key)}
                    onDragOver={(e) => e.preventDefault()}
                    // Beim Betreten einer ANDEREN Kachel dorthin einsortieren; beim
                    // Zurückkommen auf die eigene (Ursprungs-)Kachel die Vorschau
                    // auf die Ausgangsreihenfolge zurücksetzen (sonst zeigt der
                    // Originalplatz noch die letzte Nachbar-Vorschau).
                    onDragEnter={() => {
                      if (!dragKey) return;
                      if (m.key !== dragKey) { if (overKey !== m.key) setOverKey(m.key); }
                      else if (overKey !== dragKey) setOverKey(dragKey);
                    }}
                    onDrop={commit}
                    onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                    style={{ ...card, cursor: "grab", borderStyle: "dashed",
                      ...(isDragged ? { opacity: 0.35, borderColor: "var(--accent)", background: "var(--bg2)" } : {}) }}>
                    {inner}
                  </div>
                );
              }
              // Externe Module leben ausserhalb der React-App — echter Seitenwechsel.
              return m.external
                ? <a key={m.key} href={m.path} style={card}>{inner}</a>
                : <Link key={m.key} to={m.path} style={card}>{inner}</Link>;
            })}
          </div>
        </>
      )}
    </div>
  );
}
