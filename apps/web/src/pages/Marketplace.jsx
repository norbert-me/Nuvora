import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { Icon, ICONS, modalOverlay, modalPanel, COLORS as C } from "../components/Icons.jsx";

const API = "/api";

function currentUser() {
  try { return JSON.parse(localStorage.getItem("user")); } catch { return null; }
}

function Stars({ value, my, onRate, count, t }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", gap: 1 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = hover ? n <= hover : (my ? n <= my : n <= Math.round(value));
          const filled = my ? n <= my : n <= Math.round(value);
          return (
            <button
              key={n}
              onClick={() => onRate(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              title={t("market.stars", { n })}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 0 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24"
                fill={(hover ? n <= hover : filled) ? (my ? "#e5a000" : "var(--text2)") : "none"}
                stroke={(my && !hover) ? "#e5a000" : "var(--text3)"} strokeWidth="1.5" strokeLinejoin="round">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z"/>
              </svg>
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 13, color: "var(--text3)" }}>
        {value ? value.toFixed(1) : "–"} {count > 0 ? `(${count})` : ""}
      </span>
    </div>
  );
}

export default function Marketplace({ fixedKind }) {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const [hintBefore, hintAfter] = t("market.publishHint").split("{{link}}");
  const user = currentUser();
  // Aus einem Modul heraus zeigt der Marktplatz nur dessen Art (kind gesperrt).
  const lockedKind = fixedKind || params.get("kind") || "";
  const [quizzes, setQuizzes] = useState([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [kind, setKind] = useState(lockedKind); // "" = alle | cardvote_questionset | karten_deck | method
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState("");
  const [authorFilter, setAuthorFilter] = useState(null); // { id, name } oder null
  const [classes, setClasses] = useState([]);
  const [copyDeckFor, setCopyDeckFor] = useState(null); // { id, title } — Klassenwahl fuers Deck

  useEffect(() => {
    fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).then((d) => setClasses(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // Zahl-/Autor-Zeile je Art (Prefix vor dem Autorennamen).
  const countLabel = (q) => q.kind === "karten_deck" ? t("market.cardsBy", { count: q.question_count })
    : q.kind === "method" ? t("market.methodBy")
    : q.kind === "lernpfad_ladder" ? t("market.exercisesBy", { count: q.question_count })
    : t("market.questionsBy", { count: q.question_count });

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ search, sort });
    if (kind) params.set("kind", kind);
    if (authorFilter) params.set("author_id", authorFilter.id);
    fetch(`${API}/marketplace?${params}`)
      .then((r) => r.ok ? r.json() : [])
      .then((d) => { setQuizzes(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [sort, authorFilter, kind]);

  // Suche entkoppelt (Debounce). Beim Mount NICHT erneut laden — sonst feuert
  // direkt nach dem ersten load ein zweiter, und die Liste flackert (kurz leer).
  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) { firstSearch.current = false; return; }
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [search]);

  const rate = async (id, stars) => {
    setQuizzes((prev) => prev.map((q) => q.id === id ? { ...q, my_rating: stars } : q));
    await fetch(`${API}/marketplace/${id}/rate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stars }),
    });
    load();
  };

  const openPreview = async (id) => {
    setPreview({ loading: true });
    const res = await fetch(`${API}/marketplace/${id}`);
    if (res.ok) setPreview(await res.json());
    else { setPreview(null); setMsg(t("market.previewError")); }
  };

  const copy = async (q, classId) => {
    // Karten-Stapel brauchen eine Zielklasse: erst Klassenwahl oeffnen.
    if (q.kind === "karten_deck" && !classId) {
      if (!classes.length) { setMsg(t("market.needClass")); return; }
      setCopyDeckFor({ id: q.id, title: q.title });
      return;
    }
    const res = await fetch(`${API}/marketplace/${q.id}/copy`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(classId ? { class_id: classId } : {}),
    });
    if (res.ok) { setMsg(t("market.added", { title: q.title })); setTimeout(() => setMsg(""), 4000); setCopyDeckFor(null); }
    else setMsg(t("market.adoptError"));
  };

  const remove = async (id) => {
    if (!await askConfirm(t("market.removeConfirm"))) return;
    const res = await fetch(`${API}/marketplace/${id}`, { method: "DELETE" });
    if (res.ok) load();
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 20px" }}>
        {hintBefore}<a href="/questions" style={{ color: "var(--accent)", textDecoration: "none" }}>{t("market.publishHintLink")}</a>{hintAfter}
      </p>

      {msg && <div style={{ padding: "10px 14px", marginBottom: 12, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 14, color: "var(--text)" }}>{msg}</div>}

      {authorFilter && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, padding: "8px 14px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 980, fontSize: 13, color: "var(--text2)" }}>
          {t("market.filterBy")} <strong style={{ color: "var(--text)" }}>{authorFilter.name}</strong>
          <button onClick={() => setAuthorFilter(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--text3)", display: "flex", alignItems: "center", padding: 2 }} title={t("market.clearFilter")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      )}

      {!lockedKind && (
      <div style={{ display: "flex", gap: 2, background: "var(--bg2)", padding: 3, borderRadius: 980, marginBottom: 14, width: "fit-content", flexWrap: "wrap" }}>
        {[["", t("market.kindAll")], ["cardvote_questionset", t("market.kindQuiz")], ["karten_deck", t("market.kindDeck")], ["method", t("market.kindMethod")], ["lernpfad_ladder", t("market.kindLadder")]].map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} style={{
            padding: "6px 14px", fontSize: 13, fontWeight: kind === k ? 600 : 400, cursor: "pointer",
            background: kind === k ? "var(--card)" : "transparent", color: kind === k ? "var(--text)" : "var(--text2)",
            border: "none", borderRadius: 980,
          }}>{label}</button>
        ))}
      </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("market.searchPlaceholder")}
          style={{ flex: 1, minWidth: 180, padding: "9px 14px", border: "1px solid var(--border2)", borderRadius: 980, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }} />
        <div style={{ display: "flex", gap: 2, background: "var(--bg2)", padding: 3, borderRadius: 980 }}>
          {[["newest", t("market.newest")], ["top", t("market.topRated")]].map(([k, label]) => (
            <button key={k} onClick={() => setSort(k)} style={{
              padding: "6px 14px", fontSize: 13, fontWeight: sort === k ? 600 : 400, cursor: "pointer",
              background: sort === k ? "var(--card)" : "transparent", color: sort === k ? "var(--text)" : "var(--text2)",
              border: "none", borderRadius: 980,
            }}>{label}</button>
          ))}
        </div>
      </div>

      {loading && quizzes.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("common.loading")}</p>
      ) : quizzes.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{authorFilter ? t("market.emptyFiltered") : search ? t("market.emptySearch") : t("market.emptyNone")}</p>
      ) : (
        quizzes.map((q) => (
          <div key={q.id} style={{ padding: "16px 18px", marginBottom: 10, border: "1px solid var(--border)", borderRadius: 16, background: "var(--card)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{q.title}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                  {countLabel(q)}{" "}
                  {q.author_id ? (
                    <button onClick={() => setAuthorFilter({ id: q.author_id, name: q.author_name || t("market.unknown") })}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent)", fontSize: 12, fontWeight: 500 }}>
                      {q.author_name || t("market.unknown")}
                    </button>
                  ) : (q.author_name || t("market.unknown"))}
                  {user && user.id === 1 && q.author_email && (
                    <span style={{ marginLeft: 6, padding: "1px 6px", background: "var(--bg2)", borderRadius: 980, fontSize: 11 }} title={t("market.adminOnly")}>{q.author_email}</span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => openPreview(q.id)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer", background: "var(--card)", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 980, whiteSpace: "nowrap" }}>{t("market.preview")}</button>
                <button onClick={() => copy(q)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "var(--text)", color: "var(--bg)", border: "none", borderRadius: 980, whiteSpace: "nowrap" }}>{t("market.adopt")}</button>
                {(user && (user.id === q.author_id || user.id === 1)) && (
                  <button onClick={() => remove(q.id)} title={t("market.removeTitle")} style={{ padding: 7, background: "none", border: "1px solid var(--border2)", borderRadius: 980, cursor: "pointer", color: C.danger, display: "flex", alignItems: "center" }}>
                    <Icon d={ICONS.trash} size={15} color={C.danger} />
                  </button>
                )}
              </div>
            </div>
            {q.description && <p style={{ fontSize: 13, color: "var(--text2)", margin: "6px 0 10px", lineHeight: 1.5 }}>{q.description}</p>}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Stars value={q.avg_rating} my={q.my_rating} count={q.rating_count} onRate={(n) => rate(q.id, n)} t={t} />
              {q.copies > 0 && <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("market.copies", { n: q.copies })}</span>}
            </div>
          </div>
        ))
      )}

      {preview && (
        <div onClick={() => setPreview(null)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 560 }}>
            {preview.loading ? (
              <p style={{ color: "var(--text3)", fontSize: 14, margin: 0 }}>{t("common.loading")}</p>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{preview.title}</h3>
                  <button onClick={() => setPreview(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 4, display: "flex" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
                  {countLabel(preview)}{" "}
                  {preview.author_id ? (
                    <button onClick={() => { setAuthorFilter({ id: preview.author_id, name: preview.author_name || t("market.unknown") }); setPreview(null); }}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent)", fontSize: 12, fontWeight: 500 }}>
                      {preview.author_name}
                    </button>
                  ) : preview.author_name}
                </div>
                {preview.description && <p style={{ fontSize: 13.5, color: "var(--text2)", margin: "0 0 12px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{preview.description}</p>}
                {preview.cards && preview.cards.length > 0 && (
                  <div style={{ display: "flex", gap: 10, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text3)", paddingBottom: 4 }}>
                    <span style={{ flex: 1 }}>{t("karten.front")}</span>
                    <span style={{ flex: 1 }}>{t("karten.back")}</span>
                  </div>
                )}
                {(preview.cards || []).map((c, i) => (
                  <div key={i} style={{ padding: "10px 0", borderTop: "1px solid var(--border)", display: "flex", gap: 10, fontSize: 13.5 }}>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: "var(--text)", overflowWrap: "anywhere" }}>{c.front}</span>
                    <span style={{ flex: 1, minWidth: 0, color: "var(--text2)", overflowWrap: "anywhere" }}>{c.back}</span>
                  </div>
                ))}
                {preview.method && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, fontSize: 13.5, color: "var(--text2)" }}>
                    {preview.method.dauer != null && <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 700, color: C.info }}>{t("methoden.dauerBadge", { n: preview.method.dauer })}</div>}
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{preview.method.description}</div>
                    {preview.method.ablauf && <div style={{ marginTop: 10 }}><b style={{ color: "var(--text3)", fontSize: 11.5 }}>{t("methoden.ablauf")}</b><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{preview.method.ablauf}</div></div>}
                    {preview.method.material && <div style={{ marginTop: 10 }}><b style={{ color: "var(--text3)", fontSize: 11.5 }}>{t("methoden.material")}</b><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{preview.method.material}</div></div>}
                  </div>
                )}
                {preview.ladder && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, fontSize: 13.5, color: "var(--text2)" }}>
                    {preview.ladder.topic_name && <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 700, color: C.info }}>{preview.ladder.topic_name}</div>}
                    {(preview.ladder.exercises || []).map((e, i) => (
                      <div key={i} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                        {e.kategorie && <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text3)", marginRight: 6 }}>{e.kategorie}</span>}
                        <span style={{ overflowWrap: "anywhere" }}>{e.aufgabentext}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(preview.questions || []).map((q, i) => (
                  <div key={i} style={{ padding: "12px 0", borderTop: "1px solid var(--border)" }}>
                    {/* overflowWrap + minWidth:0: Flex-Kinder haben eine
                        Mindestbreite von "min-content", darum sprengte ein
                        langer oder umbruchloser Antworttext die Zeile und lief
                        auf schmalen Bildschirmen aus dem Kasten. */}
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 6, overflowWrap: "anywhere" }}>{i + 1}. {q.text}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                      {["A", "B", "C", "D"].slice(0, q.num_choices || 4).map((k) => {
                        const isCorrect = q.correct_answer && q.correct_answer.includes(k);
                        return (
                          <div key={k} style={{ fontSize: 13, color: isCorrect ? C.success : "var(--text2)", fontWeight: isCorrect ? 600 : 400, display: "flex", gap: 6, minWidth: 0, alignItems: "flex-start" }}>
                            <span style={{ fontWeight: 700, flexShrink: 0 }}>{k}</span>
                            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{(q.choices && q.choices[k]) || "–"}</span>
                            {isCorrect && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.success} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}><path d="M20 6L9 17l-5-5"/></svg>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                  <button onClick={() => { const p = preview; setPreview(null); copy(p); }} style={{ padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--text)", color: "var(--bg)", border: "none", borderRadius: 980 }}>{t("market.adopt")}</button>
                  <button onClick={() => setPreview(null)} style={{ padding: "10px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer", background: "var(--card)", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 980 }}>{t("common.close")}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {copyDeckFor && (
        <div onClick={() => setCopyDeckFor(null)} style={modalOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: 400 }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>{t("market.chooseClass")}</h3>
            <p style={{ fontSize: 12.5, color: "var(--text3)", margin: "0 0 14px" }}>{t("market.chooseClassHint", { title: copyDeckFor.title })}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflow: "auto" }}>
              {classes.map((c) => (
                <button key={c.id} onClick={() => copy({ id: copyDeckFor.id, title: copyDeckFor.title, kind: "karten_deck" }, c.id)}
                  style={{ textAlign: "left", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>{c.name}</button>
              ))}
            </div>
            <button onClick={() => setCopyDeckFor(null)} style={{ marginTop: 14, padding: "8px 16px", fontSize: 13.5, cursor: "pointer", background: "var(--card)", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 980 }}>{t("common.abort")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
