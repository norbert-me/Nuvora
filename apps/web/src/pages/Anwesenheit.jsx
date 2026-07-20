// Modul Anwesenheit — Anwesenheit/Fehlzeiten je Klasse und Tag.
// Pro Schüler ein Status (da/fehlt/verspätet/entschuldigt). "da" ist Normalfall
// und wird nicht gespeichert. Übersicht zeigt Fehlzeiten und lässt nachtragen.
import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { pageTitle, btnSecondary, selectStyle, Toggle, Tabs, inputStyle } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { swr , lastClass, rememberClass } from "../core/cache.js";

const API = "/api/anwesenheit";
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const STATI = ["da", "fehlt", "spaet", "entsch"];
const COL = { da: "#0a7d3e", fehlt: "#d1350f", spaet: "#b8860b", entsch: "#2563eb" };

export default function Anwesenheit() {
  const { t } = useLanguage();
  const { modules } = useModules();
  const kalenderAktiv = modules.find((m) => m.key === "kalender")?.active ?? false;
  const [params] = useSearchParams();
  const [classes, setClasses] = useState([]);
  // Vorauswahl per ?class= / ?date= (z. B. aus dem Kalender).
  const [classId, setClassId] = useState(() => Number(params.get("class")) || null);
  const [datum, setDatum] = useState(params.get("date") || ymd(new Date()));
  const [tag, setTag] = useState({});      // { student_id: {status,note} }
  const [summe, setSumme] = useState({});   // { student_id: {fehlt,spaet,entsch} }
  const [view, setView] = useState("tag");  // tag | uebersicht
  const [slots, setSlots] = useState([]);   // Stundenplan-Slots (falls Kalender aktiv)
  // Kam eine Klasse per Link (Kalender), nicht auf heutige Klassen filtern —
  // sonst könnte genau diese Klasse aus der Auswahl fallen.
  const [nurHeute, setNurHeute] = useState(!params.get("class"));
  const [offen, setOffen] = useState(null); // aufgeklappter Schüler in der Übersicht
  const [verlauf, setVerlauf] = useState([]);
  const [stunde, setStunde] = useState(0); // 0 = ganzer Tag, sonst Stundenplan-Period

  useEffect(() => {
    const stop = swr("classes", "/api/classes", (d) => setClasses(Array.isArray(d) ? d : []));
    if (kalenderAktiv) fetch("/api/kalender/timetable").then((r) => (r.ok ? r.json() : null)).then((d) => setSlots(d?.slots || [])).catch(() => {});
    return stop;
  }, [kalenderAktiv]);

  // Klassen, die am gewählten Wochentag im Stundenplan stehen.
  const weekday = (new Date(datum + "T00:00:00").getDay() + 6) % 7; // 0 = Montag
  const heutigeIds = useMemo(() => new Set(slots.filter((s) => s.weekday === weekday && s.class_id).map((s) => s.class_id)), [slots, weekday]);
  // Stunden dieser Klasse am gewählten Wochentag (für die optionale Stunden-Zuordnung).
  const tagStunden = useMemo(() => [...new Set(slots.filter((s) => s.weekday === weekday && s.class_id === classId).map((s) => s.period))].sort((a, b) => a - b), [slots, weekday, classId]);
  const filterAktiv = kalenderAktiv && nurHeute && view === "tag" && heutigeIds.size > 0;
  const sichtbareKlassen = filterAktiv ? classes.filter((c) => heutigeIds.has(c.id)) : classes;

  // Gültige Klasse sicherstellen, wenn Filter greift.
  useEffect(() => {
    if (!sichtbareKlassen.length) return;
    if (classId === null || !sichtbareKlassen.some((c) => c.id === classId)) { const w = lastClass(); setClassId(sichtbareKlassen.some((c) => c.id === w) ? w : sichtbareKlassen[0].id); }
  }, [sichtbareKlassen, classId]);

  // Tag-Ansicht ist immer heute (Tagesauswahl entfernt).
  useEffect(() => { if (view === "tag") setDatum(ymd(new Date())); }, [view]);

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const students = cls?.students || [];

  const isoOf = (d) => new Date(d + "T00:00:00").toISOString();
  const loadTag = useCallback(() => {
    if (!classId) return;
    // Bei gewählter Stunde diese Stunde laden (Server belegt sie aus der
    // vorherigen vor); Stunde 0 = ganzer Tag (stärkster Status).
    const p = stunde ? `&period=${stunde}` : "";
    fetch(`${API}/${classId}?date=${isoOf(datum)}${p}`).then((r) => (r.ok ? r.json() : {})).then((d) => setTag(d || {})).catch(() => {});
  }, [classId, datum, stunde]);
  const loadSumme = useCallback(() => {
    if (!classId) return;
    fetch(`${API}/${classId}/summary`).then((r) => (r.ok ? r.json() : {})).then((d) => setSumme(d || {})).catch(() => {});
  }, [classId]);
  useEffect(() => { loadTag(); }, [loadTag]);
  useEffect(() => { if (view === "uebersicht") { loadSumme(); setOffen(null); } }, [view, loadSumme]);

  const statusOf = (sid) => tag[String(sid)]?.status || "da";
  const mark = (sid, status, dateIso, period = null) => fetch(`${API}/${classId}`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id: sid, date: dateIso, status, note: "", period }) });
  const setStatus = (sid, status) => {
    setTag((prev) => ({ ...prev, [String(sid)]: { status, note: prev[String(sid)]?.note || "" } }));
    mark(sid, status, isoOf(datum), stunde || null).catch(() => {});
  };
  const shift = (n) => { const d = new Date(datum + "T00:00:00"); d.setDate(d.getDate() + n); setDatum(ymd(d)); };

  // PDF-Report laden (Endpunkt ist auth-geschützt, daher fetch + Blob statt <a href>).
  const ladePdf = async (url, name) => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }).catch(() => null);
    if (!r || !r.ok) return;
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };

  const oeffnen = (sid) => {
    if (offen === sid) { setOffen(null); return; }
    setOffen(sid); setVerlauf([]);
    fetch(`${API}/${classId}/student/${sid}`).then((r) => (r.ok ? r.json() : [])).then((d) => setVerlauf(Array.isArray(d) ? d : [])).catch(() => {});
  };
  const verlaufAendern = async (sid, dateIso, status) => {
    await mark(sid, status, dateIso).catch(() => {});
    // Verlauf + Summe neu laden.
    fetch(`${API}/${classId}/student/${sid}`).then((r) => (r.ok ? r.json() : [])).then((d) => setVerlauf(Array.isArray(d) ? d : [])).catch(() => {});
    loadSumme();
  };

  const legende = (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
      {STATI.map((st) => (
        <span key={st} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-flex", width: 22, height: 20, borderRadius: 5, alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: COL[st] + "22", color: COL[st] }}>{t(`anwesenheit.${st}Short`)}</span>
          {t(`anwesenheit.${st}`)}
        </span>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("anwesenheit.title")}</h1>
        <KursKlasseSelect value={classId} onChange={setClassId} />
        <Tabs value={view} onChange={setView} style={{ marginLeft: "auto" }}
          options={[["tag", t("anwesenheit.day")], ["uebersicht", t("anwesenheit.overview")]]} />
      </div>

      {view === "tag" ? (
        <>
          {/* Anwesenheit ist immer für HEUTE — keine Tagesauswahl mehr. Die
              Klassenliste zeigt nur die heutigen Kurse (Stundenplan). Nachtragen
              geht weiter über die Übersicht. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600, textTransform: "capitalize" }}>
              {new Date().toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "long" })}
            </span>
            {tagStunden.length > 0 && (
              <select value={stunde} onChange={(e) => setStunde(Number(e.target.value))} style={{ ...selectStyle, marginLeft: "auto" }} title={t("anwesenheit.periodHint")}>
                <option value={0}>{t("anwesenheit.wholeDay")}</option>
                {tagStunden.map((p) => <option key={p} value={p}>{p}. {t("kalender.period")}</option>)}
              </select>
            )}
          </div>
          {legende}
          {students.length === 0 ? (
            <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("anwesenheit.noStudents")}</p>
          ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {students.map((s, i) => {
              const cur = statusOf(s.id);
              return (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)" }}>
                  <span style={{ color: "var(--text3)", fontSize: 12, minWidth: 22 }}>{i + 1}.</span>
                  <span style={{ flex: 1, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <div style={{ display: "inline-flex", gap: 4 }}>
                    {STATI.map((st) => (
                      <button key={st} onClick={() => setStatus(s.id, st)} title={t(`anwesenheit.${st}`)}
                        style={{ width: 34, height: 30, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                          border: cur === st ? `2px solid ${COL[st]}` : "1px solid var(--border2)",
                          background: cur === st ? COL[st] + "22" : "transparent", color: cur === st ? COL[st] : "var(--text3)" }}>
                        {t(`anwesenheit.${st}Short`)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 8px", flexWrap: "wrap" }}>
            <p style={{ fontSize: 13, color: "var(--text3)", margin: 0, flex: 1 }}>{t("anwesenheit.overviewHint")}</p>
            <button onClick={() => ladePdf(`${API}/${classId}/report.pdf`, `Fehlzeiten_${cls?.name || ""}.pdf`)} style={{ ...btnSecondary, padding: "6px 13px", fontSize: 13 }}>{t("anwesenheit.classPdf")}</button>
          </div>
          {legende}
          {students.length === 0 && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("anwesenheit.noStudents")}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {students.map((s, i) => {
              const a = summe[String(s.id)] || { fehlt: 0, spaet: 0, entsch: 0 };
              const leer = !a.fehlt && !a.spaet && !a.entsch;
              const auf = offen === s.id;
              return (
                <div key={s.id} style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)" }}>
                  <button onClick={() => oeffnen(s.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
                    <span style={{ color: "var(--text3)", fontSize: 12, minWidth: 22 }}>{i + 1}.</span>
                    <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
                    {leer ? <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span> : (
                      <span style={{ display: "inline-flex", gap: 8, fontSize: 12.5, fontWeight: 600 }}>
                        {a.fehlt > 0 && <span style={{ color: COL.fehlt }}>{a.fehlt}× {t("anwesenheit.fehltShort")}</span>}
                        {a.spaet > 0 && <span style={{ color: COL.spaet }}>{a.spaet}× {t("anwesenheit.spaetShort")}</span>}
                        {a.entsch > 0 && <span style={{ color: COL.entsch }}>{a.entsch}× {t("anwesenheit.entschShort")}</span>}
                      </span>
                    )}
                    <span style={{ color: "var(--text3)", fontSize: 12 }}>{auf ? "▾" : "▸"}</span>
                  </button>
                  {auf && (
                    <div style={{ borderTop: "1px solid var(--border)", padding: "8px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
                        <button onClick={() => ladePdf(`${API}/${classId}/student/${s.id}/report.pdf`, `Fehlzeiten_${s.name}.pdf`)} style={{ ...btnSecondary, padding: "4px 11px", fontSize: 12 }}>{t("anwesenheit.studentPdf")}</button>
                      </div>
                      {verlauf.length === 0 ? (
                        <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "4px 0" }}>{t("anwesenheit.noEntries")}</p>
                      ) : verlauf.map((e) => (
                        <div key={e.date} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
                          <span style={{ flex: 1, fontSize: 13 }}>{new Date(e.date).toLocaleDateString()}{e.period ? ` · ${e.period}. ${t("kalender.period")}` : ""}</span>
                          <div style={{ display: "inline-flex", gap: 4 }}>
                            {STATI.map((st) => (
                              <button key={st} onClick={() => verlaufAendern(s.id, e.date, st)} title={t(`anwesenheit.${st}`)}
                                style={{ width: 30, height: 26, borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer",
                                  border: e.status === st ? `2px solid ${COL[st]}` : "1px solid var(--border2)",
                                  background: e.status === st ? COL[st] + "22" : "transparent", color: e.status === st ? COL[st] : "var(--text3)" }}>
                                {t(`anwesenheit.${st}Short`)}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
