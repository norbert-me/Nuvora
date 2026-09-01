// Was zu EINER Person gehört — an einem Ort, von überall erreichbar.
//
// Vorher lag es auseinander: E/G stand im Kurs, der Förderschwerpunkt in der
// Klasse, die Fördermaßnahmen wieder im Kurs. Wer im Notenbuch auf einen Namen
// klickte, sah davon nichts (der Roster lieferte nur Name und Nummer) und
// konnte erst recht nichts ändern — für „Zeitzuschlag eintragen" musste man das
// Notenbuch verlassen, in die Kursverwaltung wechseln und zurückkommen.
//
// Diese Komponente holt die Person einzeln (`GET /api/classes/students/{id}`,
// bewusst nicht in jeder Liste: Art-9-Angaben von dreißig Kindern braucht eine
// Notentabelle nicht) und schreibt in zwei Richtungen:
//   * Person  → PATCH /api/classes/students/{id}  (Niveau, Förderschwerpunkte,
//     Notiz, Klassenleitung) — wirkt auf alle Fach-Klassen-Zeilen der Person.
//   * Kurs    → PUT /api/kurse/{id}/massnahmen    (Nachteilsausgleiche) — die
//     wirken fachbezogen und bleiben deshalb am Kurs. Ohne gewählten Kurs wird
//     der Block ausgeblendet statt an die falsche Ebene geschrieben.
//
// Gespeichert wird auf Knopfdruck (Speicherleiste), wie überall sonst.
import { useEffect, useRef, useState } from "react";
import { FOERDER, MASSNAHMEN } from "../core/foerderung.js";
import { alsJson, hol, sende } from "../core/melden.js";
import Speicherleiste, { useEntwurf } from "./Speichern.jsx";
import { COLORS as C, ICONS, Icon, NiveauToggle, chipStyle, iconBtn, inputStyle, selectStyle, toolbarInput } from "./Icons.jsx";

const titel = { fontSize: 13, fontWeight: 600, color: "var(--text)", margin: "14px 0 6px" };

export default function SchuelerAngaben({ studentId, kursId = null, t }) {
  const [person, setPerson] = useState(null);
  const [basis, setBasis] = useState(null);
  const entwurfRef = useRef(null);
  const e = useEntwurf(basis || { niveau: "", foerder: [], notizen: "", klassenlehrer: "", massnahmen: [] }, async (w) => {
    const ok = await sende(`/api/classes/students/${studentId}`, alsJson("PATCH", {
      niveau: w.niveau, foerder: w.foerder, notizen: w.notizen, klassenlehrer: w.klassenlehrer,
    }), t("classes.editStudent"));
    if (!ok) return false;
    // Maßnahmen gehen an den Kurs — nur wenn es einen gibt und sie sich geändert haben.
    if (kursId && JSON.stringify(w.massnahmen) !== JSON.stringify(basis?.massnahmen || [])) {
      const ok2 = await sende(`/api/kurse/${kursId}/massnahmen`,
        alsJson("PUT", { name: person?.name || "", massnahmen: w.massnahmen }), t("kurse.editMeasures"));
      if (!ok2) return false;
    }
    setBasis(w);
  });
  entwurfRef.current = e;

  useEffect(() => {
    if (!studentId) return;
    hol(`/api/classes/students/${studentId}`, null).then((d) => {
      if (!d) return;
      setPerson(d);
      const eigene = (d.massnahmen || []).filter((m) => !kursId || m.kurs_id == null || m.kurs_id === kursId);
      const stand = { niveau: d.niveau || "", foerder: d.foerder || [], notizen: d.notizen || "",
                      klassenlehrer: d.klassenlehrer || "", massnahmen: eigene };
      setBasis(stand);
      entwurfRef.current?.setz(stand);
    });
  }, [studentId, kursId]); // eslint-disable-line

  if (!person || !basis) return null;
  const w = e.wert;
  const toggleFoerder = (wert) => e.setz((v) => ({
    foerder: (v.foerder || []).includes(wert) ? v.foerder.filter((f) => f !== wert) : [...(v.foerder || []), wert],
  }));
  const setM = (i, feld, val) => e.setz((v) => ({ massnahmen: v.massnahmen.map((m, j) => (j === i ? { ...m, [feld]: val } : m)) }));

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <NiveauToggle wert={w.niveau} onChange={(v) => e.setz({ niveau: v })} size={26} title={t("noten.course")} />
        <span style={{ fontSize: 13, color: "var(--text2)" }}>
          {w.niveau === "E" ? t("noten.courseE") : w.niveau === "G" ? t("noten.courseG") : t("noten.courseNone")}
        </span>
      </div>

      <div style={titel}>{t("classes.supportNeeds")}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {FOERDER.map(([wert, erklaerung]) => {
          const on = (w.foerder || []).includes(wert);
          return (
            <label key={wert} title={erklaerung}
              style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", fontSize: 13,
                cursor: "pointer", userSelect: "none",
                border: on ? "1px solid var(--accent)" : "1px solid var(--border2)",
                background: on ? "var(--accent-bg)" : "var(--bg)", color: on ? "var(--accent)" : "var(--text2)" }}>
              <input type="checkbox" checked={on} onChange={() => toggleFoerder(wert)} style={{ margin: 0, cursor: "pointer" }} />
              {wert}
            </label>
          );
        })}
      </div>

      {/* Nachteilsausgleiche wirken fachbezogen — ohne gewählten Kurs gäbe es
          keine Ebene, an die sie gehören. */}
      {kursId ? (<>
        <div style={titel}>{t("classes.measures")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(w.massnahmen || []).map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select value={m.art} onChange={(ev) => setM(i, "art", ev.target.value)}
                title={(MASSNAHMEN.find(([x]) => x === m.art) || [])[1] || ""} style={{ ...selectStyle, minWidth: 160 }}>
                {MASSNAHMEN.map(([wert]) => <option key={wert} value={wert}>{wert}</option>)}
              </select>
              <input value={m.detail || ""} onChange={(ev) => setM(i, "detail", ev.target.value)}
                placeholder={t("classes.measureDetail")} maxLength={300} style={{ ...toolbarInput, flex: 1, minWidth: 120 }} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text2)", cursor: "pointer" }}
                title={t("classes.measureExamHint")}>
                <input type="checkbox" checked={!!m.arbeit} onChange={(ev) => setM(i, "arbeit", ev.target.checked)} style={{ margin: 0 }} />
                {t("classes.measureExam")}
              </label>
              <button onClick={() => e.setz((v) => ({ massnahmen: v.massnahmen.filter((_, j) => j !== i) }))}
                className="icon-btn" style={iconBtn} title={t("common.delete")} aria-label={t("common.delete")}>
                <Icon d={ICONS.trash} size={14} color={C.danger} />
              </button>
            </div>
          ))}
          <button onClick={() => e.setz((v) => ({ massnahmen: [...v.massnahmen, { art: MASSNAHMEN[0][0], detail: "", arbeit: true }] }))}
            style={{ ...chipStyle, alignSelf: "flex-start", cursor: "pointer", border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text2)", fontSize: 13 }}>
            + {t("classes.measureAdd")}
          </button>
        </div>
      </>) : null}

      <div style={titel}>{t("classes.notes")}</div>
      <textarea value={w.notizen || ""} onChange={(ev) => e.setz({ notizen: ev.target.value })}
        rows={2} maxLength={2000} placeholder={t("classes.notesPlaceholder")}
        style={{ ...inputStyle, width: "100%", maxWidth: "100%", fontSize: 13, resize: "vertical", overflowX: "hidden", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }} />

      <Speicherleiste entwurf={e} style={{ marginTop: 8 }} klein />
    </div>
  );
}
