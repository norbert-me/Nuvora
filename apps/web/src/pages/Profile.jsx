import { useState, useEffect, useRef } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { istAdmin } from "../core/admin.js";
import { useLanguage, LANGUAGES } from "../i18n/index.jsx";
import { btnPrimary, btnSecondary, selectStyle, COLORS as C, pageForm, pageTitle, panelStyle, popoverPanel,
  sectionLabel, Tabs, th as thBasis, td as tdBasis, badge, iconBtn, inputStyle as inputBasis, Icon, ICONS, CONTROL_R } from "../components/Icons.jsx";
import Speicherleiste, { useEntwurf } from "../components/Speichern.jsx";
import { alsJson } from "../core/melden.js";

const API = "/api";

// Abschnittskarte des Profils. Abgeleitet statt siebenmal von Hand gebaut: das
// Profil war die einzige Seite mit Radius 16 an einem Panel.
const abschnitt = { ...panelStyle, padding: 24, marginBottom: 24 };

const Spinner = ({ size = 14 }) => (
  <>
    <style>{`@keyframes profspin{to{transform:rotate(360deg)}}`}</style>
    <Icon d={ICONS.spinner} size={size} color="currentColor" style={{ animation: "profspin 0.8s linear infinite", flexShrink: 0 }} />
  </>
);

// Kleiner Info-Punkt: erklaerender Text. Auf Klick UND Hover, damit er auch
// auf Touch/Mobile funktioniert (reiner title-Tooltip tut das nicht).
const InfoDot = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", marginLeft: 4, flexShrink: 0 }}>
      {/* Das „i" war ein handgezeichneter Kreis mit Buchstabe — dasselbe Bild
          gibt es als ICONS.info, und es faerbt sich mit. */}
      <button type="button" title={text} aria-label={text} onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ ...iconBtn, padding: 0 }}>
        <Icon d={ICONS.info} size={15} color={open ? "var(--accent)" : "var(--text3)"} />
      </button>
      {open && (
        <span style={{ ...popoverPanel, position: "absolute", top: 22, left: 0, zIndex: 30, width: 240, maxWidth: "70vw", padding: 8, fontSize: 12, lineHeight: 1.5, fontWeight: 400 }}>{text}</span>
      )}
    </span>
  );
};

// Papierkorb aus der einen Icon-Quelle statt als eigenes SVG.
const TrashIcon = ({ size = 16 }) => <Icon d={ICONS.trash} size={size} color={C.danger} />;

export default function Profile({ user, onLogout, onUserUpdate }) {
  const { t, lang, setLang } = useLanguage();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");
  // Bestehende Werte unveraendert mitsenden — kein UI mehr dafuer, aber Backend braucht sie im Payload
  const name = user.name || "";
  const salutation = user.salutation || "Hr.";
  const [profileMsg, setProfileMsg] = useState("");
  const DEFAULT_SCALE = { 1: 87, 2: 73, 3: 59, 4: 45, 5: 20, 6: 0 };
  // Anzeigename, Notenschlüssel und Tendenz sind EIN Entwurf: sie hängen an
  // demselben PUT und gehen gemeinsam hinaus.
  const [profilBasis, setProfilBasis] = useState({
    marketplaceName: user.marketplace_name || "",
    gradeScale: user.grade_scale || DEFAULT_SCALE,
    gradeTendency: user.grade_tendency !== false,   // Voreinstellung: mit Tendenz (2+)
  });
  const profil = useEntwurf(profilBasis, (w) => saveProfile(w));
  const { marketplaceName, gradeScale, gradeTendency } = profil.wert;
  const [showUsername, setShowUsername] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [showTendency, setShowTendency] = useState(false);
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
  const isAdmin = istAdmin(user);

  useEffect(() => {
    if (!isAdmin) return;
    fetch(`${API}/auth/admin/users`).then(r => r.ok ? r.json() : []).then(setAdminUsers).finally(() => setAdminUsersLoading(false));
    fetch(`${API}/version`).then(r => r.ok ? r.json() : null).then(setVersionInfo).catch(() => {}).finally(() => setVersionLoading(false));
    fetch(`${API}/admin/setup`).then(r => r.ok ? r.json() : null).then(setSetup).catch(() => {});
  }, [isAdmin]);

  // Der Update-Kanal ist eine Einstellung wie jede andere und wartet auf
  // „Speichern" — vorher schaltete der Reiter beim Antippen sofort um.
  const [kanalBasis, setKanalBasis] = useState({ channel: "" });
  const kanal = useEntwurf(kanalBasis, async (w) => {
    setVersionLoading(true);
    await fetch(`${API}/version/channel`, alsJson("PUT", { channel: w.channel })).catch(() => {});
    const d = await fetch(`${API}/version`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setVersionInfo(d);
    setKanalBasis({ channel: d?.channel || w.channel });
    setVersionLoading(false);
  });
  const kanalRef = useRef(null);
  kanalRef.current = kanal;
  // Erst wenn der Server seinen Kanal gemeldet hat, steht die Grundlage fest.
  useEffect(() => {
    const ch = versionInfo?.channel;
    if (!ch || ch === kanalBasis.channel) return;
    setKanalBasis({ channel: ch }); kanalRef.current?.setz({ channel: ch });
  }, [versionInfo?.channel]); // eslint-disable-line

  // Sprache: der Anzeige-Wechsel ist selbst die Änderung — also erst mit
  // „Speichern" umschalten, nicht beim Auswählen.
  const [sprachBasis, setSprachBasis] = useState({ lang });
  const sprache = useEntwurf(sprachBasis, (w) => { setLang(w.lang); setSprachBasis({ lang: w.lang }); });

  const saveProfile = async (w) => {
    setProfileMsg("");
    const res = await fetch(`${API}/auth/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, salutation, grade_scale: w.gradeScale, grade_tendency: w.gradeTendency, marketplace_name: w.marketplaceName }),
    });
    if (res.ok) {
      const data = await res.json();
      setProfileMsg(t("profile.saved"));
      setProfilBasis(w);
      const updated = { ...user, ...data };
      localStorage.setItem("user", JSON.stringify(updated));
      onUserUpdate?.(updated);
    } else {
      setProfileMsg(t("profile.saveError"));
      return false;   // Entwurf bleibt offen
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
    <div style={{ ...pageForm }}>
      <h1 style={pageTitle}>{t("nav.profile")}</h1>

      {/* Sprache steht im Profil, nicht mehr in der Navbar — sie wird einmal
          gesetzt, nicht im Betrieb gewechselt. */}
      <div style={{ ...abschnitt, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{t("nav.language")}</div>
        </div>
        <select value={sprache.wert.lang} onChange={(e) => sprache.setz({ lang: e.target.value })} style={{ ...selectStyle, minWidth: 160 }}>
          {Object.entries(LANGUAGES).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
        <Speicherleiste entwurf={sprache} klein />
      </div>

      <div style={abschnitt}>
        <div style={{ fontSize: 14, color: "var(--text3)", marginBottom: 4 }}>{t("profile.email")}</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{user.email}</div>
        {pendingEmail && (
          <div style={{ fontSize: 12, color: C.warning, marginBottom: 8 }}>
            {t("profile.pending", { email: pendingEmail })}
          </div>
        )}
        {!showEmailForm ? (
          <button type="button" onClick={() => { setShowEmailForm(true); setEmailMsg(""); }} style={{ ...linkBtn, marginBottom: 16 }}>{t("profile.changeEmail")}</button>
        ) : (
          <form onSubmit={changeEmail} style={{ marginBottom: 16 }}>
            <input type="email" name="new-email" autoComplete="email" aria-label={t("profile.newEmail")} placeholder={t("profile.newEmail")} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} style={feldStyle} required />
            <input type="password" name="current-password" autoComplete="current-password" aria-label={t("profile.currentPw")} placeholder={t("profile.currentPw")} value={emailPw} onChange={(e) => setEmailPw(e.target.value)} style={feldStyle} required />
            <p style={{ fontSize: 12, color: "var(--text3)", margin: "0 0 10px" }}>
              {t("profile.emailInfo")}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" style={btnPrimary}>{t("profile.sendLink")}</button>
              <button type="button" onClick={() => setShowEmailForm(false)} style={btnSecondary}>{t("common.cancel")}</button>
            </div>
          </form>
        )}
        {emailMsg && <div style={{ fontSize: 13, color: emailMsg === t("profile.linkSent") ? C.success : C.danger, marginBottom: 16 }}>{emailMsg}</div>}

        {/* Bewusst kein <form>: die Knöpfe der Speicherleiste wären darin
            Submit-Knöpfe, und „Abbrechen" schickte das Formular ab. */}
        <div>
          <button type="button" onClick={() => setShowUsername((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: showUsername ? 8 : 0 }}>
            <Icon d={showUsername ? ICONS.chevronUp : ICONS.chevronDown} size={15} />
            <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{t("profile.username")}</span>
            <InfoDot text={t("profile.usernameHint")} />
          </button>
          {showUsername && (
            <input placeholder={t("profile.usernamePlaceholder")} value={marketplaceName} onChange={(e) => profil.setz({ marketplaceName: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") profil.speichern(); }}
              style={{ ...feldStyle, marginBottom: 10 }} />
          )}

          <button type="button" onClick={() => setShowScale((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 24, marginBottom: showScale ? 8 : 0 }}>
            <Icon d={showScale ? ICONS.chevronUp : ICONS.chevronDown} size={15} />
            <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{t("profile.gradeScale")}</span>
            <InfoDot text={t("profile.gradeScaleHint")} />
          </button>
          <style>{".nice-num::-webkit-inner-spin-button,.nice-num::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.nice-num{-moz-appearance:textfield;appearance:textfield}"}</style>
          {showScale && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, marginTop: 4 }}>
            {[1, 2, 3, 4, 5].map((g) => (
              <div key={g} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", background: "var(--card)", borderRadius: CONTROL_R }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{g}</span>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>{t("profile.from")}</span>
                <input className="nice-num"
                  type="number" min="0" max="100" step="1"
                  value={gradeScale[g]}
                  onChange={(e) => profil.setz({ gradeScale: { ...gradeScale, [g]: Math.max(0, Math.min(100, Number(e.target.value))) } })}
                  style={{ ...inputBasis, width: 52, padding: "4px 8px", fontSize: 13, textAlign: "center" }}
                />
                <span style={{ fontSize: 11, color: "var(--text3)" }}>%</span>
              </div>
            ))}
          </div>
          )}

          {/* Noten-Anzeige: mit Tendenz (2+/2-) oder ganze Noten — einklappbar wie
              die Abschnitte darüber. */}
          <button type="button" onClick={() => setShowTendency((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 24, marginBottom: showTendency ? 8 : 0 }}>
            <Icon d={showTendency ? ICONS.chevronUp : ICONS.chevronDown} size={15} />
            <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{t("profile.gradeTendency")}</span>
            <InfoDot text={t("profile.gradeTendencyHint")} />
          </button>
          {showTendency && (
            // `Tabs` statt eines zweiten Umschalters von Hand: dieselbe
            // Entscheidung soll ueberall gleich aussehen.
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              <Tabs value={gradeTendency ? "an" : "aus"} onChange={(v) => profil.setz({ gradeTendency: v === "an" })}
                options={[["an", t("profile.gradeTendencyOn")], ["aus", t("profile.gradeTendencyOff")]]} />
            </div>
          )}

          {profileMsg && <div style={{ fontSize: 13, color: profileMsg === t("profile.saved") ? C.success : C.danger, marginTop: 12, marginBottom: 8 }}>{profileMsg}</div>}
          <Speicherleiste entwurf={profil} immer style={{ marginTop: 16 }} />
        </div>
      </div>

      <div style={abschnitt}>
        <button type="button" onClick={() => setShowPw((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: showPw ? 12 : 0 }}>
          <Icon d={showPw ? ICONS.chevronUp : ICONS.chevronDown} size={15} />
          <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{t("profile.changePw")}</span>
        </button>
        {showPw && (
        <form onSubmit={changePw} autoComplete="on">
          <input type="hidden" name="username" autoComplete="username" value={user?.email || ""} />
          <input type="password" name="current-password" autoComplete="current-password" placeholder={t("profile.oldPw")} value={oldPw} onChange={(e) => setOldPw(e.target.value)}
            style={feldStyle} required />
          <input type="password" name="new-password" autoComplete="new-password" placeholder={t("profile.newPw")} value={newPw} onChange={(e) => setNewPw(e.target.value)}
            style={feldStyle} required />
          {msg && <div style={{ fontSize: 13, color: msg === t("profile.pwChanged") ? C.success : C.danger, marginBottom: 8 }}>{msg}</div>}
          <button type="submit" style={btnPrimary}>{t("profile.change")}</button>
        </form>
        )}
      </div>

      <div style={{ ...abschnitt, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{t("profile.tutorialTitle")}</div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 2 }}>{t("profile.tutorialHint")}</div>
        </div>
        <button type="button" onClick={() => {
          try { localStorage.removeItem(`nuvora_onboarded_${user?.id ?? "x"}`); } catch { /* egal */ }
          window.location.href = "/";
        }} style={btnSecondary}>{t("profile.tutorialRestart")}</button>
      </div>

      {isAdmin && (
        <div style={{ marginTop: 24, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <span style={sectionLabel}>
              {t("profile.admin")}
            </span>
            <div style={{ height: 1, flex: 1, background: "var(--border2)" }} />
          </div>

          {setup && !(setup.smtp && setup.site_json && setup.admin_email && setup.contact_deliverable) && (
            <div style={{ ...abschnitt, marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>{t("profile.setup")}</div>
              {[["smtp", t("profile.setupSmtp")], ["site_json", t("profile.setupSite")], ["admin_email", t("profile.setupAdminMail")], ["contact_deliverable", t("profile.setupContact")]].map(([k, label]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0", color: "var(--text)" }}>
                  <span style={{ display: "inline-flex", flexShrink: 0 }}>
                    <Icon d={setup[k] ? ICONS.checkCircle : ICONS.close} size={16}
                      color={setup[k] ? C.success : "var(--text3)"} />
                  </span>
                  <span style={{ color: setup[k] ? "var(--text)" : C.warning }}>{label}</span>
                </div>
              ))}
              {!setup.smtp && <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>{t("profile.setupSmtpHint")}</p>}
              {setup.smtp && !setup.contact_deliverable && <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>{t("profile.setupContactHint")}</p>}
              {setup.contact_fallback && <p style={{ fontSize: 12, color: C.warning, marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <Icon d={ICONS.warn} size={13} color={C.warning} />{t("profile.setupContactFallback")}</p>}
              {setup.contact_to && <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{t("profile.setupContactTo", { to: setup.contact_to })}</p>}
            </div>
          )}

          <div style={{ ...abschnitt, marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>{t("profile.version")}</div>
            {versionLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text3)" }}>
                <Spinner /> {t("profile.checking")}
              </div>
            ) : versionInfo ? (
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, color: "var(--text)" }}>{t("profile.installed")} <strong>v{versionInfo.current}</strong></span>
                    {!versionInfo.update_available && (
                      <Icon d={ICONS.checkCircle} size={16} color={C.success} />
                    )}
                  </div>
                  {versionInfo.update_available && (
                    <div style={{ marginTop: 12, padding: 12, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: CONTROL_R, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Icon d={ICONS.download} size={18} color="var(--text)" />
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{t("profile.updateAvailable")} v{versionInfo.latest}</span>
                      <a href={versionInfo.repo_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{t("profile.toGithub")}</a>
                    </div>
                  )}
                </div>
                {versionInfo.channels && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("profile.channel")}</span>
                    <Tabs value={kanal.wert.channel || versionInfo.channel} onChange={(ch) => kanal.setz({ channel: ch })}
                      options={versionInfo.channels.map((ch) => [ch, t(`profile.channel.${ch}`)])} />
                    <InfoDot text={t(`profile.channelHint.${kanal.wert.channel || versionInfo.channel}`)} />
                    <Speicherleiste entwurf={kanal} klein />
                  </div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text3)" }}>{t("profile.versionFail")}</div>
            )}
          </div>

          <div style={{ ...abschnitt, marginBottom: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>{t("profile.accounts")}</div>
            {adminUsersLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text3)" }}>
                <Spinner /> {t("profile.accountsLoading")}
              </div>
            ) : adminUsers.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text3)" }}>{t("profile.noAccounts")}</div>
            ) : (
              <>
                {adminMsg && <div style={{ fontSize: 13, color: adminMsg.includes("Fehler") ? C.danger : C.success, marginBottom: 10 }}>{adminMsg}</div>}
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                {/* Kein `minWidth` an der Tabelle: das erzwang auf schmalen Geräten
                    einen waagerechten Rollbalken und schnitt die Spalte „Status"
                    ab. Drei kurze Spalten passen in die Karte, die E-Mail bricht
                    (`overflowWrap: anywhere` in tdStyle). Das `overflowX: auto` am
                    Container bleibt nur als Netz — es zeigt nichts, solange nichts
                    überläuft. */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("profile.email")}</th>
                      <th style={thStyle}>{t("profile.role")}</th>
                      <th style={thStyle}>{t("profile.accountState")}</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map(u => (
                      <tr key={u.id}>
                        <td style={tdStyle}>{u.email}</td>
                        {/* Rolle statt Anzeigename: die Administration ist das Konto mit
                            id 1 (siehe _require_admin), der Name sagt darüber nichts. */}
                        <td style={tdStyle}>
                          {u.admin
                            ? <span style={badge(C.info)}>{t("profile.roleAdmin")}</span>
                            : <span style={{ color: "var(--text3)" }}>{t("profile.roleTeacher")}</span>}
                        </td>
                        {/* Bestätigt oder nicht — das Einzige, was hier eine Entscheidung
                            stützt: ein unbestätigtes Konto kann sich nie anmelden. */}
                        <td style={tdStyle}>
                          {u.email_verified
                            ? <span style={{ color: "var(--text3)" }}>{t("profile.verified")}</span>
                            : <span style={badge(C.warning)}>{t("profile.unverified")}</span>}
                        </td>
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
                              style={{ ...iconBtn, border: `1px solid `, borderRadius: CONTROL_R }}
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

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
        <button onClick={onLogout} style={{ ...btnPrimary, background: C.danger }}>{t("profile.logout")}</button>
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
        }} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", color: C.danger, fontSize: 13, cursor: "pointer" }}>
          <TrashIcon size={14} /> {t("profile.deleteUser")}
        </button>
      </div>
    </div>
  );
}

// Abgeleitet, nicht neu gebaut: hiess frueher `inputStyle` und ueberschattete
// damit den gleichnamigen Stil aus Icons.jsx — beim Lesen war nicht zu sehen,
// welcher gilt. Formularseiten duerfen abweichen (volle Breite, Abstand nach
// unten), aber die Grundform kommt aus der einen Quelle.
const feldStyle = {
  ...inputBasis,
  display: "block", width: "100%", marginBottom: 10, maxWidth: 340,
};



const linkBtn = {
  background: "none", border: "none", color: "var(--accent)", fontSize: 13, fontWeight: 500, cursor: "pointer", padding: 0,
};

// Kopf und Zelle müssen dieselbe Ausrichtung haben: `th`/`td` aus Icons.jsx
// stehen beide auf "center", der Kopf hier auf "left" — dadurch sah die
// E-Mail-Spalte eingerückt aus, während die Überschrift links stand.
const thStyle = { ...thBasis,
  textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border2)",
  color: "var(--text3)", fontSize: 12, fontWeight: 600,
};

const tdStyle = { ...tdBasis,
  textAlign: "left", padding: "8px 8px", borderBottom: "1px solid var(--border)",
  color: "var(--text)", overflowWrap: "anywhere",
};
