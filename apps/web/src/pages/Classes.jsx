// Klassen und Schueler sind Nuvora-Kerndaten, kein Modulbesitz — beide Module
// arbeiten darauf. Deshalb liegt diese Seite im Rahmen unter /classes.
//
// Die Kartennummer (students.card_id) ist dagegen CardVote-Zubehoer: sie ist
// die Nummer der bedruckten ArUco-Karte. Der Kern speichert sie zwar (sie
// identifiziert die Person innerhalb der Klasse), zeigt sie aber nur, wenn
// CardVote aktiviert ist — sonst traegt der Rahmen Modulwissen zur Schau.
//
// Kartendruck und Auswertung liegen NICHT hier, sondern im Modul unter
// /cardvote/cards: der Kern kennt Klassen, nicht was ein Modul damit tut.
import { useState, useEffect } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { undoDelete } from "../core/undo.jsx";
import { useSearchParams } from "react-router-dom";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { AddButton, COLORS as C, CONTROL_R, ICONS, Icon, Tabs, btnSecondary, btnSmall, cardStyle, chipStyle, dateiWaehlen, iconBtn, inputStyle, pageApp, pageTitle, toolbarBtn } from "../components/Icons.jsx";
import ImportMenu from "../components/ImportMenu.jsx";
import Speicherleiste, { useEntwurf } from "../components/Speichern.jsx";
import AuthImage from "../components/AuthImage.jsx";
import { FOERDER } from "../core/foerderung.js";
import { useLanguage } from "../i18n/index.jsx";
import { hochladen } from "../core/upload.js";
import Fortschrittsbalken from "../components/Fortschrittsbalken.jsx";
import BildZuschnitt from "../components/BildZuschnitt.jsx";
import { useAktiv } from "../core/modules.js";
import { peek, put } from "../core/cache.js";
import { alsJson } from "../core/melden.js";

const API = "/api";

// Feste Auswahl, identisch zum Backend (FOERDER_VALUES in classes.py) und
// wortgleich zur bisherigen Lernleiter-App — die Bestandsdaten benutzen genau
// diese Zeichenketten. Freitext wuerde in Lernpfads Differenzierung still zu
// Extrakategorien fuehren.
//
// Die Erklaerungen stammen ebenfalls von dort: sie sagen, was der Schwerpunkt
// im Unterricht bedeutet, statt nur ein Etikett zu vergeben.

const EMPTY_STUDENT = { card_id: 1, name: "", niveau: "", foerder: null, massnahmen: null, notizen: "", klassenlehrer: "" };

// Der leere Entwurf einer Klasse. `archiviert` gehört dazu: Archivieren ist
// eine Änderung an der Klasse wie jede andere und wartet auf „Speichern".
const LEERE_KLASSE = { name: "", color: C.info, students: [{ ...EMPTY_STUDENT, card_id: 1 }], archiviert: false };

export default function Classes() {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const cardvote = aktiv("cardvote");
  // Zugangs-Codes (QR) fuehren zu den Karteikarten ODER zu den Testergebnissen.
  // Mit beiden Modulen aus fuehren sie nirgendwohin — dann verschwinden sie auch
  // aus der Klassenansicht, statt einen toten Ausdruck nahezulegen.
  const karten = aktiv("karten");
  const zugaengeMoeglich = karten || cardvote;
  const [classes, setClasses] = useState([]);
  const [editing, setEditing] = useState(null);
  const [params, setParams] = useSearchParams();
  // EIN Entwurf für die ganze Maske: Name, Farbe, alle Zeilen der Liste und der
  // Archiv-Zustand. Dreißig Zeilen mit dreißig Speichern-Knöpfen wären
  // unbedienbar — offen ist die Maske, nicht das einzelne Feld.
  const [basis, setBasis] = useState(LEERE_KLASSE);
  const entwurf = useEntwurf(basis, (wert) => save(wert));
  const { name, students } = entwurf.wert;
  const setName = (v) => entwurf.setz({ name: v });
  const setStudents = (v) => entwurf.setz((w) => ({ students: typeof v === "function" ? v(w.students) : v }));
  const [detailsFor, setDetailsFor] = useState(null);
  // Gelöschte Klassen liegen im gemeinsamen Papierkorb des Kerns (/papierkorb),
  // nicht mehr hier — jedes Modul hatte sonst seinen eigenen.

  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Archiv: am Schuljahresende raus aus den Listen, Daten bleiben. Der
  // gecachte Stand gilt nur fuer die aktive Ansicht — sonst zeigte die Seite
  // beim Umschalten kurz die falsche Liste.
  const [archiv, setArchiv] = useState(false);
  const load = (imArchiv = archiv) => fetch(`${API}/classes${imArchiv ? "?archiviert=true" : ""}`).then((r) => {
    if (r.status === 401) { localStorage.removeItem("token"); localStorage.removeItem("user"); location.reload(); return []; }
    return r.json();
  }).then((d) => { const list = Array.isArray(d) ? d : []; setClasses(list); if (!imArchiv) put("classes", list); setLoadError(false); }).catch(() => setLoadError(true)).finally(() => setLoaded(true));
  useEffect(() => {
    // Sofort den gecachten Stand zeigen (Seite wirkt instant), dann frisch laden.
    const c = peek("classes"); if (Array.isArray(c)) { setClasses(c); setLoaded(true); }
    const timer = setTimeout(() => { if (classes.length === 0) setLoadError(true); }, 15000);
    load().then(() => clearTimeout(timer));
    return () => clearTimeout(timer);
  }, []);

  const MAX_CARDS = 50;
  // Solange ein Schlüssel in i18n/* fehlt, gäbe `t` den Schlüssel selbst aus.
  const txt = (k, fb) => (t(k) !== k ? t(k) : fb);

  // Der PDF-Endpunkt haengt an der Anmeldung; eine Browser-Navigation schickt
  // den Token nicht mit. Deshalb holen und als Blob speichern.
  const zugaengeDrucken = async (classId) => {
    const url = `${API}/karten/classes/${classId}/zugaenge.pdf?base=${encodeURIComponent(location.origin)}`;
    const r = await fetch(url).catch(() => null);
    if (!r || !r.ok) {
      const b = r ? await r.json().catch(() => ({})) : {};
      showAlert(typeof b.detail === "string" ? b.detail : t("common.notWork"));
      return;
    }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Zugaenge.pdf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  // Grundlage UND Arbeitskopie zugleich setzen: sonst hielte useEntwurf den
  // Entwurf der zuletzt bearbeiteten Klasse für „noch offen" und zeigte ihn in
  // der nächsten weiter.
  const uebernehmen = (stand) => { setBasis(stand); entwurf.setz(stand); };

  const startNew = () => {
    setEditing({ id: null });
    uebernehmen({ ...LEERE_KLASSE, students: [{ ...EMPTY_STUDENT, card_id: 1 }] });
  };

  const startEdit = (cls) => {
    setEditing(cls);
    // Reihenfolge kommt vom Server (position, dann card_id) und wird NICHT
    // ueberschrieben: sie ist genau das, was hier per Ziehen gesetzt wurde.
    // Fruehere Fassung sortierte nach card_id und nummerierte durch — damit war
    // jedes Verschieben beim naechsten Oeffnen wieder weg, und die Kartennummer
    // (sie steht auf der gedruckten ArUco-Karte und jeder Scan zeigt darauf)
    // wanderte auf ein anderes Kind.
    // Ganzen Datensatz uebernehmen, nicht nur Nummer und Name: niveau, foerder
    // und notizen wuerden sonst bei jedem Speichern still verschwinden.
    const rows = [...cls.students].map((s) => ({ ...s }));
    if (rows.length === 0) rows.push({ ...EMPTY_STUDENT, card_id: 1 });
    uebernehmen({ name: cls.name, color: cls.color || C.info, students: rows, archiviert: archiv });
  };

  // Direktlink ?open=<id> (z.B. aus dem Stundenplan): diese Klasse aufklappen.
  useEffect(() => {
    const oid = Number(params.get("open"));
    if (!oid || editing) return;
    const cls = classes.find((c) => c.id === oid);
    if (cls) { startEdit(cls); setParams({}, { replace: true }); }
  }, [classes, params]); // eslint-disable-line

  const save = async (wert) => {
    if (!wert.name.trim()) { showAlert(txt("classes.nameRequired", "Bitte einen Klassennamen eingeben.")); return false; }
    const filled = wert.students.filter((s) => s.name.trim() !== "");
    const body = {
      name: wert.name,
      color: wert.color,
      // Reihenfolge = Kartennummer: der Server vergibt 1, 2, 3 … nach dieser
      // Liste und schreibt die Scans der alten Nummern mit um. Nur von hier
      // aus, nicht bei Import oder Farbwechsel.
      renumber: true,
      students: filled.map((s) => ({
        card_id: s.card_id,
        name: s.name.trim(),
        niveau: s.niveau || "",
        foerder: s.foerder || null,
        massnahmen: s.massnahmen && s.massnahmen.length ? s.massnahmen : null,
        notizen: s.notizen || "",
        klassenlehrer: s.klassenlehrer || "",
      })),
    };
    const res = editing.id
      ? await fetch(`${API}/classes/${editing.id}`, alsJson("PUT", body))
      : await fetch(`${API}/classes`, alsJson("POST", body));
    // Fehler nicht verschlucken: sonst schließt sich der Editor und die
    // Eingaben (Förderdaten!) sind still verloren.
    if (res && !res.ok) {
      let detail = "";
      try { const b = await res.json(); detail = typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail); } catch { /* egal */ }
      showAlert(detail || t("common.notWork"));
      return false;   // Entwurf bleibt offen — nichts geht verloren
    }
    // Archivieren wandert mit demselben Speichern hinaus. Der Endpunkt schaltet
    // um, deshalb nur bei echter Änderung.
    if (wert.archiviert !== basis.archiviert) {
      const angelegt = editing.id ? null : await res.json().catch(() => null);
      const id = editing.id || angelegt?.id;
      if (id) await fetch(`${API}/classes/${id}/archive`, { method: "POST" }).catch(() => {});
    }
    uebernehmen(LEERE_KLASSE);
    setEditing(null);
    load();
  };

  const remove = (id) => {
    const cls = classes.find((c) => c.id === id);
    const next = classes.filter((c) => c.id !== id);
    setClasses(next); put("classes", next); // sofort weg
    undoDelete({
      message: t("undo.deleted", { name: cls?.name || "" }),
      undo: () => { load(); },
      commit: async () => { await fetch(`${API}/classes/${id}`, { method: "DELETE" }).catch(() => {}); },
    });
  };

  // Dateidialog aus Icons.jsx (`dateiWaehlen`) statt von Hand gebautem <input>.
  const importJson = () => dateiWaehlen(async (file) => {
    const data = JSON.parse(await file.text());
    if (data.type === "cardvote_class") {
      await fetch(`${API}/import/class`, alsJson("POST", data));
      load();
    } else { showAlert(t("classes.invalidFormat")); }
  }, ".json");

  const importXlsx = async () => {
    const className = await askPrompt(t("classes.classNamePrompt"));
    if (!className) return;
    dateiWaehlen(async (file) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/import/class-xlsx?name=${encodeURIComponent(className)}`, { method: "POST", body: form });
      if (res.ok) { load(); } else { const err = await res.json(); showAlert(err.detail || t("classes.importError")); }
    }, ".xlsx");
  };

  const updateStudent = (idx, value) => setStudentField(idx, "name", value);

  const setStudentField = (idx, field, value) => {
    const updated = [...students];
    updated[idx] = { ...updated[idx], [field]: value };
    setStudents(updated);
  };

  const toggleFoerder = (idx, wert) => {
    const cur = students[idx].foerder || [];
    setStudentField(idx, "foerder", cur.includes(wert) ? cur.filter((f) => f !== wert) : [...cur, wert]);
  };

  // Foto je SuS (personenbezogen, eigener Endpoint). photoVer erzwingt Neu-Laden
  // der Vorschau nach Upload/Löschen.
  const [photoVer, setPhotoVer] = useState(0);
  // Das Foto ist ein eigener Endpunkt und mit der Dateiauswahl bereits
  // beauftragt — es gehört deshalb NICHT in den Entwurf der Maske (sonst stünde
  // nach einem Bild „nicht gespeichert" da, obwohl das Bild längst liegt).
  const [fotoDa, setFotoDa] = useState({});   // student_id -> hat Foto?
  const hatFoto = (s) => (s.id != null && s.id in fotoDa ? fotoDa[s.id] : !!s.has_photo);
  // Ein Foto geht nie ungeschnitten hinaus: die Anzeige ist quadratisch
  // (Sitzplan, Listen), und `object-fit: cover` schneidet mittig ab — bei
  // einem Hochformat also am Gesicht vorbei. Der Dialog schlaegt den groessten
  // mittigen Ausschnitt vor; wer nachhelfen will, schiebt und zoomt.
  const [zuschnitt, setZuschnitt] = useState(null);   // { sid, datei }
  const [fotoLaeuft, setFotoLaeuft] = useState(null); // sid des laufenden Uploads
  const [fotoProzent, setFotoProzent] = useState(null);
  const uploadPhoto = async (sid, file) => {
    if (!file || !sid) return;
    const fd = new FormData(); fd.append("file", file);
    setFotoLaeuft(sid); setFotoProzent(0);
    const r = await hochladen(`/api/classes/students/${sid}/photo`, fd, { onFortschritt: setFotoProzent });
    setFotoLaeuft(null); setFotoProzent(null);
    if (r.ok) { setFotoDa((m) => ({ ...m, [sid]: true })); setPhotoVer((v) => v + 1); }
  };
  const removePhoto = async (sid) => {
    if (!sid) return;
    await fetch(`/api/classes/students/${sid}/photo`, { method: "DELETE" }).catch(() => {});
    setFotoDa((m) => ({ ...m, [sid]: false })); setPhotoVer((v) => v + 1);
  };

  // Kartennummern bleiben, wo sie sind — auch beim Loeschen. Frueher wurde hier
  // durchnummeriert (card_id = Zeilennummer); da die Zusammenfuehrung beim
  // Speichern ueber die card_id laeuft, uebernahm das nachrueckende Kind die
  // Noten und Scans des geloeschten. Die Reihenfolge steckt jetzt in der
  // Position (Reihenfolge dieser Liste), die Kartennummer bleibt an der
  // gedruckten Karte.
  const removeStudent = async (idx) => {
    if (!await askConfirm(t("classes.removeCardConfirm"))) return;
    setStudents(students.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    if (students.length >= MAX_CARDS) return;
    const naechste = students.reduce((m, s) => Math.max(m, Number(s.card_id) || 0), 0) + 1;
    setStudents([...students, { ...EMPTY_STUDENT, card_id: naechste }]);
  };

  // ─── Reihenfolge per Ziehen ───
  // Sie gilt nicht nur hier: Notenbuch, Anwesenheit, Klassenarbeit und
  // Kartenfortschritt sortieren nach derselben Position. Waehrend des Ziehens
  // steht die Zeile schon dort, wo sie beim Loslassen landet — man sieht das
  // Ergebnis, statt es sich vorzustellen.
  const [zieht, setZieht] = useState(null);   // Index der gezogenen Zeile
  const [ueber, setUeber] = useState(null);   // Index, ueber dem sie schwebt
  // Gezogen wird ueber die ORIGINAL-Indizes: so bleibt `idx` in der Zeile der
  // echte Platz in `students`, und kein Handgriff (umbenennen, Foto, loeschen)
  // muss davon wissen.
  const reihenfolge = () => {
    const ids = students.map((_, i) => i);
    if (zieht == null || ueber == null || zieht === ueber) return ids;
    ids.splice(ueber, 0, ids.splice(ids.indexOf(zieht), 1)[0]);
    return ids;
  };
  const ablegen = () => {
    if (zieht != null && ueber != null && zieht !== ueber) {
      setStudents(reihenfolge().map((i) => students[i]));
    }
    setZieht(null); setUeber(null);
  };

  const downloadFile = async (url, filename) => {
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (editing) {
    const filled = students.filter((s) => s.name.trim() !== "").length;
    return (
      // Schmaler als eine Modulseite (die Zeilen sind 620 breit) und trotzdem
      // mittig: mit der vollen pageApp-Breite klebte das Formular am linken Rand.
      <div style={{ ...pageApp, maxWidth: 620 }}>
        {/* Die Ueberschrift ist der Weg zurueck. „Abbrechen" steht unten in
            der Werkzeugleiste — wer oben am Titel steht, sucht dort und nicht
            am anderen Ende der Maske. Dieselbe Nachfrage wie beim Abbrechen:
            ein offener Entwurf geht nicht still verloren. */}
        <button onClick={() => {
          if (entwurf.geaendert && !window.confirm(t("speichern.verlassen"))) return;
          uebernehmen(LEERE_KLASSE); setEditing(null);
        }} title={t("classes.backToList")}
          style={{ ...pageTitle, display: "inline-flex", alignItems: "center", gap: 6, border: "none",
            background: "none", padding: 0, cursor: "pointer", color: "var(--text)" }}>
          <Icon d={ICONS.chevronLeft} size={18} color="var(--text3)" />
          {editing.id ? t("classes.editTitle") : t("classes.newTitle")}
        </button>
        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          {/* Klassen tragen keine Farbe — die Farbe hängt am Kurs (Fach). */}
          <input placeholder={t("classes.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)}
            autoComplete="off" style={{ ...inputStyle, fontSize: 16, width: 300 }} autoFocus />
        </div>
        <p style={{ color: "var(--text3)", marginBottom: 8, fontSize: 14 }}>
          {t("classes.fillHint", { filled, total: students.length })}
        </p>
        {cardvote && (
          <p style={{ color: "var(--text3)", marginBottom: 8, fontSize: 13 }}>{t("classes.renumberHint")}</p>
        )}
        <div style={{ marginBottom: 12 }}>
          {reihenfolge().map((idx, platz) => { const s = students[idx]; return (
            <div key={s.card_id ?? idx}
              onDragOver={(e) => { e.preventDefault(); if (zieht != null && ueber !== platz) setUeber(platz); }}
              onDrop={ablegen}
              style={{ opacity: zieht === idx ? 0.45 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              {/* Griff: nur hier wird gezogen, damit man im Namensfeld weiter
                  Text markieren kann. */}
              <span draggable
                onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setZieht(idx); }}
                onDragEnd={() => { setZieht(null); setUeber(null); }}
                className="drag-handle" title={t("classes.reorderHint")}
                style={{ color: "var(--text3)", cursor: "grab", display: "inline-flex", flexShrink: 0 }}>
                <Icon d={ICONS.grip} size={15} />
              </span>
              <span
                style={{ width: 44, textAlign: "right", fontWeight: 700, color: s.name.trim() ? "var(--text)" : "var(--border2)", fontSize: 14, flexShrink: 0 }}
                title={cardvote ? t("classes.cardNumberHint") : undefined}
              >
                {/* Die Nummer ist der PLATZ, nicht die alte Kartennummer: beim
                    Ziehen zaehlt sie sofort neu durch, und genau so wird beim
                    Speichern vergeben (Server schreibt die Scans mit um). */}
                {cardvote ? `#${platz + 1}` : `${platz + 1}.`}
              </span>
              <input value={s.name} onChange={(e) => updateStudent(idx, e.target.value)} placeholder={t("common.name")}
                autoComplete="off" name={`stud-${idx}`} data-lpignore="true"
                style={{ ...inputStyle, flex: 1 }} />
              {/* E/G wird nicht mehr hier gepflegt, sondern im Kurs (betrifft die
                  Person, nicht die Fach-Klasse) — siehe Kurse.jsx. */}
              <button
                type="button" onClick={() => setDetailsFor(detailsFor === idx ? null : idx)}
                title={t("classes.detailsTitle")}
                style={{
                  ...btnSecondary, ...btnSmall, width: 92, flexShrink: 0, textAlign: "center",
                  background: (s.foerder?.length || s.massnahmen?.length || s.notizen || s.klassenlehrer) ? "var(--accent-bg)" : "var(--card)",
                  color: "var(--text2)", cursor: "pointer",
                }}
              >
                {s.foerder?.length ? t("classes.detailsN", { n: s.foerder.length }) : t("classes.details")}
              </button>
              <button onClick={() => removeStudent(idx)} className="icon-btn" style={{ ...iconBtn, flexShrink: 0 }} title={t("classes.removeCard")} aria-label={t("classes.removeCard")}>
                <Icon d={ICONS.trash} color={C.danger} />
              </button>
            </div>

            {detailsFor === idx && (
              <div style={{ ...cardStyle, margin: "0 0 12px 52px" }}>
                {/* Foto der Person (personenbezogen; nie im Export). */}
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>{t("classes.photo")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  {s.id && hatFoto(s) && <AuthImage src={`/api/classes/students/${s.id}/photo`} reloadKey={photoVer} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: CONTROL_R, border: "1px solid var(--border2)" }} />}
                  {s.id ? (
                    <>
                      <label style={{ ...btnSecondary, ...btnSmall, cursor: "pointer" }}>
                        {hatFoto(s) ? t("classes.photoChange") : t("classes.photoAdd")}
                        <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) setZuschnitt({ sid: s.id, datei: f }); }} />
                      </label>
                      {hatFoto(s) && <button type="button" onClick={() => removePhoto(s.id)} className="icon-btn" style={iconBtn} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>}
                      {fotoLaeuft === s.id && <Fortschrittsbalken wert={fotoProzent} style={{ flex: 1, minWidth: 80, margin: 0 }} />}
                    </>
                  ) : <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("classes.photoSaveFirst")}</span>}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>{t("classes.classTeacher")}</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  <input
                    value={s.klassenlehrer || ""} onChange={(e) => setStudentField(idx, "klassenlehrer", e.target.value)}
                    placeholder={t("classes.classTeacherPlaceholder")} maxLength={120}
                    style={{ ...inputStyle, flex: 1, minWidth: 180, fontSize: 13 }}
                  />
                  {/* Bei einer echten Klasse ist die Leitung fuer alle gleich —
                      dann waere 30x tippen unsinnig. Bei einem Kurs, der Kinder
                      aus mehreren Klassen mischt, bleibt jedes Feld einzeln. */}
                  {(s.klassenlehrer || "").trim() && students.length > 1 && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!await askConfirm(t("classes.applyAllConfirm", { name: s.klassenlehrer, n: students.length }))) return;
                        setStudents(students.map((st) => ({ ...st, klassenlehrer: s.klassenlehrer })));
                      }}
                      style={{ ...btnSecondary, ...btnSmall }}
                    >
                      {t("classes.applyAll")}
                    </button>
                  )}
                </div>

                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>{t("classes.supportNeeds")}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
                  Schwierigkeiten — steuern später die Differenzierung in Lernpfad.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                  {FOERDER.map(([wert, erklaerung]) => {
                    const on = (s.foerder || []).includes(wert);
                    return (
                      // Auswaehlbarer Chip: dieselbe runde Form wie chipStyle,
                      // nur mit Kaestchen und Aktiv-Zustand.
                      <label
                        key={wert} title={erklaerung}
                        style={{
                          ...chipStyle, display: "inline-flex", alignItems: "center", gap: 8,
                          padding: "4px 12px", fontSize: 13, cursor: "pointer", userSelect: "none",
                          border: on ? "1px solid var(--accent)" : "1px solid var(--border2)",
                          background: on ? "var(--accent-bg)" : "var(--bg)",
                          color: on ? "var(--accent)" : "var(--text2)",
                        }}
                      >
                        <input
                          type="checkbox" checked={on} onChange={() => toggleFoerder(idx, wert)}
                          style={{ margin: 0, cursor: "pointer" }}
                        />
                        {wert}
                      </label>
                    );
                  })}
                </div>

                {/* Fördermaßnahmen hängen am KURS (Fach), nicht an der Klasse —
                    ein Zeitzuschlag in Mathe heißt nicht dasselbe wie in Sport.
                    Gepflegt werden sie unter /kurse. */}
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>{t("classes.notes")}</div>
                <textarea
                  value={s.notizen || ""} onChange={(e) => setStudentField(idx, "notizen", e.target.value)}
                  rows={2} placeholder={t("classes.notesPlaceholder")} maxLength={2000}
                  // Breite fest: nur senkrecht ziehbar, lange Wörter brechen um. Ein
                  // seitlicher Rollbalken hilft bei Notizen niemandem.
                  style={{ ...inputStyle, width: "100%", maxWidth: "100%", fontSize: 13, resize: "vertical", overflowX: "hidden", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}
                />
                <p style={{ fontSize: 12, color: "var(--text3)", margin: "8px 0 0" }}>
                  {t("classes.staysPrivate")}
                </p>
              </div>
            )}
            </div>
          ); })}
        </div>
        {/* Dieselbe Bauform wie ueberall: links, was man staendig tut
            (speichern, Zeile dazu), rechts im Menue das Seltene und das
            Gefaehrliche. Vorher stand der Papierkorb direkt neben
            „Speichern" — eine Handbreite von der Klasse entfernt. */}
        <Werkzeugleiste
          links={<Speicherleiste entwurf={entwurf} immer />}
          mehr={editing.id ? [
            zugaengeMoeglich && { key: "qr", label: t("classes.qrPrint"), icon: ICONS.pdf || ICONS.export,
                                  onClick: () => zugaengeDrucken(editing.id) },
            // Archivieren ist ein Umschalten und wartet wie alles andere auf
            // „Speichern" — vorher war die Klasse schon weg, während die
            // getippten Namen daneben noch ungespeichert dastanden.
            { key: "archiv", label: entwurf.wert.archiviert ? t("classes.unarchive") : t("classes.archive"), icon: ICONS.archive,
              onClick: () => entwurf.setz((w) => ({ archiviert: !w.archiviert })) },
            { key: "loeschen", label: t("common.delete"), icon: ICONS.trash, gefahr: true,
              onClick: () => { remove(editing.id); uebernehmen(LEERE_KLASSE); setEditing(null); } },
          ] : []}>
          <button onClick={addRow} disabled={students.length >= MAX_CARDS}
            style={{ ...toolbarBtn, opacity: students.length >= MAX_CARDS ? 0.4 : 1 }}>{t("classes.addRow")}</button>
          <button onClick={() => {
            if (entwurf.geaendert && !window.confirm(t("speichern.verlassen"))) return;
            uebernehmen(LEERE_KLASSE); setEditing(null);
          }} style={toolbarBtn}>{t("common.cancel")}</button>
        </Werkzeugleiste>
        {/* Was das Speichern zusätzlich tun wird — sonst wäre ein
            umgeschaltetes Archiv im Menü verborgen. */}
        {entwurf.wert.archiviert !== basis.archiviert && (
          <p style={{ fontSize: 13, color: C.warning, margin: "0 0 8px" }}>
            {entwurf.wert.archiviert ? t("classes.archive") : t("classes.unarchive")}
          </p>
        )}
        {cardvote && (
          <p style={{ fontSize: 12, color: students.length >= MAX_CARDS ? C.danger : "var(--text3)", margin: 0 }}>
            {t("classes.limit", { max: MAX_CARDS, count: students.length })}
          </p>
        )}
        {zuschnitt && (
          <BildZuschnitt datei={zuschnitt.datei}
            onAbbruch={() => setZuschnitt(null)}
            onFertig={(quadrat) => { const sid = zuschnitt.sid; setZuschnitt(null); uploadPhoto(sid, quadrat); }} />
        )}
      </div>
    );
  }

  if (loadError && classes.length === 0) return <p style={{ color: C.danger }}>{t("common.connectionError")}</p>;

  return (
    <div style={{ ...pageApp }}>
      <h1 style={pageTitle}>{t("nav.classes")}</h1>
      {/* Archiv statt Papierkorb: der Papierkorb loescht nach 30 Tagen, das
          Archiv haelt auf Dauer — alte Noten muss man Jahre spaeter noch
          nachschlagen koennen.
          Eine Leiste, ein Abstand: das zusaetzliche marginLeft am Import riss
          vorher ein 16-px-Loch mitten in die Reihe. */}
      <Werkzeugleiste
        links={<Tabs value={archiv ? "archiv" : "aktiv"} onChange={(v) => { const a = v === "archiv"; setArchiv(a); setLoaded(false); load(a).then(() => setLoaded(true)); }}
          options={[["aktiv", t("classes.active")], ["archiv", t("classes.archived")]]} />}
        style={{ marginBottom: 16 }}
      >
        {!archiv && <AddButton onClick={startNew} title={t("classes.new")} />}
        <ImportMenu
          importItems={[
            { label: t("classes.importExcel"), onClick: importXlsx },
            { label: t("classes.importJson"), onClick: importJson },
          ]}
          templateItems={[
            { label: t("classes.templateExcel"), href: `${API}/import/class-template.xlsx` },
          ]}
        />
      </Werkzeugleiste>

      {!loaded && !loadError && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("common.loading")}</p>}
      {loaded && !loadError && classes.length === 0 && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("classes.empty")}</p>}

      {classes.map((cls) => (
        <div key={cls.id} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <button onClick={() => startEdit(cls)} title={t("classes.open")}
            style={{ display: "flex", alignItems: "center", gap: 8, border: "none", background: "none", cursor: "pointer", padding: 0, textAlign: "left", flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: 16, color: "var(--text)" }}>{cls.name}</strong>
            <span style={{ color: "var(--text3)", fontSize: 13 }}>{cls.students.length} {t("classes.learners")}</span>
          </button>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <button onClick={() => downloadFile(`${API}/export/class/${cls.id}`, `${cls.name}.json`)} className="icon-btn" style={iconBtn} title={t("classes.export")} aria-label={t("classes.export")}><Icon d={ICONS.export} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

