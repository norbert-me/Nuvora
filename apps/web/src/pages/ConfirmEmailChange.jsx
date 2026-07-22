import { useState, useEffect } from "react";
import { COLORS as C } from "../components/Icons.jsx";

import { useLanguage } from "../i18n/index.jsx";

const API = "/api";

export default function ConfirmEmailChange() {
  const { t } = useLanguage();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [state, setState] = useState("loading"); // loading | ok | error
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) { setState("error"); return; }
    fetch(`${API}/auth/confirm-email-change`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).then(async (r) => {
      if (r.ok) { setState("ok"); return; }
      const d = await r.json().catch(() => ({}));
      setError(d.detail || "Bestätigung fehlgeschlagen.");
      setState("error");
    }).catch(() => setState("error"));
  }, [token]);

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
      <div style={{ width: "100%", maxWidth: 380, padding: "32px 36px", background: "var(--card)", borderRadius: 20, border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.06)", textAlign: "center" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: "0 0 16px" }}>CardVote</h2>
        {state === "loading" && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("emailchange.inProgress")}</p>}
        {state === "ok" && (
          <>
            <div style={{ color: C.success, fontSize: 15, fontWeight: 600, marginBottom: 16 }}>{t("emailchange.ok")}</div>
            <a href="/login" style={btnPrimary}>{t("verify.toLogin")}</a>
          </>
        )}
        {state === "error" && (
          <>
            <div style={{ color: C.danger, fontSize: 14, marginBottom: 16 }}>{error || t("emailchange.failed")}</div>
            <a href="/profile" style={{ color: "var(--accent)", fontSize: 14, textDecoration: "none" }}>{t("emailchange.backToProfile")}</a>
          </>
        )}
      </div>
    </div>
  );
}

const btnPrimary = {
  display: "inline-block", padding: "12px 24px", fontSize: 15, fontWeight: 600,
  background: "var(--text)", color: "var(--bg)", border: "none", borderRadius: 980,
  cursor: "pointer", textDecoration: "none",
};
