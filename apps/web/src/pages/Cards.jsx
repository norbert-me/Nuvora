// Modul CardVote: Karten und Auswertung je Klasse.
//
// Diese Seite gehoert bewusst dem Modul, nicht dem Kern. Die Klassen selbst
// liegen im Kern (/classes) — hier steht nur, was CardVote mit ihnen tut:
// Karten drucken und auswerten. Frueher hingen beide Knoepfe an der
// Kern-Klassenseite; damit trug der Kern Modulwissen (Regel 3 in CLAUDE.md).
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon, ICONS, iconBtn, pageTitle } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api";

export default function Cards() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [kurse, setKurse] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API}/classes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setClasses(Array.isArray(d) ? d : []))
      .catch(() => setClasses([]))
      .finally(() => setLoaded(true));
    fetch(`${API}/kurse`).then((r) => (r.ok ? r.json() : [])).then((d) => setKurse(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const download = async (url, filename) => {
    const r = await fetch(url);
    if (!r.ok) return;
    const b = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <h1 style={pageTitle}>{t("cards.title")}</h1>
      <p style={{ color: "var(--text2)", marginBottom: 20, fontSize: 14 }}>
        {t("cards.intro").split("{{link}}")[0]}<Link to="/classes" style={{ color: "var(--accent)" }}>{t("nav.classes")}</Link>{t("cards.intro").split("{{link}}")[1]}
      </p>

      {!loaded && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("common.loading2")}</p>}
      {loaded && classes.length === 0 && (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>
          {t("cards.empty").split("{{link}}")[0]}<Link to="/classes" style={{ color: "var(--accent)" }}>{t("nav.classes")}</Link>{t("cards.empty").split("{{link}}")[1]}
        </p>
      )}

      {(() => {
        const row = (cls) => (
          <div key={cls.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", marginBottom: 10, border: "1px solid var(--border)", borderRadius: 16, background: "var(--card)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <strong style={{ fontSize: 16, color: "var(--text)" }}>{cls.name}</strong>
              <span style={{ color: "var(--text3)", fontSize: 13 }}>{cls.students.length} {t("classes.learners")}</span>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button onClick={() => download(`${API}/classes/${cls.id}/cards-pdf`, `CardVote_${cls.name}.pdf`)} className="icon-btn" style={iconBtn} title={t("classes.printCards")}>
                <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" />
                </svg>
              </button>
            </div>
          </div>
        );
        const groups = kurse.map((k) => {
          const ids = new Set((k.classes || []).filter((c) => c.shared).map((c) => c.id));
          return { name: k.name, list: classes.filter((c) => ids.has(c.id)) };
        }).filter((g) => g.list.length);
        const grouped = new Set(groups.flatMap((g) => g.list.map((c) => c.id)));
        const rest = classes.filter((c) => !grouped.has(c.id));
        if (rest.length) groups.push({ name: null, list: rest });
        return groups.map((g, gi) => (
          <div key={gi}>
            {g.name && g.list.length > 1 && <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text3)", margin: "6px 0 6px" }}>{g.name}</div>}
            {g.list.map(row)}
          </div>
        ));
      })()}
    </div>
  );
}
