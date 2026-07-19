// Modul Zufallsschüler — zieht per Knopfdruck eine zufällige Person aus einer
// Klasse. Reiner Client: liest nur die Kern-Klassen, speichert nichts.
// "Ohne Wiederholung" merkt sich die schon Gezogenen, bis die Klasse durch ist.
import { useState, useEffect, useMemo } from "react";
import { pageTitle, btnPrimary, btnSecondary, selectStyle, Toggle } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { swr } from "../core/cache.js";

export default function Zufall() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [ohneWdh, setOhneWdh] = useState(true);
  const [gezogen, setGezogen] = useState([]); // IDs schon gezogener Schüler
  const [aktuell, setAktuell] = useState(null); // aktueller Schüler
  const [rollt, setRollt] = useState(false);

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (classId === null && list.length) setClassId(list[0].id);
    });
  }, []);

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const students = cls?.students || [];

  // Klassenwechsel/Umschalten: Runde zurücksetzen.
  useEffect(() => { setGezogen([]); setAktuell(null); }, [classId, ohneWdh]);

  const pool = ohneWdh ? students.filter((s) => !gezogen.includes(s.id)) : students;

  const ziehen = () => {
    if (!students.length || rollt) return;
    const kandidaten = pool.length ? pool : students; // Pool leer -> neue Runde
    if (ohneWdh && !pool.length) setGezogen([]);
    // Kurze "Roll"-Animation: ein paar schnelle Namen, dann Ergebnis.
    setRollt(true);
    let ticks = 0;
    const iv = setInterval(() => {
      setAktuell(students[Math.floor(Math.random() * students.length)]);
      if (++ticks >= 10) {
        clearInterval(iv);
        const pick = kandidaten[Math.floor(Math.random() * kandidaten.length)];
        setAktuell(pick);
        if (ohneWdh) setGezogen((g) => [...g, pick.id]);
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
      </div>

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
                {t("zufall.progress", { done: gezogen.length, total: students.length })}
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
