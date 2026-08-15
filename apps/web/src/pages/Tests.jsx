import { useState, useEffect } from "react";
import { askConfirm } from "../core/dialog.jsx";
import { Link } from "react-router-dom";
import { Icon, ICONS, iconBtn, cardStyle, sectionLabel, Tabs, COLORS as C, pageApp } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api";

export default function Tests() {
  const { t, lang } = useLanguage();
  const [sessions, setSessions] = useState([]);
  const [classes, setClasses] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API}/classes`).then((r) => (r.ok ? r.json() : [])).then((d) => setClasses(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const load = () => {
    const timer = setTimeout(() => setError(true), 15000);
    fetch(`${API}/sessions-list${showArchived ? "?archived=true" : "?archived=false"}`)
      .then((r) => r.json())
      .then((d) => { setSessions(d); clearTimeout(timer); setError(false); })
      .catch(() => setError(true));
  };
  useEffect(() => { load(); }, [showArchived]);

  const remove = async (id) => {
    if (!await askConfirm(t("tests.deleteConfirm"))) return;
    await fetch(`${API}/sessions/${id}`, { method: "DELETE" });
    load();
  };

  const toggleArchive = async (id) => {
    await fetch(`${API}/sessions/${id}/archive`, { method: "POST" });
    load();
  };

  const downloadXlsx = async (s) => {
    const r = await fetch(`${API}/sessions/${s.id}/evaluation-xlsx`);
    if (!r.ok) return;
    const b = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = `Auswertung_${s.class_name || s.id}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const formatDate = (iso) => {
    if (!iso) return "–";
    const d = new Date(iso);
    return d.toLocaleDateString({ de: "de-DE", en: "en-GB", es: "es-ES" }[lang] || "de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  if (error && sessions.length === 0) return <p style={{ color: C.danger }}>{t("common.connectionError")}</p>;

  return (
    <div style={{ ...pageApp }}>
      {/* Oben: je Klasse die Gesamtauswertung. Darunter die einzelnen Quiz. */}
      {classes.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ ...sectionLabel, marginBottom: 12 }}>{t("tests.byClass")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {classes.map((c) => (
              <Link key={c.id} to={`/cardvote/class-evaluation/${c.id}`}
                style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", textDecoration: "none", color: "var(--text)" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Aktiv/Archiv ist ein Zwei-Zustands-Umschalter — also `Tabs`, nicht ein
          Knopf, der seine Beschriftung wechselt. */}
      <Werkzeugleiste
        links={<div style={sectionLabel}>{t("tests.quizzes")}</div>}
        ansicht={
          <Tabs
            value={showArchived ? "archiv" : "aktiv"}
            onChange={(v) => setShowArchived(v === "archiv")}
            options={[["aktiv", t("tests.showActive")], ["archiv", t("tests.archive")]]}
          />
        }
        style={{ marginBottom: 16 }}
      />

      {sessions.length === 0 && <p style={{ color: "var(--text3)", fontSize: 14 }}>{showArchived ? t("tests.emptyArchived") : t("tests.emptyActive")}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sessions.map((s) => (
          <div key={s.id} style={{
            ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: 16, transition: "background 0.15s",
          }}>
            <Link to={`/cardvote/evaluation/${s.id}`} style={{ flex: 1, textDecoration: "none", minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 16, marginBottom: 2 }}>
                {s.class_name || "–"}
                {s.set_name && <span style={{ fontWeight: 400, color: "var(--text2)", marginLeft: 8 }}>{s.set_name}</span>}
              </div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>{formatDate(s.created_at)}</div>
            </Link>
            <div style={{ display: "flex", gap: 4, flexShrink: 0, marginLeft: 12 }}>
              <button onClick={() => downloadXlsx(s)} className="icon-btn" style={iconBtn} title={t("tests.excel")} aria-label={t("tests.excel")}><Icon d={ICONS.download} /></button>
              <button onClick={() => toggleArchive(s.id)} className="icon-btn" style={iconBtn} title={s.archived ? t("tests.restore") : t("tests.archiveAction")}>
                <Icon d={s.archived ? ICONS.restore : ICONS.archive} />
              </button>
              <button onClick={() => remove(s.id)} className="icon-btn" style={iconBtn} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
