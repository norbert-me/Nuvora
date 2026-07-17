import { useState } from "react";

import { useLanguage } from "../i18n/index.jsx";

const API = "/api";

export default function ResetPassword() {
  const { t } = useLanguage();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (pw.length < 8) { setError(t("reset.tooShort")); return; }
    if (pw !== pw2) { setError(t("reset.mismatch")); return; }
    try {
      const res = await fetch(`${API}/auth/reset-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.detail || t("reset.error")); return; }
      setDone(true);
    } catch { setError(t("login.connectionError")); }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
      <div style={{ width: "100%", maxWidth: 380, padding: "32px 36px", background: "var(--card)", borderRadius: 20, border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", textAlign: "center", margin: "0 0 4px" }}>CardVote</h2>
        <p style={{ color: "var(--text3)", fontSize: 14, textAlign: "center", marginBottom: 24, marginTop: 4 }}>{t("reset.title")}</p>

        {!token ? (
          <div style={{ color: "#d1350f", fontSize: 14, textAlign: "center" }}>{t("reset.noToken")}</div>
        ) : done ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ color: "#0a7d3e", fontSize: 14, marginBottom: 16 }}>
              {t("reset.done")}
            </div>
            <a href="/login" style={{ ...btnPrimary, display: "inline-block", textDecoration: "none", textAlign: "center", boxSizing: "border-box" }}>{t("verify.toLogin")}</a>
          </div>
        ) : (
          <form onSubmit={submit}>
            <input type="password" placeholder={t("reset.pw")} value={pw} onChange={(e) => setPw(e.target.value)} style={inputStyle} autoFocus required />
            <input type="password" placeholder={t("reset.pw2")} value={pw2} onChange={(e) => setPw2(e.target.value)} style={inputStyle} required />
            {error && <div style={{ color: "#d1350f", fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <button type="submit" style={btnPrimary}>{t("reset.save")}</button>
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <a href="/login" style={{ color: "var(--accent)", fontSize: 13, textDecoration: "none" }}>{t("login.backToLogin")}</a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  display: "block", width: "100%", padding: "12px 14px", marginBottom: 12,
  border: "1px solid var(--border2)", borderRadius: 10, fontSize: 15, boxSizing: "border-box",
  background: "var(--bg)", color: "var(--text)",
};

const btnPrimary = {
  width: "100%", padding: "12px", fontSize: 15, fontWeight: 600,
  background: "var(--text)", color: "var(--bg)", border: "none", borderRadius: 980,
  cursor: "pointer", letterSpacing: "-0.2px",
};
