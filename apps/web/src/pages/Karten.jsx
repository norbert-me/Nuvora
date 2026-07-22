// Modul Karten (Lehrer): Stapel & Karten verwalten, QR-Tokens drucken,
// Fortschritt sehen. Schüler lernen kontenlos über den Token (siehe Lernen.jsx).
import { useState, useEffect } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { Link, useSearchParams } from "react-router-dom";
import { Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary, pageTitle, selectStyle, modalOverlay, modalPanel, Empty, Skeleton } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules } from "../core/modules.js";
import { swr , lastClass, rememberClass } from "../core/cache.js";
import PublishModal from "../components/PublishModal.jsx";
import { gradeFromPct, DEFAULT_SCALE } from "../core/grades.js";

// Meisterung aus dem Reifegrad: gewichteter Anteil reifer Karten. Neu zählt
// nicht, langfristig voll. Ergibt 0–100 %, das die Notenskala in eine Note übersetzt.
const MASTERY_W = { neu: 0, lernen: 0.25, kurz: 0.5, mittel: 0.8, lang: 1 };
function masteryPct(hist) {
  const total = Object.values(hist || {}).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const w = Object.entries(MASTERY_W).reduce((s, [k, v]) => s + ((hist[k] || 0) * v), 0);
  return (w / total) * 100;
}

const API = "/api/karten";

export default function Karten() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null); // Karten hängen am Kurs (Fach)
  const [decks, setDecks] = useState([]);
  const [progress, setProgress] = useState([]);
  const [tokens, setTokens] = useState(null);
  const [params] = useSearchParams();
  const view = params.get("tab") || "cards"; // cards | progress | qr — aus der Navbar
  const [error, setError] = useState("");
  const [newDeck, setNewDeck] = useState("");
  const [addingDeck, setAddingDeck] = useState(false);
  const [detail, setDetail] = useState(null); // { student, cards } — Einzelstatistik
  const [topics, setTopics] = useState([]);
  const { modules } = useModules();
  // Themen-Bindung ist nur mit Kalender sinnvoll (Auto-Freischaltung). Ohne das
  // Modul bleibt die Option aus (Regel 3: Zusatz, nie Voraussetzung).
  const kalenderAktiv = modules.find((m) => m.key === "kalender")?.active ?? false;
  // Brücke zum Notenbuch (Regel 3: Zusatz). Nur wenn das Modul Noten aktiv ist.
  const notenAktiv = modules.find((m) => m.key === "noten")?.active ?? false;
  const [gradeScale, setGradeScale] = useState(DEFAULT_SCALE);
  const [notenDialog, setNotenDialog] = useState(false);

  useEffect(() => {
    if (kalenderAktiv) return swr("topics", "/api/topics", (d) => setTopics(Array.isArray(d) ? d : []));
  }, [kalenderAktiv]);

  useEffect(() => {
    if (!notenAktiv) return;
    // Notenskala der Lehrkraft vom Server (autoritativ) — der localStorage-Cache
    // kann veraltet sein, wenn die Skala in dieser Sitzung geaendert wurde.
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((u) => {
      if (u?.grade_scale) setGradeScale(u.grade_scale);
      else { try { const c = JSON.parse(localStorage.getItem("user")); if (c?.grade_scale) setGradeScale(c.grade_scale); } catch {} }
    }).catch(() => { try { const c = JSON.parse(localStorage.getItem("user")); if (c?.grade_scale) setGradeScale(c.grade_scale); } catch {} });
  }, [notenAktiv]);

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      // Vorauswahl per ?class=<id> (z. B. Link aus dem Kalender), sonst erste Klasse.
      const wanted = Number(params.get("class")) || null;
      if (classId === null) { const w = lastClass(); setClassId((wanted && list.some((c) => c.id === wanted)) ? wanted : (list.some((c) => c.id === w) ? w : (list[0]?.id ?? null))); }
    });
  }, []);

  useEffect(() => { if (classId) rememberClass(classId); }, [classId]);

  const [deckTrash, setDeckTrash] = useState([]);
  const [showTrash, setShowTrash] = useState(false);
  const kq = kursId != null ? `?kurs_id=${kursId}` : "";
  const [loadingDecks, setLoadingDecks] = useState(true);
  const decksLoadedOnce = useRef(false); // Skeleton nur beim ersten Laden, nicht bei Klassen-/Kurswechsel
  const loadDecks = (id) => { if (!id) return; setLoadingDecks(true); return fetch(`${API}/classes/${id}/decks${kq}`).then((r) => (r.ok ? r.json() : [])).then(setDecks).catch(() => {}).finally(() => { setLoadingDecks(false); decksLoadedOnce.current = true; }); };
  const loadTrash = (id) => id && fetch(`${API}/classes/${id}/decks/trash${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => setDeckTrash(Array.isArray(d) ? d : [])).catch(() => {});
  useEffect(() => { loadDecks(classId); loadTrash(classId); }, [classId, kursId]);
  const restoreDeck = async (id) => { await fetch(`${API}/decks/${id}/restore`, { method: "POST" }).catch(() => {}); loadDecks(classId); loadTrash(classId); };
  const purgeDeck = async (id) => {
    if (!await askConfirm(t("karten.purgeConfirm"))) return;
    await fetch(`${API}/decks/${id}/purge`, { method: "DELETE" }).catch(() => {});
    loadTrash(classId);
  };

  const call = async (fn) => {
    setError("");
    const res = await fn();
    if (!res.ok) { const b = await res.json().catch(() => ({})); setError(typeof b.detail === "string" ? b.detail : t("common.notWork")); return false; }
    await loadDecks(classId);
    loadTrash(classId);
    return true;
  };

  const loadProgress = () => fetch(`${API}/classes/${classId}/progress${kq}`).then((r) => (r.ok ? r.json() : [])).then(setProgress).catch(() => {});
  const openDetail = async (p) => {
    const cards = await fetch(`${API}/classes/${classId}/students/${p.student_id}/cards${kq}`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    setDetail({ student: p, cards });
  };
  const loadTokens = () => fetch(`${API}/classes/${classId}/tokens`, { method: "POST" }).then((r) => (r.ok ? r.json() : [])).then(setTokens).catch(() => {});
  // Daten laden, wenn der Tab (aus der Navbar) oder die Klasse wechselt.
  useEffect(() => {
    if (!classId) return;
    if (view === "progress") loadProgress(); // eslint-disable-line
    if (view === "qr") loadTokens();
  }, [view, classId, kursId]);

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
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("karten.title")}</h1>
        <KursKlasseSelect value={classId} onChange={(id, kid) => { setClassId(id); setKursId(kid); setTokens(null); }} onKurs={setKursId} />
      </div>

      {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {view === "cards" && (
        <>
          <details style={{ marginBottom: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg3)", padding: "10px 14px" }}>
            <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 600, color: "var(--text2)" }}>{t("karten.srTitle")}</summary>
            <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, margin: "8px 0 0" }}>{t("karten.srInfo")}</p>
          </details>
          <form onSubmit={async (e) => { e.preventDefault(); if (addingDeck || !newDeck.trim()) return; setAddingDeck(true); try { if (await call(() => fetch(`${API}/classes/${classId}/decks${kq}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newDeck.trim() }) }))) setNewDeck(""); } finally { setAddingDeck(false); } }}
            style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <input value={newDeck} onChange={(e) => setNewDeck(e.target.value)} placeholder={t("karten.newDeck")}
              style={{ flex: 1, maxWidth: 320, padding: "8px 12px", border: "1px solid var(--border2)", borderRadius: 10, background: "var(--bg)", color: "var(--text)" }} />
            <button type="submit" disabled={addingDeck || !newDeck.trim()} style={{ ...btnPrimary, opacity: (!addingDeck && newDeck.trim()) ? 1 : 0.4 }}>{t("common.add")}</button>
          </form>
          {loadingDecks && !decksLoadedOnce.current ? <Skeleton rows={3} height={60} />
            : decks.length === 0 ? <Empty title={t("karten.noDecks")} hint={t("karten.noDecksHint")} /> : null}
          {decks.map((d) => <Deck key={d.id} deck={d} t={t} call={call} topics={topics} showTopic={kalenderAktiv} />)}
          {deckTrash.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setShowTrash((v) => !v)} style={{ ...btnSecondary, fontSize: 13 }}>{t("karten.trash")} ({deckTrash.length})</button>
              {showTrash && (
                <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, marginTop: 8, background: "var(--bg3)" }}>
                  <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 8px" }}>{t("karten.trashHint")}</p>
                  {deckTrash.map((d) => (
                    <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: "1px solid var(--border)" }}>
                      <span style={{ flex: 1, fontWeight: 500 }}>{d.name} <span style={{ fontSize: 12, color: "var(--text3)" }}>· {t("karten.cardCount", { n: d.cards?.length || 0 })}</span></span>
                      <button onClick={() => restoreDeck(d.id)} style={{ ...btnSecondary, padding: "4px 11px", fontSize: 12.5 }}>{t("classes.restore")}</button>
                      <button onClick={() => purgeDeck(d.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("classes.purge")}><Icon d={ICONS.trash} size={14} color={C.danger} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {view === "progress" && (() => {
        const total = progress[0]?.total || 0;
        // Klassen-Reifegrad zeigt nur aktiv gelernte Karten — "Neu" (noch nicht
        // angefasst) bleibt aussen vor, sonst spiegelt der Balken vor allem
        // Wochenansicht: wer hat diese Woche (ab Montag) gelernt, wer noch nie.
        const wochStart = (() => { const d = new Date(); const wd = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - wd); return d.getTime(); })();
        const nStud = progress.length;
        const dieseWoche = progress.filter((p) => p.last_reviewed && new Date(p.last_reviewed).getTime() >= wochStart).length;
        const nieGelernt = progress.filter((p) => !p.last_reviewed).length;
        return (
          <>
            {total === 0 ? (
              <p style={{ fontSize: 13.5, color: "var(--text3)", marginBottom: 16 }}>{t("karten.noRolledOut")}</p>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{t("karten.progress")}</span>
                <span style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 980, background: "rgba(10,125,62,0.12)", color: C.success, fontWeight: 600 }}>{t("karten.thisWeek")}: {dieseWoche}/{nStud}</span>
                {nieGelernt > 0 && <span style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 980, background: "var(--bg2)", color: "var(--text3)", fontWeight: 600 }}>{t("karten.neverLearned")}: {nieGelernt}</span>}
                {notenAktiv && <button onClick={() => setNotenDialog(true)} style={{ ...btnSecondary, padding: "5px 12px", marginLeft: "auto" }}>{t("karten.toNoten")}</button>}
              </div>
            )}
            <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: "left" }}>{t("common.name")}</th>
                  <th style={{ ...th, textAlign: "left", minWidth: 120 }}>{t("karten.maturity")}</th>
                  <th style={th}>{t("karten.reviewed")}</th>
                  <th style={th}>{t("karten.due")}</th>
                  <th style={th}>{t("karten.lastLearned")}</th>
                </tr></thead>
                <tbody>
                  {progress.map((p) => (
                    <tr key={p.student_id}>
                      <td style={{ ...td, textAlign: "left" }}>
                        <button onClick={() => openDetail(p)} style={{ border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600, fontSize: 13.5, padding: 0, textAlign: "left" }}>{p.name}</button>
                      </td>
                      <td style={{ ...td, textAlign: "left" }}><ReifeBar hist={p.hist} /></td>
                      <td style={td}>{p.reviewed}{total ? ` / ${total}` : ""}</td>
                      <td style={{ ...td, color: p.due ? C.warning : "var(--text3)" }}>{p.due || "—"}</td>
                      <td style={{ ...td, color: "var(--text3)", fontSize: 12.5 }}>{p.last_reviewed ? new Date(p.last_reviewed).toLocaleDateString() : "—"}</td>
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
      {notenDialog && <NotenBrueckeModal t={t} classId={classId} kursId={kursId} progress={progress} scale={gradeScale} onClose={() => setNotenDialog(false)} />}
    </div>
  );
}

// Brücke Karten → Notenbuch: rechnet je SuS die Meisterung in eine Note (über die
// Notenskala der Lehrkraft) und legt daraus eine neue Spalte an. Nur SuS, die schon
// gelernt haben — nie-Gelernte bekommen keine 6 untergeschoben. Die Spalte ist frei
// editierbar; die Note bleibt pädagogische Entscheidung.
function NotenBrueckeModal({ t, classId, kursId, progress, scale, onClose }) {
  const [sections, setSections] = useState(null);
  const [sectionId, setSectionId] = useState("");
  const [name, setName] = useState(`${t("karten.masteryColumn")} ${new Date().toLocaleDateString()}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // term=all: Karten hat keinen Halbjahr-Selektor — sonst waeren im 2. Halbjahr
  // keine Abschnitte waehlbar. Das Halbjahr steht als Label an der Option.
  const kq = `?term=all${kursId != null ? `&kurs_id=${kursId}` : ""}`;
  const secLabel = (s) => `${s.term === "2" ? "2. Hj · " : "1. Hj · "}${s.name}`;

  useEffect(() => {
    fetch(`/api/noten/classes/${classId}/sections${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => {
      const list = Array.isArray(d) ? d : [];
      setSections(list);
      if (list[0]) setSectionId(String(list[0].id));
    }).catch(() => setSections([]));
  }, [classId, kursId]);

  const grades = progress
    .filter((p) => p.reviewed > 0)
    .map((p) => ({ student_id: p.student_id, value: gradeFromPct(masteryPct(p.hist), scale) }))
    .filter((g) => g.value >= 1 && g.value <= 6);

  const submit = async () => {
    if (!sectionId) { setErr(t("karten.masteryNoSection")); return; }
    if (!name.trim()) { setErr(t("noten.columnName")); return; }
    setBusy(true); setErr("");
    const res = await fetch("/api/noten/import-grades", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_id: classId, kurs_id: kursId, section_id: Number(sectionId), column_name: name.trim(), note: t("karten.masteryNote"), source_kind: "karten", grades }),
    }).catch(() => null);
    setBusy(false);
    if (res && res.ok) onClose();
    else { const b = res ? await res.json().catch(() => ({})) : {}; setErr(typeof b.detail === "string" ? b.detail : t("common.notWork")); }
  };

  return (
    <div onClick={onClose} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 440 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{t("karten.toNoten")}</h3>
        <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 14px" }}>{t("karten.masteryHint", { n: grades.length })}</p>
        {sections && sections.length === 0 ? (
          <p style={{ fontSize: 13, color: C.danger }}>{t("karten.masteryNoSection")}</p>
        ) : (<>
          <div style={{ fontSize: 12.5, color: "var(--text2)", margin: "0 0 5px" }}>{t("karten.masterySection")}</div>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
            {(sections || []).map((s) => <option key={s.id} value={s.id}>{secLabel(s)}</option>)}
          </select>
          <div style={{ fontSize: 12.5, color: "var(--text2)", margin: "12px 0 5px" }}>{t("noten.columnName")}</div>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, width: "100%" }} />
        </>)}
        {err && <p style={{ color: C.danger, fontSize: 12.5, marginTop: 10 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <button onClick={submit} disabled={busy || grades.length === 0 || (sections && sections.length === 0)} style={{ ...btnPrimary, opacity: busy || grades.length === 0 ? 0.6 : 1 }}>{t("common.save")}</button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
        </div>
      </div>
    </div>
  );
}

// Einzelstatistik je Schueler: alle Karten mit Reifegrad, Faelligkeit und
// Fehlversuchen. Nur Anzeige.
function StudentDetail({ detail, t, onClose }) {
  const { student, cards } = detail;
  // Nach Set/Stapel gruppieren: je Set ein Reifegrad-Balken mit der aktuellen
  // Zuordnung, statt jede einzelne Karte aufzulisten.
  const sets = {};
  for (const c of cards) {
    const key = c.deck || "—";
    (sets[key] ||= { hist: {}, learned: 0, total: 0 });
    sets[key].hist[c.bucket] = (sets[key].hist[c.bucket] || 0) + 1;
    sets[key].total += 1;
    if (c.bucket !== "neu") sets[key].learned += 1;
  }
  const rows = Object.entries(sets);
  return (
    <div onClick={onClose} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>{student.name}</h3>
          <button onClick={onClose} className="icon-btn" style={iconBtn} title={t("common.close")}><Icon d={ICONS.close} size={16} /></button>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 16 }}>{student.reviewed} / {student.total} {t("karten.reviewed").toLowerCase()} · {student.due || 0} {t("karten.due").toLowerCase()}</div>
        {rows.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("karten.noRolledOut")}</p>
        ) : rows.map(([name, s]) => (
          <div key={name} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>{s.learned} / {s.total} {t("karten.reviewed").toLowerCase()}</span>
            </div>
            <ReifeBar hist={s.hist} height={12} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Deck({ deck, t, call, topics = [], showTopic = false }) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [planDate, setPlanDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [importing, setImporting] = useState(false);
  const saveDeck = (patch) => call(() => fetch(`${API}/decks/${deck.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: deck.name, topic_id: deck.topic_id ?? null, niveau: deck.niveau || "", ...patch }) }));
  const setTopic = (tid) => saveDeck({ topic_id: tid ? Number(tid) : null });
  const setNiveau = (n) => saveDeck({ niveau: n });
  const topicLabel = (tp) => { const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null; return p ? `${p.name} / ${tp.name}` : tp.name; };
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
  const badge = status === "aus" ? { text: t("karten.rolledOut"), bg: "rgba(10,125,62,0.12)", col: C.success }
    : status === "geplant" ? { text: t("karten.plannedFor", { date: new Date(deck.released_at).toLocaleString() }), bg: "rgba(184,134,11,0.12)", col: C.warning }
    : { text: t("karten.draft"), bg: "var(--bg3)", col: "var(--text3)" };

  return (
    <div style={{ marginBottom: 14, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16 }}>{deck.name || t("karten.deck")}</strong>
        <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 8px", borderRadius: 980, background: badge.bg, color: badge.col }}>{badge.text}</span>
        {showTopic && (
          <select value={deck.topic_id ?? ""} onChange={(e) => setTopic(e.target.value)} title={t("karten.topicHint")}
            style={{ ...selectStyle, fontSize: 12, padding: "4px 28px 4px 9px", maxWidth: 180 }}>
            <option value="">– {t("karten.freeCards")} –</option>
            {topics.map((tp) => <option key={tp.id} value={tp.id}>{topicLabel(tp)}</option>)}
          </select>
        )}
        {/* Niveau-Stapel: "E"/"G" wird automatisch nur an Schueler des jeweiligen
            Niveaus verteilt, "" an alle. Kein manuelles Zuweisen noetig. */}
        <select value={deck.niveau || ""} onChange={(e) => setNiveau(e.target.value)} title={t("karten.niveauHint")}
          style={{ ...selectStyle, fontSize: 12, padding: "4px 28px 4px 9px", maxWidth: 150 }}>
          <option value="">{t("karten.niveauAll")}</option>
          <option value="E">{t("karten.niveauE")}</option>
          <option value="G">{t("karten.niveauG")}</option>
        </select>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{deck.cards.length} {t("karten.cards")}</span>
        {deck.cards.length > 0 && (
          <button onClick={() => setPublishing(true)} className="icon-btn" style={iconBtn} title={t("karten.publish")}><Icon d={ICONS.share} size={18} color="var(--accent)" /></button>
        )}
        {publishing && <PublishModal name={deck.name || t("karten.deck")} onClose={() => setPublishing(false)}
          onPublish={(description) => fetch(`/api/marketplace/publish/deck`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deck_id: deck.id, description }) }).catch(() => null)} />}
        <button onClick={async () => { if (await askConfirm(t("karten.delDeck", { name: deck.name }))) call(() => fetch(`${API}/decks/${deck.id}`, { method: "DELETE" })); }}
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
        <button type="button" onClick={() => setImporting(true)} style={{ ...btnSecondary, padding: "6px 14px" }}>{t("karten.import")}</button>
        {deck.cards.length > 0 && (
          <button type="button" onClick={() => {
            // Export als CSV (Vorderseite,Rückseite) — Trenner Semikolon, damit
            // Kommas im Text nicht stören; Anführungszeichen escaped.
            const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
            const csv = deck.cards.map((c) => `${esc(c.front)};${esc(c.back)}`).join("\n");
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
            a.download = `${(deck.name || "stapel").replace(/[^\w-]+/g, "_")}.csv`; a.click(); URL.revokeObjectURL(a.href);
          }} style={{ ...btnSecondary, padding: "6px 14px" }}>{t("karten.export")}</button>
        )}
      </form>
      {importing && <ImportModal deckName={deck.name || t("karten.deck")} t={t}
        onClose={() => setImporting(false)}
        onImport={async (cards) => call(() => fetch(`${API}/decks/${deck.id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cards }) }))} />}
    </div>
  );
}

// CSV/TSV/Text in {front, back}-Paare. Trenner automatisch erkannt (Tab,
// Semikolon, Komma). Kopfzeilen (mit '#') werden uebersprungen.
function parseCards(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (!lines.length) return [];
  // Trenner an der ersten Datenzeile bestimmen: Tab > Semikolon > Komma.
  const first = lines[0];
  const delim = first.includes("\t") ? "\t" : first.includes(";") ? ";" : ",";
  const splitLine = (line) => {
    // Einfaches CSV mit Anfuehrungszeichen: "a,b","c" bleibt zusammen.
    const out = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === delim && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  return lines.map(splitLine).filter((c) => c.length >= 2 && (c[0].trim() || c[1].trim()))
    .map((c) => ({ front: c[0].trim(), back: c[1].trim() }));
}

function ImportModal({ deckName, onClose, onImport, t }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = parseCards(text);
  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setText(String(r.result || ""));
    r.readAsText(f);
  };
  const doImport = async () => {
    if (!parsed.length || busy) return;
    setBusy(true);
    const ok = await onImport(parsed);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <div onClick={onClose} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 560 }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{t("karten.importTitle", { name: deckName })}</h3>
        <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 12px" }}>{t("karten.importHint")}</p>
        <input type="file" accept=".csv,.tsv,.txt" onChange={onFile} style={{ fontSize: 13, marginBottom: 10 }} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"Frage,Antwort\nHauptstadt Frankreich,Paris"} rows={8}
          style={{ ...inp, width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 13, resize: "vertical" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <button onClick={doImport} disabled={!parsed.length || busy} style={{ ...btnPrimary, opacity: (parsed.length && !busy) ? 1 : 0.4 }}>
            {busy ? t("karten.importing") : t("karten.importCount", { n: parsed.length })}
          </button>
          <button onClick={onClose} style={btnSecondary}>{t("common.abort")}</button>
        </div>
      </div>
    </div>
  );
}

// Reifegrade fuer das Histogramm — gleiche Staffelung wie in Lernen.jsx.
const REIFE = [
  ["neu", "Neu", "#cbd5e1"],
  ["lernen", "Am Lernen", "#f59e0b"],
  ["kurz", "Kurzfristig", "#eab308"],
  ["mittel", "Mittelfristig", "#84cc16"],
  ["lang", "Langfristig", C.success],
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
