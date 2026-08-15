// Modul CardVote: Karten und Auswertung je Klasse.
//
// Diese Seite gehoert bewusst dem Modul, nicht dem Kern. Die Klassen selbst
// liegen im Kern (/classes) — hier steht nur, was CardVote mit ihnen tut:
// Karten drucken und auswerten. Frueher hingen beide Knoepfe an der
// Kern-Klassenseite; damit trug der Kern Modulwissen (Regel 3 in CLAUDE.md).
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon, ICONS, iconBtn, cardStyle, sectionLabel, pageApp } from "../components/Icons.jsx";
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
    <div style={{ ...pageApp }}>
      <p style={{ color: "var(--text2)", marginBottom: 24, fontSize: 14 }}>
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
          <div key={cls.id} style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <strong style={{ fontSize: 16, color: "var(--text)" }}>{cls.name}</strong>
              <span style={{ color: "var(--text3)", fontSize: 13 }}>{cls.students.length} {t("classes.learners")}</span>
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button onClick={() => download(`${API}/classes/${cls.id}/cards-pdf`, `CardVote_${cls.name}.pdf`)} className="icon-btn" style={iconBtn} title={t("classes.printCards")} aria-label={t("classes.printCards")}>
                <Icon d={ICONS.print} size={19} />
              </button>
            </div>
          </div>
        );
        const groups = kurse.map((k) => {
          const ids = new Set((k.classes || []).map((c) => c.id));
          return { name: k.name, list: classes.filter((c) => ids.has(c.id)) };
        }).filter((g) => g.list.length);
        const grouped = new Set(groups.flatMap((g) => g.list.map((c) => c.id)));
        const rest = classes.filter((c) => !grouped.has(c.id));
        if (rest.length) groups.push({ name: null, list: rest });
        return groups.map((g, gi) => (
          <div key={gi}>
            {g.name && g.list.length > 1 && <div style={{ ...sectionLabel, margin: "8px 0" }}>{g.name}</div>}
            {g.list.map(row)}
          </div>
        ));
      })()}
    </div>
  );
}
