import { useState } from "react";
import { COLORS as C } from "../components/Icons.jsx";

import { useLanguage } from "../i18n/index.jsx";

const API = "/api";

export default function Contact() {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSending(true);
    try {
      const res = await fetch(`${API}/contact`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.detail || t("contact.error")); setSending(false); return; }
      setSent(true);
    } catch { setError(t("login.connectionError")); setSending(false); }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
      <div style={{ width: "100%", maxWidth: 480, padding: "32px 36px", background: "var(--card)", borderRadius: 20, border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", textAlign: "center", margin: "0 0 4px" }}>{t("contact.title")}</h2>
        <p style={{ color: "var(--text3)", fontSize: 14, textAlign: "center", marginBottom: 24, marginTop: 4 }}>
          {t("contact.subtitle")}
        </p>

        {sent ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ color: C.success, fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{t("contact.sent")}</div>
            <p style={{ color: "var(--text3)", fontSize: 13 }}>{t("contact.sentThanks")}</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <input type="text" placeholder={t("contact.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            <input type="email" placeholder={t("contact.emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} required />
            <textarea placeholder={t("contact.messagePlaceholder")} value={message} onChange={(e) => setMessage(e.target.value)} rows={6}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} required maxLength={5000} />
            {error && <div style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{error}</div>}
            <button type="submit" disabled={sending} style={{ ...btnPrimary, opacity: sending ? 0.6 : 1 }}>
              {sending ? t("contact.sending") : t("contact.send")}
            </button>
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
