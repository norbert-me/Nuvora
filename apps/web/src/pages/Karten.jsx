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
  const [addingDeck, setAddingDeck] = useState(false);
  const [detail, setDetail] = useState(null); // { student, cards } — Einzelstatistik

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
  const openDetail = async (p) => {
    const cards = await fetch(`${API}/classes/${classId}/students/${p.student_id}/cards`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    setDetail({ student: p, cards });
  };
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
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text2)" }}>
          {t("nav.classes")}
          <select value={classId ?? ""} onChange={(e) => { setClassId(Number(e.target.value)); setTokens(null); }}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)" }}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {view === "cards" && (
        <>
          <form onSubmit={async (e) => { e.preventDefault(); if (addingDeck || !newDeck.trim()) return; setAddingDeck(true); try { if (await call(() => fetch(`${API}/classes/${classId}/decks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newDeck.trim() }) }))) setNewDeck(""); } finally { setAddingDeck(false); } }}
            style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <input value={newDeck} onChange={(e) => setNewDeck(e.target.value)} placeholder={t("karten.newDeck")}
              style={{ flex: 1, maxWidth: 320, padding: "8px 12px", border: "1px solid var(--border2)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }} />
            <button type="submit" disabled={addingDeck || !newDeck.trim()} style={{ ...btnPrimary, opacity: (!addingDeck && newDeck.trim()) ? 1 : 0.4 }}>{t("common.add")}</button>
          </form>
          {decks.length === 0 && <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("karten.noDecks")}</p>}
          {decks.map((d) => <Deck key={d.id} deck={d} t={t} call={call} />)}
        </>
      )}

      {view === "progress" && (() => {
        const total = progress[0]?.total || 0;
        // Klassen-Reifegrad zeigt nur aktiv gelernte Karten — "Neu" (noch nicht
        // angefasst) bleibt aussen vor, sonst spiegelt der Balken vor allem
        // Unbearbeitetes.
        const REIFE_AKTIV = REIFE.filter(([k]) => k !== "neu");
        const classHist = progress.reduce((acc, p) => {
          REIFE_AKTIV.forEach(([k]) => { acc[k] = (acc[k] || 0) + (p.hist?.[k] || 0); });
          return acc;
        }, {});
        return (
          <>
            {total === 0 ? (
              <p style={{ fontSize: 13.5, color: "var(--text3)", marginBottom: 16 }}>{t("karten.noRolledOut")}</p>
            ) : (
              <div style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 12, marginBottom: 16, background: "var(--card)" }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{t("karten.classMaturity")}</div>
                <ReifeBar hist={classHist} height={14} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
                  {REIFE_AKTIV.map(([k, label, color]) => (
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text3)" }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />{label} {classHist[k] || 0}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: "left" }}>{t("common.name")}</th>
                  <th style={{ ...th, textAlign: "left", minWidth: 120 }}>{t("karten.maturity")}</th>
                  <th style={th}>{t("karten.reviewed")}</th>
                  <th style={th}>{t("karten.due")}</th>
                </tr></thead>
                <tbody>
                  {progress.map((p) => (
                    <tr key={p.student_id}>
                      <td style={{ ...td, textAlign: "left" }}>
                        <button onClick={() => openDetail(p)} style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600, fontSize: 13.5, padding: 0, textAlign: "left" }}>{p.name}</button>
                      </td>
                      <td style={{ ...td, textAlign: "left" }}><ReifeBar hist={p.hist} /></td>
                      <td style={td}>{p.reviewed}{total ? ` / ${total}` : ""}</td>
                      <td style={{ ...td, color: p.due ? "#b8860b" : "var(--text3)" }}>{p.due || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      })()}

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

      {detail && <StudentDetail detail={detail} t={t} onClose={() => setDetail(null)} />}
    </div>
  );
}

// Einzelstatistik je Schueler: alle Karten mit Reifegrad, Faelligkeit und
// Fehlversuchen. Nur Anzeige.
function StudentDetail({ detail, t, onClose }) {
  const { student, cards } = detail;
  const now = Date.now();
  const label = (b) => (REIFE.find(([k]) => k === b) || [null, b])[1];
  const color = (b) => (REIFE.find(([k]) => k === b) || [null, null, "var(--text3)"])[2];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 18, maxWidth: 560, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 22, border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>{student.name}</h3>
          <button onClick={onClose} className="icon-btn" style={iconBtn} title={t("common.close")}><Icon d={ICONS.close} size={16} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 14 }}>{student.reviewed} / {student.total} {t("karten.reviewed").toLowerCase()} · {student.due || 0} {t("karten.due").toLowerCase()}</div>
        {cards.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("karten.noRolledOut")}</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead><tr>
                <th style={{ ...th, textAlign: "left" }}>{t("karten.front")}</th>
                <th style={{ ...th, textAlign: "left" }}>{t("karten.maturity")}</th>
                <th style={th}>{t("karten.due")}</th>
                <th style={th} title={t("karten.lapsesHint")}>↺</th>
              </tr></thead>
              <tbody>
                {cards.map((c) => {
                  const due = c.due ? new Date(c.due) : null;
                  const dueTxt = !due ? "—" : due.getTime() <= now ? t("karten.dueNow") : due.toLocaleDateString();
                  return (
                    <tr key={c.card_id}>
                      <td style={{ ...td, textAlign: "left", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${c.front} (${c.deck})`}>{c.front}</td>
                      <td style={{ ...td, textAlign: "left" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: color(c.bucket) }} />{label(c.bucket)}</span></td>
                      <td style={{ ...td, color: due && due.getTime() <= now ? "#b8860b" : "var(--text3)" }}>{dueTxt}</td>
                      <td style={{ ...td, color: c.lapses ? "#d1350f" : "var(--text3)" }}>{c.lapses || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Deck({ deck, t, call }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [planDate, setPlanDate] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    if (busy || !front.trim() || !back.trim()) return;
    setBusy(true);
    try {
      if (await call(() => fetch(`${API}/decks/${deck.id}/cards`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ front: front.trim(), back: back.trim() }) }))) { setFront(""); setBack(""); }
    } finally { setBusy(false); }
  };
  const release = (payload) => call(() => fetch(`${API}/decks/${deck.id}/release`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));

  const now = Date.now();
  const rel = deck.released_at ? new Date(deck.released_at).getTime() : null;
  const status = rel === null ? "entwurf" : rel > now ? "geplant" : "aus";
  const badge = status === "aus" ? { text: t("karten.rolledOut"), bg: "rgba(10,125,62,0.12)", col: "#0a7d3e" }
    : status === "geplant" ? { text: t("karten.plannedFor", { date: new Date(deck.released_at).toLocaleString() }), bg: "rgba(184,134,11,0.12)", col: "#b8860b" }
    : { text: t("karten.draft"), bg: "var(--bg3)", col: "var(--text3)" };

  return (
    <div style={{ marginBottom: 14, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16 }}>{deck.name || t("karten.deck")}</strong>
        <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 8px", borderRadius: 980, background: badge.bg, color: badge.col }}>{badge.text}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{deck.cards.length} {t("karten.cards")}</span>
        <button onClick={() => { if (confirm(t("karten.delDeck", { name: deck.name }))) call(() => fetch(`${API}/decks/${deck.id}`, { method: "DELETE" })); }}
          className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>
      </div>

      {/* Ausrollen: sofort, geplant oder zurueckziehen. Ohne Karten sinnlos. */}
      {deck.cards.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap", fontSize: 13 }}>
          {status !== "aus" && <button onClick={() => release({ now: true })} style={{ ...btnPrimary, padding: "5px 12px" }}>{t("karten.rollOutNow")}</button>}
          {status !== "aus" && (
            <>
              <input type="datetime-local" value={planDate} onChange={(e) => setPlanDate(e.target.value)}
                style={{ ...inp, padding: "5px 8px" }} />
              <button disabled={!planDate} onClick={() => release({ released_at: new Date(planDate).toISOString() })}
                style={{ ...btnSecondary, padding: "5px 12px", opacity: planDate ? 1 : 0.4 }}>{t("karten.plan")}</button>
            </>
          )}
          {status !== "entwurf" && <button onClick={() => release({})} style={{ ...btnSecondary, padding: "5px 12px" }}>{t("karten.withdraw")}</button>}
        </div>
      )}
      {deck.cards.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 13.5 }}>
          <span style={{ flex: 1, minWidth: 0 }}><strong>{c.front}</strong> <span style={{ color: "var(--text3)" }}>→ {c.back}</span></span>
          <button onClick={() => call(() => fetch(`${API}/cards/${c.id}`, { method: "DELETE" }))} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} size={14} /></button>
        </div>
      ))}
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input value={front} onChange={(e) => setFront(e.target.value)} placeholder={t("karten.front")} style={{ flex: 1, minWidth: 120, ...inp }} />
        <input value={back} onChange={(e) => setBack(e.target.value)} placeholder={t("karten.back")} style={{ flex: 1, minWidth: 120, ...inp }} />
        <button type="submit" disabled={busy || !front.trim() || !back.trim()} style={{ ...btnPrimary, padding: "6px 14px", opacity: (!busy && front.trim() && back.trim()) ? 1 : 0.4 }}>{t("common.add")}</button>
      </form>
    </div>
  );
}

// Reifegrade fuer das Histogramm — gleiche Staffelung wie in Lernen.jsx.
const REIFE = [
  ["neu", "Neu", "#cbd5e1"],
  ["lernen", "Am Lernen", "#f59e0b"],
  ["kurz", "Kurzfristig", "#eab308"],
  ["mittel", "Mittelfristig", "#84cc16"],
  ["lang", "Langfristig", "#0a7d3e"],
];

// Gestapelter Reifegrad-Balken aus einem hist-Objekt {neu,lernen,...}.
function ReifeBar({ hist, height = 10 }) {
  const total = REIFE.reduce((s, [k]) => s + (hist?.[k] || 0), 0);
  if (!total) return <span style={{ fontSize: 12, color: "var(--text3)" }}>—</span>;
  return (
    <div style={{ display: "flex", height, borderRadius: height / 2, overflow: "hidden", minWidth: 80 }} title={REIFE.map(([k, l]) => `${l}: ${hist[k] || 0}`).join(" · ")}>
      {REIFE.map(([k, , color]) => {
        const n = hist?.[k] || 0;
        return n > 0 ? <div key={k} style={{ width: `${(n / total) * 100}%`, background: color }} /> : null;
      })}
    </div>
  );
}

const inp = { padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
const th = { padding: "8px 10px", borderBottom: "2px solid var(--border)", fontWeight: 600, fontSize: 12, color: "var(--text2)", textAlign: "center" };
const td = { padding: "7px 10px", borderBottom: "1px solid var(--border)", textAlign: "center", color: "var(--text)" };
