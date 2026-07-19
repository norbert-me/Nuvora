// Module zuschalten und abschalten. Abschalten blendet nur aus — die Daten
// des Moduls bleiben im Kern liegen und sind nach dem Wiedereinschalten da.
import { useState } from "react";
import { useModules } from "../core/modules.js";
import { StageBadge, Tabs } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { pageTitle } from "../components/Icons.jsx";

export default function Modules() {
  const { t } = useLanguage();
  const { modules, loading, toggle } = useModules();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState("popular"); // popular | name | status
  const [dir, setDir] = useState("asc");           // asc | desc

  if (loading) return null;

  const dispName = (m) => (t(`mod.${m.key}.name`) !== `mod.${m.key}.name` ? t(`mod.${m.key}.name`) : m.name);
  // Neuer Nutzer ohne aktives Modul: nach Beliebtheit vorsortieren, damit der
  // Einstieg nicht bei einer alphabetischen Wand aus 12 Namen beginnt.
  const noneActive = modules.every((m) => !m.active);
  const effKey = sortKey === "name" && noneActive ? "popular" : sortKey;
  // „Beliebt" = die meistgenutzten Module (Top 5 mit >0 Aktivierungen).
  const beliebt = new Set([...modules].filter((m) => m.popularity > 0)
    .sort((a, b) => b.popularity - a.popularity).slice(0, 5).map((m) => m.key));
  const sorted = [...modules].sort((a, b) => {
    // Status aufsteigend = aktive zuerst; bei Gleichstand alphabetisch.
    const r = effKey === "status"
      ? (a.active === b.active ? dispName(a).localeCompare(dispName(b)) : (a.active ? -1 : 1))
      : effKey === "popular"
        ? ((b.popularity || 0) - (a.popularity || 0)) || dispName(a).localeCompare(dispName(b))
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

      {noneActive && beliebt.size > 0 && (
        <p style={{ fontSize: 13.5, color: "var(--text2)", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
          {t("modules.startHint")}
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 12.5, color: "var(--text3)" }}>{t("modules.sortBy")}</span>
        <Tabs value={effKey} onChange={setSortKey}
          options={[["name", t("modules.sortName")], ["status", t("modules.sortStatus")], ["popular", t("modules.sortPopular")]]} />
        <button onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))} title={t("modules.sortDir")}
          style={{ padding: "5px 12px", fontSize: 14, fontWeight: 700, border: "1px solid var(--border2)", borderRadius: 980, cursor: "pointer", background: "transparent", color: "var(--text2)" }}>
          {dir === "asc" ? "↑" : "↓"}
        </button>
      </div>

      {[["unterricht", t("modules.groupUnterricht")], ["organisation", t("modules.groupOrganisation")], ["werkzeug", t("modules.groupWerkzeug")]].map(([g, label]) => {
        const mods = sorted.filter((m) => (m.group || "werkzeug") === g);
        if (!mods.length) return null;
        return (
        <div key={g} style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--text3)", margin: "0 0 10px" }}>{label}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {mods.map((m) => (
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
                {beliebt.has(m.key) && !m.active && (
                  <span title={t("modules.popularHint", { n: m.popularity })} style={{ fontSize: 11, fontWeight: 700, color: "#0a7d3e", background: "rgba(10,125,62,0.12)", padding: "2px 8px", borderRadius: 980, marginLeft: 8 }}>
                    {t("modules.popularBadge")}
                  </span>
                )}
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
      })}
    </div>
  );
}
