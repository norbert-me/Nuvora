// Tutorial für Nuvora — führt durch Kern und Module, jederzeit neu startbar.
//
// Bewusst kein Overlay über der App: Overlays verdecken genau das, was sie
// erklären, und lassen sich nicht nebenher lesen. Stattdessen eine eigene
// Seite mit Links in die echten Bereiche — wer abbricht, findet den Stand
// wieder, weil der Fortschritt im Konto-Browser gemerkt wird.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { btnPrimary, btnSecondary, pageTitle } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const STORAGE_KEY = "nuvora_tutorial_done";

const BEREICHE = [
  { key: "willkommen", ziel: "/modules" },
  { key: "klasse", ziel: "/classes" },
  { key: "themen", ziel: "/topics" },
  { key: "module", ziel: "/modules" },
  { key: "loslegen", ziel: "/modules" },
];

export default function Tutorial() {
  const { t } = useLanguage();
  const [done, setDone] = useState({});
  const [offen, setOffen] = useState(BEREICHE[0].key);

  useEffect(() => {
    try { setDone(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch { /* egal */ }
  }, []);

  const merke = (next) => {
    setDone(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* egal */ }
  };

  const toggle = (key) => merke({ ...done, [key]: !done[key] });
  const neu = () => { merke({}); setOffen(BEREICHE[0].key); };

  const kb = (b) => b.keyBase || b.key;
  const fertig = BEREICHE.filter((b) => done[b.key]).length;

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={pageTitle}>{t("tut.title")}</h1>
        <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("tut.progress", { n: fertig, total: BEREICHE.length })}</span>
        {fertig > 0 && (
          <button onClick={neu} style={{ marginLeft: "auto", ...btnSecondary }}>{t("tut.restart")}</button>
        )}
      </div>
      <p style={{ color: "var(--text2)", marginBottom: 22, fontSize: 14 }}>
{t("tut.intro")}
      </p>

      {BEREICHE.map((b, i) => {
        const auf = offen === b.key;
        const erledigt = !!done[b.key];
        return (
          <div key={b.key} style={{ marginBottom: 10, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", overflow: "hidden" }}>
            <button
              onClick={() => setOffen(auf ? null : b.key)}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "14px 16px",
                background: "none", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)",
              }}
            >
              <span style={{
                width: 26, height: 26, borderRadius: 13, flexShrink: 0, fontSize: 13, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: erledigt ? "#0a7d3e" : "var(--bg)", color: erledigt ? "#fff" : "var(--text3)",
                border: erledigt ? "none" : "1px solid var(--border2)",
              }}>
                {erledigt ? "✓" : i + 1}
              </span>
              <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>{t(`tut.${kb(b)}.title`)}</span>
              <span style={{ color: "var(--text3)", fontSize: 12 }}>{auf ? "▾" : "▸"}</span>
            </button>

            {auf && (
              <div style={{ padding: "0 16px 16px 54px" }}>
                <ul style={{ margin: "0 0 14px", paddingLeft: 18, color: "var(--text2)", fontSize: 14, lineHeight: 1.75 }}>
{[1,2,3,4,5,6].map((k) => { const key = `tut.${kb(b)}.${k}`; const v = t(key); return v === key ? null : <li key={k}>{v}</li>; })}
                </ul>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link to={b.ziel} style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}>{t(`tut.${kb(b)}.goto`)}</Link>
                  <button onClick={() => toggle(b.key)} style={btnSecondary}>
                    {erledigt ? t("tut.reopen") : t("tut.done")}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

