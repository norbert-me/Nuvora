// Themen sind Nuvora-Kerndaten: der gemeinsame Wortschatz beider Module.
// CardVote-Fragen und (spaeter) Lernpfad-Aufgaben zeigen auf dieselben Themen —
// erst dadurch laesst sich ein schwach ausgefallenes Thema auf passende
// Aufgaben abbilden.
import { useState, useEffect } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { Link } from "react-router-dom";
import { Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary, pageTitle, Empty, Skeleton } from "../components/Icons.jsx";
import { peek, put } from "../core/cache.js";

const API = "/api";

export default function Topics() {
  const { t } = useLanguage();
  const [topics, setTopics] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [newRoot, setNewRoot] = useState("");
  const [addingUnder, setAddingUnder] = useState(null);
  const [childName, setChildName] = useState("");
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");
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
      body: JSON.stringify({ name, parent_id: t.parent_id }),
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

  const submitRoot = async (e) => {
    e.preventDefault();
    if (!newRoot.trim()) return;
    if (await add(newRoot.trim(), null)) setNewRoot("");
  };

  const submitChild = async (e, parentId) => {
    e.preventDefault();
    if (!childName.trim()) return;
    if (await add(childName.trim(), parentId)) { setChildName(""); setAddingUnder(null); }
  };

  // Drei Ebenen: Fach (0) > Thema (1) > Unterthema (2). depth steuert Einzug,
  // ob noch Unterpunkte erlaubt sind (nur bis Ebene 2) und ob gezogen wird
  // (Reihenfolge per Drag nur auf der obersten Ebene).
  const MAX_DEPTH = 2;
  const row = (tp, depth) => {
    const isChild = depth > 0;
    const isRoot = depth === 0;
    const canHaveKids = depth < MAX_DEPTH;
    const subCount = canHaveKids ? childrenOf(tp.id).length : 0;
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
        display: "flex", alignItems: "center", gap: 10,
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
          <Icon d={expanded.has(tp.id) ? ICONS.minus : ICONS.plus} size={15} />
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
          <span onClick={subCount ? () => toggleExpand(tp.id) : undefined}
            style={{ flex: 1, fontWeight: isChild ? 400 : 600, fontSize: isChild ? 14 : 15.5, color: "var(--text)", cursor: subCount ? "pointer" : undefined }}>
            {tp.name}
            {subCount > 0 && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text3)", marginLeft: 8 }}>{t("topics.subCount", { n: subCount })}</span>}
          </span>
          {tp.question_count > 0 && (
            <span style={{ fontSize: 12, color: "var(--text3)" }}>
              {t("topics.questionCount", { n: tp.question_count })}
            </span>
          )}
          {canHaveKids && (
            <button onClick={() => { setAddingUnder(tp.id); setChildName(""); setExpanded((p) => new Set(p).add(tp.id)); }} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 13 }}>
              {t("topics.addSub")}
            </button>
          )}
          <Link to={`/thema/${tp.id}`} className="icon-btn" style={{ ...iconBtn, display: "inline-flex", color: "var(--accent)" }} title={t("thema.view")}>
            <Icon d={ICONS.chart} size={16} color="var(--accent)" />
          </Link>
          <button onClick={() => { setEditing(tp.id); setEditName(tp.name); }} className="icon-btn" style={iconBtn} title={t("common.rename")}>
            <Icon d={ICONS.edit} />
          </button>
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
    <div>
      <h1 style={pageTitle}>{t("topics.title")}</h1>
      <p style={{ color: "var(--text2)", marginBottom: 22, fontSize: 14 }}>
        {t("topics.intro")}
      </p>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <form onSubmit={submitRoot} style={{ display: "flex", gap: 8, marginBottom: 22 }}>
        <input
          value={newRoot} onChange={(e) => setNewRoot(e.target.value)} placeholder={t("topics.newPlaceholder")}
          style={{ flex: 1, maxWidth: 340, padding: "9px 12px", border: "1px solid var(--border2)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }}
        />
        <button type="submit" disabled={!newRoot.trim()} style={{ ...btnPrimary, opacity: newRoot.trim() ? 1 : 0.4 }}>
          {t("common.add")}
        </button>
      </form>

      {!loaded && <Skeleton rows={5} />}
      {loaded && roots.length === 0 && <Empty title={t("topics.empty")} hint={t("topics.emptyHint")} />}

      {roots.map((tp) => renderNode(tp, 0))}
    </div>
  );
}

