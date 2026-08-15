// „In Noten übernehmen" — ein Dialog für alle Brücken ins Notenbuch.
//
// Er stand zweimal fast wortgleich da: `NotenBrueckeModal` in Karten.jsx
// (Meisterung → Note) und `NotenUebernahme` in Klassenarbeit.jsx (Punkte →
// Note) — gleiche Felder, gleicher Endpunkt, gleiche Fehlerbehandlung.
// Verschieden war nur, WIE die Noten zustande kommen; die fertige Liste
// `[{ student_id, value }]` rechnet deshalb weiter das Modul aus.
//
// Regel 3 bleibt gewahrt: eine Anzeige, kein Modul-Import. Wer den Dialog
// öffnet, hat vorher geprüft, ob das Notenbuch überhaupt an ist.
import { useState } from "react";

import { btnPrimary, btnSecondary, COLORS as C, inputStyle, Modal } from "./Icons.jsx";
import AbschnittWahl from "./AbschnittWahl.jsx";
import { alsJson } from "../core/melden.js";
import { useLanguage } from "../i18n/index.jsx";

/**
 * @param titel     Überschrift und Beschriftung des Dialogs
 * @param hinweis   Satz unter der Überschrift (nennt die Zahl der Noten)
 * @param grades    [{ student_id, value }] — schon fertig gerechnet
 * @param spalte    Vorschlag für den Spaltennamen
 * @param notiz     was als Herkunft an der Spalte steht
 * @param quelle    `source_kind` für den Server ("karten", "klassenarbeit", …)
 */
export default function NotenUebernahme({ titel, hinweis, classId, kursId, grades, spalte, notiz, quelle, onClose }) {
  const { t } = useLanguage();
  const [sectionId, setSectionId] = useState(null);
  const [name, setName] = useState(spalte);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!sectionId) { setErr(t("notenimp.noSection")); return; }
    if (!name.trim()) { setErr(t("noten.columnName")); return; }
    setBusy(true); setErr("");
    const res = await fetch("/api/noten/import-grades", alsJson("POST", {
      class_id: classId, kurs_id: kursId, section_id: Number(sectionId),
      column_name: name.trim(), note: notiz, source_kind: quelle, grades,
    })).catch(() => null);
    setBusy(false);
    if (res && res.ok) onClose();
    else { const b = res ? await res.json().catch(() => ({})) : {}; setErr(typeof b.detail === "string" ? b.detail : t("common.notWork")); }
  };

  const aus = busy || grades.length === 0 || !sectionId;
  return (
    <Modal onClose={onClose} width={440} label={titel}>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{titel}</h3>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 12px" }}>{hinweis}</p>
      <AbschnittWahl classId={classId} kursId={kursId} value={sectionId} onChange={setSectionId} />
      <div style={{ fontSize: 13, color: "var(--text2)", margin: "12px 0 5px" }}>{t("noten.columnName")}</div>
      <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
      {err && <p style={{ color: C.danger, fontSize: 13, marginTop: 12 }}>{err}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button onClick={submit} disabled={aus} style={{ ...btnPrimary, opacity: aus ? 0.6 : 1 }}>{t("common.save")}</button>
        <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
      </div>
    </Modal>
  );
}
