import { useState, useEffect } from "react";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api";

const Spinner = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "profspin 0.8s linear infinite", flexShrink: 0 }}>
    <style>{`@keyframes profspin{to{transform:rotate(360deg)}}`}</style>
    <path d="M21 12a9 9 0 1 1-6.2-8.5"/>
  </svg>
);

const TrashIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#d1350f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>
  </svg>
);

export default function Profile({ user, onLogout, onUserUpdate }) {
  const { t } = useLanguage();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");
  // Bestehende Werte unveraendert mitsenden — kein UI mehr dafuer, aber Backend braucht sie im Payload
  const name = user.name || "";
  const salutation = user.salutation || "Hr.";
  const [marketplaceName, setMarketplaceName] = useState(user.marketplace_name || "");
  const [profileMsg, setProfileMsg] = useState("");
  const DEFAULT_SCALE = { 1: 87, 2: 73, 3: 59, 4: 45, 5: 20, 6: 0 };
  const [gradeScale, setGradeScale] = useState(user.grade_scale || DEFAULT_SCALE);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminMsg, setAdminMsg] = useState("");
  const [versionInfo, setVersionInfo] = useState(null);
  const [versionLoading, setVersionLoading] = useState(true);
  const [adminUsersLoading, setAdminUsersLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [pendingEmail, setPendingEmail] = useState(user.pending_email || "");

  const token = localStorage.getItem("token");
  const isAdmin = user.id === 1;

  useEffect(() => {
    if (!isAdmin) return;
    fetch(`${API}/auth/admin/users`).then(r => r.ok ? r.json() : []).then(setAdminUsers).finally(() => setAdminUsersLoading(false));
    fetch(`${API}/version`).then(r => r.ok ? r.json() : null).then(setVersionInfo).catch(() => {}).finally(() => setVersionLoading(false));
  }, [isAdmin]);

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileMsg("");
    const res = await fetch(`${API}/auth/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, salutation, grade_scale: gradeScale, marketplace_name: marketplaceName }),
    });
    if (res.ok) {
      const data = await res.json();
      setProfileMsg(t("profile.saved"));
      const updated = { ...user, ...data };
      localStorage.setItem("user", JSON.stringify(updated));
      onUserUpdate?.(updated);
    } else {
      setProfileMsg(t("profile.saveError"));
    }
  };

  const changePw = async (e) => {
    e.preventDefault();
    setMsg("");
    const res = await fetch(`${API}/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.token) localStorage.setItem("token", data.token);
      setMsg(t("profile.pwChanged"));
      setOldPw("");
      setNewPw("");
    } else {
      const data = await res.json();
      setMsg(data.detail || t("login.genericError"));
    }
  };

  const changeEmail = async (e) => {
    e.preventDefault();
    setEmailMsg("");
    const res = await fetch(`${API}/auth/change-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ new_email: newEmail, password: emailPw }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setPendingEmail(data.pending_email || newEmail);
      setEmailMsg(t("profile.linkSent"));
      setEmailPw("");
      setShowEmailForm(false);
    } else {
      setEmailMsg(data.detail || t("login.genericError"));
    }
  };

  return (
    <div>

      <div style={{ padding: 24, background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)", marginBottom: 24 }}>
        <div style={{ fontSize: 15, color: "var(--text3)", marginBottom: 4 }}>{t("profile.email")}</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{user.email}</div>
        {pendingEmail && (
          <div style={{ fontSize: 12, color: "#b8860b", marginBottom: 8 }}>
            {t("profile.pending", { email: pendingEmail })}
          </div>
        )}
        {!showEmailForm ? (
          <button type="button" onClick={() => { setShowEmailForm(true); setEmailMsg(""); }} style={{ ...linkBtn, marginBottom: 16 }}>{t("profile.changeEmail")}</button>
        ) : (
          <form onSubmit={changeEmail} style={{ marginBottom: 16 }}>
            <input type="email" placeholder={t("profile.newEmail")} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} style={inputStyle} required />
            <input type="password" placeholder={t("profile.currentPw")} value={emailPw} onChange={(e) => setEmailPw(e.target.value)} style={inputStyle} required />
            <p style={{ fontSize: 12, color: "var(--text3)", margin: "0 0 10px" }}>
              {t("profile.emailInfo")}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" style={btnPrimary}>{t("profile.sendLink")}</button>
              <button type="button" onClick={() => setShowEmailForm(false)} style={btnSecondary}>{t("common.cancel")}</button>
            </div>
          </form>
        )}
        {emailMsg && <div style={{ fontSize: 13, color: emailMsg === t("profile.linkSent") ? "#0a7d3e" : "#d1350f", marginBottom: 16 }}>{emailMsg}</div>}

        <form onSubmit={saveProfile}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>{t("profile.username")}</div>
          <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
            {t("profile.usernameHint")}
          </p>
          <input placeholder={t("profile.usernamePlaceholder")} value={marketplaceName} onChange={(e) => setMarketplaceName(e.target.value)}
            style={{ ...inputStyle, marginBottom: 10 }} />

          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginTop: 20, marginBottom: 10 }}>{t("profile.gradeScale")}</div>
          <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
            {t("profile.gradeScaleHint")}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            {[1, 2, 3, 4, 5].map((g) => (
              <div key={g} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, width: 16 }}>{g}</span>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>{t("profile.from")}</span>
                <input
                  type="number" min="0" max="100" step="1"
                  value={gradeScale[g]}
                  onChange={(e) => setGradeScale({ ...gradeScale, [g]: Math.max(0, Math.min(100, Number(e.target.value))) })}
                  style={{ width: 48, padding: "4px 4px", fontSize: 13, border: "1px solid var(--border2)", borderRadius: 6, textAlign: "center" }}
                />
                <span style={{ fontSize: 11, color: "var(--text3)" }}>%</span>
              </div>
            ))}
          </div>

          {profileMsg && <div style={{ fontSize: 13, color: profileMsg === "Gespeichert" ? "#0a7d3e" : "#d1350f", marginBottom: 8 }}>{profileMsg}</div>}
          <button type="submit" style={btnPrimary}>{t("common.save")}</button>
        </form>
      </div>

      <div style={{ padding: 24, background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)", marginBottom: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>{t("profile.changePw")}</div>
        <form onSubmit={changePw} autoComplete="on">
          <input type="hidden" name="username" autoComplete="username" value={user?.email || ""} />
          <input type="password" name="current-password" autoComplete="current-password" placeholder={t("profile.oldPw")} value={oldPw} onChange={(e) => setOldPw(e.target.value)}
            style={inputStyle} required />
          <input type="password" name="new-password" autoComplete="new-password" placeholder={t("profile.newPw")} value={newPw} onChange={(e) => setNewPw(e.target.value)}
            style={inputStyle} required />
          {msg && <div style={{ fontSize: 13, color: msg === t("profile.pwChanged") ? "#0a7d3e" : "#d1350f", marginBottom: 8 }}>{msg}</div>}
          <button type="submit" style={btnPrimary}>{t("profile.change")}</button>
        </form>
      </div>

      {isAdmin && (
        <div style={{ marginTop: 40, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", letterSpacing: "0.8px", textTransform: "uppercase" }}>
              {t("profile.admin")}
            </span>
            <div style={{ height: 1, flex: 1, background: "var(--border2)" }} />
          </div>

          <div style={{ padding: 24, background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)", marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>{t("profile.version")}</div>
            {versionLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text3)" }}>
                <Spinner /> {t("profile.checking")}
              </div>
            ) : versionInfo ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, color: "var(--text)" }}>{t("profile.installed")} <strong>v{versionInfo.current}</strong></span>
                </div>
                {versionInfo.update_available ? (
                  <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v10M12 12l4-4M12 12l-4-4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{t("profile.updateAvailable")} v{versionInfo.latest}</span>
                    <a href={versionInfo.repo_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{t("profile.toGithub")}</a>
                  </div>
                ) : versionInfo.latest ? (
                  <div style={{ marginTop: 10, fontSize: 13, color: "#0a7d3e", display: "flex", alignItems: "center", gap: 6 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0a7d3e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                    {t("profile.upToDate")}
                  </div>
                ) : (
                  <div style={{ marginTop: 10, fontSize: 12, color: "var(--text3)" }}>{t("profile.githubFail")}</div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text3)" }}>{t("profile.versionFail")}</div>
            )}
          </div>

          <div style={{ padding: 24, background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>{t("profile.accounts")}</div>
            {adminUsersLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text3)" }}>
                <Spinner /> {t("profile.accountsLoading")}
              </div>
            ) : adminUsers.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text3)" }}>{t("profile.noAccounts")}</div>
            ) : (
              <>
                {adminMsg && <div style={{ fontSize: 13, color: adminMsg.includes("Fehler") ? "#d1350f" : "#0a7d3e", marginBottom: 10 }}>{adminMsg}</div>}
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("common.name")}</th>
                      <th style={thStyle}>{t("profile.email")}</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map(u => (
                      <tr key={u.id}>
                        <td style={tdStyle}>{u.name || "–"}</td>
                        <td style={tdStyle}>{u.email}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {u.id !== 1 && (
                            <button
                              title={t("profile.deleteUser")}
                              onClick={async () => {
                                if (!confirm(t("profile.deleteUserConfirm", { email: u.email }))) return;
                                const res = await fetch(`${API}/auth/admin/users/${u.id}`, { method: "DELETE" });
                                if (res.ok) {
                                  setAdminUsers(adminUsers.filter(x => x.id !== u.id));
                                  setAdminMsg(t("profile.deleted", { email: u.email }));
                                }
                              }}
                              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 6, background: "none", border: "1px solid #d1350f", borderRadius: 8, cursor: "pointer" }}
                            ><TrashIcon size={15} /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={onLogout} style={{ ...btnPrimary, background: "#d1350f" }}>{t("profile.logout")}</button>
        <button onClick={async () => {
          const pw = prompt(t("profile.deletePwPrompt"));
          if (!pw) return;
          if (!confirm(t("profile.deleteConfirm"))) return;
          const res = await fetch(`${API}/auth/delete-account`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ password: pw }),
          });
          if (res.ok) {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            location.reload();
          } else {
            const data = await res.json();
            alert(data.detail || t("login.genericError"));
          }
        }} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "#d1350f", fontSize: 13, cursor: "pointer" }}>
          <TrashIcon size={14} /> {t("profile.deleteUser")}
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  display: "block", width: "100%", padding: "10px 14px", marginBottom: 10,
  border: "1px solid var(--border2)", borderRadius: 10, fontSize: 14, boxSizing: "border-box",
  maxWidth: 340,
};

const btnPrimary = {
  padding: "10px 22px", fontSize: 14, fontWeight: 600,
  background: "var(--accent)", color: "#fff", border: "none", borderRadius: 980,
  cursor: "pointer",
};

const btnSecondary = {
  padding: "10px 22px", fontSize: 14, fontWeight: 500,
  background: "var(--card)", color: "var(--text)", border: "1px solid var(--border2)",
  borderRadius: 980, cursor: "pointer",
};

const linkBtn = {
  background: "none", border: "none", color: "var(--accent)", fontSize: 13, fontWeight: 500, cursor: "pointer", padding: 0,
};

const thStyle = {
  textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border2)",
  color: "var(--text3)", fontSize: 12, fontWeight: 600,
};

const tdStyle = {
  padding: "8px 8px", borderBottom: "1px solid var(--border)", color: "var(--text)",
};
