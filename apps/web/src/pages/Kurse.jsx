// Kurse (Lerngruppen) verwalten. Klassen im selben Kurs teilen SuS + Anwesenheit
// (per Name); Karten/Noten bleiben pro Fach-Klasse. Eine Klasse darf in mehreren
// Kursen sein.
import { useState, useEffect } from "react";
import { useLanguage } from "../i18n/index.jsx";
import KursLinks from "../components/KursLinks.jsx";
import { undoDelete } from "../core/undo.jsx";
import { sende } from "../core/melden.js";
import { AddButton, pageTitle, pageIntro, btnPrimary, btnSecondary, selectStyle, chipStyle, Icon, ICONS, iconBtn, COLORS as C, cardStyle, inputStyle, Toggle, Empty, pageApp, LoadError} from "../components/Icons.jsx";

const API = "/api";
const editLabel = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text3)", marginBottom: 6 };

export default function Kurse() {
  const { t } = useLanguage();
  const [kurse, setKurse] = useState([]);
  const [allClasses, setAllClasses] = useState([]);
  // Gelöschte Kurse liegen im gemeinsamen Papierkorb des Kerns (/papierkorb).
  const [neu, setNeu] = useState("");
  const [editKurs, setEditKurs] = useState(null); // aufgeklappter Bearbeiten-Bereich (Name, E/G)
  const [editName, setEditName] = useState("");

  // Ein Serverfehler sah hier aus wie „noch kein Kurs angelegt" — mitsamt der
  // freundlichen Empty-Kachel. Wer seine Kurse vermisste, suchte den Fehler bei
  // sich statt beim Endpunkt. Deshalb der eigene Zustand.
  const [ladefehler, setLadefehler] = useState(false);
  const load = () => fetch(`${API}/kurse`)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { setKurse(Array.isArray(d) ? d : []); setLadefehler(false); })
    .catch(() => setLadefehler(true));
  const loadClasses = () => fetch(`${API}/classes`).then((r) => (r.ok ? r.json() : [])).then((d) => setAllClasses(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); loadClasses(); }, []);

  const anlegen = async () => {
    const name = neu.trim(); if (!name) return;
    // Bei Ablehnung bleibt der getippte Name im Feld stehen — sonst wäre er weg
    // und der Kurs trotzdem nicht da.
    if (!(await sende(`${API}/kurse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }, t("kurse.add")))) return;
    setNeu(""); load();
  };
  const openEdit = (k) => { if (editKurs === k.id) { setEditKurs(null); } else { setEditKurs(k.id); setEditName(k.name); } };
  const saveName = async (k) => {
    const name = editName.trim();
    if (!name) return;
    // Ohne die Prüfung holte load() den alten Namen zurück: der getippte Name
    // verschwand vor den Augen der Lehrkraft, ohne Meldung.
    if (!(await sende(`${API}/kurse/${k.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }, t("kurse.editName")))) return;
    load();
  };
  const setNiveauAktiv = async (k, val) => {
    // Ein abgelehnter Schalter sprang wortlos zurück — das sieht aus wie ein
    // klemmender Regler, ist aber eine Ablehnung des Servers.
    if (!(await sende(`${API}/kurse/${k.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: k.name, niveau_aktiv: val }) }, t("kurse.editLevels")))) return;
    load();
  };
  const addMember = async (kursId, classId) => { if (!(await sende(`${API}/kurse/${kursId}/classes/${classId}`, { method: "POST" }, t("kurse.addClass")))) return; load(); };
  const removeMember = async (kursId, classId) => { if (!(await sende(`${API}/kurse/${kursId}/classes/${classId}`, { method: "DELETE" }, t("kurse.unlink")))) return; load(); };
  const delKurs = (k) => {
    // Sofort aus der Liste, 5 s Undo-Toast; erst dann wirklich löschen.
    setKurse((prev) => prev.filter((x) => x.id !== k.id));
    undoDelete({
      message: t("undo.deleted", { name: k.name }),
      undo: () => load(),
      commit: async () => { await fetch(`${API}/kurse/${k.id}`, { method: "DELETE" }).catch(() => {}); },
    });
  };

  // Klassen, die (noch) nicht in diesem Kurs sind — zum Hinzufügen.
  const frei = (k) => { const drin = new Set(k.classes.map((c) => c.id)); return allClasses.filter((c) => !drin.has(c.id)); };

  return (
    <div style={{ ...pageApp }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>{t("kurse.title")}</h1>
      </div>
      <p style={pageIntro}>{t("kurse.intro")}</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anlegen()}
          placeholder={t("kurse.newPlaceholder")} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
        <AddButton onClick={anlegen} title={t("kurse.add")} />
      </div>

      {/* Ladefehler ist NICHT dasselbe wie „noch nichts angelegt": das eine
          repariert der Server, das andere die Lehrkraft. */}
      {ladefehler ? <LoadError message="Die Kurse konnten nicht geladen werden." onRetry={() => { load(); loadClasses(); }} />
        : kurse.length === 0 && <Empty title={t("kurse.emptyTitle")} hint={t("kurse.emptyHint")} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {kurse.map((k) => (
          <div key={k.id} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <strong style={{ fontSize: 15, flex: 1 }}>{k.name}</strong>
              <button onClick={() => openEdit(k)} className="icon-btn" style={iconBtn} title={t("common.edit")} aria-label={t("common.edit")}><Icon d={ICONS.edit} size={15} /></button>
            </div>
            {/* Zweiter Weg durch Nuvora: vom Kurs (Fach) aus in die Module.
                Alles Verlinkte ist fachlich — deshalb hier und nicht an der Klasse. */}
            <KursLinks kurs={k} />

            {/* Bearbeiten-Bereich (hinter dem Stift): klar gegliedert in Name,
                Klassen (hinzufügen/entfernen) und E/G. */}
            {editKurs === k.id && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <div style={editLabel}>{t("kurse.editName")}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t("kurse.renamePrompt")}
                      onKeyDown={(e) => e.key === "Enter" && saveName(k)} style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
                    <button onClick={() => saveName(k)} style={btnPrimary}>{t("common.save")}</button>
                  </div>
                </div>

                <div>
                  <div style={editLabel}>{t("kurse.editClasses")}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {k.classes.map((c) => (
                      <span key={c.id} style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {c.name}
                        <button onClick={() => removeMember(k.id, c.id)} title={t("kurse.unlink")}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 0, display: "flex" }}>
                          <Icon d={ICONS.close} size={12} />
                        </button>
                      </span>
                    ))}
                    {frei(k).length > 0 && (
                      <select value="" onChange={(e) => e.target.value && addMember(k.id, Number(e.target.value))} style={{ ...selectStyle, fontSize: 12.5 }}>
                        <option value="">+ {t("kurse.addClass")}</option>
                        {frei(k).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )}
                  </div>
                </div>

                <div>
                  <div style={editLabel}>{t("kurse.editStudents")}</div>
                  <StudentMembers kursId={k.id} allClasses={allClasses} t={t} />
                </div>

                <div>
                  <div style={editLabel}>{t("kurse.editMeasures")}</div>
                  <p style={{ fontSize: 12, color: "var(--text3)", margin: "0 0 8px" }}>{t("kurse.measuresHint")}</p>
                  <MassnahmenPanel kursId={k.id} t={t} />
                </div>

                {k.classes.length > 0 && (
                  <div>
                    <div style={editLabel}>{t("kurse.editLevels")}</div>
                    <Toggle checked={!!k.niveau_aktiv} onChange={(v) => setNiveauAktiv(k, v)} label={t("kurse.niveauToggle")} />
                    {/* Teilnehmerliste immer sichtbar; der E/G-Selektor je Person nur,
                        wenn der E/G-Regler an ist. */}
                    <NiveauPanel kursId={k.id} niveauAktiv={!!k.niveau_aktiv} t={t} />
                  </div>
                )}
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                  <button onClick={() => delKurs(k)} className="icon-btn" style={{ ...iconBtn }} title={t("kurse.deleteKurs") !== "kurse.deleteKurs" ? t("kurse.deleteKurs") : t("common.delete")} aria-label={t("kurse.deleteKurs") !== "kurse.deleteKurs" ? t("kurse.deleteKurs") : t("common.delete")}>
                    <Icon d={ICONS.trash} size={16} color={C.danger} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Einzelne SuS in einem Kurs (Kurs aus Teilen von Klassen): Chips der bereits
// gewählten SuS + Picker (Klasse wählen -> SuS einzeln hinzufügen).
function StudentMembers({ kursId, allClasses, t }) {
  const [members, setMembers] = useState([]);
  const [pickClass, setPickClass] = useState("");
  const load = () => fetch(`${API}/kurse/${kursId}/members`).then((r) => (r.ok ? r.json() : [])).then((d) => setMembers(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { load(); }, [kursId]); // eslint-disable-line
  const memberIds = new Set(members.map((m) => m.student_id));
  const add = async (sid) => { await sende(`${API}/kurse/${kursId}/members/${sid}`, { method: "POST" }, t("kurse.editStudents")); load(); };
  const remove = async (sid) => { await sende(`${API}/kurse/${kursId}/members/${sid}`, { method: "DELETE" }, t("kurse.unlink")); load(); };
  const cls = allClasses.find((c) => String(c.id) === String(pickClass));
  const candidates = cls ? (cls.students || []).filter((sname) => !memberIds.has(sname.id)) : [];
  return (
    <div>
      {members.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {members.map((m) => (
            <span key={m.student_id} style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 4 }}>
              {m.name} <span style={{ color: "var(--text3)", fontSize: 11 }}>· {m.class_name}</span>
              <button onClick={() => remove(m.student_id)} title={t("kurse.unlink")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 0, display: "flex" }}>
                <Icon d={ICONS.close} size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <select value={pickClass} onChange={(e) => setPickClass(e.target.value)} style={{ ...selectStyle, fontSize: 12.5 }}>
          <option value="">{t("kurse.pickClass")}</option>
          {allClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {cls && candidates.map((sname) => (
          <button key={sname.id} onClick={() => add(sname.id)} style={{ ...chipStyle, cursor: "pointer", border: "1px dashed var(--border2)", background: "none" }}>+ {sname.name}</button>
        ))}
        {cls && candidates.length === 0 && <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("kurse.allAdded")}</span>}
      </div>
    </div>
  );
}

// Fördermaßnahmen je Person IN DIESEM Kurs — Nachteilsausgleiche wirken
// fachbezogen (mehr Zeit in Mathe heißt nicht dasselbe wie in Sport). Sie
// hängen deshalb am Kurs; gespeichert werden sie an der Person, mit kurs_id.
//
// Vokabular wortgleich zum Backend (MASSNAHMEN_VALUES in classes.py).
const MASSNAHMEN = [
  ["Zeitzuschlag", "Mehr Bearbeitungszeit, z. B. +25 %"],
  ["Abweichende Lernziele", "Wird an anderen Zielen gemessen als die Klasse"],
  ["Weniger Aufgaben", "Reduzierter Umfang bei gleicher Anforderung"],
  ["Vorlesen", "Aufgabenstellungen werden vorgelesen"],
  ["Größere Schrift", "Arbeitsblatt in größerer Schrift / mehr Kontrast"],
  ["Hilfsmittel", "Z. B. Taschenrechner, Wörterbuch, Formelsammlung"],
  ["Eigener Raum", "Arbeitet getrennt oder in einer Kleingruppe"],
  ["Zusätzliche Pausen", "Darf die Arbeit unterbrechen"],
  ["Assistenz", "Begleitung durch eine weitere Person"],
  ["Rechtschreibung nicht bewertet", "Rechtschreibleistung fließt nicht ein"],
  ["Mündlich statt schriftlich", "Leistung wird mündlich erbracht"],
  ["Sonstiges", "Freie Beschreibung im Feld daneben"],
];

function MassnahmenPanel({ kursId, t }) {
  const [studs, setStuds] = useState(null);
  const [offen, setOffen] = useState(null); // Name der aufgeklappten Person
  useEffect(() => {
    fetch(`${API}/kurse/${kursId}/massnahmen`).then((r) => (r.ok ? r.json() : [])).then((d) => setStuds(Array.isArray(d) ? d : [])).catch(() => setStuds([]));
  }, [kursId]);

  const speichern = async (name, liste) => {
    setStuds((prev) => prev.map((s) => (s.name === name ? { ...s, massnahmen: liste } : s)));
    // Die Anzeige ist optimistisch: ohne Prüfung stand der Nachteilsausgleich
    // auf dem Schirm, aber nicht in der Datenbank — und fehlte am Tag der
    // Klassenarbeit, wo der Kalender ihn zeigen soll.
    const ok = await sende(`${API}/kurse/${kursId}/massnahmen`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, massnahmen: liste }),
    }, t("kurse.editMeasures"));
    if (!ok) fetch(`${API}/kurse/${kursId}/massnahmen`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d)) setStuds(d); }).catch(() => {});
  };
  const setFeld = (s, i, feld, wert) => {
    const liste = [...(s.massnahmen || [])];
    liste[i] = { ...liste[i], [feld]: wert };
    speichern(s.name, liste);
  };
  const hinzu = (s) => speichern(s.name, [...(s.massnahmen || []), { art: MASSNAHMEN[0][0], detail: "", arbeit: true }]);
  const weg = (s, i) => speichern(s.name, (s.massnahmen || []).filter((_, x) => x !== i));

  if (!studs) return null;
  if (studs.length === 0) return <p style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("kurse.niveauNoStudents")}</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {studs.map((s) => {
        const n = (s.massnahmen || []).length;
        const auf = offen === s.name;
        return (
          <div key={s.name} style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
            <button onClick={() => setOffen(auf ? null : s.name)}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: "2px 0", cursor: "pointer", textAlign: "left", fontSize: 13, color: "var(--text)" }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              <span style={{ fontSize: 12, color: n ? "var(--accent)" : "var(--text3)" }}>{n ? t("kurse.measuresCount", { n }) : t("kurse.measuresNone")}</span>
              <span style={{ color: "var(--text3)", fontSize: 11 }}>{auf ? "▲" : "▾"}</span>
            </button>
            {auf && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 0 10px" }}>
                {(s.massnahmen || []).map((m, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <select value={m.art} onChange={(e) => setFeld(s, i, "art", e.target.value)}
                      title={(MASSNAHMEN.find(([w]) => w === m.art) || [])[1] || ""}
                      style={{ ...selectStyle, padding: "6px 24px 6px 8px", fontSize: 12.5, minWidth: 170 }}>
                      {MASSNAHMEN.map(([wert]) => <option key={wert} value={wert}>{wert}</option>)}
                    </select>
                    <input value={m.detail || ""} onChange={(e) => setFeld(s, i, "detail", e.target.value)}
                      placeholder={t("classes.measureDetail")} maxLength={300}
                      style={{ ...inputStyle, flex: 1, minWidth: 140, padding: "6px 8px", fontSize: 12.5 }} />
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text2)", cursor: "pointer" }}
                      title={t("classes.measureExamHint")}>
                      <input type="checkbox" checked={!!m.arbeit} onChange={(e) => setFeld(s, i, "arbeit", e.target.checked)} style={{ margin: 0 }} />
                      {t("classes.measureExam")}
                    </label>
                    <button onClick={() => weg(s, i)} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.delete")} aria-label={t("common.delete")}>
                      <Icon d={ICONS.trash} size={14} color={C.danger} />
                    </button>
                  </div>
                ))}
                <div>
                  <button onClick={() => hinzu(s)} style={{ ...btnSecondary, padding: "4px 11px", fontSize: 12.5 }}>{t("classes.measureAdd")}</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// E/G je Person im Kurs. Setzt das Niveau kursweit (alle Fach-Klassen-Zeilen der
// Person), damit z.B. die Karteikarten-Niveaustapel überall greifen.
function NiveauPanel({ kursId, niveauAktiv = false, t }) {
  const [studs, setStuds] = useState(null);
  useEffect(() => {
    fetch(`${API}/kurse/${kursId}/students`).then((r) => (r.ok ? r.json() : [])).then((d) => setStuds(Array.isArray(d) ? d : [])).catch(() => setStuds([]));
  }, [kursId]);
  const setNiveau = async (name, niveau) => {
    const vorher = studs;
    setStuds((prev) => prev.map((s) => (s.name === name ? { ...s, niveau } : s)));
    // E/G steuert die Wertung. Ein still verlorenes E hieße: die Auswertung
    // rechnet weiter mit G, und niemand merkt es bis zur Notenkonferenz.
    if (!(await sende(`${API}/kurse/${kursId}/niveau`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, niveau }) }, t("kurse.editLevels")))) setStuds(vorher);
  };
  if (!studs) return null;
  if (studs.length === 0) return <p style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 8 }}>{t("kurse.niveauNoStudents")}</p>;
  return (
    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6 }}>
      {studs.map((s) => (
        <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
          {/* E/G-Selektor nur bei aktivem Regler; sonst nur der Name (Teilnehmer sichtbar). */}
          {niveauAktiv && (
            <select value={s.niveau || ""} onChange={(e) => setNiveau(s.name, e.target.value)}
              style={{ ...selectStyle, fontSize: 12.5, padding: "4px 24px 4px 8px" }}>
              <option value="">–</option>
              <option value="E">{t("classes.eCourse")}</option>
              <option value="G">{t("classes.gCourse")}</option>
            </select>
          )}
        </div>
      ))}
    </div>
  );
}
