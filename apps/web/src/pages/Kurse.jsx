// Kurse (Lerngruppen) verwalten. Klassen im selben Kurs teilen SuS + Anwesenheit
// (per Name); Karten/Noten bleiben pro Fach-Klasse. Eine Klasse darf in mehreren
// Kursen sein.
import { useState, useEffect, useRef } from "react";
import { liegtDavor, nachJahrAbsteigend } from "../core/schuljahr.js";
import { useLanguage } from "../i18n/index.jsx";
import KursLinks from "../components/KursLinks.jsx";
import { undoDelete } from "../core/undo.jsx";
import { alsJson, hol, sende } from "../core/melden.js";
import { NiveauToggle, AddButton, pageTitle, pageIntro, btnSecondary, btnSmall, selectStyle, chipStyle,
  Icon, ICONS, iconBtn, COLORS as C, cardStyle, inputStyle, toolbarInput, sectionLabel, Toggle, Tabs, Empty, pageApp, LoadError } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import Speicherleiste, { useEntwurf } from "../components/Speichern.jsx";

const API = "/api";
const editLabel = { ...sectionLabel, marginBottom: 4 };

// Dieselben Vorschlaege wie bei den Themen (pages/Topics.jsx) — dort steht,
// warum es eine Liste zum Ergaenzen ist und kein Katalog.
const FACH_VORSCHLAEGE = [
  "Mathematik", "Deutsch", "Englisch", "Französisch", "Latein", "Spanisch",
  "Biologie", "Chemie", "Physik", "Informatik", "Technik",
  "Geschichte", "Erdkunde", "Politik", "Religion", "Ethik", "Philosophie",
  "Kunst", "Musik", "Sport", "Wirtschaft", "Sachunterricht", "Lernzeit",
];

export default function Kurse() {
  const { t } = useLanguage();
  const [kurse, setKurse] = useState([]);
  const [allClasses, setAllClasses] = useState([]);
  // Gelöschte Kurse liegen im gemeinsamen Papierkorb des Kerns (/papierkorb).
  const [neu, setNeu] = useState("");
  const [editKurs, setEditKurs] = useState(null); // aufgeklappter Bearbeiten-Bereich (Name, E/G)
  // Name, Schuljahr, Vorjahr, E/G, Klassen und Archiv sind EIN Entwurf mit
  // EINER Speicherleiste. Vorher ging jeder Handgriff für sich zum Server: der
  // Schalter beim Umlegen, die Klasse beim Auswählen im Feld daneben.
  //
  // Jahresfolge: Schuljahr und der Kurs des Vorjahres. Die Daten bleiben
  // getrennt (Zeugnisnoten gelten je Schuljahr) — verbunden wird nur die Kette,
  // damit „6.5 Mathe" und „7.5 Mathe" nicht als zwei fremde Gruppen dastehen.
  const LEER = { name: "", jahr: "", fach: "", jahrgang: "", vorgaenger: "", niveauAktiv: false, archiviert: false, klassen: [] };
  const [kursBasis, setKursBasis] = useState(LEER);
  const kurs = useEntwurf(kursBasis, (w) => kursSpeichern(w));
  const kursUebernehmen = (stand) => { setKursBasis(stand); kurs.setz(stand); };
  const [alleKurse, setAlleKurse] = useState([]);   // inkl. Archiv — das Vorjahr liegt meist dort

  // Ein Serverfehler sah hier aus wie „noch kein Kurs angelegt" — mitsamt der
  // freundlichen Empty-Kachel. Wer seine Kurse vermisste, suchte den Fehler bei
  // sich statt beim Endpunkt. Deshalb der eigene Zustand.
  const [ladefehler, setLadefehler] = useState(false);
  // Archiv wie bei den Klassen: raus aus den Listen, Inhalte bleiben.
  const [archiv, setArchiv] = useState(false);
  const load = (imArchiv = archiv) => fetch(`${API}/kurse${imArchiv ? "?archiviert=true" : ""}`)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { setKurse(Array.isArray(d) ? d : []); setLadefehler(false); })
    .catch(() => setLadefehler(true));
  const loadClasses = () => hol(`${API}/classes`).then((d) => setAllClasses(Array.isArray(d) ? d : []));
  useEffect(() => { load(); loadClasses(); }, []);

  const anlegen = async () => {
    const name = neu.trim(); if (!name) return;
    // Bei Ablehnung bleibt der getippte Name im Feld stehen — sonst wäre er weg
    // und der Kurs trotzdem nicht da.
    if (!(await sende(`${API}/kurse`, alsJson("POST", { name }), t("kurse.add")))) return;
    setNeu(""); load();
  };
  const openEdit = (k) => {
    if (editKurs === k.id) {
      if (kurs.geaendert && !window.confirm(t("speichern.verlassen"))) return;
      kursUebernehmen(LEER); setEditKurs(null); return;
    }
    if (kurs.geaendert && !window.confirm(t("speichern.verlassen"))) return;
    setEditKurs(k.id);
    kursUebernehmen({
      name: k.name, jahr: k.schuljahr || "", vorgaenger: k.vorgaenger_id ? String(k.vorgaenger_id) : "",
      niveauAktiv: !!k.niveau_aktiv, archiviert: archiv, klassen: k.classes.map((c) => c.id),
    });
    // Auswahl fuer „Vorjahr": aktive UND archivierte Kurse. Nach dem
    // Schuljahresende steht der Vorgaenger im Archiv, und genau dann braucht
    // man ihn hier.
    Promise.all([
      fetch(`${API}/kurse`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/kurse?archiviert=true`).then((r) => (r.ok ? r.json() : [])),
    ]).then(([a, b]) => setAlleKurse([...(a || []), ...(b || [])])).catch(() => {});
  };
  // Ein Speichern für den ganzen Bearbeiten-Bereich: erst der Kurs selbst, dann
  // die Klassen, die dazugekommen oder weggefallen sind, zuletzt das Archiv.
  // Bricht ein Schritt ab, bleibt der Entwurf offen (Rückgabe false).
  const kursSpeichern = async (w) => {
    const k = kurse.find((x) => x.id === editKurs);
    if (!k) return false;
    const name = w.name.trim();
    if (!name) return false;
    const koerper = { name, schuljahr: w.jahr.trim(), vorgaenger_id: w.vorgaenger ? Number(w.vorgaenger) : 0, niveau_aktiv: w.niveauAktiv };
    if (!(await sende(`${API}/kurse/${k.id}`, alsJson("PUT", koerper), t("kurse.editName")))) return false;
    for (const id of w.klassen.filter((x) => !kursBasis.klassen.includes(x)))
      if (!(await sende(`${API}/kurse/${k.id}/classes/${id}`, { method: "POST" }, t("kurse.addClass")))) return false;
    for (const id of kursBasis.klassen.filter((x) => !w.klassen.includes(x)))
      if (!(await sende(`${API}/kurse/${k.id}/classes/${id}`, { method: "DELETE" }, t("kurse.unlink")))) return false;
    if (w.archiviert !== kursBasis.archiviert
      && !(await sende(`${API}/kurse/${k.id}/archive`, { method: "POST" }, t("classes.archive")))) return false;
    setKursBasis(w);
    load(); loadClasses();
  };
  const delKurs = (k) => {
    // Sofort aus der Liste, 5 s Undo-Toast; erst dann wirklich löschen.
    setKurse((prev) => prev.filter((x) => x.id !== k.id));
    undoDelete({
      message: t("undo.deleted", { name: k.name }),
      undo: () => load(),
      commit: async () => { await fetch(`${API}/kurse/${k.id}`, { method: "DELETE" }).catch(() => {}); },
    });
  };

  // Klassen, die (noch) nicht im Entwurf dieses Kurses stehen — zum Hinzufügen.
  const frei = (ids) => { const drin = new Set(ids); return allClasses.filter((c) => !drin.has(c.id)); };
  // Name einer Klassen-ID: erst aus dem Kurs (dort steht sie schon), sonst aus
  // der Gesamtliste — eine gerade hinzugefügte kennt der Kurs noch nicht.
  const klassenName = (k, id) => k.classes.find((c) => c.id === id)?.name
    || allClasses.find((c) => c.id === id)?.name || `#${id}`;

  return (
    <div style={{ ...pageApp }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>{t("kurse.title")}</h1>
      </div>
      <p style={pageIntro}>{t("kurse.intro")}</p>

      {/* Eine Leiste statt zwei Zeilen: links die Auswahl (aktiv/Archiv),
          daneben der eine haeufige Handgriff (neuer Kurs). Das Feld hat
          Leistenhoehe — daneben stand der AddButton vorher vier Pixel tiefer. */}
      <Werkzeugleiste
        links={<Tabs value={archiv ? "archiv" : "aktiv"} onChange={(v) => { const a = v === "archiv"; setArchiv(a); load(a); }}
          options={[["aktiv", t("classes.active")], ["archiv", t("classes.archived")]]} />}
        style={{ marginBottom: 16 }}
      >
        {!archiv && (
          <>
            <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anlegen()}
              placeholder={t("kurse.newPlaceholder")} style={{ ...toolbarInput, flex: "1 1 200px", minWidth: 0 }} />
            <AddButton onClick={anlegen} title={t("kurse.add")} />
          </>
        )}
      </Werkzeugleiste>

      {/* Ladefehler ist NICHT dasselbe wie „noch nichts angelegt": das eine
          repariert der Server, das andere die Lehrkraft. */}
      {ladefehler ? <LoadError message={t("kurse.loadError")} onRetry={() => { load(); loadClasses(); }} />
        : kurse.length === 0 && <Empty title={t("kurse.emptyTitle")} hint={t("kurse.emptyHint")} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {kurse.map((k) => (
          <div key={k.id} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: 16 }}>{k.name}</strong>
              {k.schuljahr && <span style={chipStyle}>{k.schuljahr}</span>}
              <span style={{ flex: 1 }} />
              {/* Archivieren steht jetzt IM Bearbeiten-Bereich und wartet dort
                  auf „Speichern" — es ist ein Umschalten wie der E/G-Regler,
                  kein Sofortbefehl. Der Stift auch im Archiv, sonst käme man an
                  archivierte Kurse gar nicht mehr heran. */}
              <button onClick={() => openEdit(k)} className="icon-btn" style={iconBtn} title={t("common.edit")} aria-label={t("common.edit")}><Icon d={ICONS.edit} size={15} /></button>
            </div>
            {/* Zweiter Weg durch Nuvora: vom Kurs (Fach) aus in die Module.
                Alles Verlinkte ist fachlich — deshalb hier und nicht an der Klasse. */}
            {(k.vorgaenger_name || k.nachfolger_name) && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "var(--text3)", marginBottom: 8 }}>
                {k.vorgaenger_name && <span title={t("kurse.chainHint")}>← {t("kurse.previousYear")}: {k.vorgaenger_name}</span>}
                {k.vorgaenger_name && k.nachfolger_name && <span>·</span>}
                {k.nachfolger_name && <span title={t("kurse.chainHint")}>{t("kurse.nextYear")}: {k.nachfolger_name} →</span>}
              </div>
            )}
            <KursLinks kurs={k} />

            {/* Bearbeiten-Bereich (hinter dem Stift): klar gegliedert in Name,
                Klassen (hinzufügen/entfernen) und E/G. */}
            {editKurs === k.id && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>
                {/* EINE Leiste für den ganzen Bereich — Name, Jahr, Klassen,
                    E/G und Archiv gehen zusammen hinaus. */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Speicherleiste entwurf={kurs} immer />
                  <button onClick={() => kurs.setz((w) => ({ archiviert: !w.archiviert }))}
                    style={{ ...btnSecondary, ...btnSmall, marginLeft: "auto",
                      borderColor: kurs.wert.archiviert !== kursBasis.archiviert ? "var(--accent)" : "var(--border2)" }}
                    title={t("classes.archiveHint")}>
                    {kurs.wert.archiviert ? t("classes.unarchive") : t("classes.archive")}
                  </button>
                </div>

                <div>
                  <div style={editLabel}>{t("kurse.editName")}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input value={kurs.wert.name} onChange={(e) => kurs.setz({ name: e.target.value })} placeholder={t("kurse.renamePrompt")}
                      onKeyDown={(e) => e.key === "Enter" && kurs.speichern()} style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
                  </div>
                </div>

                <div>
                  <div style={editLabel}>{t("kurse.editYear")}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input value={kurs.wert.jahr} onChange={(e) => kurs.setz({ jahr: e.target.value })} placeholder="2025/26"
                      style={{ ...inputStyle, width: 120 }} />
                    <select value={kurs.wert.vorgaenger} onChange={(e) => kurs.setz({ vorgaenger: e.target.value })} style={{ ...selectStyle, flex: 1, minWidth: 200 }}>
                      <option value="">{t("kurse.noPrevious")}</option>
                      {/* Nur FRUEHERE Jahrgaenge: ein Kurs aus demselben
                          Schuljahr ist nie das Vorjahr. Kurse ohne
                          Jahresangabe bleiben in der Liste — Bestandskurse
                          tragen keins, und sie zu verstecken hiesse, sie gar
                          nicht verknuepfen zu koennen. Neueste zuerst, damit
                          das direkt vorangehende Jahr oben steht. */}
                      {alleKurse
                        .filter((x) => x.id !== k.id && liegtDavor(x.schuljahr, kurs.wert.jahr))
                        .sort((a, b) => nachJahrAbsteigend(a.schuljahr, b.schuljahr))
                        .map((x) => (
                          <option key={x.id} value={x.id}>{x.name}{x.schuljahr ? ` (${x.schuljahr})` : ""}</option>
                        ))}
                    </select>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{t("kurse.chainHint")}</div>
                </div>

                <div>
                  <div style={editLabel}>{t("kurse.editClasses")}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {/* Angezeigt wird der Entwurf, nicht der Serverstand: eine
                        gerade gewählte Klasse steht sofort da, ist aber erst
                        mit „Speichern" wirklich im Kurs. */}
                    {kurs.wert.klassen.map((cid) => (
                      <span key={cid} style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {klassenName(k, cid)}
                        <button onClick={() => kurs.setz((w) => ({ klassen: w.klassen.filter((x) => x !== cid) }))} title={t("kurse.unlink")}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 0, display: "flex" }}>
                          <Icon d={ICONS.close} size={12} />
                        </button>
                      </span>
                    ))}
                    {frei(kurs.wert.klassen).length > 0 && (
                      <select value="" onChange={(e) => { const id = Number(e.target.value); if (id) kurs.setz((w) => ({ klassen: [...w.klassen, id] })); }} style={selectStyle}>
                        <option value="">+ {t("kurse.addClass")}</option>
                        {frei(kurs.wert.klassen).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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

                {kurs.wert.klassen.length > 0 && (
                  <div>
                    <div style={editLabel}>{t("kurse.editLevels")}</div>
                    <Toggle checked={kurs.wert.niveauAktiv} onChange={(v) => kurs.setz({ niveauAktiv: v })} label={t("kurse.niveauToggle")} />
                    {/* Teilnehmerliste immer sichtbar; der E/G-Selektor je Person nur,
                        wenn der E/G-Regler an ist. */}
                    <NiveauPanel kursId={k.id} niveauAktiv={kurs.wert.niveauAktiv} t={t} />
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
  const load = () => hol(`${API}/kurse/${kursId}/members`).then((d) => {
    const liste = Array.isArray(d) ? d : [];
    setMembers(liste);
    uebernehmen({ ids: liste.map((m) => m.student_id) });
  });
  useEffect(() => { load(); }, [kursId]); // eslint-disable-line
  // Wer im Kurs ist, sammelt sich im Entwurf: Hinzufügen und Entfernen gehen
  // gemeinsam mit einem Speichern hinaus.
  const [basis, setBasis] = useState({ ids: [] });
  const e = useEntwurf(basis, async (w) => {
    for (const sid of w.ids.filter((x) => !basis.ids.includes(x)))
      if (!(await sende(`${API}/kurse/${kursId}/members/${sid}`, { method: "POST" }, t("kurse.editStudents")))) return false;
    for (const sid of basis.ids.filter((x) => !w.ids.includes(x)))
      if (!(await sende(`${API}/kurse/${kursId}/members/${sid}`, { method: "DELETE" }, t("kurse.unlink")))) return false;
    setBasis(w);
    load();
  });
  const entwurfRef = useRef(null);
  entwurfRef.current = e;
  const uebernehmen = (stand) => { setBasis(stand); entwurfRef.current?.setz(stand); };
  const memberIds = new Set(e.wert.ids);
  const add = (sid) => e.setz((w) => ({ ids: [...w.ids, sid] }));
  const remove = (sid) => e.setz((w) => ({ ids: w.ids.filter((x) => x !== sid) }));
  const cls = allClasses.find((c) => String(c.id) === String(pickClass));
  const candidates = cls ? (cls.students || []).filter((sname) => !memberIds.has(sname.id)) : [];
  // Name einer Person: aus der geladenen Liste, sonst aus den Klassen (frisch
  // hinzugefügte kennt der Server noch nicht).
  const nameVon = (sid) => members.find((m) => m.student_id === sid)
    || allClasses.flatMap((c) => (c.students || []).map((s) => ({ student_id: s.id, name: s.name, class_name: c.name }))).find((s) => s.student_id === sid)
    || { name: `#${sid}`, class_name: "" };
  return (
    <div>
      {e.wert.ids.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          {e.wert.ids.map((sid) => { const m = nameVon(sid); return (
            <span key={sid} style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 4 }}>
              {m.name} <span style={{ color: "var(--text3)", fontSize: 11 }}>· {m.class_name}</span>
              <button onClick={() => remove(sid)} title={t("kurse.unlink")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 0, display: "flex" }}>
                <Icon d={ICONS.close} size={12} />
              </button>
            </span>
          ); })}
        </div>
      )}
      <Speicherleiste entwurf={e} style={{ marginBottom: 8 }} klein />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={pickClass} onChange={(e) => setPickClass(e.target.value)} style={selectStyle}>
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
  // Vorher ging JEDER Tastendruck im Detailfeld als eigener PUT hinaus. Jetzt
  // sammelt der Entwurf die Maßnahmen aller Personen dieses Kurses; gespeichert
  // wird, was sich wirklich geändert hat.
  const [basis, setBasis] = useState({ liste: {} });
  const e = useEntwurf(basis, async (w) => {
    for (const [name, m] of Object.entries(w.liste)) {
      if (m === basis.liste[name]) continue;
      if (!(await sende(`${API}/kurse/${kursId}/massnahmen`, alsJson("PUT", { name, massnahmen: m }), t("kurse.editMeasures")))) return false;
    }
    setBasis(w);
  });
  const entwurfRef = useRef(null);
  entwurfRef.current = e;
  useEffect(() => {
    fetch(`${API}/kurse/${kursId}/massnahmen`).then((r) => (r.ok ? r.json() : [])).then((d) => {
      const liste = Array.isArray(d) ? d : [];
      setStuds(liste);
      const stand = { liste: Object.fromEntries(liste.map((s) => [s.name, s.massnahmen || []])) };
      setBasis(stand); entwurfRef.current?.setz(stand);
    }).catch(() => setStuds([]));
  }, [kursId]); // eslint-disable-line

  const massnahmen = (s) => e.wert.liste[s.name] || [];
  const setzen = (s, liste) => e.setz((w) => ({ liste: { ...w.liste, [s.name]: liste } }));
  const setFeld = (s, i, feld, wert) => {
    const liste = [...massnahmen(s)];
    liste[i] = { ...liste[i], [feld]: wert };
    setzen(s, liste);
  };
  const hinzu = (s) => setzen(s, [...massnahmen(s), { art: MASSNAHMEN[0][0], detail: "", arbeit: true }]);
  const weg = (s, i) => setzen(s, massnahmen(s).filter((_, x) => x !== i));

  if (!studs) return null;
  if (studs.length === 0) return <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("kurse.niveauNoStudents")}</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Speicherleiste entwurf={e} style={{ marginBottom: 4 }} klein />
      {studs.map((s) => {
        const n = massnahmen(s).length;
        const auf = offen === s.name;
        return (
          <div key={s.name} style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
            <button onClick={() => setOffen(auf ? null : s.name)}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: "2px 0", cursor: "pointer", textAlign: "left", fontSize: 13, color: "var(--text)" }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              <span style={{ fontSize: 12, color: n ? "var(--accent)" : "var(--text3)" }}>{n ? t("kurse.measuresCount", { n }) : t("kurse.measuresNone")}</span>
              <span style={{ color: "var(--text3)", display: "inline-flex" }}>
                <Icon d={auf ? ICONS.chevronUp : ICONS.chevronDown} size={13} />
              </span>
            </button>
            {auf && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0 12px" }}>
                {massnahmen(s).map((m, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select value={m.art} onChange={(e) => setFeld(s, i, "art", e.target.value)}
                      title={(MASSNAHMEN.find(([w]) => w === m.art) || [])[1] || ""}
                      style={{ ...selectStyle, minWidth: 170 }}>
                      {MASSNAHMEN.map(([wert]) => <option key={wert} value={wert}>{wert}</option>)}
                    </select>
                    <input value={m.detail || ""} onChange={(e) => setFeld(s, i, "detail", e.target.value)}
                      placeholder={t("classes.measureDetail")} maxLength={300}
                      style={{ ...toolbarInput, flex: 1, minWidth: 140 }} />
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text2)", cursor: "pointer" }}
                      title={t("classes.measureExamHint")}>
                      <input type="checkbox" checked={!!m.arbeit} onChange={(e) => setFeld(s, i, "arbeit", e.target.checked)} style={{ margin: 0 }} />
                      {t("classes.measureExam")}
                    </label>
                    <button onClick={() => weg(s, i)} className="icon-btn" style={iconBtn} title={t("common.delete")} aria-label={t("common.delete")}>
                      <Icon d={ICONS.trash} size={14} color={C.danger} />
                    </button>
                  </div>
                ))}
                <div>
                  <button onClick={() => hinzu(s)} style={{ ...btnSecondary, ...btnSmall }}>{t("classes.measureAdd")}</button>
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
  // E/G steuert die Wertung — ein still verlorenes E hieße: die Auswertung
  // rechnet weiter mit G, und niemand merkt es bis zur Notenkonferenz. Deshalb
  // sammelt der Entwurf die Umschaltungen und zeigt „nicht gespeichert", bis
  // sie wirklich draußen sind.
  const [basis, setBasis] = useState({});
  const e = useEntwurf(basis, async (w) => {
    for (const [name, niveau] of Object.entries(w)) {
      if (niveau === basis[name]) continue;
      if (!(await sende(`${API}/kurse/${kursId}/niveau`, alsJson("PUT", { name, niveau }), t("kurse.editLevels")))) return false;
    }
    setBasis(w);
  });
  const entwurfRef = useRef(null);
  entwurfRef.current = e;
  useEffect(() => {
    fetch(`${API}/kurse/${kursId}/students`).then((r) => (r.ok ? r.json() : [])).then((d) => {
      const liste = Array.isArray(d) ? d : [];
      setStuds(liste);
      const stand = Object.fromEntries(liste.map((s) => [s.name, s.niveau || ""]));
      setBasis(stand); entwurfRef.current?.setz(stand);
    }).catch(() => setStuds([]));
  }, [kursId]); // eslint-disable-line
  if (!studs) return null;
  if (studs.length === 0) return <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 8 }}>{t("kurse.niveauNoStudents")}</p>;
  return (
    <>
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
        {studs.map((s) => (
          <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            {/* E/G-Selektor nur bei aktivem Regler; sonst nur der Name (Teilnehmer sichtbar). */}
            {niveauAktiv && (
              <NiveauToggle wert={e.wert[s.name] || ""} onChange={(v) => e.setz({ [s.name]: v })}
                size={24} title={t("kurse.niveauToggle")} />
            )}
          </div>
        ))}
      </div>
      <Speicherleiste entwurf={e} style={{ marginTop: 8 }} klein />
    </>
  );
}
