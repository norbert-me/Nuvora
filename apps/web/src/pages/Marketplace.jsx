import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { askConfirm } from "../core/dialog.jsx";
import { useAktiv } from "../core/modules.js";
import { istAdmin } from "../core/admin.js";
import { useLanguage } from "../i18n/index.jsx";
import { Icon, ICONS, Modal, Tabs, btnPrimary, btnSecondary, btnSmall, cardStyle, chipStyle, panelStyle, sectionLabel, toolbarInput, iconBtn, COLORS as C, pageApp } from "../components/Icons.jsx";
import Werkzeugleiste, { MehrMenu } from "../components/Werkzeugleiste.jsx";
import Speicherleiste, { useEntwurf } from "../components/Speichern.jsx";

const API = "/api";

function currentUser() {
  try { return JSON.parse(localStorage.getItem("user")); } catch { return null; }
}

/**
 * Bewertung eines Eintrags — eine Aenderung wie jede andere, also mit
 * Speichern. Der Entwurf haengt am EINZELNEN Eintrag: bewertet wird ein Werk,
 * nicht die Liste, und zwei Eintraege gleichzeitig bewertet niemand.
 */
function Bewertung({ q, onRate, t }) {
  // Stabile Kennung: ein bei jedem Rendern neues Objekt wuerde die Arbeitskopie
  // in einer Schleife zuruecksetzen.
  const gespeichert = useMemo(() => ({ stars: q.my_rating || 0 }), [q.my_rating]);
  const e = useEntwurf(gespeichert, async (wert) => {
    if (!wert.stars) return false;
    return await onRate(wert.stars);
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <Stars value={q.avg_rating} my={e.wert.stars} count={q.rating_count}
        onRate={(n) => e.setz({ stars: n })} t={t} />
      <Speicherleiste entwurf={e} klein />
    </div>
  );
}

function Stars({ value, my, onRate, count, t }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ display: "flex", gap: 1 }}>
        {[1, 2, 3, 4, 5].map((n) => {
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
              {/* Roh statt <Icon>: ein Bewertungsstern muss GEFUELLT sein, und
                  `Icon` kann nur Striche zeichnen. Die Farbe kommt trotzdem
                  aus dem Kern. */}
              <svg width="18" height="18" viewBox="0 0 24 24"
                fill={(hover ? n <= hover : filled) ? (my ? C.warning : "var(--text2)") : "none"}
                stroke={(my && !hover) ? C.warning : "var(--text3)"} strokeWidth="1.5" strokeLinejoin="round">
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

// Welche Art gehoert welchem Modul (wortgleich zu ART_MODUL im Backend).
// Ohne aktives Modul kann man mit einer Uebernahme nichts anfangen — sie landet
// in einer Oberflaeche, die gar nicht da ist (Regel 3).
const ART_MODUL = {
  cardvote_questionset: "cardvote",
  karten_deck: "karten",
  method: "unterrichtsplanung",
  lernpfad_ladder: "lernpfad",
};

export default function Marketplace({ fixedKind }) {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const artNutzbar = (k) => !ART_MODUL[k] || aktiv(ART_MODUL[k]);
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
    const r = await fetch(`${API}/marketplace/${id}/rate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stars }),
    }).catch(() => null);
    if (!r || !r.ok) return false;
    setQuizzes((prev) => prev.map((q) => q.id === id ? { ...q, my_rating: stars } : q));
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
    <div style={{ ...pageApp }}>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 24px" }}>
        {hintBefore}<a href="/questions" style={{ color: "var(--accent)", textDecoration: "none" }}>{t("market.publishHintLink")}</a>{hintAfter}
      </p>

      {msg && <div style={{ ...panelStyle, padding: "10px 14px", marginBottom: 12, fontSize: 14, color: "var(--text)" }}>{msg}</div>}

      {authorFilter && (
        <div style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 14px", fontSize: 13, color: "var(--text2)" }}>
          {t("market.filterBy")} <strong style={{ color: "var(--text)" }}>{authorFilter.name}</strong>
          <button onClick={() => setAuthorFilter(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--text3)", display: "flex", alignItems: "center", padding: 2 }} title={t("market.clearFilter")}>
            <Icon d={ICONS.close} size={16} color="currentColor" />
          </button>
        </div>
      )}

      {/* Eine Leiste statt zweier Zeilen: Art, Suche und Sortierung gehoeren zu
          derselben Frage („was will ich sehen?"). Die Reiter behalten ihre
          Leistenhoehe — `height: auto` hat sie vorher aus der Reihe gehoben. */}
      <Werkzeugleiste
        style={{ marginBottom: 16 }}
        links={!lockedKind && (
          <Tabs value={kind} onChange={setKind}
            options={[["", t("market.kindAll")], ["cardvote_questionset", t("market.kindQuiz")], ["karten_deck", t("market.kindDeck")], ["method", t("market.kindMethod")], ["lernpfad_ladder", t("market.kindLadder")]]
              .filter(([k]) => artNutzbar(k))} />
        )}
        ansicht={<Tabs value={sort} onChange={setSort} options={[["newest", t("market.newest")], ["top", t("market.topRated")]]} />}
      >
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("market.searchPlaceholder")}
          style={{ ...toolbarInput, width: 240, maxWidth: "100%" }} />
      </Werkzeugleiste>

      {loading && quizzes.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("common.loading")}</p>
      ) : quizzes.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{authorFilter ? t("market.emptyFiltered") : search ? t("market.emptySearch") : t("market.emptyNone")}</p>
      ) : (
        quizzes.map((q) => (
          <div key={q.id} style={{ ...cardStyle, padding: "16px 18px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 6 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
                  {q.title}
                  {/* Schon in der Übersicht sichtbar: das Quiz differenziert nach E/G. */}
                  {q.niveau_aktiv && (
                    <span style={{ ...chipStyle, marginLeft: 8, background: "var(--accent-bg)", color: "var(--accent)", verticalAlign: "middle" }}>
                      {t("market.badgeNiveau")}
                    </span>
                  )}
                  {q.minuspunkte && (
                    <span style={{ ...chipStyle, marginLeft: 8, verticalAlign: "middle" }}>
                      {t("market.badgeMinus")}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                  {countLabel(q)}{" "}
                  {q.author_id ? (
                    <button onClick={() => setAuthorFilter({ id: q.author_id, name: q.author_name || t("market.unknown") })}
                      style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--accent)", fontSize: 12, fontWeight: 500 }}>
                      {q.author_name || t("market.unknown")}
                    </button>
                  ) : (q.author_name || t("market.unknown"))}
                  {user && istAdmin(user) && q.author_email && (
                    <span style={{ ...chipStyle, marginLeft: 8, fontWeight: 500 }} title={t("market.adminOnly")}>{q.author_email}</span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => openPreview(q.id)} style={{ ...btnSecondary, ...btnSmall, whiteSpace: "nowrap" }}>{t("market.preview")}</button>
                {/* Ansehen darf jeder — uebernehmen nur, wer das Modul hat:
                    der Inhalt landet sonst in einer Oberflaeche, die fehlt. */}
                {artNutzbar(q.kind) ? (
                  <button onClick={() => copy(q)} style={{ ...btnPrimary, ...btnSmall, whiteSpace: "nowrap" }}>{t("market.adopt")}</button>
                ) : (
                  <Link to="/modules" style={{ ...btnSecondary, ...btnSmall, whiteSpace: "nowrap", textDecoration: "none", color: "var(--text3)" }}
                    title={t("market.needsModuleHint")}>{t("market.needsModule")}</Link>
                )}
                {/* Loeschen steht NICHT neben „Uebernehmen": ein Papierkorb
                    direkt an der Haupt-Aktion wird irgendwann getroffen. */}
                {(user && (user.id === q.author_id || istAdmin(user))) && (
                  <MehrMenu eintraege={[{ key: "remove", label: t("market.removeTitle"), icon: ICONS.trash, gefahr: true, onClick: () => remove(q.id) }]} />
                )}
              </div>
            </div>
            {q.description && <p style={{ fontSize: 13, color: "var(--text2)", margin: "8px 0 12px", lineHeight: 1.5 }}>{q.description}</p>}
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <Bewertung q={q} onRate={(n) => rate(q.id, n)} t={t} />
              {q.copies > 0 && <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("market.copies", { n: q.copies })}</span>}
            </div>
          </div>
        ))
      )}

      {preview && (
        <Modal onClose={() => setPreview(null)} width={560} label={preview.title || t("nav.marketplace")}>
            {preview.loading ? (
              <p style={{ color: "var(--text3)", fontSize: 14, margin: 0 }}>{t("common.loading")}</p>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 4 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{preview.title}</h3>
                  <button onClick={() => setPreview(null)} className="icon-btn" style={{ ...iconBtn, color: "var(--text3)" }} title={t("common.close")} aria-label={t("common.close")}>
                    <Icon d={ICONS.close} size={18} />
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
                {preview.description && <p style={{ fontSize: 14, color: "var(--text2)", margin: "0 0 12px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{preview.description}</p>}
                {preview.cards && preview.cards.length > 0 && (
                  <div style={{ ...sectionLabel, display: "flex", gap: 12, paddingBottom: 4 }}>
                    <span style={{ flex: 1 }}>{t("karten.front")}</span>
                    <span style={{ flex: 1 }}>{t("karten.back")}</span>
                  </div>
                )}
                {(preview.cards || []).map((c, i) => (
                  <div key={i} style={{ padding: "8px 0", borderTop: "1px solid var(--border)", display: "flex", gap: 12, fontSize: 14 }}>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: "var(--text)", overflowWrap: "anywhere" }}>{c.front}</span>
                    <span style={{ flex: 1, minWidth: 0, color: "var(--text2)", overflowWrap: "anywhere" }}>{c.back}</span>
                  </div>
                ))}
                {preview.method && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, fontSize: 14, color: "var(--text2)" }}>
                    {preview.method.dauer != null && <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 700, color: C.info }}>{t("methoden.dauerBadge", { n: preview.method.dauer })}</div>}
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{preview.method.description}</div>
                    {preview.method.ablauf && <div style={{ marginTop: 12 }}><b style={{ color: "var(--text3)", fontSize: 12 }}>{t("methoden.ablauf")}</b><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{preview.method.ablauf}</div></div>}
                    {preview.method.material && <div style={{ marginTop: 12 }}><b style={{ color: "var(--text3)", fontSize: 12 }}>{t("methoden.material")}</b><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{preview.method.material}</div></div>}
                  </div>
                )}
                {preview.ladder && (
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, fontSize: 14, color: "var(--text2)" }}>
                    {preview.ladder.topic_name && <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 700, color: C.info }}>{preview.ladder.topic_name}</div>}
                    {(preview.ladder.exercises || []).map((e, i) => (
                      <div key={i} style={{ padding: "8px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                        {e.kategorie && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", marginRight: 6 }}>{e.kategorie}</span>}
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
                            {isCorrect && <Icon d={ICONS.check} size={16} color={C.success} style={{ marginTop: 1 }} />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  {artNutzbar(preview.kind) ? (
                    <button onClick={() => { const p = preview; setPreview(null); copy(p); }} style={{ ...btnPrimary, padding: "10px 20px" }}>{t("market.adopt")}</button>
                  ) : (
                    <Link to="/modules" style={{ ...btnSecondary, padding: "10px 20px", textDecoration: "none" }}>{t("market.needsModule")}</Link>
                  )}
                  <button onClick={() => setPreview(null)} style={{ ...btnSecondary, padding: "10px 20px" }}>{t("common.close")}</button>
                </div>
              </>
            )}
        </Modal>
      )}

      {copyDeckFor && (
        <Modal onClose={() => setCopyDeckFor(null)} width={400} label={t("market.chooseClass")}>
            <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{t("market.chooseClass")}</h3>
            <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 12px" }}>{t("market.chooseClassHint", { title: copyDeckFor.title })}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflow: "auto" }}>
              {classes.map((c) => (
                <button key={c.id} onClick={() => copy({ id: copyDeckFor.id, title: copyDeckFor.title, kind: "karten_deck" }, c.id)}
                  style={{ ...btnSecondary, textAlign: "left", padding: "10px 12px", background: "var(--bg)" }}>{c.name}</button>
              ))}
            </div>
            <button onClick={() => setCopyDeckFor(null)} style={{ ...btnSecondary, marginTop: 12 }}>{t("common.abort")}</button>
        </Modal>
      )}
    </div>
  );
}
