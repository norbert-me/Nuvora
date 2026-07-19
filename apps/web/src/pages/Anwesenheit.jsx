// Modul Anwesenheit — Anwesenheit/Fehlzeiten je Klasse und Tag.
// Pro Schüler ein Status (da/fehlt/verspätet/entschuldigt). "da" ist Normalfall
// und wird nicht gespeichert. Zusätzlich eine Fehlzeiten-Übersicht.
import { useState, useEffect, useMemo, useCallback } from "react";
import { pageTitle, btnSecondary, selectStyle } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { swr } from "../core/cache.js";

const API = "/api/anwesenheit";
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const STATI = ["da", "fehlt", "spaet", "entsch"];
const COL = { da: "#0a7d3e", fehlt: "#d1350f", spaet: "#b8860b", entsch: "#2563eb" };

export default function Anwesenheit() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [datum, setDatum] = useState(ymd(new Date()));
  const [tag, setTag] = useState({});      // { student_id: {status,note} }
  const [summe, setSumme] = useState({});   // { student_id: {fehlt,spaet,entsch} }
  const [view, setView] = useState("tag");  // tag | uebersicht

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (classId === null && list.length) setClassId(list[0].id);
    });
  }, []);

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const students = cls?.students || [];

  const loadTag = useCallback(() => {
    if (!classId) return;
    fetch(`${API}/${classId}?date=${new Date(datum + "T00:00:00").toISOString()}`).then((r) => (r.ok ? r.json() : {})).then((d) => setTag(d || {})).catch(() => {});
  }, [classId, datum]);
  const loadSumme = useCallback(() => {
    if (!classId) return;
    fetch(`${API}/${classId}/summary`).then((r) => (r.ok ? r.json() : {})).then((d) => setSumme(d || {})).catch(() => {});
  }, [classId]);
  useEffect(() => { loadTag(); }, [loadTag]);
  useEffect(() => { if (view === "uebersicht") loadSumme(); }, [view, loadSumme]);

  const statusOf = (sid) => tag[String(sid)]?.status || "da";
  const setStatus = (sid, status) => {
    setTag((prev) => ({ ...prev, [String(sid)]: { status, note: prev[String(sid)]?.note || "" } }));
    fetch(`${API}/${classId}`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: sid, date: new Date(datum + "T00:00:00").toISOString(), status, note: "" }) }).catch(() => {});
  };
  const shift = (n) => { const d = new Date(datum + "T00:00:00"); d.setDate(d.getDate() + n); setDatum(ymd(d)); };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("anwesenheit.title")}</h1>
        <select value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))} style={selectStyle}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ display: "inline-flex", border: "1px solid var(--border2)", borderRadius: 980, overflow: "hidden", marginLeft: "auto" }}>
          {[["tag", t("anwesenheit.day")], ["uebersicht", t("anwesenheit.overview")]].map(([v, l]) => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "6px 14px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: view === v ? "var(--accent)" : "transparent", color: view === v ? "#fff" : "var(--text2)" }}>{l}</button>
          ))}
        </div>
      </div>

      {students.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("anwesenheit.noStudents")}</p>
      ) : view === "tag" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <button onClick={() => shift(-1)} style={{ ...btnSecondary, padding: "5px 12px" }}>‹</button>
            <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} style={{ ...selectStyle, padding: "7px 11px" }} />
            <button onClick={() => shift(1)} style={{ ...btnSecondary, padding: "5px 12px" }}>›</button>
            <button onClick={() => setDatum(ymd(new Date()))} style={{ ...btnSecondary, padding: "5px 12px" }}>{t("anwesenheit.today")}</button>
          </div>
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
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {students.map((s, i) => {
            const a = summe[String(s.id)] || { fehlt: 0, spaet: 0, entsch: 0 };
            const leer = !a.fehlt && !a.spaet && !a.entsch;
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)" }}>
                <span style={{ color: "var(--text3)", fontSize: 12, minWidth: 22 }}>{i + 1}.</span>
                <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
                {leer ? <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span> : (
                  <div style={{ display: "inline-flex", gap: 8, fontSize: 12.5, fontWeight: 600 }}>
                    {a.fehlt > 0 && <span style={{ color: COL.fehlt }}>{a.fehlt}× {t("anwesenheit.fehltShort")}</span>}
                    {a.spaet > 0 && <span style={{ color: COL.spaet }}>{a.spaet}× {t("anwesenheit.spaetShort")}</span>}
                    {a.entsch > 0 && <span style={{ color: COL.entsch }}>{a.entsch}× {t("anwesenheit.entschShort")}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
