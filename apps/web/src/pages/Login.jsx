import { useState, useEffect } from "react";
import { COLORS as C } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api";

export default function Login({ onLogin }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState("login");
  const [message, setMessage] = useState("");
  const [showResend, setShowResend] = useState(false);

  const resendVerification = async () => {
    setMessage(""); setError("");
    try {
      await fetch(`${API}/auth/resend-verification`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setShowResend(false);
      setMessage(t("login.resendSuccess"));
    } catch { setError(t("login.connectionError")); }
  };

  useEffect(() => {
    const resetMode = () => { setMode("login"); setError(""); setMessage(""); };
    window.addEventListener("cardvote:reset-login-mode", resetMode);
    return () => window.removeEventListener("cardvote:reset-login-mode", resetMode);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (mode === "forgot") {
      try {
        await fetch(`${API}/auth/forgot-password`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        setMessage(t("login.forgotSuccess"));
      } catch { setError(t("login.connectionError")); }
      return;
    }

    const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
    const body = mode === "login" ? { email, password } : { email, password };
    try {
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || t("login.genericError"));
        setShowResend(mode === "login" && res.status === 403);
        return;
      }
      if (mode === "register") {
        // Kein Auto-Login: zur Anmeldung wechseln
        setMode("login");
        setPassword("");
        setMessage(t("login.registerSuccess"));
        return;
      }
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      onLogin(data.user);
    } catch { setError(t("login.connectionError")); }
  };

  const subtitle = mode === "login" ? t("login.signIn") : mode === "register" ? t("login.createAccount") : t("login.resetPassword");

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
      <div style={{ width: "100%", maxWidth: 380, padding: "32px 36px", background: "var(--card)", borderRadius: 20, border: "1px solid var(--border)", boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", textAlign: "center", margin: "0 0 4px" }}>CardVote</h2>
        <p style={{ color: "var(--text3)", fontSize: 14, textAlign: "center", marginBottom: 24, marginTop: 4 }}>
          {subtitle}
        </p>

        <form onSubmit={submit}>
          <input type="email" placeholder={t("login.email")} value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoFocus required />
          {mode !== "forgot" && (
            <input type="password" placeholder={t("login.password")} value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} required />
          )}

          {error && <div style={{ color: C.danger, fontSize: 13, marginBottom: 12 }}>{error}</div>}
          {showResend && (
            <button type="button" onClick={resendVerification} style={{ ...linkBtn, marginBottom: 12, display: "block" }}>{t("login.resendVerification")}</button>
          )}
          {message && <div style={{ color: C.success, fontSize: 13, marginBottom: 12 }}>{message}</div>}

          <button type="submit" style={btnPrimary}>
            {mode === "login" ? t("login.submitLogin") : mode === "register" ? t("login.submitRegister") : t("login.submitForgot")}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          {mode === "login" && (
            <>
              <button onClick={() => { setMode("register"); setError(""); setMessage(""); }} style={linkBtn}>{t("login.createAccountLink")}</button>
              <button onClick={() => { setMode("forgot"); setError(""); setMessage(""); }} style={{ ...linkBtn, fontSize: 13, color: "var(--text3)" }}>{t("login.forgotPassword")}</button>
            </>
          )}
          {mode !== "login" && (
            <button onClick={() => { setMode("login"); setError(""); setMessage(""); }} style={linkBtn}>{t("login.backToLogin")}</button>
          )}
        </div>
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

const linkBtn = {
  background: "none", border: "none", color: "var(--accent)", fontSize: 14,
  cursor: "pointer", fontWeight: 500,
};
