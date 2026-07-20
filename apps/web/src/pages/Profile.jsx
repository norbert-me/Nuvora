import { useState, useEffect } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { btnPrimary, btnSecondary } from "../components/Icons.jsx";

const API = "/api";

const Spinner = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "profspin 0.8s linear infinite", flexShrink: 0 }}>
    <style>{`@keyframes profspin{to{transform:rotate(360deg)}}`}</style>
    <path d="M21 12a9 9 0 1 1-6.2-8.5"/>
  </svg>
);

// Kleiner Info-Punkt: erklaerender Text. Auf Klick UND Hover, damit er auch
// auf Touch/Mobile funktioniert (reiner title-Tooltip tut das nicht).
const InfoDot = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", marginLeft: 6, flexShrink: 0 }}>
      <button type="button" title={text} onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: "50%", border: "1px solid var(--border2)", background: open ? "var(--accent)" : "transparent", color: open ? "#fff" : "var(--text3)", fontSize: 10, fontWeight: 700, cursor: "pointer", padding: 0 }}>i</button>
      {open && (
        <span style={{ position: "absolute", top: 22, left: 0, zIndex: 30, width: 240, maxWidth: "70vw", background: "var(--card)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 11px", fontSize: 12.5, lineHeight: 1.5, boxShadow: "0 8px 24px rgba(0,0,0,0.18)", fontWeight: 400 }}>{text}</span>
      )}
    </span>
  );
};

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
  const [showUsername, setShowUsername] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminMsg, setAdminMsg] = useState("");
  const [setup, setSetup] = useState(null);
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
    fetch(`${API}/admin/setup`).then(r => r.ok ? r.json() : null).then(setSetup).catch(() => {});
  }, [isAdmin]);

  const changeChannel = async (ch) => {
    if (ch === versionInfo?.channel) return;
    setVersionLoading(true);
    await fetch(`${API}/version/channel`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: ch }),
    }).catch(() => {});
    const d = await fetch(`${API}/version`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setVersionInfo(d);
    setVersionLoading(false);
  };

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
      // Passwortmanager (Chrome/Edge) das neue Passwort anbieten. Safari kennt
      // die API nicht — dort haengt das Speichern am echten Formular-Submit,
      // deshalb die Felder nicht sofort leeren (das wuergt den Dialog ab),
      // sondern erst nach kurzer Verzoegerung.
      try {
        if (window.PasswordCredential && user?.email) {
          await navigator.credentials.store(
            new window.PasswordCredential({ id: user.email, password: newPw })
          );
        }
      } catch { /* egal, best effort */ }
      setMsg(t("profile.pwChanged"));
      setTimeout(() => { setOldPw(""); setNewPw(""); }, 1500);
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
      // Bei res.ok ist die Bestaetigungsmail garantiert verschickt — der Server
      // aendert die Adresse sonst gar nicht erst (503 statt ok).
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
          <button type="button" onClick={() => setShowUsername((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: showUsername ? 10 : 0 }}>
            <span style={{ fontSize: 20, color: "var(--text3)", lineHeight: 1 }}>{showUsername ? "−" : "+"}</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{t("profile.username")}</span>
            <InfoDot text={t("profile.usernameHint")} />
          </button>
          {showUsername && (
            <input placeholder={t("profile.usernamePlaceholder")} value={marketplaceName} onChange={(e) => setMarketplaceName(e.target.value)}
              style={{ ...inputStyle, marginBottom: 10 }} />
          )}

          <button type="button" onClick={() => setShowScale((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 20, marginBottom: showScale ? 10 : 0 }}>
            <span style={{ fontSize: 20, color: "var(--text3)", lineHeight: 1 }}>{showScale ? "−" : "+"}</span>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{t("profile.gradeScale")}</span>
            <InfoDot text={t("profile.gradeScaleHint")} />
          </button>
          <style>{".nice-num::-webkit-inner-spin-button,.nice-num::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.nice-num{-moz-appearance:textfield;appearance:textfield}"}</style>
          {showScale && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, marginTop: 4 }}>
            {[1, 2, 3, 4, 5].map((g) => (
              <div key={g} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", background: "var(--card)", borderRadius: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{g}</span>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>{t("profile.from")}</span>
                <input className="nice-num"
                  type="number" min="0" max="100" step="1"
                  value={gradeScale[g]}
                  onChange={(e) => setGradeScale({ ...gradeScale, [g]: Math.max(0, Math.min(100, Number(e.target.value))) })}
                  style={{ width: 52, padding: "6px 8px", fontSize: 13, border: "1px solid var(--border2)", borderRadius: 8, textAlign: "center", background: "var(--bg)", color: "var(--text)" }}
                />
                <span style={{ fontSize: 11, color: "var(--text3)" }}>%</span>
              </div>
            ))}
          </div>
          )}

          {profileMsg && <div style={{ fontSize: 13, color: profileMsg === "Gespeichert" ? "#0a7d3e" : "#d1350f", marginTop: 12, marginBottom: 8 }}>{profileMsg}</div>}
          <button type="submit" style={{ ...btnPrimary, marginTop: 16 }}>{t("common.save")}</button>
        </form>
      </div>

      <div style={{ padding: 24, background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)", marginBottom: 24 }}>
        <button type="button" onClick={() => setShowPw((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: showPw ? 12 : 0 }}>
          <span style={{ fontSize: 20, color: "var(--text3)", lineHeight: 1 }}>{showPw ? "−" : "+"}</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{t("profile.changePw")}</span>
        </button>
        {showPw && (
        <form onSubmit={changePw} autoComplete="on">
          <input type="hidden" name="username" autoComplete="username" value={user?.email || ""} />
          <input type="password" name="current-password" autoComplete="current-password" placeholder={t("profile.oldPw")} value={oldPw} onChange={(e) => setOldPw(e.target.value)}
            style={inputStyle} required />
          <input type="password" name="new-password" autoComplete="new-password" placeholder={t("profile.newPw")} value={newPw} onChange={(e) => setNewPw(e.target.value)}
            style={inputStyle} required />
          {msg && <div style={{ fontSize: 13, color: msg === t("profile.pwChanged") ? "#0a7d3e" : "#d1350f", marginBottom: 8 }}>{msg}</div>}
          <button type="submit" style={btnPrimary}>{t("profile.change")}</button>
        </form>
        )}
      </div>

      <div style={{ padding: 24, background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)", marginBottom: 24, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{t("profile.tutorialTitle")}</div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 2 }}>{t("profile.tutorialHint")}</div>
        </div>
        <button type="button" onClick={() => {
          try { localStorage.removeItem(`nuvora_onboarded_${user?.id ?? "x"}`); } catch { /* egal */ }
          window.location.href = "/";
        }} style={btnSecondary}>{t("profile.tutorialRestart")}</button>
      </div>

      {isAdmin && (
        <div style={{ marginTop: 40, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", letterSpacing: "0.8px", textTransform: "uppercase" }}>
              {t("profile.admin")}
            </span>
            <div style={{ height: 1, flex: 1, background: "var(--border2)" }} />
          </div>

          {setup && !(setup.smtp && setup.site_json && setup.admin_email && setup.contact_deliverable) && (
            <div style={{ padding: 24, background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)", marginBottom: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>{t("profile.setup")}</div>
              {[["smtp", t("profile.setupSmtp")], ["site_json", t("profile.setupSite")], ["admin_email", t("profile.setupAdminMail")], ["contact_deliverable", t("profile.setupContact")]].map(([k, label]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, padding: "5px 0", color: "var(--text)" }}>
                  <span style={{ display: "inline-flex", width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", background: setup[k] ? "#0a7d3e" : "var(--border3)", color: "#fff", flexShrink: 0 }}>
                    {setup[k]
                      ? <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                      : <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="3.5" strokeLinecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>}
                  </span>
                  <span style={{ color: setup[k] ? "var(--text)" : "#b8860b" }}>{label}</span>
                </div>
              ))}
              {!setup.smtp && <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>{t("profile.setupSmtpHint")}</p>}
              {setup.smtp && !setup.contact_deliverable && <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>{t("profile.setupContactHint")}</p>}
              {setup.contact_fallback && <p style={{ fontSize: 12, color: "#b8860b", marginTop: 8 }}>⚠️ {t("profile.setupContactFallback")}</p>}
              {setup.contact_to && <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{t("profile.setupContactTo", { to: setup.contact_to })}</p>}
            </div>
          )}

          <div style={{ padding: 24, background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)", marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>{t("profile.version")}</div>
            {versionLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text3)" }}>
                <Spinner /> {t("profile.checking")}
              </div>
            ) : versionInfo ? (
              <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, color: "var(--text)" }}>{t("profile.installed")} <strong>v{versionInfo.current}</strong></span>
                    {!versionInfo.update_available && (
                      <svg title={t("profile.upToDate")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0a7d3e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                    )}
                  </div>
                  {versionInfo.update_available && (
                    <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v10M12 12l4-4M12 12l-4-4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{t("profile.updateAvailable")} v{versionInfo.latest}</span>
                      <a href={versionInfo.repo_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{t("profile.toGithub")}</a>
                    </div>
                  )}
                </div>
                {versionInfo.channels && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("profile.channel")}</span>
                    <div style={{ display: "inline-flex", border: "1px solid var(--border2)", borderRadius: 980, overflow: "hidden" }}>
                      {versionInfo.channels.map((ch) => (
                        <button key={ch} onClick={() => changeChannel(ch)}
                          style={{
                            padding: "4px 12px", fontSize: 12.5, fontWeight: 600, border: "none", cursor: "pointer",
                            background: versionInfo.channel === ch ? "var(--accent)" : "transparent",
                            color: versionInfo.channel === ch ? "#fff" : "var(--text2)",
                          }}>{t(`profile.channel.${ch}`)}</button>
                      ))}
                    </div>
                    <InfoDot text={t(`profile.channelHint.${versionInfo.channel}`)} />
                  </div>
                )}
              </div>
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
                                if (!await askConfirm(t("profile.deleteUserConfirm", { email: u.email }))) return;
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

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={async () => {
          const res = await fetch(`${API}/me/export`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
          if (!res || !res.ok) { showAlert(t("profile.exportError")); return; }
          const blob = await res.blob();
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `nuvora-export-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        }} style={btnSecondary}>{t("profile.exportData")}</button>
        <button onClick={onLogout} style={{ ...btnPrimary, background: "#d1350f" }}>{t("profile.logout")}</button>
        <button onClick={async () => {
          const pw = await askPrompt(t("profile.deletePwPrompt"));
          if (!pw) return;
          if (!await askConfirm(t("profile.deleteConfirm"))) return;
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
            showAlert(data.detail || t("login.genericError"));
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
