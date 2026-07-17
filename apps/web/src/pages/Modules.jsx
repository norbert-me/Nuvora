// Module zuschalten und abschalten. Abschalten blendet nur aus — die Daten
// des Moduls bleiben im Kern liegen und sind nach dem Wiedereinschalten da.
import { useState } from "react";
import { useModules } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";
import { pageTitle } from "../components/Icons.jsx";

export default function Modules() {
  const { t } = useLanguage();
  const { modules, loading, toggle } = useModules();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState("");

  if (loading) return null;

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
    <div style={{ maxWidth: 720 }}>
      <h1 style={pageTitle}>{t("modules.title")}</h1>
      <p style={{ color: "var(--text2)", marginBottom: 24, fontSize: 14 }}>
        Aktiviere, was du brauchst. Abschalten entfernt keine Daten — sie sind
        nach dem Wiedereinschalten wieder da.
      </p>

      {error && (
        <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 12 }}>{error}</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {modules.map((m) => (
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
                {m.name}
                {!m.available && (
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text3)", marginLeft: 8 }}>
                    {t("modules.notAvailable")}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.6 }}>
                {m.description}
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
