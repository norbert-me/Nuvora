// Modul Karten (Lehrer): Stapel & Karten verwalten, QR-Tokens drucken,
// Fortschritt sehen. Schüler lernen kontenlos über den Token (siehe Lernen.jsx).
import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary, pageTitle } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/karten";

export default function Karten() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [decks, setDecks] = useState([]);
  const [progress, setProgress] = useState([]);
  const [tokens, setTokens] = useState(null);
  const [params] = useSearchParams();
  const view = params.get("tab") || "cards"; // cards | progress | qr — aus der Navbar
  const [error, setError] = useState("");
  const [newDeck, setNewDeck] = useState("");

  useEffect(() => {
    fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).then((d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (list.length && classId === null) setClassId(list[0].id);
    }).catch(() => {});
  }, []);

  const loadDecks = (id) => id && fetch(`${API}/classes/${id}/decks`).then((r) => (r.ok ? r.json() : [])).then(setDecks).catch(() => {});
  useEffect(() => { loadDecks(classId); }, [classId]);

  const call = async (fn) => {
    setError("");
    const res = await fn();
    if (!res.ok) { const b = await res.json().catch(() => ({})); setError(typeof b.detail === "string" ? b.detail : t("common.notWork")); return false; }
    await loadDecks(classId);
    return true;
  };

  const loadProgress = () => fetch(`${API}/classes/${classId}/progress`).then((r) => (r.ok ? r.json() : [])).then(setProgress).catch(() => {});
  const loadTokens = () => fetch(`${API}/classes/${classId}/tokens`, { method: "POST" }).then((r) => (r.ok ? r.json() : [])).then(setTokens).catch(() => {});
  // Daten laden, wenn der Tab (aus der Navbar) oder die Klasse wechselt.
  useEffect(() => {
    if (!classId) return;
    if (view === "progress") loadProgress();
    if (view === "qr") loadTokens();
  }, [view, classId]);

  if (classes.length === 0) {
    return (
      <div style={{ maxWidth: 700 }}>
        <h1 style={pageTitle}>{t("karten.title")}</h1>
        <p style={{ color: "var(--text2)", fontSize: 14 }}>
          {t("karten.needClass").split("{{link}}")[0]}<Link to="/classes" style={{ color: "var(--accent)" }}>{t("nav.classes")}</Link>{t("karten.needClass").split("{{link}}")[1]}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>{t("karten.title")}</h1>
        <select value={classId ?? ""} onChange={(e) => { setClassId(Number(e.target.value)); setTokens(null); }}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)" }}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {view === "cards" && (
        <>
          <form onSubmit={async (e) => { e.preventDefault(); if (newDeck.trim() && await call(() => fetch(`${API}/classes/${classId}/decks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newDeck.trim() }) }))) setNewDeck(""); }}
            style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <input value={newDeck} onChange={(e) => setNewDeck(e.target.value)} placeholder={t("karten.newDeck")}
              style={{ flex: 1, maxWidth: 320, padding: "8px 12px", border: "1px solid var(--border2)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }} />
            <button type="submit" disabled={!newDeck.trim()} style={{ ...btnPrimary, opacity: newDeck.trim() ? 1 : 0.4 }}>{t("common.add")}</button>
          </form>
          {decks.length === 0 && <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("karten.noDecks")}</p>}
          {decks.map((d) => <Deck key={d.id} deck={d} t={t} call={call} />)}
        </>
      )}

      {view === "progress" && (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>{t("common.name")}</th>
              <th style={th}>{t("karten.reviewed")}</th>
              <th style={th}>{t("karten.due")}</th>
            </tr></thead>
            <tbody>
              {progress.map((p) => (
                <tr key={p.student_id}>
                  <td style={{ ...td, textAlign: "left" }}>{p.name}</td>
                  <td style={td}>{p.reviewed}</td>
                  <td style={{ ...td, color: p.due ? "#b8860b" : "var(--text3)" }}>{p.due || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "qr" && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 14 }}>{t("karten.qrHint")}</p>
          <button onClick={() => window.print()} style={{ ...btnSecondary, marginBottom: 16 }}>{t("karten.print")}</button>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
            {(tokens || []).map((s) => (
              <div key={s.student_id} style={{ textAlign: "center", border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "#fff" }}>
                <img src={`${API}/qr/${s.token}.png?base=${encodeURIComponent(window.location.origin)}`} alt="" width={120} height={120} style={{ display: "block", margin: "0 auto 6px" }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{s.name}</div>
                <div style={{ fontSize: 11, color: "#666" }}>#{s.card_id}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Deck({ deck, t, call }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const add = async (e) => {
    e.preventDefault();
    if (!front.trim() || !back.trim()) return;
    if (await call(() => fetch(`${API}/decks/${deck.id}/cards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ front: front.trim(), back: back.trim() }) }))) { setFront(""); setBack(""); }
  };
  return (
    <div style={{ marginBottom: 14, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <strong style={{ flex: 1, fontSize: 16 }}>{deck.name || t("karten.deck")}</strong>
        <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{deck.cards.length} {t("karten.cards")}</span>
        <button onClick={() => { if (confirm(t("karten.delDeck", { name: deck.name }))) call(() => fetch(`${API}/decks/${deck.id}`, { method: "DELETE" })); }}
          className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>
      </div>
      {deck.cards.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 13.5 }}>
          <span style={{ flex: 1, minWidth: 0 }}><strong>{c.front}</strong> <span style={{ color: "var(--text3)" }}>→ {c.back}</span></span>
          <button onClick={() => call(() => fetch(`${API}/cards/${c.id}`, { method: "DELETE" }))} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} size={14} /></button>
        </div>
      ))}
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input value={front} onChange={(e) => setFront(e.target.value)} placeholder={t("karten.front")} style={{ flex: 1, minWidth: 120, ...inp }} />
        <input value={back} onChange={(e) => setBack(e.target.value)} placeholder={t("karten.back")} style={{ flex: 1, minWidth: 120, ...inp }} />
        <button type="submit" disabled={!front.trim() || !back.trim()} style={{ ...btnPrimary, padding: "6px 14px", opacity: (front.trim() && back.trim()) ? 1 : 0.4 }}>{t("common.add")}</button>
      </form>
    </div>
  );
}

const inp = { padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
const th = { padding: "8px 10px", borderBottom: "2px solid var(--border)", fontWeight: 600, fontSize: 12, color: "var(--text2)", textAlign: "center" };
const td = { padding: "7px 10px", borderBottom: "1px solid var(--border)", textAlign: "center", color: "var(--text)" };
