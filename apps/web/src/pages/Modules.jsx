// Module zuschalten und abschalten. Abschalten blendet nur aus — die Daten
// des Moduls bleiben im Kern liegen und sind nach dem Wiedereinschalten da.
import { useState } from "react";
import { useModules } from "../core/modules.js";
import { StageBadge } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { pageTitle } from "../components/Icons.jsx";

export default function Modules() {
  const { t } = useLanguage();
  const { modules, loading, toggle } = useModules();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState("name"); // name | status
  const [dir, setDir] = useState("asc");           // asc | desc

  if (loading) return null;

  const dispName = (m) => (t(`mod.${m.key}.name`) !== `mod.${m.key}.name` ? t(`mod.${m.key}.name`) : m.name);
  const sorted = [...modules].sort((a, b) => {
    // Status aufsteigend = aktive zuerst; bei Gleichstand alphabetisch.
    const r = sortKey === "status"
      ? (a.active === b.active ? dispName(a).localeCompare(dispName(b)) : (a.active ? -1 : 1))
      : dispName(a).localeCompare(dispName(b));
    return dir === "asc" ? r : -r;
  });

  const handle = async (m) => {
    setBusy(m.key);
    setError("");
    try {
      await toggle(m.key, !m.active);
    } catch (e) {
      setError(e.message || t("modules.error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1 style={pageTitle}>{t("modules.title")}</h1>
      <p style={{ color: "var(--text2)", marginBottom: 24, fontSize: 14 }}>
        Aktiviere, was du brauchst. Abschalten entfernt keine Daten — sie sind
        nach dem Wiedereinschalten wieder da.
      </p>

      {error && (
        <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 12 }}>{error}</p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("modules.sortBy")}</span>
        <div style={{ display: "inline-flex", border: "1px solid var(--border2)", borderRadius: 980, overflow: "hidden" }}>
          {[["name", t("modules.sortName")], ["status", t("modules.sortStatus")]].map(([k, label]) => (
            <button key={k} onClick={() => setSortKey(k)} style={{ padding: "5px 13px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: sortKey === k ? "var(--accent)" : "transparent", color: sortKey === k ? "#fff" : "var(--text2)" }}>{label}</button>
          ))}
        </div>
        <button onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))} title={t("modules.sortDir")}
          style={{ padding: "5px 12px", fontSize: 14, fontWeight: 700, border: "1px solid var(--border2)", borderRadius: 980, cursor: "pointer", background: "transparent", color: "var(--text2)" }}>
          {dir === "asc" ? "↑" : "↓"}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sorted.map((m) => (
          <div
            key={m.key}
            style={{
              border: "1px solid var(--border)", borderRadius: 14, padding: 18,
              background: "var(--surface)", display: "flex", alignItems: "flex-start",
              gap: 16,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                {t(`mod.${m.key}.name`) !== `mod.${m.key}.name` ? t(`mod.${m.key}.name`) : m.name}
                {" "}<StageBadge stage={m.stage} title={m.stage === "beta" ? t("stage.betaHint") : t("stage.alphaHint")} />
                {!m.available && (
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)", marginLeft: 8 }}>
                    {t("modules.notAvailable")}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.6 }}>
                {t(`mod.${m.key}.desc`) !== `mod.${m.key}.desc` ? t(`mod.${m.key}.desc`) : m.description}
              </div>
            </div>
            <button
              onClick={() => handle(m)}
              disabled={busy === m.key || !m.available}
              style={{
                flexShrink: 0, padding: "8px 16px", borderRadius: 980, fontSize: 13.5,
                fontWeight: 600, cursor: m.available ? "pointer" : "not-allowed",
                border: m.active ? "1px solid var(--border)" : "none",
                background: m.active ? "transparent" : "var(--accent)",
                color: m.active ? "var(--text2)" : "#fff",
                opacity: busy === m.key || !m.available ? 0.5 : 1,
              }}
            >
              {m.active ? t("modules.deactivate") : t("modules.activate")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
