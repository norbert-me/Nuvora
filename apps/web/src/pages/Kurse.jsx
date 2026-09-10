// Kurse (Lerngruppen) verwalten. Klassen im selben Kurs teilen SuS + Anwesenheit
// (per Name); Karten/Noten bleiben pro Fach-Klasse. Eine Klasse darf in mehreren
// Kursen sein.
import { useState, useEffect, useRef } from "react";
import { liegtDavor, nachJahrAbsteigend } from "../core/schuljahr.js";
import KursKinder from "../components/KursKinder.jsx";
import { useLanguage } from "../i18n/index.jsx";
import KursLinks from "../components/KursLinks.jsx";
import { undoDelete } from "../core/undo.jsx";
import { alsJson, hol, sende } from "../core/melden.js";
import { AddButton, pageTitle, pageIntro, btnSecondary, btnSmall, selectStyle, chipStyle,
  Icon, ICONS, iconBtn, COLORS as C, cardStyle, inputStyle, toolbarInput, sectionLabel, Toggle, Tabs, Empty, pageApp, LoadError } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import Speicherleiste, { useEntwurf } from "../components/Speichern.jsx";
import SuchSelect from "../components/SuchSelect.jsx";

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

// Platzhalter fuer „andere …" in den Auswahlfeldern: er steht nur im Entwurf
// und wird beim Speichern zu einem leeren Wert — sonst stuende er als Jahr in
// der Datenbank.
const NEU = "\u0000neu";

export default function Kurse() {
  const { t } = useLanguage();
  const [kurse, setKurse] = useState([]);
  const [allClasses, setAllClasses] = useState([]);
  // Gelöschte Kurse liegen im gemeinsamen Papierkorb des Kerns (/papierkorb).
  const [neu, setNeu] = useState("");
  // Vorbild fuer einen neuen Kurs (leer = leerer Kurs).
  const [ausKurs, setAusKurs] = useState("");
  const [editKurs, setEditKurs] = useState(null); // aufgeklappter Bearbeiten-Bereich (Name, E/G)
  // Name, Schuljahr, Vorjahr, E/G, Klassen und Archiv sind EIN Entwurf mit
  // EINER Speicherleiste. Vorher ging jeder Handgriff für sich zum Server: der
  // Schalter beim Umlegen, die Klasse beim Auswählen im Feld daneben.
  //
  // Jahresfolge: Schuljahr und der Kurs des Vorjahres. Die Daten bleiben
  // getrennt (Zeugnisnoten gelten je Schuljahr) — verbunden wird nur die Kette,
  // damit „6.5 Mathe" und „7.5 Mathe" nicht als zwei fremde Gruppen dastehen.
  const LEER = { name: "", jahr: "", fach: "", raum: "", vorgaenger: "", niveauAktiv: false, archiviert: false, klassen: [] };
  const [kursBasis, setKursBasis] = useState(LEER);
  const kurs = useEntwurf(kursBasis, (w) => kursSpeichern(w));
  const kursUebernehmen = (stand) => { setKursBasis(stand); kurs.setz(stand); };
  const [alleKurse, setAlleKurse] = useState([]);   // inkl. Archiv — das Vorjahr liegt meist dort
  // Und welche Schuljahre: „2025/26" tippt niemand jedes Mal neu, und ein
  // Tippfehler macht aus einem Jahr zwei.
  // Aus den eigenen Kursen, Archiv eingeschlossen (das Vorjahr liegt dort).
  const schuljahre = [...new Set([...kurse, ...alleKurse].map((k) => k.schuljahr).filter(Boolean))]
    .sort(nachJahrAbsteigend);

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
    //
    // „aus": derselbe Kurs mit anderem Fach oder im nächsten Jahr — der
    // Normalfall. Übernommen werden die KINDER; Noten, Karten und Anwesenheit
    // des Vorbilds bleiben, wo sie entstanden sind.
    const rumpf = ausKurs ? { name, aus_kurs_id: Number(ausKurs) } : { name };
    if (!(await sende(`${API}/kurse`, alsJson("POST", rumpf), t("kurse.add")))) return;
    setNeu(""); setAusKurs(""); load();
  };
  const openEdit = (k) => {
    if (editKurs === k.id) {
      if (kurs.geaendert && !window.confirm(t("speichern.verlassen"))) return;
      kursUebernehmen(LEER); setEditKurs(null); return;
    }
    if (kurs.geaendert && !window.confirm(t("speichern.verlassen"))) return;
    setEditKurs(k.id);
    kursUebernehmen({
      name: k.name, jahr: k.schuljahr || "", fach: k.fach || "", raum: k.raum || "",
      vorgaenger: k.vorgaenger_id ? String(k.vorgaenger_id) : "",
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
    const koerper = { name, schuljahr: w.jahr === NEU ? "" : w.jahr.trim(), vorgaenger_id: w.vorgaenger ? Number(w.vorgaenger) : 0, niveau_aktiv: w.niveauAktiv,
                      fach: (w.fach || "").trim(),
                      raum: (w.raum || "").trim() };
    if (!(await sende(`${API}/kurse/${k.id}`, alsJson("PUT", koerper), t("kurse.editName")))) return false;
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
            {/* Leer ODER aus einem anderen Kurs entwickeln — beides steht
                nebeneinander, weil es dieselbe Handlung ist. Erst ab einem
                vorhandenen Kurs sichtbar: vorher gibt es nichts zu übernehmen. */}
            {kurse.length > 0 && (
              <select value={ausKurs} onChange={(e) => setAusKurs(e.target.value)}
                title={t("kurse.ausKursHinweis")} style={{ ...selectStyle, maxWidth: 220 }}>
                <option value="">{t("kurse.ausKursLeer")}</option>
                {kurse.map((k) => <option key={k.id} value={k.id}>{t("kurse.ausKurs", { name: k.name })}</option>)}
              </select>
            )}
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
              {k.fach && <span style={chipStyle}>{k.fach}</span>}
              {k.raum && <span style={chipStyle}>{k.raum}</span>}
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
                  {/* Archivieren wirkt SOFORT und wartet nicht auf „Speichern":
                      es ist eine Handlung, kein Feld — wie Löschen. Als Teil des
                      Entwurfs stand die Maske nach einem Klick auf „nicht
                      gespeichert", obwohl niemand etwas getippt hatte, und der
                      Knopf sah aus wie ein Umschalter, der nichts tut. */}
                  <button onClick={async () => {
                      if (!(await sende(`${API}/kurse/${k.id}/archive`, { method: "POST" }, t("classes.archive")))) return;
                      load(); loadClasses();
                    }}
                    style={{ ...btnSecondary, ...btnSmall, marginLeft: "auto" }}
                    title={t("classes.archiveHint")}>
                    {archiv ? t("classes.unarchive") : t("classes.archive")}
                  </button>
                </div>

                {/* Die Kinder stehen im KURS — dort, wo mit ihnen gearbeitet
                    wird. Die Klassenmaske daneben war eine zweite Liste
                    derselben Personen (Umbau vom 06.09.2026). */}
                <div>
                  <KursKinder kursId={k.id} t={t} />
                </div>

                <div>
                  <div style={editLabel}>{t("kurse.editName")}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input value={kurs.wert.name} onChange={(e) => kurs.setz({ name: e.target.value })} placeholder={t("kurse.renamePrompt")}
                      onKeyDown={(e) => e.key === "Enter" && kurs.speichern()} style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
                  </div>
                </div>

                {/* Das Fach: das Gegenstueck zu `topics.fach`. Erst dadurch
                    laesst sich fragen „welche Themen gehoeren zu diesem Kurs"
                    — der NAME ist frei („Mathe 7.5", „M7b", „Gruppe rot") und
                    taugt nicht als Schluessel. Es steht ausserdem im
                    Kalender-Etikett („Fach · Kurs"). */}
                <div>
                  <div style={editLabel}>{t("kurse.editFach")}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input list="nuvora-faecher-kurs" value={kurs.wert.fach} maxLength={60}
                      onChange={(e) => kurs.setz({ fach: e.target.value })} placeholder={t("topics.fachPlaceholder")}
                      style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
                    <datalist id="nuvora-faecher-kurs">
                      {FACH_VORSCHLAEGE.map((f) => <option key={f} value={f} />)}
                    </datalist>
                    {/* Der Stammraum. Am Kurs und nicht je Stundenplan-Stunde:
                        derselbe Kurs hat vier Stunden in der Woche und meist
                        denselben Raum. Der Kalender setzt ihn als Ort ein. */}
                    <input value={kurs.wert.raum} maxLength={60}
                      onChange={(e) => kurs.setz({ raum: e.target.value })} placeholder={t("kurse.raum")}
                      style={{ ...inputStyle, width: 140 }} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{t("kurse.fachHint")}</div>
                </div>

                <div>
                  <div style={editLabel}>{t("kurse.editYear")}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {/* Auswahl statt Freitext: die Liste kommt aus den
                        eigenen Kursen (Archiv eingeschlossen).
                        „andere …" bleibt der Weg fuer das erste Jahr und fuer
                        eins, das es hier noch nicht gibt — getippt wird ein
                        Schuljahr sonst jedes Mal neu, und „2025/26" neben
                        „2025/2026" sind zwei Jahre, die nie zusammenfinden. */}
                    {kurs.wert.jahr === NEU || (kurs.wert.jahr && !schuljahre.includes(kurs.wert.jahr)) ? (
                      <input autoFocus value={kurs.wert.jahr === NEU ? "" : kurs.wert.jahr} maxLength={20}
                        onChange={(e) => kurs.setz({ jahr: e.target.value })} placeholder="2025/26"
                        style={{ ...inputStyle, width: 120 }} />
                    ) : (
                      <select value={kurs.wert.jahr || ""} style={{ ...selectStyle, width: 140 }}
                        onChange={(e) => kurs.setz({ jahr: e.target.value })}>
                        <option value="">– {t("kurse.editYear")} –</option>
                        {schuljahre.map((j) => <option key={j} value={j}>{j}</option>)}
                        <option value={NEU}>{t("kurse.andere")}</option>
                      </select>
                    )}
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

                {/* Kein Klassen-Feld mehr. Der Kurs ist die Bedienebene
                    (Umbau vom 06.09.2026): gepflegt werden KINDER, und wer sie
                    aus einer ganzen Klasse holt, tut das beim Anlegen („aus
                    einem anderen Kurs entwickeln") oder über die Namensliste.
                    Ein zweites Feld daneben führte dieselben Personen ein
                    zweites Mal — und niemand wusste, welche der beiden Listen
                    gilt. Die Verknüpfung selbst gibt es weiter (die API), nur
                    nicht mehr als Formularfeld. */}
                <div>
                  <div style={editLabel}>{t("kurse.editStudents")}</div>
                  <StudentMembers kursId={k.id} allClasses={allClasses} t={t} />
                </div>

                {/* Fördermaßnahmen und E/G je Person standen hier als zwei
                    eigene Listen — dieselben dreißig Namen ein zweites und
                    drittes Mal, direkt unter der Kinderliste, in der sie schon
                    stehen. Beides gehört zu EINEM Kind und steht jetzt in
                    seinen Angaben (Klick auf den Namen oben); die Liste zeigt
                    nur noch, WER ein E/G-Niveau und wer einen
                    Nachteilsausgleich hat. Der Schalter bleibt hier: er gilt
                    dem ganzen Kurs, nicht einem Kind. */}
                <div>
                    <div style={editLabel}>{t("kurse.editLevels")}</div>
                    <Toggle checked={kurs.wert.niveauAktiv} onChange={(v) => kurs.setz({ niveauAktiv: v })} label={t("kurse.niveauToggle")} />
                </div>
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
  // Alle Kinder aller Klassen, die noch nicht im Kurs sind — einmal je
  // Listenzeile, mit ihrer Klasse. Mehr weiß die Seite nicht: Mitglied wird
  // eine ZEILE (student_id), daran hängen Noten und Karten.
  const kandidaten = allClasses
    .flatMap((c) => (c.students || []).map((s) => ({ id: s.id, name: s.name, class_name: c.name })))
    .filter((s) => !memberIds.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
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
      {/* Gesucht wird die PERSON, nicht erst ihre Klasse. Vorher musste man
          wissen, in welcher Liste ein Kind steht, bevor man es hinzufügen
          konnte — genau das weiß man beim Zusammenstellen eines Kurses nicht
          („wer kommt in den WP8?"). Die Klasse steht am Treffer, damit
          Namensgleiche unterscheidbar bleiben. */}
      <SuchSelect value="" onChange={(v) => { if (v) add(Number(v)); }}
        leerLabel={t("kurse.personSuchen")} abSuche={0}
        optionen={kandidaten.map((s) => ({ wert: String(s.id), label: `${s.name}${s.class_name ? ` · ${s.class_name}` : ""}` }))}
        style={{ maxWidth: 320 }} />
      {kandidaten.length === 0 && <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("kurse.allAdded")}</span>}
    </div>
  );
}

