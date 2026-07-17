import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon, ICONS, iconBtn, COLORS as C } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api";

export default function Tests() {
  const { t, lang } = useLanguage();
  const [sessions, setSessions] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState(false);

  const load = () => {
    const timer = setTimeout(() => setError(true), 15000);
    fetch(`${API}/sessions-list${showArchived ? "?archived=true" : "?archived=false"}`)
      .then((r) => r.json())
      .then((d) => { setSessions(d); clearTimeout(timer); setError(false); })
      .catch(() => setError(true));
  };
  useEffect(() => { load(); }, [showArchived]);

  const remove = async (id) => {
    if (!confirm(t("tests.deleteConfirm"))) return;
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

  if (error && sessions.length === 0) return <p style={{ color: "#d1350f" }}>{t("common.connectionError")}</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 24 }}>
        <button
          onClick={() => setShowArchived(!showArchived)}
          style={{
            padding: "6px 14px", fontSize: 13, fontWeight: 500, cursor: "pointer",
            background: showArchived ? "var(--text)" : "var(--bg2)",
            color: showArchived ? "var(--bg)" : "var(--text2)",
            border: "none", borderRadius: 980, transition: "all 0.15s",
          }}
        >
          {showArchived ? t("tests.showActive") : t("tests.archive")}
        </button>
      </div>

      {sessions.length === 0 && <p style={{ color: "var(--text3)", fontSize: 14 }}>{showArchived ? t("tests.emptyArchived") : t("tests.emptyActive")}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sessions.map((s) => (
          <div key={s.id} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "14px 18px", background: "var(--card)", border: "1px solid var(--border)",
            borderRadius: 14, transition: "background 0.15s",
          }}>
            <Link to={`/evaluation/${s.id}`} style={{ flex: 1, textDecoration: "none", minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 15, marginBottom: 2 }}>
                {s.class_name || "–"}
                {s.set_name && <span style={{ fontWeight: 400, color: "var(--text2)", marginLeft: 8 }}>{s.set_name}</span>}
              </div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>{formatDate(s.created_at)}</div>
            </Link>
            <div style={{ display: "flex", gap: 4, flexShrink: 0, marginLeft: 12 }}>
              <button onClick={() => downloadXlsx(s)} className="icon-btn" style={iconBtn} title={t("tests.excel")}><Icon d={ICONS.download} /></button>
              <button onClick={() => toggleArchive(s.id)} className="icon-btn" style={iconBtn} title={s.archived ? t("tests.restore") : t("tests.archiveAction")}>
                <Icon d={s.archived ? ICONS.restore : ICONS.archive} />
              </button>
              <button onClick={() => remove(s.id)} className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
