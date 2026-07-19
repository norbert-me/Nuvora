// Modul Zufallsschüler — zieht per Knopfdruck eine zufällige Person aus einer
// Klasse. Reiner Client: liest nur die Kern-Klassen, speichert nichts.
// "Ohne Wiederholung" merkt sich die schon Gezogenen, bis die Klasse durch ist.
import { useState, useEffect, useMemo } from "react";
import { pageTitle, btnPrimary, btnSecondary, selectStyle, Toggle } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { swr , lastClass, rememberClass } from "../core/cache.js";

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Zufall() {
  const { t } = useLanguage();
  const { modules } = useModules();
  const anwesenheitAktiv = modules.find((m) => m.key === "anwesenheit")?.active ?? false;
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [ohneWdh, setOhneWdh] = useState(true);
  const [skipAbs, setSkipAbs] = useState(true);    // Abwesende überspringen
  const [gewichtet, setGewichtet] = useState(false); // am seltensten dran bevorzugen
  const [gezogen, setGezogen] = useState([]); // IDs schon gezogener Schüler (diese Runde)
  const [counts, setCounts] = useState({});   // wie oft je Schüler gezogen (Klasse)
  const [absent, setAbsent] = useState(new Set()); // heute abwesende IDs
  const [aktuell, setAktuell] = useState(null);
  const [rollt, setRollt] = useState(false);

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (classId === null && list.length) { const w = lastClass(); setClassId(list.some((c) => c.id === w) ? w : list[0].id); }
    });
  }, []);

  useEffect(() => { if (classId) rememberClass(classId); }, [classId]);

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const students = cls?.students || [];

  // Heutige Abwesende laden (nur wenn Modul aktiv und Option an).
  useEffect(() => {
    if (!anwesenheitAktiv || !skipAbs || !classId) { setAbsent(new Set()); return; }
    fetch(`/api/anwesenheit/${classId}?date=${new Date(ymd(new Date()) + "T00:00:00").toISOString()}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => { const s = new Set(); Object.entries(d || {}).forEach(([sid, v]) => { if (v.status && v.status !== "da") s.add(Number(sid)); }); setAbsent(s); })
      .catch(() => {});
  }, [anwesenheitAktiv, skipAbs, classId]);

  // Klassenwechsel/Umschalten: Runde und Zählung zurücksetzen.
  useEffect(() => { setGezogen([]); setAktuell(null); setCounts({}); }, [classId, ohneWdh]);

  const anwesend = students.filter((s) => !absent.has(s.id));
  const basis = anwesend.length ? anwesend : students; // alle abwesend -> nicht blockieren
  const pool = ohneWdh ? basis.filter((s) => !gezogen.includes(s.id)) : basis;

  // Gewichtete Auswahl: seltener Gezogene bekommen mehr Gewicht.
  const waehle = (list) => {
    if (!gewichtet) return list[Math.floor(Math.random() * list.length)];
    const max = Math.max(0, ...list.map((s) => counts[s.id] || 0));
    const w = list.map((s) => (max - (counts[s.id] || 0)) + 1); // je seltener, desto größer
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  };

  const ziehen = () => {
    if (!basis.length || rollt) return;
    const leer = ohneWdh && !pool.length;
    const kandidaten = leer ? basis : pool;
    if (leer) setGezogen([]);
    setRollt(true);
    let ticks = 0;
    const iv = setInterval(() => {
      setAktuell(basis[Math.floor(Math.random() * basis.length)]);
      if (++ticks >= 10) {
        clearInterval(iv);
        const pick = waehle(kandidaten);
        setAktuell(pick);
        if (ohneWdh) setGezogen((g) => [...g, pick.id]);
        setCounts((c) => ({ ...c, [pick.id]: (c[pick.id] || 0) + 1 }));
        setRollt(false);
      }
    }, 55);
  };

  const reset = () => { setGezogen([]); setAktuell(null); };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1 style={pageTitle}>{t("zufall.title")}</h1>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <select value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))} style={selectStyle}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Toggle checked={ohneWdh} onChange={setOhneWdh} label={t("zufall.noRepeat")} />
        <Toggle checked={gewichtet} onChange={setGewichtet} label={t("zufall.weighted")} />
        {anwesenheitAktiv && <Toggle checked={skipAbs} onChange={setSkipAbs} label={t("zufall.skipAbsent")} />}
      </div>
      {skipAbs && anwesenheitAktiv && absent.size > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--text3)", marginTop: -8, marginBottom: 16 }}>{t("zufall.absentSkipped", { n: absent.size })}</p>
      )}

      {students.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("zufall.noStudents")}</p>
      ) : (
        <>
          <div style={{ border: "1px solid var(--border)", borderRadius: 18, background: "var(--card)", padding: "48px 24px", textAlign: "center", marginBottom: 18 }}>
            <div style={{ fontSize: aktuell ? 34 : 18, fontWeight: 800, color: aktuell ? "var(--text)" : "var(--text3)", opacity: rollt ? 0.6 : 1, transition: "opacity .1s", minHeight: 44 }}>
              {aktuell ? aktuell.name : t("zufall.hint")}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={ziehen} disabled={rollt} style={{ ...btnPrimary, fontSize: 16, padding: "12px 26px", opacity: rollt ? 0.6 : 1 }}>{t("zufall.draw")}</button>
            {ohneWdh && (
              <span style={{ fontSize: 13, color: "var(--text3)" }}>
                {t("zufall.progress", { done: gezogen.length, total: basis.length })}
              </span>
            )}
            {ohneWdh && gezogen.length > 0 && (
              <button onClick={reset} style={{ ...btnSecondary, marginLeft: "auto" }}>{t("zufall.reset")}</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
