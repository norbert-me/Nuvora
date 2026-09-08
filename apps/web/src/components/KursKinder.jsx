import { useEffect, useState } from "react";
import {
  AddButton, Icon, ICONS, COLORS as C, CONTROL_R, badge, btnSecondary, btnSmall,
  dateiWaehlen, iconBtn, sectionLabel, toolbarInput,
} from "./Icons.jsx";
import Portrait from "./Portrait.jsx";
import SchuelerAngaben from "./SchuelerAngaben.jsx";
import BildZuschnitt from "./BildZuschnitt.jsx";
import { askConfirm, askPrompt } from "../core/dialog.jsx";
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
  const [zuschnitt, setZuschnitt] = useState(null);   // { personId, datei }
  const [importOffen, setImportOffen] = useState(false);
  const [importText, setImportText] = useState("");

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

  // Name UND Foto gehören der Person — nicht der Zeile, in der sie gerade
  // steht. Deshalb gehen beide an /api/personen; die Listenzeilen bekommen es
  // mit, solange sie es noch selbst führen.
  const umbenennen = async (kind) => {
    const name = await askPrompt(text("kurse.kindName"), { initial: kind.name });
    if (!name || !name.trim() || !kind.person_id) return;
    await fetch(`/api/personen/${kind.person_id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    }).catch(() => {});
    laden();
  };

  const fotoWaehlen = (kind) => {
    if (!kind.person_id) return;
    dateiWaehlen((datei) => setZuschnitt({ personId: kind.person_id, datei }), "image/*");
  };

  const fotoHochladen = async (personId, quadrat) => {
    const daten = new FormData();
    daten.append("file", quadrat);
    await fetch(`/api/personen/${personId}/photo`, { method: "POST", body: daten }).catch(() => {});
    laden();
  };

  const importieren = async () => {
    if (!importText.trim()) return;
    const r = await fetch(`/api/kurse/${kursId}/kinder/import`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: importText }),
    }).catch(() => null);
    if (r && r.ok) { setImportText(""); setImportOffen(false); laden(); }
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
        <button onClick={() => setImportOffen((v) => !v)} style={{ ...btnSecondary, ...btnSmall }}>
          {text("kurse.kindListe")}
        </button>
      </div>

      {/* Namensliste einfügen: der Alltag beim Anlegen eines Kurses. Eine Zeile
          je Kind, Doppelte werden übersprungen statt verdoppelt. */}
      {importOffen && (
        <div style={{ marginBottom: 12 }}>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={5}
            placeholder={text("kurse.kindListePlatzhalter")}
            style={{ ...toolbarInput, width: "100%", boxSizing: "border-box", height: "auto", resize: "vertical", lineHeight: 1.5 }} />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
            <button onClick={() => { setImportOffen(false); setImportText(""); }} style={{ ...btnSecondary, ...btnSmall }}>{text("common.abort")}</button>
            <button onClick={importieren} style={{ ...btnSecondary, ...btnSmall }}>{text("kurse.kindListeAn")}</button>
          </div>
        </div>
      )}

      {liste.length === 0 && <p style={{ fontSize: 13, color: "var(--text3)" }}>{text("kurse.kinderLeer")}</p>}

      {reihenfolge().map((idx, platz) => {
        const k = liste[idx];
        return (
          <div key={k.student_id}>
          <div
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
            {/* Der Name oeffnet die Angaben des Kindes — das ist die Frage,
                die man an einen Namen in einer Kursliste stellt („was gilt bei
                dem?"), und dort stehen Niveau, Foerderschwerpunkt und der
                Nachteilsausgleich FUER DIESEN KURS beieinander. Umbenannt wird
                mit dem Stift daneben: das ist der seltenere Handgriff, und als
                Klick auf den Namen verdeckte er den haeufigen. */}
            <button onClick={() => setOffen(offen === k.student_id ? null : k.student_id)}
              title={text("kurse.kindAngaben")}
              style={{ flex: 1, fontSize: 14, textAlign: "left", border: "none", background: "none", cursor: "pointer", color: "var(--text)", padding: 0 }}>
              {k.name}
            </button>
            {k.niveau && <span style={badge(k.niveau === "E" ? C.info : C.success)}>{k.niveau}</span>}
            {/* Nur DASS etwas vereinbart ist. Was genau, steht im Dialog des
                Kindes — eine Kursliste ist kein Ort fuer Art-9-Angaben. */}
            {k.nta && <span style={badge(C.warning)} title={text("kurse.ntaHint")}>{text("kurse.nta")}</span>}
            <button onClick={() => umbenennen(k)} className="icon-btn" style={{ ...iconBtn, padding: 4 }}
              title={text("kurse.kindName")} aria-label={text("kurse.kindName")}>
              <Icon d={ICONS.edit} size={15} />
            </button>
            <button onClick={() => fotoWaehlen(k)} className="icon-btn" style={{ ...iconBtn, padding: 4 }}
              title={text("kurse.kindFoto")} aria-label={text("kurse.kindFoto")}>
              <Icon d={ICONS.camera} size={15} />
            </button>
            <button onClick={() => entfernen(k)} className="icon-btn" style={{ ...iconBtn, padding: 4 }}
              title={text("common.delete")} aria-label={text("common.delete")}>
              <Icon d={ICONS.trash} size={15} color={C.danger} />
            </button>
            </div>
            {/* Die Angaben stehen UNTER ihrer Zeile, nicht am Listenende: bei
                dreissig Kindern stand die geoeffnete Maske sonst weit weg von
                dem Namen, auf den geklickt wurde. */}
            {offen === k.student_id && (
              <div style={{ margin: "0 0 8px 34px", paddingLeft: 12, borderLeft: "2px solid var(--border2)" }}>
                <SchuelerAngaben studentId={k.student_id} kursId={kursId} t={text} />
              </div>
            )}
          </div>
        );
      })}

      {zuschnitt && (
        <BildZuschnitt datei={zuschnitt.datei}
          onAbbruch={() => setZuschnitt(null)}
          onFertig={(quadrat) => { const pid = zuschnitt.personId; setZuschnitt(null); fotoHochladen(pid, quadrat); }} />
      )}


    </div>
  );
}
