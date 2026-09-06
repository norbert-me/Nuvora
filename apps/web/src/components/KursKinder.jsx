import { useEffect, useState } from "react";
import {
  AddButton, Icon, ICONS, COLORS as C, CONTROL_R, badge, btnSecondary, btnSmall,
  iconBtn, sectionLabel, toolbarInput,
} from "./Icons.jsx";
import Portrait from "./Portrait.jsx";
import SchuelerAngaben from "./SchuelerAngaben.jsx";
import { askConfirm } from "../core/dialog.jsx";
import { useLanguage } from "../i18n";

// Die Kinder eines Kurses — dort gepflegt, wo man mit ihnen arbeitet.
//
// Bis hierher gab es dafür nur die Klassenmaske: eine zweite Liste neben dem
// Kurs, in dem der Unterricht stattfindet. Der Kurs wird die Bedienebene
// (Umbau vom 06.09.2026); die Klasse bleibt vorerst der Träger im Hintergrund,
// weil `students.class_id` an Noten, Karten und Scans hängt.
//
// Sortiert wird per Ziehen, und zwar `position` — NICHT die Kartennummer: die
// steht auf einer gedruckten Karte und wird von jedem Scan referenziert.
export default function KursKinder({ kursId, t: tProp }) {
  const { t } = useLanguage();
  const text = tProp || t;
  const [liste, setListe] = useState([]);
  const [neu, setNeu] = useState("");
  const [offen, setOffen] = useState(null);
  const [zieht, setZieht] = useState(null);
  const [ueber, setUeber] = useState(null);

  const laden = () => fetch(`/api/kurse/${kursId}/kinder`)
    .then((r) => (r.ok ? r.json() : [])).then((d) => setListe(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { laden(); /* eslint-disable-next-line */ }, [kursId]);

  const anlegen = async () => {
    const name = neu.trim();
    if (!name) return;
    const r = await fetch(`/api/kurse/${kursId}/kinder`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (r && r.ok) { setNeu(""); laden(); }
  };

  const entfernen = async (kind) => {
    if (!(await askConfirm(text("kurse.kindWeg", { name: kind.name })))) return;
    const r = await fetch(`/api/kurse/${kursId}/kinder/${kind.student_id}`, { method: "DELETE" }).catch(() => null);
    // 409 heißt: das Kind kommt über seine Klasse — der Hinweis des Servers ist
    // die Antwort, nicht ein stilles Nichtstun.
    if (r && r.status === 409) { const d = await r.json().catch(() => null); await askConfirm(d?.detail || text("common.error")); }
    laden();
  };

  const reihenfolge = () => {
    const ids = liste.map((_, i) => i);
    if (zieht == null || ueber == null || zieht === ueber) return ids;
    ids.splice(ueber, 0, ids.splice(ids.indexOf(zieht), 1)[0]);
    return ids;
  };

  const ablegen = async () => {
    const neueFolge = reihenfolge().map((i) => liste[i]);
    setZieht(null); setUeber(null);
    if (neueFolge.every((k, i) => k.student_id === liste[i].student_id)) return;
    setListe(neueFolge);
    await fetch(`/api/kurse/${kursId}/kinder/reihenfolge`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_ids: neueFolge.map((k) => k.student_id) }),
    }).catch(() => {});
    laden();
  };

  return (
    <div>
      <div style={{ ...sectionLabel, margin: "0 0 8px" }}>{text("kurse.kinder", { n: liste.length })}</div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anlegen()}
          placeholder={text("kurse.kindNeu")} style={{ ...toolbarInput, flex: "1 1 200px", minWidth: 0 }} />
        <AddButton onClick={anlegen} title={text("kurse.kindNeu")} />
      </div>

      {liste.length === 0 && <p style={{ fontSize: 13, color: "var(--text3)" }}>{text("kurse.kinderLeer")}</p>}

      {reihenfolge().map((idx, platz) => {
        const k = liste[idx];
        return (
          <div key={k.student_id}
            onDragOver={(e) => { e.preventDefault(); if (zieht != null) setUeber(platz); }}
            onDrop={ablegen}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 4,
              border: "1px solid var(--border)", borderRadius: CONTROL_R,
              background: zieht === platz ? "var(--bg2)" : "transparent" }}>
            <span draggable onDragStart={() => setZieht(platz)} onDragEnd={() => { setZieht(null); setUeber(null); }}
              className="drag-handle" title={text("classes.reorderHint")}
              style={{ color: "var(--text3)", cursor: "grab", display: "inline-flex", flexShrink: 0 }}>
              <Icon d={ICONS.grip} size={15} />
            </span>
            {/* Die Nummer ist der PLATZ; die Kartennummer steht daneben nur,
                wo sie gebraucht wird (Abstimmkarte). */}
            <span style={{ width: 26, textAlign: "right", fontSize: 13, color: "var(--text3)" }}>{platz + 1}.</span>
            <Portrait student={{ id: k.person_id || k.student_id, name: k.name, has_photo: k.has_photo }}
              size={28} form="eckig" quelle={k.person_id ? "person" : "schueler"} />
            <span style={{ flex: 1, fontSize: 14 }}>{k.name}</span>
            {k.niveau && <span style={badge(k.niveau === "E" ? C.info : C.success)}>{k.niveau}</span>}
            <button onClick={() => setOffen(offen === k.student_id ? null : k.student_id)}
              style={{ ...btnSecondary, ...btnSmall }}>{text("kurse.kindAngaben")}</button>
            <button onClick={() => entfernen(k)} className="icon-btn" style={{ ...iconBtn, padding: 4 }}
              title={text("common.delete")} aria-label={text("common.delete")}>
              <Icon d={ICONS.trash} size={15} color={C.danger} />
            </button>
          </div>
        );
      })}

      {offen != null && (
        <div style={{ marginTop: 12 }}>
          <SchuelerAngaben studentId={offen} kursId={kursId} t={text} />
        </div>
      )}
    </div>
  );
}
