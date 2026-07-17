// Themen sind Nuvora-Kerndaten: der gemeinsame Wortschatz beider Module.
// CardVote-Fragen und (spaeter) Lernpfad-Aufgaben zeigen auf dieselben Themen —
// erst dadurch laesst sich ein schwach ausgefallenes Thema auf passende
// Aufgaben abbilden.
import { useState, useEffect } from "react";
import { Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary, pageTitle } from "../components/Icons.jsx";

const API = "/api";

export default function Topics() {
  const [topics, setTopics] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [newRoot, setNewRoot] = useState("");
  const [addingUnder, setAddingUnder] = useState(null);
  const [childName, setChildName] = useState("");
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState("");

  const load = () =>
    fetch(`${API}/topics`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTopics(Array.isArray(d) ? d : []))
      .catch(() => setError("Themen konnten nicht geladen werden"))
      .finally(() => setLoaded(true));

  useEffect(() => { load(); }, []);

  const call = async (fn) => {
    setError("");
    try {
      const res = await fn();
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || "Das hat nicht geklappt");
        return false;
      }
      await load();
      return true;
    } catch {
      setError("Das hat nicht geklappt");
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

  const remove = async (t) => {
    const kids = topics.filter((x) => x.parent_id === t.id);
    const parts = [`„${t.name}“ löschen?`];
    if (kids.length) parts.push(`${kids.length} Unterthema${kids.length > 1 ? "s" : ""} verschwindet mit.`);
    const affected = t.question_count + kids.reduce((n, k) => n + k.question_count, 0);
    if (affected) parts.push(`${affected} Frage${affected > 1 ? "n" : ""} verliert das Thema — die Fragen selbst bleiben.`);
    if (!confirm(parts.join("\n"))) return;
    await call(() => fetch(`${API}/topics/${t.id}`, { method: "DELETE" }));
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

  const row = (t, isChild) => (
    <div
      key={t.id}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: isChild ? "8px 12px" : "12px 14px",
        marginLeft: isChild ? 28 : 0, marginBottom: 6,
        border: "1px solid var(--border)", borderRadius: isChild ? 10 : 14,
        background: isChild ? "var(--bg)" : "var(--card)",
      }}
    >
      {editing === t.id ? (
        <form
          onSubmit={async (e) => { e.preventDefault(); if (await rename(t, editName.trim())) setEditing(null); }}
          style={{ display: "flex", gap: 8, flex: 1 }}
        >
          <input
            value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
            style={{ flex: 1, padding: 7, border: "1px solid var(--border2)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }}
          />
          <button type="submit" style={btnPrimary}>Speichern</button>
          <button type="button" onClick={() => setEditing(null)} style={btnSecondary}>Abbrechen</button>
        </form>
      ) : (
        <>
          <span style={{ flex: 1, fontWeight: isChild ? 400 : 600, fontSize: isChild ? 14 : 15.5, color: "var(--text)" }}>
            {t.name}
          </span>
          {t.question_count > 0 && (
            <span style={{ fontSize: 12, color: "var(--text3)" }}>
              {t.question_count} Frage{t.question_count > 1 ? "n" : ""}
            </span>
          )}
          {!isChild && (
            <button onClick={() => { setAddingUnder(t.id); setChildName(""); }} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 13 }}>
              + Unterthema
            </button>
          )}
          <button onClick={() => { setEditing(t.id); setEditName(t.name); }} className="icon-btn" style={iconBtn} title="Umbenennen">
            <Icon d={ICONS.edit} />
          </button>
          <button onClick={() => remove(t)} className="icon-btn" style={iconBtn} title="Löschen">
            <Icon d={ICONS.trash} color={C.danger} />
          </button>
        </>
      )}
    </div>
  );

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={pageTitle}>Themen</h1>
      <p style={{ color: "var(--text2)", marginBottom: 22, fontSize: 14 }}>
        Der gemeinsame Wortschatz deiner Module. Fragen und Aufgaben zeigen auf
        dieselben Themen — so lässt sich später erkennen, wo eine Klasse Übung
        braucht.
      </p>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <form onSubmit={submitRoot} style={{ display: "flex", gap: 8, marginBottom: 22 }}>
        <input
          value={newRoot} onChange={(e) => setNewRoot(e.target.value)} placeholder="Neues Thema, z. B. Bruchrechnung"
          style={{ flex: 1, maxWidth: 340, padding: "9px 12px", border: "1px solid var(--border2)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }}
        />
        <button type="submit" disabled={!newRoot.trim()} style={{ ...btnPrimary, opacity: newRoot.trim() ? 1 : 0.4 }}>
          Hinzufügen
        </button>
      </form>

      {!loaded && <p style={{ color: "var(--text3)", fontSize: 14 }}>Lädt…</p>}
      {loaded && roots.length === 0 && (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>
          Noch keine Themen. Lege eins an — Unterthemen kommen darunter.
        </p>
      )}

      {roots.map((t) => (
        <div key={t.id} style={{ marginBottom: 10 }}>
          {row(t, false)}
          {childrenOf(t.id).map((c) => row(c, true))}
          {addingUnder === t.id && (
            <form onSubmit={(e) => submitChild(e, t.id)} style={{ display: "flex", gap: 8, marginLeft: 28, marginBottom: 6 }}>
              <input
                value={childName} onChange={(e) => setChildName(e.target.value)} autoFocus
                placeholder="Unterthema, z. B. Vervielfachen und Teilen"
                style={{ flex: 1, padding: 7, border: "1px solid var(--border2)", borderRadius: 8, background: "var(--bg)", color: "var(--text)" }}
              />
              <button type="submit" style={btnPrimary}>Hinzufügen</button>
              <button type="button" onClick={() => setAddingUnder(null)} style={btnSecondary}>Abbrechen</button>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}

