import { useState, useEffect } from "react";
import { useLanguage } from "../i18n/index.jsx";

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

export default function Marketplace() {
  const { t } = useLanguage();
  const [hintBefore, hintAfter] = t("market.publishHint").split("{{link}}");
  const user = currentUser();
  const [quizzes, setQuizzes] = useState([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState("");
  const [authorFilter, setAuthorFilter] = useState(null); // { id, name } oder null

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ search, sort });
    if (authorFilter) params.set("author_id", authorFilter.id);
    fetch(`${API}/marketplace?${params}`)
      .then((r) => r.ok ? r.json() : [])
      .then((d) => { setQuizzes(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [sort, authorFilter]);

  useEffect(() => {
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

  const copy = async (id, title) => {
    const res = await fetch(`${API}/marketplace/${id}/copy`, { method: "POST" });
    if (res.ok) { setMsg(t("market.added", { title })); setTimeout(() => setMsg(""), 4000); }
    else setMsg(t("market.adoptError"));
  };

  const remove = async (id) => {
    if (!confirm(t("market.removeConfirm"))) return;
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
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

      {loading ? (
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
                  {t("market.questionsBy", { count: q.question_count })}{" "}
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
                <button onClick={() => copy(q.id, q.title)} style={{ padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "var(--text)", color: "var(--bg)", border: "none", borderRadius: 980, whiteSpace: "nowrap" }}>{t("market.adopt")}</button>
                {(user && (user.id === q.author_id || user.id === 1)) && (
                  <button onClick={() => remove(q.id)} title={t("market.removeTitle")} style={{ padding: 7, background: "none", border: "1px solid var(--border2)", borderRadius: 980, cursor: "pointer", color: "#d1350f", display: "flex", alignItems: "center" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>
                  </button>
                )}
              </div>
            </div>
            {q.description && <p style={{ fontSize: 13, color: "var(--text2)", margin: "6px 0 10px", lineHeight: 1.5 }}>{q.description}</p>}
            <Stars value={q.avg_rating} my={q.my_rating} count={q.rating_count} onRate={(n) => rate(q.id, n)} t={t} />
          </div>
        ))
      )}

      {preview && (
        <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 200 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 20, maxWidth: 560, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 24, border: "1px solid var(--border)" }}>
            {preview.loading ? (
              <p style={{ color: "var(--text3)", fontSize: 14, margin: 0 }}>{t("common.loading")}</p>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
                  <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{preview.title}</h3>
                  <button onClick={() => setPreview(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", padding: 4, display: "flex" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16 }}>
                  {t("market.questionsBy", { count: preview.question_count })}{" "}
                  {preview.author_id ? (
                    <button onClick={() => { setAuthorFilter({ id: preview.author_id, name: preview.author_name || t("market.unknown") }); setPreview(null); }}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent)", fontSize: 12, fontWeight: 500 }}>
                      {preview.author_name}
                    </button>
                  ) : preview.author_name}
                </div>
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
                          <div key={k} style={{ fontSize: 13, color: isCorrect ? "#0a7d3e" : "var(--text2)", fontWeight: isCorrect ? 600 : 400, display: "flex", gap: 6, minWidth: 0, alignItems: "flex-start" }}>
                            <span style={{ fontWeight: 700, flexShrink: 0 }}>{k}</span>
                            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{(q.choices && q.choices[k]) || "–"}</span>
                            {isCorrect && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a7d3e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}><path d="M20 6L9 17l-5-5"/></svg>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                  <button onClick={() => { copy(preview.id, preview.title); setPreview(null); }} style={{ padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--text)", color: "var(--bg)", border: "none", borderRadius: 980 }}>{t("market.adopt")}</button>
                  <button onClick={() => setPreview(null)} style={{ padding: "10px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer", background: "var(--card)", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 980 }}>{t("common.close")}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
