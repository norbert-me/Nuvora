import { useState } from "react";
import { COLORS as C, cardStyle, inputStyle as feld, btnPrimary as knopf, pageForm, SHADOW } from "../components/Icons.jsx";

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
    <div style={{ ...pageForm, padding: "24px 0" }}>
      <div style={{ ...cardStyle, padding: 24, boxShadow: SHADOW.ruhig }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", textAlign: "center", margin: "0 0 4px" }}>CardVote</h2>
        <p style={{ color: "var(--text3)", fontSize: 14, textAlign: "center", marginBottom: 24, marginTop: 4 }}>{t("reset.title")}</p>

        {!token ? (
          <div style={{ color: C.danger, fontSize: 14, textAlign: "center" }}>{t("reset.noToken")}</div>
        ) : done ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ color: C.success, fontSize: 14, marginBottom: 16 }}>
              {t("reset.done")}
            </div>
            <a href="/login" style={{ ...btnPrimary, display: "inline-block", textDecoration: "none", textAlign: "center", boxSizing: "border-box" }}>{t("verify.toLogin")}</a>
          </div>
        ) : (
          <form onSubmit={submit}>
            <input type="password" placeholder={t("reset.pw")} value={pw} onChange={(e) => setPw(e.target.value)} style={inputStyle} autoFocus required />
            <input type="password" placeholder={t("reset.pw2")} value={pw2} onChange={(e) => setPw2(e.target.value)} style={inputStyle} required />
            {error && <div style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{error}</div>}
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

// Formularseite: volle Breite, sonst aus der Design-Quelle abgeleitet.
const inputStyle = { ...feld, display: "block", width: "100%", marginBottom: 12 };

const btnPrimary = { ...knopf, width: "100%", padding: 12, fontSize: 16 };
