// Themen sind Nuvora-Kerndaten: der gemeinsame Wortschatz beider Module.
// CardVote-Fragen und (spaeter) Lernpfad-Aufgaben zeigen auf dieselben Themen —
// erst dadurch laesst sich ein schwach ausgefallenes Thema auf passende
// Aufgaben abbilden.
import { useState, useEffect } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { Link } from "react-router-dom";
import { AddButton, Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary, pageTitle, Empty, Skeleton, overlayGuard, modalOverlay, modalPanel, inputStyle, pageApp} from "../components/Icons.jsx";
import { peek, put } from "../core/cache.js";

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
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
  const [popup, setPopup] = useState(null); // Thema/Unterthema im Detail-Popup
  const [expanded, setExpanded] = useState(() => new Set());
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null); // { id, side: "above"|"below" }

  const toggleExpand = (id) => setExpanded((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const dragOverRoot = (e, id) => {
    e.preventDefault();
    if (!dragId || id === dragId) { setDragOver(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const side = e.clientY < r.top + r.height / 2 ? "above" : "below";
    setDragOver((p) => (p && p.id === id && p.side === side ? p : { id, side }));
  };

  const dropRoot = async (targetId) => {
    const von = dragId, ov = dragOver;
    setDragId(null); setDragOver(null);
    if (!von || von === targetId) return;
    const ids = topics.filter((x) => x.parent_id === null).map((x) => x.id);
    const from = ids.indexOf(von); let to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    if (ov && ov.id === targetId && ov.side === "below") to += 1;
    if (from < to) to -= 1;
    const neu = [...ids]; neu.splice(to, 0, neu.splice(from, 1)[0]);
    await call(() => fetch(`${API}/topics/reorder`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: neu }) }));
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

  const add = (name, parent_id) =>
    call(() => fetch(`${API}/topics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parent_id }),
    }));

  const rename = (t, name) =>
    call(() => fetch(`${API}/topics/${t.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parent_id: t.parent_id, notes: t.notes || "", ziel_g: t.ziel_g || "", ziel_e: t.ziel_e || "" }),
    }));

  // Titel + Notiz speichern (aus dem Detail-Popup). Leerer Titel behält den alten.
  const saveTopic = (tp, name, notes, zielG, zielE) =>
    call(() => fetch(`${API}/topics/${tp.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: (name || "").trim() || tp.name, parent_id: tp.parent_id, notes, ziel_g: zielG || "", ziel_e: zielE || "" }),
    }));

  const remove = async (tp) => {
    const kids = topics.filter((x) => x.parent_id === tp.id);
    const parts = [t("topics.delConfirm", { name: tp.name })];
    if (kids.length) parts.push(t("topics.delSubs", { n: kids.length }));
    const affected = tp.question_count + kids.reduce((n, k) => n + k.question_count, 0);
    if (affected) parts.push(t("topics.delQuestions", { n: affected }));
    if (!await askConfirm(parts.join("\n"))) return;
    await call(() => fetch(`${API}/topics/${tp.id}`, { method: "DELETE" }));
  };

  const roots = topics.filter((t) => t.parent_id === null);
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
    const over = isRoot && dragId && dragOver && dragOver.id === tp.id;
    return (
    <div
      key={tp.id}
      draggable={isRoot && editing !== tp.id}
      onDragStart={isRoot ? () => setDragId(tp.id) : undefined}
      onDragOver={isRoot ? (e) => dragOverRoot(e, tp.id) : undefined}
      onDragEnd={isRoot ? () => { setDragId(null); setDragOver(null); } : undefined}
      onDrop={isRoot ? () => dropRoot(tp.id) : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        padding: isChild ? "8px 12px" : "12px 14px",
        marginLeft: depth * 28, marginBottom: 6,
        border: "1px solid var(--border)", borderRadius: isChild ? 10 : 14,
        background: isChild ? "var(--bg)" : "var(--card)",
        cursor: isRoot ? "grab" : "default",
        opacity: dragId === tp.id ? 0.4 : 1,
        borderTop: over && dragOver.side === "above" ? "3px solid var(--accent)" : undefined,
        borderBottom: over && dragOver.side === "below" ? "3px solid var(--accent)" : undefined,
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
      {editing === tp.id ? (
        <form
          onSubmit={async (e) => { e.preventDefault(); if (await rename(tp, editName.trim())) setEditing(null); }}
          style={{ display: "flex", gap: 8, flex: 1 }}
        >
          <input
            value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
            style={{ flex: 1, padding: 7, border: "1px solid var(--border2)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }}
          />
          <button type="submit" style={btnPrimary}>{t("common.save")}</button>
          <button type="button" onClick={() => setEditing(null)} style={btnSecondary}>{t("common.abort")}</button>
        </form>
      ) : (
        <>
          {/* Klick auf den Namen öffnet das Detail-Popup (Notiz + Inhalte). Das
              Auf-/Zuklappen der Unterthemen bleibt am Pfeil-Button links. */}
          <span onClick={() => openPopup(tp)} title={t("topics.openDetails")}
            style={{ flex: 1, fontWeight: isChild ? 400 : 600, fontSize: isChild ? 14 : 15.5, color: "var(--text)", cursor: "pointer" }}>
            {tp.name}
            {subCount > 0 && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text3)", marginLeft: 8 }}>{t("topics.subCount", { n: subCount })}</span>}
          </span>
          {tp.question_count > 0 && (
            <span style={{ fontSize: 12, color: "var(--text3)" }}>
              {t("topics.questionCount", { n: tp.question_count })}
            </span>
          )}
          {canHaveKids && (
            <button onClick={() => { setAddingUnder(tp.id); setChildName(""); setExpanded((p) => new Set(p).add(tp.id)); }} className="icon-btn" style={iconBtn} title={t("topics.addSub")}>
              <Icon d={ICONS.plus} size={16} color="var(--accent)" />
            </button>
          )}
          {/* Unterthemen: kein Umbenennen-Icon in der Zeile — läuft übers Detail-Popup. */}
          {isRoot && (
            <button onClick={() => { setEditing(tp.id); setEditName(tp.name); }} className="icon-btn" style={iconBtn} title={t("common.rename")}>
              <Icon d={ICONS.edit} />
            </button>
          )}
          <button onClick={() => remove(tp)} className="icon-btn" style={iconBtn} title={t("common.delete")}>
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
    <div key={tp.id} style={depth === 0 ? { marginBottom: 10 } : undefined}>
      {row(tp, depth)}
      {expanded.has(tp.id) && depth < MAX_DEPTH && childrenOf(tp.id).map((c) => renderNode(c, depth + 1))}
      {addingUnder === tp.id && depth < MAX_DEPTH && (
        <form onSubmit={(e) => submitChild(e, tp.id)} style={{ display: "flex", gap: 8, marginLeft: (depth + 1) * 28, marginBottom: 6 }}>
          <input
            value={childName} onChange={(e) => setChildName(e.target.value)} autoFocus
            placeholder={t("topics.subPlaceholder")}
            style={{ flex: 1, padding: 7, border: "1px solid var(--border2)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }}
          />
          <button type="submit" style={btnPrimary}>{t("common.add")}</button>
          <button type="button" onClick={() => setAddingUnder(null)} style={btnSecondary}>{t("common.abort")}</button>
        </form>
      )}
    </div>
  );

  return (
    <div style={{ ...pageApp }}>
      <h1 style={pageTitle}>{t("topics.title")}</h1>
      <p style={{ color: "var(--text2)", marginBottom: 22, fontSize: 14 }}>
        {t("topics.intro")}
      </p>

      {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {!showRootForm ? (
        <AddButton onClick={() => setShowRootForm(true)} title={t("topics.addTopic")} style={{ marginBottom: 22 }} />
      ) : (
        <form onSubmit={submitRoot} style={{ display: "flex", gap: 8, marginBottom: 22 }}>
          <input
            value={newRoot} onChange={(e) => setNewRoot(e.target.value)} placeholder={t("topics.newPlaceholder")} autoFocus
            onKeyDown={(e) => { if (e.key === "Escape") { setShowRootForm(false); setNewRoot(""); } }}
            style={{ flex: 1, maxWidth: 340, padding: "9px 12px", border: "1px solid var(--border2)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }}
          />
          <button type="submit" disabled={!newRoot.trim()} style={{ ...btnPrimary, opacity: newRoot.trim() ? 1 : 0.4 }}>
            {t("common.add")}
          </button>
          <button type="button" onClick={() => { setShowRootForm(false); setNewRoot(""); }} style={btnSecondary}>
            {t("common.abort")}
          </button>
        </form>
      )}

      {!loaded && <Skeleton rows={5} />}
      {loaded && roots.length === 0 && <Empty title={t("topics.empty")} hint={t("topics.emptyHint")} />}

      {roots.map((tp) => renderNode(tp, 0))}

      {popup && <TopicPopup tp={popup} t={t} onSaveTopic={saveTopic} onClose={() => setPopup(null)} />}
    </div>
  );
}

// Detail-Popup eines Themas/Unterthemas: Notiz (inline editierbar) und — hinter
// einem Ausklapp-Icon — welche Klassen und welche Modul-Inhalte am Thema hängen.
function TopicPopup({ tp, t, onSaveTopic, onClose }) {
  const [editNote, setEditNote] = useState(false);
  const [noteVal, setNoteVal] = useState(tp.notes || "");
  const [notes, setNotes] = useState(tp.notes || "");
  // Anforderungen je Niveau — am Thema, weil der Inhalt zum Thema gehört.
  const [zielG, setZielG] = useState(tp.ziel_g || "");
  const [zielE, setZielE] = useState(tp.ziel_e || "");
  const [zielGVal, setZielGVal] = useState(tp.ziel_g || "");
  const [zielEVal, setZielEVal] = useState(tp.ziel_e || "");
  const [name, setName] = useState(tp.name);      // Anzeige-Titel (nach Umbenennen)
  const [titleVal, setTitleVal] = useState(tp.name); // Titel im Edit
  const [open, setOpen] = useState(false); // Inhalte-Bereich ausgeklappt?
  const [usage, setUsage] = useState(null);
  const [classes, setClasses] = useState({}); // id -> name

  useEffect(() => {
    if (!open || usage) return;
    fetch(`/api/topics/${tp.id}/usage`).then((r) => (r.ok ? r.json() : null)).then(setUsage).catch(() => setUsage(null));
    fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).then((d) => setClasses(Object.fromEntries((Array.isArray(d) ? d : []).map((c) => [c.id, c.name])))).catch(() => {});
  }, [open]);

  const saveEdit = async () => {
    await onSaveTopic(tp, titleVal, noteVal, zielGVal, zielEVal);
    setNotes(noteVal); setZielG(zielGVal); setZielE(zielEVal);
    setName(titleVal.trim() || name); setEditNote(false);
  };

  // Klassen, die über Inhalte (Decks/Kalender) an diesem Thema hängen.
  const klassenNamen = usage ? [...new Set([
    ...(usage.karten || []).map((d) => d.class_id),
    ...(usage.kalender || []).map((e) => e.class_id),
    ...(usage.lernpfad || []).map((l) => l.class_id),
  ].filter(Boolean))].map((id) => classes[id]).filter(Boolean) : [];

  const secTitle = { fontSize: 11.5, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.5px", margin: "12px 0 4px" };
  const line = { fontSize: 13.5, color: "var(--text2)", padding: "3px 0", lineHeight: 1.4 };

  return (
    <div {...overlayGuard(onClose)} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 520, maxHeight: "86vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1 }}>{tp.parent_name ? `${tp.parent_name} / ${name}` : name}</h3>
          {/* Ein Edit-Icon für Titel UND Notiz. */}
          {!editNote && <button onClick={() => { setTitleVal(name); setNoteVal(notes); setZielGVal(zielG); setZielEVal(zielE); setEditNote(true); }} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.edit")}><Icon d={ICONS.edit} size={16} /></button>}
          <button onClick={onClose} className="icon-btn" style={{ ...iconBtn, padding: 6 }} title={t("common.close")}><Icon d={ICONS.close} size={18} /></button>
        </div>

        {editNote ? (
          <div>
            <div style={secTitle}>{t("common.rename")}</div>
            <input value={titleVal} onChange={(e) => setTitleVal(e.target.value)} autoFocus maxLength={120}
              style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid var(--border2)", borderRadius: 10, background: "var(--bg)", color: "var(--text)", fontSize: 15, fontWeight: 600 }} />
            <div style={secTitle}>{t("topics.notes")}</div>
            <textarea value={noteVal} onChange={(e) => setNoteVal(e.target.value.slice(0, 500))} rows={4} maxLength={500}
              placeholder={t("topics.notesPlaceholder")}
              style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid var(--border2)", borderRadius: 10, background: "var(--bg)", color: "var(--text)", fontSize: 14, lineHeight: 1.5, resize: "vertical" }} />
            {[["g", t("topics.zielG"), t("topics.zielGPlaceholder"), zielGVal, setZielGVal],
              ["e", t("topics.zielE"), t("topics.zielEPlaceholder"), zielEVal, setZielEVal]].map(([k, label, ph, wert, setzen]) => (
              <div key={k}>
                <div style={secTitle}>{label}</div>
                <textarea value={wert} onChange={(e) => setzen(e.target.value.slice(0, 500))} rows={2} maxLength={500} placeholder={ph}
                  style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid var(--border2)", borderRadius: 10, background: "var(--bg)", color: "var(--text)", fontSize: 14, lineHeight: 1.5, resize: "vertical" }} />
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
              <button onClick={saveEdit} style={btnPrimary}>{t("common.save")}</button>
              <button onClick={() => setEditNote(false)} style={btnSecondary}>{t("common.abort")}</button>
              <span style={{ marginLeft: "auto", fontSize: 12, color: noteVal.length >= 500 ? C.danger : "var(--text3)" }}>{noteVal.length}/500</span>
            </div>
          </div>
        ) : (<>
          <div style={secTitle}>{t("topics.notes")}</div>
          <div style={{ fontSize: 14, color: notes ? "var(--text2)" : "var(--text3)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{notes || t("topics.notesEmpty")}</div>
          {(zielG || zielE) && (
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              {[[t("topics.zielG"), zielG], [t("topics.zielE"), zielE]].filter(([, v]) => v).map(([label, v]) => (
                <div key={label} style={{ flex: "1 1 200px", minWidth: 180, padding: "8px 10px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>{label}</div>
                  <div style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{v}</div>
                </div>
              ))}
            </div>
          )}
        </>)}

        {/* Ausklappbar: Klassen + Inhalte zum Thema. */}
        <button onClick={() => setOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 16, padding: "10px 12px", background: "var(--bg3, var(--bg))", border: "1px solid var(--border)", borderRadius: 10, cursor: "pointer", color: "var(--text)", fontSize: 14, fontWeight: 600, textAlign: "left" }}>
          <span style={{ display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--text3)" }}><Icon d={ICONS.open} size={15} /></span>
          {t("topics.detailsToggle")}
        </button>
        {open && (
          <div style={{ padding: "4px 2px 0" }}>
            {!usage ? <p style={line}>…</p> : (
              <>
                <div style={secTitle}>{t("nav.classes")}</div>
                {klassenNamen.length ? <div style={line}>{klassenNamen.join(", ")}</div> : <div style={{ ...line, color: "var(--text3)" }}>{t("topics.noClasses")}</div>}

                {(usage.cardvote?.length > 0) && (<><div style={secTitle}>CardVote</div>{usage.cardvote.map((q) => <div key={q.id} style={line}>{q.text || `#${q.id}`}</div>)}</>)}
                {(usage.karten?.length > 0) && (<><div style={secTitle}>{t("nav.cards2")}</div>{usage.karten.map((d) => <div key={d.id} style={line}>{d.name}{classes[d.class_id] ? ` · ${classes[d.class_id]}` : ""}{d.released ? "" : ` · ${t("topics.draft")}`}</div>)}</>)}
                {(usage.lernpfad?.length > 0) && (<><div style={secTitle}>Lernpfad</div>{usage.lernpfad.map((l) => <div key={l.id} style={line}>{l.path || "—"}{classes[l.class_id] ? ` · ${classes[l.class_id]}` : ""}</div>)}</>)}
                {(usage.kalender?.length > 0) && (<><div style={secTitle}>Kalender</div>{usage.kalender.map((e) => <div key={e.id} style={line}>{e.date ? `${new Date(e.date).toLocaleDateString()} · ` : ""}{e.title || "—"}{classes[e.class_id] ? ` · ${classes[e.class_id]}` : ""}</div>)}</>)}
                {(usage.codedetektiv?.length > 0) && (<><div style={secTitle}>Code-Detektiv</div>{usage.codedetektiv.map((p) => <div key={p.id} style={line}>{p.title || p.client_id}</div>)}</>)}

                {!(usage.cardvote?.length || usage.karten?.length || usage.lernpfad?.length || usage.kalender?.length || usage.codedetektiv?.length) && (
                  <div style={{ ...line, color: "var(--text3)" }}>{t("topics.noContent")}</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

