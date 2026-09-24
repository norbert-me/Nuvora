// Themen sind Nuvora-Kerndaten: der gemeinsame Wortschatz beider Module.
// CardVote-Fragen und (spaeter) Lernpfad-Aufgaben zeigen auf dieselben Themen —
// erst dadurch laesst sich ein schwach ausgefallenes Thema auf passende
// Aufgaben abbilden.
import { useState, useEffect, useMemo, useRef } from "react";
import { askConfirm } from "../core/dialog.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { AddButton, btnSecondary, cardStyle, chipStyle, COLORS as C, CONTROL_R, DialogKopf, Empty, Icon, iconBtn, ICONS, inputStyle, Modal, pageApp, pageIntro, pageTitle, panelStyle, sectionLabel, Skeleton } from "../components/Icons.jsx";
import Speicherleiste, { useEntwurf } from "../components/Speichern.jsx";
import { peek, put } from "../core/cache.js";
import AutoTextarea from "../components/AutoTextarea.jsx";
import { Link } from "react-router-dom";
import { themaZiel } from "../core/themaLinks.js";
import { useEinfuegen } from "../core/ziehsortieren.js";
import { mitNummer, themenGruppen, themenVergleich } from "../core/topics.js";
import { alsJson, hol } from "../core/melden.js";

const API = "/api";

export default function Topics() {
  const { t } = useLanguage();
  const [topics, setTopics] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  // Anlegen läuft über denselben Dialog wie das Bearbeiten, mit allen Feldern
  // (Nummer, Fach, Stufe …) — vorher nur ein Namensfeld, und alles Übrige
  // musste man danach im zweiten Schritt nachtragen. `{ parent_id }` = offen.
  const [neu, setNeu] = useState(null);
  const [popup, setPopup] = useState(null); // Thema/Unterthema im Detail-Popup
  const [expanded, setExpanded] = useState(() => new Set());
  // Ziehen zum Umsortieren kommt aus core/ziehsortieren.js — dieselbe Marke
  // („vor"/„nach") wie bei Kartenstapeln, Karten und Notenbuch-Spalten.
  // Unterthemen sortieren sich nur unter ihrem eigenen Thema — die Gruppe ist
  // der Elternknoten; zwischen Themen umhängen geht über das Detail-Popup.
  const ziehKind = useEinfuegen({ nurGleicheGruppe: true });
  // Sortiert wird nach Fach, Stufe und Nummer (core/topics.js); gezogen wird
  // deshalb nur zwischen Einträgen, die dort gleichauf liegen — sonst sprängen
  // sie nach dem Ablegen an ihren Platz zurück.
  const zieh0 = useEinfuegen({ nurGleicheGruppe: true });

  const toggleExpand = (id) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Umsortieren ist eine Änderung wie jede andere: sie sammelt sich im Entwurf
  // und geht erst mit „Speichern" zum Server. Vorher lag jede losgelassene
  // Karte sofort in der Datenbank — ein Verrutschen war nicht zurückzunehmen.
  const dropRoot = (targetId) => {
    const ids = zieh0.ablegen(targetId, ordnung.wert.ids);
    if (ids) ordnung.setz({ ids });
  };
  const dropKind = (parentId, targetId) => {
    const aktuell = kinderIds(parentId);
    const ids = ziehKind.ablegen(targetId, aktuell);
    if (ids) ordnung.setz({ kinder: { ...ordnung.wert.kinder, [parentId]: ids } });
  };

  const load = () =>
    fetch(`${API}/topics`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { const list = Array.isArray(d) ? d : []; setTopics(list); put("topics", list); })
      .catch(() => setError(t("topics.loadError")))
      .finally(() => setLoaded(true));

  useEffect(() => {
    const c = peek("topics"); if (Array.isArray(c)) { setTopics(c); setLoaded(true); }
    load();
  }, []);

  const call = async (fn) => {
    setError("");
    try {
      const res = await fn();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || t("common.notWork"));
        return false;
      }
      await load();
      return true;
    } catch {
      setError(t("common.notWork"));
      return false;
    }
  };

  // Reihenfolge der Themen als Entwurf. Die Grundlage muss über Rendergrenzen
  // hinweg DIESELBE bleiben (sonst ersetzt useEntwurf die Arbeitskopie bei
  // jedem Rendern) — deshalb der Schlüssel aus den IDs.
  const wurzelIds = topics.filter((x) => x.parent_id === null).map((x) => x.id);
  // Unterthemen je Thema im selben Schlüssel: „7:3,1,2;9:4" — eine Änderung
  // an ihrer Reihenfolge gehört in denselben Entwurf wie die der Themen.
  const kinderSchluessel = wurzelIds.map((id) => `${id}:${topics.filter((x) => x.parent_id === id).map((x) => x.id).join(",")}`).join(";");
  const idSchluessel = wurzelIds.join(",");
  const basisOrdnung = useMemo(() => {
    const kinder = {};
    for (const teil of kinderSchluessel ? kinderSchluessel.split(";") : []) {
      const [pid, rest] = teil.split(":");
      kinder[pid] = rest ? rest.split(",").map(Number) : [];
    }
    return { ids: idSchluessel ? idSchluessel.split(",").map(Number) : [], kinder };
  }, [idSchluessel, kinderSchluessel]);
  // Eine Liste für alle: Themen zuerst, dann die Unterthemen je Thema. Die
  // Positionen sind damit überall eindeutig, und innerhalb eines Themas stimmt
  // die Reihenfolge — mehr fragt die Sortierung (position, name) nicht.
  const ordnung = useEntwurf(basisOrdnung, (w) =>
    call(() => fetch(`${API}/topics/reorder`, alsJson("PUT", { ids: [...w.ids, ...Object.values(w.kinder || {}).flat()] }))));

  // Ein Satz Felder für Anlegen und Ändern (`w` aus dem Dialog-Entwurf).
  const felder = (w) => ({
    name: (w.name || "").trim(), notes: w.notes || "", ziel_g: w.zielG || "", ziel_e: w.zielE || "",
    voraussetzungen: w.voraus || "", fach: w.fach || "", jahrgang: (w.jahrgang || "").trim() || null,
    nummer: (w.nummer || "").trim(),
  });
  const add = async (w, parent_id) => {
    if (!(w.name || "").trim()) { setError(t("topics.newPlaceholder")); return false; }
    const ok = await call(() => fetch(`${API}/topics`, alsJson("POST", { ...felder(w), parent_id })));
    if (ok && parent_id) setExpanded((p) => new Set(p).add(parent_id));
    return ok;
  };

  // Umbenennen laeuft ueber saveTopic (Detail-Popup) — eine Funktion, ein Weg.
  // Wichtig dabei: alle Felder mitschicken, PUT setzt fehlende auf leer. Genau
  // daran ist die frueher getrennte rename()-Fassung fast gescheitert (Notiz,
  // Ziele und Voraussetzungen weg nach einem Umbenennen).
  // Titel + Notiz speichern (aus dem Detail-Popup). Leerer Titel behält den alten.
  const saveTopic = (tp, w) =>
    call(() => fetch(`${API}/topics/${tp.id}`, alsJson("PUT", { ...felder(w), name: (w.name || "").trim() || tp.name, parent_id: tp.parent_id })));

  const remove = async (tp) => {
    const kids = topics.filter((x) => x.parent_id === tp.id);
    const parts = [t("topics.delConfirm", { name: tp.name })];
    if (kids.length) parts.push(t("topics.delSubs", { n: kids.length }));
    const affected = tp.question_count + kids.reduce((n, k) => n + k.question_count, 0);
    if (affected) parts.push(t("topics.delQuestions", { n: affected }));
    if (!await askConfirm(parts.join("\n"))) return;
    await call(() => fetch(`${API}/topics/${tp.id}`, { method: "DELETE" }));
  };

  // Angezeigt wird die Reihenfolge des Entwurfs; was der Server inzwischen neu
  // kennt (frisch angelegtes Thema), hängt hinten an, statt zu verschwinden.
  // Die gezogene Reihenfolge des Entwurfs tritt an die Stelle von `position`
  // — sie entscheidet nur bei Gleichstand in Fach, Stufe und Nummer.
  const nachEntwurf = (liste, ids) => {
    const rang = new Map((ids || []).map((id, i) => [id, i]));
    return liste
      .map((x) => ({ x, v: { ...x, position: rang.has(x.id) ? rang.get(x.id) : 1e6 + (x.position || 0) } }))
      .sort((a, b) => themenVergleich(a.v, b.v))
      .map(({ x }) => x);
  };
  const roots = nachEntwurf(topics.filter((x) => x.parent_id === null), ordnung.wert.ids);
  const gruppe = (tp) => (tp.parent_id ? `${tp.parent_id}|${tp.nummer || ""}` : `${tp.fach || ""}|${tp.jahrgang || ""}|${tp.nummer || ""}`);
  // Wie bei den Themen: Reihenfolge aus dem Entwurf, Unbekanntes hinten an.
  const childrenOf = (id) => nachEntwurf(topics.filter((x) => x.parent_id === id), (ordnung.wert.kinder || {})[id]);
  const kinderIds = (id) => childrenOf(id).map((x) => x.id);
  const openPopup = (tp) => setPopup({ ...tp, parent_name: tp.parent_id ? (topics.find((x) => x.id === tp.parent_id)?.name || "") : "" });


  // Zwei Ebenen: Thema (0) > Unterthema (1). Neue Unterpunkte nur unter Themen
  // (Ebene 0). Bestehende tiefere Einträge werden weiter angezeigt, nur nicht mehr
  // erweitert. Gezogen wird auf beiden Ebenen, Unterthemen nur unter ihrem Thema.
  const MAX_DEPTH = 1;
  const row = (tp, depth) => {
    const isChild = depth > 0;
    const isRoot = depth === 0;
    const canHaveKids = depth < MAX_DEPTH;                 // neues Unterthema erlauben?
    const subCount = childrenOf(tp.id).length;             // vorhandene Kinder immer zeigen
    const z = isRoot ? zieh0 : ziehKind;
    const nachbarn = isRoot ? roots : childrenOf(tp.parent_id);
    const ziehbar = (isRoot || depth === 1) && nachbarn.filter((x) => gruppe(x) === gruppe(tp)).length > 1;
    const seite = ziehbar ? z.seite(tp.id) : null;
    return (
    <div
      key={tp.id}
      draggable={ziehbar}
      onDragStart={ziehbar ? (e) => { e.stopPropagation(); z.start(tp.id, gruppe(tp)); } : undefined}
      onDragOver={ziehbar ? (e) => z.ueber(e, tp.id, gruppe(tp)) : undefined}
      onDragEnd={ziehbar ? z.beenden : undefined}
      onDrop={ziehbar ? () => (isRoot ? dropRoot(tp.id) : dropKind(tp.parent_id, tp.id)) : undefined}
      style={{
        // Thema = Karte (cardStyle), Unterthema = flachere Zeile mit
        // Bedien-Radius — der Unterschied traegt die Schachtelung.
        ...cardStyle,
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: isChild ? "8px 12px" : 12,
        marginLeft: depth * 28, marginBottom: 4,
        borderRadius: isChild ? CONTROL_R : cardStyle.borderRadius,
        background: isChild ? "var(--bg)" : "var(--card)",
        cursor: ziehbar ? "grab" : "default",
        opacity: z.zieht === tp.id ? 0.4 : 1,
        borderTop: seite === "vor" ? "3px solid var(--accent)" : undefined,
        borderBottom: seite === "nach" ? "3px solid var(--accent)" : undefined,
      }}
    >
      {canHaveKids ? (
        <button onClick={() => toggleExpand(tp.id)} className="icon-btn" style={{ ...iconBtn, padding: 1, visibility: subCount ? "visible" : "hidden" }}
          title={expanded.has(tp.id) ? t("topics.collapse") : t("topics.expand")}>
          {/* Pfeil (rotiert) zum Auf-/Zuklappen — klar anders als das +-Icon zum
              Unterthema-Anlegen. */}
          <span style={{ display: "inline-flex", transform: expanded.has(tp.id) ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--text3)" }}>
            <Icon d={ICONS.open} size={13} />
          </span>
        </button>
      ) : null}
      {(
        <>
          {/* Klick auf den Namen klappt die Unterthemen auf — das ist, was man
              an einem Thema fast immer will. Erst wo es keine gibt, oeffnet er
              die Details; die erreicht man sonst ueber das Stift-Symbol rechts.
              Vorher fuehrte jeder Klick ins Popup, und die Liste darunter kam
              nur ueber den schmalen Pfeil links. */}
          <span onClick={() => (subCount > 0 ? toggleExpand(tp.id) : openPopup(tp))}
            title={subCount > 0 ? (expanded.has(tp.id) ? t("topics.collapse") : t("topics.expand")) : t("topics.openDetails")}
            style={{ flex: 1, fontWeight: isChild ? 400 : 600, fontSize: isChild ? 14 : 16, color: "var(--text)", cursor: "pointer" }}>
            {mitNummer(tp)}
            {subCount > 0 && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text3)", marginLeft: 8 }}>{t("topics.subCount", { n: subCount })}</span>}
          </span>
          {canHaveKids && (
            <button onClick={() => setNeu({ parent_id: tp.id })} className="icon-btn" style={iconBtn} title={t("topics.addSub")} aria-label={t("topics.addSub")}>
              <Icon d={ICONS.plus} size={16} color="var(--accent)" />
            </button>
          )}
          {/* Details (Umbenennen, Notiz, Ziele, Voraussetzungen) sitzen hinter
              EINEM Symbol — nicht verteilt auf mehrere Zeilen-Icons. Seit der
              Namensklick die Unterthemen aufklappt, braucht es diesen Weg auch
              bei Themen, die welche haben. */}
          <button onClick={() => openPopup(tp)} className="icon-btn" style={iconBtn}
            title={t("topics.openDetails")} aria-label={t("topics.openDetails")}>
            <Icon d={ICONS.edit} size={16} />
          </button>
          <button onClick={() => remove(tp)} className="icon-btn" style={iconBtn} title={t("common.delete")} aria-label={t("common.delete")}>
            <Icon d={ICONS.trash} color={C.danger} />
          </button>
        </>
      )}
    </div>
    );
  };

  // Ein Knoten samt Kindern, rekursiv bis MAX_DEPTH. Das „Hinzufügen"-Formular
  // hängt unter dem jeweiligen Elternknoten (auf jeder Ebene außer der letzten).
  // Zugeklappte Fach-/Stufen-Ordner: eine Ansicht dieses Geraets, kein Inhalt.
  const [zu, setZu] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("themen_zu") || "[]")); } catch { return new Set(); }
  });
  const umschalten = (key) => setZu((alt) => {
    const neu = new Set(alt);
    if (neu.has(key)) neu.delete(key); else neu.add(key);
    try { localStorage.setItem("themen_zu", JSON.stringify([...neu])); } catch { /* nur Ansicht */ }
    return neu;
  });

  const renderNode = (tp, depth) => (
    <div key={tp.id} style={depth === 0 ? { marginBottom: 12 } : undefined}>
      {row(tp, depth)}
      {expanded.has(tp.id) && depth < MAX_DEPTH && childrenOf(tp.id).map((c) => renderNode(c, depth + 1))}
    </div>
  );

  return (
    <div style={{ ...pageApp }}>
      <h1 style={pageTitle}>{t("topics.title")}</h1>
      <p style={pageIntro}>{t("topics.intro")}</p>

      {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <AddButton onClick={() => setNeu({ parent_id: null })} title={t("topics.addTopic")} style={{ marginBottom: 24 }} />

      {!loaded && <Skeleton rows={5} />}
      {loaded && roots.length === 0 && <Empty title={t("topics.empty")} hint={t("topics.emptyHint")} />}

      {/* Erscheint erst, wenn wirklich etwas umsortiert wurde. */}
      <Speicherleiste entwurf={ordnung} style={{ marginBottom: 12 }} />

      {/* Fach > Stufe sind keine angelegten Ordner, sondern die Felder der
          Oberthemen — sie entstehen und verschwinden mit ihnen. */}
      {themenGruppen(roots).map((f) => {
        const fKey = "f:" + f.key;
        const fZu = zu.has(fKey);
        const n = f.stufen.reduce((m, st) => m + st.themen.length, 0);
        return (
          <div key={fKey} style={{ marginBottom: 16 }}>
            <GruppenKopf ebene={0} zu={fZu} onClick={() => umschalten(fKey)}
              titel={f.fach || t("topics.ohneFach")} anzahl={n} t={t} />
            {!fZu && f.stufen.map((st) => {
              const sKey = fKey + "|s:" + st.key;
              const sZu = zu.has(sKey);
              return (
                <div key={sKey} style={{ marginLeft: 12, marginBottom: 8 }}>
                  <GruppenKopf ebene={1} zu={sZu} onClick={() => umschalten(sKey)}
                    titel={st.jahrgang ? t("topics.stufeN", { n: st.jahrgang }) : t("topics.ohneStufe")} anzahl={st.themen.length} t={t} />
                  {!sZu && <div style={{ marginLeft: 12 }}>{st.themen.map((tp) => renderNode(tp, 0))}</div>}
                </div>
              );
            })}
          </div>
        );
      })}

      {popup && <TopicPopup tp={popup} t={t} onSaveTopic={saveTopic} onClose={() => setPopup(null)} />}
      {neu && <ThemaNeu parent={topics.find((x) => x.id === neu.parent_id) || null} t={t}
        onAnlegen={(w) => add(w, neu.parent_id)} onClose={() => setNeu(null)} />}
    </div>
  );
}

// Kopf eines Fach- oder Stufen-Ordners (aufklappbar).
function GruppenKopf({ ebene, zu, onClick, titel, anzahl, t }) {
  return (
    <button onClick={onClick} aria-expanded={!zu} title={zu ? t("topics.expand") : t("topics.collapse")}
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", cursor: "pointer",
        padding: "8px 4px", color: ebene === 0 ? "var(--text)" : "var(--text2)", fontSize: ebene === 0 ? 16 : 14, fontWeight: ebene === 0 ? 700 : 600, textAlign: "left" }}>
      <Icon d={zu ? ICONS.chevronRight : ICONS.chevronDown} size={15} />
      <span>{titel}</span>
      <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text3)" }}>{anzahl}</span>
    </button>
  );
}

// Detail-Popup eines Themas/Unterthemas: Notiz (inline editierbar) und — hinter
// einem Ausklapp-Icon — welche Klassen und welche Modul-Inhalte am Thema hängen.
// Vorschlaege, kein Katalog (siehe Kommentar am Eingabefeld).
const FACH_VORSCHLAEGE = [
  "Mathematik", "Deutsch", "Englisch", "Französisch", "Latein", "Spanisch",
  "Biologie", "Chemie", "Physik", "Informatik", "Technik",
  "Geschichte", "Erdkunde", "Politik", "Religion", "Ethik", "Philosophie",
  "Kunst", "Musik", "Sport", "Wirtschaft", "Sachunterricht", "Lernzeit",
];

function TopicPopup({ tp, t, onSaveTopic, onClose }) {
  const [editNote, setEditNote] = useState(false);
  // Ein Entwurf für Titel, Notiz, Voraussetzung und beide Ziele — nicht fünf
  // Felder mit fünf eigenen Zuständen, die einzeln verloren gehen können.
  const [gespeichert, setGespeichert] = useState({
    name: tp.name, notes: tp.notes || "", zielG: tp.ziel_g || "", zielE: tp.ziel_e || "", voraus: tp.voraussetzungen || "",
    fach: tp.fach || "", jahrgang: tp.jahrgang || "", nummer: tp.nummer || "",
  });
  // Der Entwurf muss sich nach dem Speichern selbst nachziehen (leerer Titel
  // behält den alten). `e` steht in seiner eigenen Rückrufkette noch nicht —
  // deshalb über die Ref.
  const entwurfRef = useRef(null);
  const ent = useEntwurf(gespeichert, async (w) => {
    const name = (w.name || "").trim() || gespeichert.name;
    if (await onSaveTopic(tp, { ...w, name }) === false) return false;
    entwurfRef.current?.setz({ name });
    setGespeichert({ ...w, name });
    setEditNote(false);
  });
  entwurfRef.current = ent;
  const { notes, zielG, zielE, voraus, fach, jahrgang, nummer } = gespeichert;
  const name = gespeichert.name;                  // Anzeige-Titel (nach Umbenennen)
  const [open, setOpen] = useState(false); // Inhalte-Bereich ausgeklappt?
  const [usage, setUsage] = useState(null);
  const [classes, setClasses] = useState({}); // id -> name

  useEffect(() => {
    if (!open || usage) return;
    fetch(`/api/topics/${tp.id}/usage`).then((r) => (r.ok ? r.json() : null)).then(setUsage).catch(() => setUsage(null));
    hol("/api/classes").then((d) => setClasses(Object.fromEntries((Array.isArray(d) ? d : []).map((c) => [c.id, c.name]))));
  }, [open]);

  // Der Dialog ist der zweite Weg hinaus: ohne Nachfrage wäre alles Getippte
  // mit einem Klick auf das Kreuz weg.
  const schliessen = () => {
    if (ent.geaendert && !window.confirm(t("speichern.verlassen"))) return;
    onClose();
  };

  // Klassen, die über Inhalte (Decks/Kalender) an diesem Thema hängen.
  const klassenNamen = usage ? [...new Set([
    ...(usage.karten || []).map((d) => d.class_id),
    ...(usage.kalender || []).map((e) => e.class_id),
    ...(usage.lernpfad || []).map((l) => l.class_id),
  ].filter(Boolean))].map((id) => classes[id]).filter(Boolean) : [];

  const secTitle = { ...sectionLabel, margin: "12px 0 4px" };
  const line = { fontSize: 13, color: "var(--text2)", padding: "4px 0", lineHeight: 1.4 };
  // Dieselben Ziele wie auf der Themenseite (core/themaLinks.js). Ohne Ziel
  // bleibt die Zeile Text — ein Link, der nichts tut, ist schlimmer als keiner.
  const Zeile = ({ to, children }) => (to ? (
    <Link to={to} style={{ ...line, display: "block", color: "var(--text)", textDecoration: "none" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text)")}>
      {children} <Icon d={ICONS.open} size={12} color="var(--accent)" />
    </Link>
  ) : <div style={line}>{children}</div>);

  const titel = [tp.parent_name, nummer ? `${nummer} ${name}` : name].filter(Boolean).join(" / ");
  return (
    <Modal onClose={schliessen} width={520} style={{ maxHeight: "86vh", overflowY: "auto" }} label={titel}>
        <DialogKopf titel={titel} onClose={schliessen}
          schliessenLabel={t("common.close")} style={{ marginBottom: 8 }}>
          {/* Ein Edit-Icon für Titel UND Notiz. */}
          {!editNote && <button onClick={() => setEditNote(true)} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.edit")} aria-label={t("common.edit")}><Icon d={ICONS.edit} size={16} /></button>}
        </DialogKopf>

        {editNote ? (
          <div>
            <ThemaFelder ent={ent} istOberthema={!tp.parent_id} t={t} />
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Speicherleiste entwurf={ent} immer />
              <button onClick={() => { if (!ent.geaendert || window.confirm(t("speichern.verlassen"))) { ent.verwerfen(); setEditNote(false); } }}
                style={btnSecondary}>{t("common.done")}</button>
              <span style={{ marginLeft: "auto", fontSize: 12, color: ent.wert.notes.length >= 500 ? C.danger : "var(--text3)" }}>{ent.wert.notes.length}/500</span>
            </div>
          </div>
        ) : (<>
          {!tp.parent_id && (fach || jahrgang) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
              {fach && <span style={chipStyle}>{fach}</span>}
              {jahrgang && <span style={chipStyle}>{t("topics.stufeN", { n: jahrgang })}</span>}
            </div>
          )}
          <div style={secTitle}>{t("topics.notes")}</div>
          <div style={{ fontSize: 14, color: notes ? "var(--text2)" : "var(--text3)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{notes || t("topics.notesEmpty")}</div>
          {voraus && (
            <div style={{ ...panelStyle, marginTop: 12, padding: "8px 12px" }}>
              <div style={{ ...sectionLabel, marginBottom: 4 }}>{t("topics.voraus")}</div>
              <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{voraus}</div>
            </div>
          )}
          {(zielG || zielE) && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {[[t("topics.zielG"), zielG], [t("topics.zielE"), zielE]].filter(([, v]) => v).map(([label, v]) => (
                <div key={label} style={{ ...panelStyle, flex: "1 1 200px", minWidth: 180, padding: "8px 12px" }}>
                  <div style={{ ...sectionLabel, marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{v}</div>
                </div>
              ))}
            </div>
          )}
        </>)}

        {/* Ausklappbar: Klassen + Inhalte zum Thema. */}
        <button onClick={() => setOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 16, padding: "8px 12px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: CONTROL_R, cursor: "pointer", color: "var(--text)", fontSize: 14, fontWeight: 600, textAlign: "left" }}>
          <span style={{ display: "inline-flex", color: "var(--text3)" }}><Icon d={open ? ICONS.chevronUp : ICONS.chevronDown} size={15} /></span>
          {t("topics.detailsToggle")}
        </button>
        {open && (
          <div style={{ padding: "4px 2px 0" }}>
            {!usage ? <p style={line}>…</p> : (
              <>
                <div style={secTitle}>{t("nav.classes")}</div>
                {klassenNamen.length ? <div style={line}>{klassenNamen.join(", ")}</div> : <div style={{ ...line, color: "var(--text3)" }}>{t("topics.noClasses")}</div>}

                {(usage.cardvote?.length > 0) && (<><div style={secTitle}>CardVote</div>{usage.cardvote.map((q) => <Zeile key={q.id} to={themaZiel.cardvote(q)}>{q.text || `#${q.id}`}<span style={{ fontSize: 12, color: q.set_id ? "var(--text3)" : C.warning }}> · {q.set_id ? q.set_name : t("thema.noSet")}</span></Zeile>)}</>)}
                {(usage.karten?.length > 0) && (<><div style={secTitle}>{t("nav.cards2")}</div>{usage.karten.map((d) => <Zeile key={d.id} to={themaZiel.karten(d)}>{d.name}{classes[d.class_id] ? ` · ${classes[d.class_id]}` : ""}{d.released ? "" : ` · ${t("topics.draft")}`}</Zeile>)}</>)}
                {(usage.lernpfad?.length > 0) && (<><div style={secTitle}>Lernpfad</div>{usage.lernpfad.map((l) => <Zeile key={l.id} to={themaZiel.lernpfad(l)}>{l.path || "—"}{classes[l.class_id] ? ` · ${classes[l.class_id]}` : ""}</Zeile>)}</>)}
                {(usage.kalender?.length > 0) && (<><div style={secTitle}>Kalender</div>{usage.kalender.map((e) => <Zeile key={e.id} to={themaZiel.kalender(e)}>{e.date ? `${new Date(e.date).toLocaleDateString()} · ` : ""}{e.title || "—"}{classes[e.class_id] ? ` · ${classes[e.class_id]}` : ""}</Zeile>)}</>)}
                {(usage.codedetektiv?.length > 0) && (<><div style={secTitle}>Code-Detektiv</div>{usage.codedetektiv.map((p) => <Zeile key={p.id} to={themaZiel.codedetektiv(p)}>{p.title || p.client_id}</Zeile>)}</>)}

                {!(usage.cardvote?.length || usage.karten?.length || usage.lernpfad?.length || usage.kalender?.length || usage.codedetektiv?.length) && (
                  <div style={{ ...line, color: "var(--text3)" }}>{t("topics.noContent")}</div>
                )}
              </>
            )}
          </div>
        )}
    </Modal>
  );
}

// Die Felder eines Themas — EINMAL, für Anlegen und Bearbeiten. Zwei Fassungen
// liefen beim ersten neuen Feld auseinander.
function ThemaFelder({ ent, istOberthema, t, autoFocus = true }) {
  const secTitle = { ...sectionLabel, margin: "12px 0 4px" };
  return (<>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <div style={{ flex: "0 1 96px", minWidth: 0 }}>
        <div style={secTitle}>{t("topics.nummer")}</div>
        <input value={ent.wert.nummer} onChange={(ev) => ent.setz({ nummer: ev.target.value })} maxLength={20}
          placeholder={t("topics.nummerPlaceholder")} style={{ ...inputStyle, width: "100%" }} />
      </div>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={secTitle}>{t("topics.name")}</div>
        <input value={ent.wert.name} onChange={(ev) => ent.setz({ name: ev.target.value })} autoFocus={autoFocus} maxLength={120}
          placeholder={istOberthema ? t("topics.newPlaceholder") : t("topics.subPlaceholder")}
          style={{ ...inputStyle, width: "100%", fontWeight: 600 }} />
      </div>
    </div>
    {/* Fach und Stufe stehen am OBERTHEMA — Unterthemen erben sie (der
        Server pflegt die Regel, siehe _erbt in topics.py). Ein zweites Feld
        am Unterthema hiesse: dasselbe Fach an fuenfzig Stellen. Die Stufe war
        einmal entfernt (08.09.2026) und ist zurück: nach Fach, Stufe und
        Nummer wird die Liste geordnet, und die Auswahl zeigt sie an. */}
    {istOberthema && (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: "2 1 180px", minWidth: 0 }}>
          <div style={secTitle}>{t("topics.fach")}</div>
          <input list="nuvora-faecher" value={ent.wert.fach} maxLength={60}
            onChange={(ev) => ent.setz({ fach: ev.target.value })}
            placeholder={t("topics.fachPlaceholder")} style={{ ...inputStyle, width: "100%" }} />
          {/* Vorschlagsliste statt Katalog: Schulformen und Bundeslaender
              nennen Faecher verschieden, eine feste Liste waere nach einem
              Jahr falsch. Eigenes bleibt trotzdem moeglich. */}
          <datalist id="nuvora-faecher">
            {FACH_VORSCHLAEGE.map((f) => <option key={f} value={f} />)}
          </datalist>
        </div>
        <div style={{ flex: "1 1 96px", minWidth: 0 }}>
          <div style={secTitle}>{t("topics.stufe")}</div>
          <input value={ent.wert.jahrgang} maxLength={20} onChange={(ev) => ent.setz({ jahrgang: ev.target.value })}
            placeholder={t("topics.stufePlaceholder")} style={{ ...inputStyle, width: "100%" }} />
        </div>
      </div>
    )}
    <div style={secTitle}>{t("topics.notes")}</div>
    <AutoTextarea value={ent.wert.notes} onChange={(ev) => ent.setz({ notes: ev.target.value.slice(0, 500) })} rows={2} maxLength={500}
      placeholder={t("topics.notesPlaceholder")}
      style={{ ...inputStyle, width: "100%", lineHeight: 1.5, resize: "vertical" }} />
    {[["v", t("topics.voraus"), t("topics.vorausPlaceholder"), "voraus"],
      ["g", t("topics.zielG"), t("topics.zielGPlaceholder"), "zielG"],
      ["e", t("topics.zielE"), t("topics.zielEPlaceholder"), "zielE"]].map(([k, label, ph, feld]) => (
      <div key={k}>
        <div style={secTitle}>{label}</div>
        <AutoTextarea value={ent.wert[feld]} onChange={(ev) => ent.setz({ [feld]: ev.target.value.slice(0, 500) })} rows={2} maxLength={500} placeholder={ph}
          style={{ ...inputStyle, width: "100%", lineHeight: 1.5, resize: "vertical" }} />
      </div>
    ))}
  </>);
}

const LEER = { name: "", notes: "", zielG: "", zielE: "", voraus: "", fach: "", jahrgang: "", nummer: "" };

// Neues Thema/Unterthema: derselbe Dialog wie das Bearbeiten, gleich mit allen
// Feldern. Ein Unterthema bekommt als Nummer die nächste freie vorgeschlagen.
function ThemaNeu({ parent, t, onAnlegen, onClose }) {
  const basis = useMemo(() => LEER, []);
  const ent = useEntwurf(basis, async (w) => {
    if (await onAnlegen(w) === false) return false;
    onClose();
  });
  const schliessen = () => {
    if (ent.geaendert && !window.confirm(t("speichern.verlassen"))) return;
    onClose();
  };
  const titel = parent ? `${mitNummer(parent)} / ${t("topics.neuSub")}` : t("topics.addTopic");
  return (
    <Modal onClose={schliessen} width={520} style={{ maxHeight: "86vh", overflowY: "auto" }} label={titel}>
      <DialogKopf titel={titel} onClose={schliessen} schliessenLabel={t("common.close")} style={{ marginBottom: 8 }} />
      <ThemaFelder ent={ent} istOberthema={!parent} t={t} />
      <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
        <Speicherleiste entwurf={ent} immer />
      </div>
    </Modal>
  );
}
