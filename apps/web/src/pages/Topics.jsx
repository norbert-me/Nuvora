// Themen sind Nuvora-Kerndaten: der gemeinsame Wortschatz beider Module.
// CardVote-Fragen und (spaeter) Lernpfad-Aufgaben zeigen auf dieselben Themen —
// erst dadurch laesst sich ein schwach ausgefallenes Thema auf passende
// Aufgaben abbilden.
import { useState, useEffect, useMemo, useRef } from "react";
import { askConfirm } from "../core/dialog.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { AddButton, Icon, ICONS, iconBtn, COLORS as C, btnSecondary, pageTitle, pageIntro,
  Empty, Skeleton, Modal, pageApp, cardStyle, panelStyle, inputStyle, sectionLabel,
  toolbarBtn, toolbarBtnPrimary, toolbarInput, CONTROL_R } from "../components/Icons.jsx";
import Speicherleiste, { useEntwurf } from "../components/Speichern.jsx";
import { peek, put } from "../core/cache.js";
import AutoTextarea from "../components/AutoTextarea.jsx";
import { Link } from "react-router-dom";
import { themaZiel } from "../core/themaLinks.js";
import { useEinfuegen } from "../core/ziehsortieren.js";
import { alsJson, hol } from "../core/melden.js";

const API = "/api";

export default function Topics() {
  const { t } = useLanguage();
  const [topics, setTopics] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [newRoot, setNewRoot] = useState("");
  const [showRootForm, setShowRootForm] = useState(false);
  const [addingUnder, setAddingUnder] = useState(null);
  const [childName, setChildName] = useState("");
  const [popup, setPopup] = useState(null); // Thema/Unterthema im Detail-Popup
  const [expanded, setExpanded] = useState(() => new Set());
  // Ziehen zum Umsortieren kommt aus core/ziehsortieren.js — dieselbe Marke
  // („vor"/„nach") wie bei Kartenstapeln, Karten und Notenbuch-Spalten.
  const zieh = useEinfuegen();

  const toggleExpand = (id) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Umsortieren ist eine Änderung wie jede andere: sie sammelt sich im Entwurf
  // und geht erst mit „Speichern" zum Server. Vorher lag jede losgelassene
  // Karte sofort in der Datenbank — ein Verrutschen war nicht zurückzunehmen.
  const dropRoot = (targetId) => {
    const ids = zieh.ablegen(targetId, ordnung.wert.ids);
    if (ids) ordnung.setz({ ids });
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
  const idSchluessel = wurzelIds.join(",");
  const basisOrdnung = useMemo(() => ({ ids: idSchluessel ? idSchluessel.split(",").map(Number) : [] }), [idSchluessel]);
  const ordnung = useEntwurf(basisOrdnung, (w) =>
    call(() => fetch(`${API}/topics/reorder`, alsJson("PUT", { ids: w.ids }))));

  const add = (name, parent_id) =>
    call(() => fetch(`${API}/topics`, alsJson("POST", { name, parent_id })));

  // Umbenennen laeuft ueber saveTopic (Detail-Popup) — eine Funktion, ein Weg.
  // Wichtig dabei: alle Felder mitschicken, PUT setzt fehlende auf leer. Genau
  // daran ist die frueher getrennte rename()-Fassung fast gescheitert (Notiz,
  // Ziele und Voraussetzungen weg nach einem Umbenennen).
  // Titel + Notiz speichern (aus dem Detail-Popup). Leerer Titel behält den alten.
  const saveTopic = (tp, name, notes, zielG, zielE, voraussetzungen) =>
    call(() => fetch(`${API}/topics/${tp.id}`, alsJson("PUT", { name: (name || "").trim() || tp.name, parent_id: tp.parent_id, notes, ziel_g: zielG || "", ziel_e: zielE || "", voraussetzungen: voraussetzungen || "" })));

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
  const roots = (() => {
    const wurzeln = topics.filter((x) => x.parent_id === null);
    const nach = new Map(wurzeln.map((x) => [x.id, x]));
    const sortiert = ordnung.wert.ids.map((id) => nach.get(id)).filter(Boolean);
    const bekannt = new Set(sortiert.map((x) => x.id));
    return [...sortiert, ...wurzeln.filter((x) => !bekannt.has(x.id))];
  })();
  const childrenOf = (id) => topics.filter((t) => t.parent_id === id);
  const openPopup = (tp) => setPopup({ ...tp, parent_name: tp.parent_id ? (topics.find((x) => x.id === tp.parent_id)?.name || "") : "" });

  const submitRoot = async (e) => {
    e.preventDefault();
    if (!newRoot.trim()) return;
    if (await add(newRoot.trim(), null)) { setNewRoot(""); setShowRootForm(false); }
  };

  const submitChild = async (e, parentId) => {
    e.preventDefault();
    if (!childName.trim()) return;
    if (await add(childName.trim(), parentId)) { setChildName(""); setAddingUnder(null); }
  };

  // Zwei Ebenen: Thema (0) > Unterthema (1). Neue Unterpunkte nur unter Themen
  // (Ebene 0). Bestehende tiefere Einträge werden weiter angezeigt, nur nicht mehr
  // erweitert. Drag (Reihenfolge) nur auf der obersten Ebene.
  const MAX_DEPTH = 1;
  const row = (tp, depth) => {
    const isChild = depth > 0;
    const isRoot = depth === 0;
    const canHaveKids = depth < MAX_DEPTH;                 // neues Unterthema erlauben?
    const subCount = childrenOf(tp.id).length;             // vorhandene Kinder immer zeigen
    const seite = isRoot ? zieh.seite(tp.id) : null;
    return (
    <div
      key={tp.id}
      draggable={isRoot}
      onDragStart={isRoot ? () => zieh.start(tp.id) : undefined}
      onDragOver={isRoot ? (e) => zieh.ueber(e, tp.id) : undefined}
      onDragEnd={isRoot ? zieh.beenden : undefined}
      onDrop={isRoot ? () => dropRoot(tp.id) : undefined}
      style={{
        // Thema = Karte (cardStyle), Unterthema = flachere Zeile mit
        // Bedien-Radius — der Unterschied traegt die Schachtelung.
        ...cardStyle,
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: isChild ? "8px 12px" : 12,
        marginLeft: depth * 28, marginBottom: 4,
        borderRadius: isChild ? CONTROL_R : cardStyle.borderRadius,
        background: isChild ? "var(--bg)" : "var(--card)",
        cursor: isRoot ? "grab" : "default",
        opacity: zieh.zieht === tp.id ? 0.4 : 1,
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
            {tp.name}
            {subCount > 0 && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text3)", marginLeft: 8 }}>{t("topics.subCount", { n: subCount })}</span>}
          </span>
          {tp.question_count > 0 && (
            <span style={{ fontSize: 12, color: "var(--text3)" }}>
              {t("topics.questionCount", { n: tp.question_count })}
            </span>
          )}
          {canHaveKids && (
            <button onClick={() => { setAddingUnder(tp.id); setChildName(""); setExpanded((p) => new Set(p).add(tp.id)); }} className="icon-btn" style={iconBtn} title={t("topics.addSub")} aria-label={t("topics.addSub")}>
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
  const renderNode = (tp, depth) => (
    <div key={tp.id} style={depth === 0 ? { marginBottom: 12 } : undefined}>
      {row(tp, depth)}
      {expanded.has(tp.id) && depth < MAX_DEPTH && childrenOf(tp.id).map((c) => renderNode(c, depth + 1))}
      {addingUnder === tp.id && depth < MAX_DEPTH && (
        <form onSubmit={(e) => submitChild(e, tp.id)} style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: (depth + 1) * 28, marginBottom: 4 }}>
          <input
            value={childName} onChange={(e) => setChildName(e.target.value)} autoFocus
            placeholder={t("topics.subPlaceholder")}
            style={{ ...toolbarInput, flex: 1 }}
          />
          <button type="submit" style={toolbarBtnPrimary}>{t("common.add")}</button>
          <button type="button" onClick={() => setAddingUnder(null)} style={toolbarBtn}>{t("common.abort")}</button>
        </form>
      )}
    </div>
  );

  return (
    <div style={{ ...pageApp }}>
      <h1 style={pageTitle}>{t("topics.title")}</h1>
      <p style={pageIntro}>{t("topics.intro")}</p>

      {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {!showRootForm ? (
        <AddButton onClick={() => setShowRootForm(true)} title={t("topics.addTopic")} style={{ marginBottom: 24 }} />
      ) : (
        // Leisten-Masse (CONTROL_H), damit die Zeile beim Umschalten vom
        // AddButton aufs Formular nicht in der Hoehe springt.
        <form onSubmit={submitRoot} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
          <input
            value={newRoot} onChange={(e) => setNewRoot(e.target.value)} placeholder={t("topics.newPlaceholder")} autoFocus
            onKeyDown={(e) => { if (e.key === "Escape") { setShowRootForm(false); setNewRoot(""); } }}
            style={{ ...toolbarInput, flex: 1, maxWidth: 340 }}
          />
          <button type="submit" disabled={!newRoot.trim()} style={{ ...toolbarBtnPrimary, opacity: newRoot.trim() ? 1 : 0.4 }}>
            {t("common.add")}
          </button>
          <button type="button" onClick={() => { setShowRootForm(false); setNewRoot(""); }} style={toolbarBtn}>
            {t("common.abort")}
          </button>
        </form>
      )}

      {!loaded && <Skeleton rows={5} />}
      {loaded && roots.length === 0 && <Empty title={t("topics.empty")} hint={t("topics.emptyHint")} />}

      {/* Erscheint erst, wenn wirklich etwas umsortiert wurde. */}
      <Speicherleiste entwurf={ordnung} style={{ marginBottom: 12 }} />

      {roots.map((tp) => renderNode(tp, 0))}

      {popup && <TopicPopup tp={popup} t={t} onSaveTopic={saveTopic} onClose={() => setPopup(null)} />}
    </div>
  );
}

// Detail-Popup eines Themas/Unterthemas: Notiz (inline editierbar) und — hinter
// einem Ausklapp-Icon — welche Klassen und welche Modul-Inhalte am Thema hängen.
function TopicPopup({ tp, t, onSaveTopic, onClose }) {
  const [editNote, setEditNote] = useState(false);
  // Ein Entwurf für Titel, Notiz, Voraussetzung und beide Ziele — nicht fünf
  // Felder mit fünf eigenen Zuständen, die einzeln verloren gehen können.
  const [gespeichert, setGespeichert] = useState({
    name: tp.name, notes: tp.notes || "", zielG: tp.ziel_g || "", zielE: tp.ziel_e || "", voraus: tp.voraussetzungen || "",
  });
  // Der Entwurf muss sich nach dem Speichern selbst nachziehen (leerer Titel
  // behält den alten). `e` steht in seiner eigenen Rückrufkette noch nicht —
  // deshalb über die Ref.
  const entwurfRef = useRef(null);
  const ent = useEntwurf(gespeichert, async (w) => {
    const name = (w.name || "").trim() || gespeichert.name;
    if (await onSaveTopic(tp, name, w.notes, w.zielG, w.zielE, w.voraus) === false) return false;
    entwurfRef.current?.setz({ name });
    setGespeichert({ ...w, name });
    setEditNote(false);
  });
  entwurfRef.current = ent;
  const { notes, zielG, zielE, voraus } = gespeichert;
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

  return (
    <Modal onClose={schliessen} width={520} style={{ maxHeight: "86vh", overflowY: "auto" }} label={tp.parent_name ? `${tp.parent_name} / ${name}` : name}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, flex: 1 }}>{tp.parent_name ? `${tp.parent_name} / ${name}` : name}</h3>
          {/* Ein Edit-Icon für Titel UND Notiz. */}
          {!editNote && <button onClick={() => setEditNote(true)} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.edit")} aria-label={t("common.edit")}><Icon d={ICONS.edit} size={16} /></button>}
          <button onClick={schliessen} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.close")} aria-label={t("common.close")}><Icon d={ICONS.close} size={18} /></button>
        </div>

        {editNote ? (
          <div>
            <div style={secTitle}>{t("common.rename")}</div>
            <input value={ent.wert.name} onChange={(ev) => ent.setz({ name: ev.target.value })} autoFocus maxLength={120}
              style={{ ...inputStyle, width: "100%", fontSize: 16, fontWeight: 600 }} />
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
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Speicherleiste entwurf={ent} immer />
              <button onClick={() => { if (!ent.geaendert || window.confirm(t("speichern.verlassen"))) { ent.verwerfen(); setEditNote(false); } }}
                style={btnSecondary}>{t("common.done")}</button>
              <span style={{ marginLeft: "auto", fontSize: 12, color: ent.wert.notes.length >= 500 ? C.danger : "var(--text3)" }}>{ent.wert.notes.length}/500</span>
            </div>
          </div>
        ) : (<>
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

