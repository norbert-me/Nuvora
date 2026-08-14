// Abschnitt des Notenbuchs wählen — für jede Brücke, die eine Notenspalte
// anlegt (CardVote-Test, Karten-Meisterung, Klassenarbeit).
//
// Eine Quelle statt dreier Nachbauten: die drei Dialoge hatten dieselbe Liste
// dreimal, mit drei verschiedenen Sackgassen. Fehlte der Abschnitt, stand dort
// „Lege dort zuerst einen an" — und man musste den Dialog verlassen, das
// Notenbuch suchen, zurückkommen. Hier wird er an Ort und Stelle angelegt,
// samt Halbjahr: sonst landet die Spalte im 2. Halbjahr im ersten.
import { useEffect, useState } from "react";
import { COLORS as C, btnSecondary, inputStyle, selectStyle } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const feld = { ...selectStyle, width: "100%" };

/**
 * @param classId  Kern-Klasse
 * @param kursId   Fach (optional) — Abschnitte hängen am Kurs
 * @param value    gewählte section_id (Zahl) oder null
 * @param onChange (id|null) => void
 */
export default function AbschnittWahl({ classId, kursId = null, value, onChange }) {
  const { t } = useLanguage();
  const [sections, setSections] = useState(null);
  const [neu, setNeu] = useState(false);
  const [name, setName] = useState("");
  const [term, setTerm] = useState("1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // term=all: das Halbjahr steht als Etikett an der Option. Ein eigener
  // Halbjahr-Filter würde im 2. Halbjahr die Abschnitte des ersten verstecken,
  // obwohl eine Spalte durchaus dorthin gehören kann (Nachzügler).
  useEffect(() => {
    const q = `?term=all${kursId != null ? `&kurs_id=${kursId}` : ""}`;
    fetch(`/api/noten/classes/${classId}/sections${q}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const list = Array.isArray(d) ? d : [];
        setSections(list);
        if (list[0]) onChange(list[0].id);
        else { setNeu(true); onChange(null); }
      })
      .catch(() => { setSections([]); setNeu(true); });
  }, [classId, kursId]);

  const label = (s) => `${s.term === "2" ? t("noten.term2") : t("noten.term1")} · ${s.name}`;

  const anlegen = async () => {
    if (!name.trim()) { setErr(t("noten.sectionName")); return; }
    setBusy(true); setErr("");
    const q = `?term=${term}${kursId != null ? `&kurs_id=${kursId}` : ""}`;
    const res = await fetch(`/api/noten/classes/${classId}/sections${q}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), weight: 0, position: 0 }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { setErr(t("common.notWork")); return; }
    const sec = await res.json();
    setSections((alt) => [...(alt || []), sec]);
    onChange(sec.id);
    setNeu(false);
  };

  if (sections === null) return null;

  const lbl = { fontSize: 12.5, color: "var(--text2)", margin: "0 0 5px" };

  if (neu) {
    return (
      <div>
        {sections.length === 0 && (
          <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 10px" }}>{t("notenimp.noSection")}</p>
        )}
        <div style={lbl}>{t("noten.sectionName")}</div>
        <input value={name} placeholder={t("noten.newSection")} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
        <div style={{ ...lbl, marginTop: 12 }}>{t("noten.term")}</div>
        <select value={term} onChange={(e) => setTerm(e.target.value)} style={feld}>
          <option value="1">{t("noten.term1")}</option>
          <option value="2">{t("noten.term2")}</option>
        </select>
        {err && <p style={{ color: C.danger, fontSize: 12.5, marginTop: 8 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={anlegen} disabled={busy} style={{ ...btnSecondary, fontSize: 13 }}>{t("noten.addSection")}</button>
          {sections.length > 0 && (
            <button onClick={() => setNeu(false)} style={{ ...btnSecondary, fontSize: 13 }}>{t("common.abort")}</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={lbl}>{t("notenimp.section")}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} style={{ ...selectStyle, flex: 1 }}>
          {sections.map((s) => <option key={s.id} value={s.id}>{label(s)}</option>)}
        </select>
        <button onClick={() => { setNeu(true); setName(""); }} style={{ ...btnSecondary, fontSize: 13, whiteSpace: "nowrap" }}>
          {t("noten.addSection")}
        </button>
      </div>
    </div>
  );
}
