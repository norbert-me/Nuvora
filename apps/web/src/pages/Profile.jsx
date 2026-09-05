import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { istAdmin } from "../core/admin.js";
import { useLanguage, LANGUAGES } from "../i18n/index.jsx";
import { btnPrimary, btnSecondary, selectStyle, COLORS as C, pageForm, pageTitle, panelStyle, popoverPanel,
  sectionLabel, Tabs, th as thBasis, td as tdBasis, iconBtn, inputStyle as inputBasis, Icon, ICONS, CONTROL_R } from "../components/Icons.jsx";
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

// Eine Einstellungszeile: links, wofuer sie steht, rechts der Wert. Vorher war
// jede Zeile ein Aufklapper mit Pfeil und Info-Punkt — vier Ueberschriften
// untereinander, hinter denen jeweils EIN kleines Feld lag. Wer sein Schuljahr
// nachsehen wollte, musste es erst aufklappen. `block` stellt den Wert unter
// die Beschriftung; das brauchen die beiden breiten Zeilen (Notenschluessel,
// Schuljahr), die sonst die Karte sprengen.
const Zeile = ({ label, hint, block = false, erste = false, children }) => (
  <div style={{
    display: "flex", gap: 12, flexWrap: "wrap",
    flexDirection: block ? "column" : "row",
    alignItems: block ? "stretch" : "center",
    padding: erste ? "0 0 12px" : "12px 0",
    borderTop: erste ? "none" : "1px solid var(--border)",
  }}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14,
      fontWeight: 600, color: "var(--text)", flex: block ? "none" : 1, minWidth: 120 }}>
      {label}{hint && <InfoDot text={hint} />}
    </span>
    {children}
  </div>
);

// Ein Abschnitt der Profilseite: Überschrift zum Aufklappen, Inhalt darunter.
// Aufklappbar sind die ABSCHNITTE, nicht die einzelnen Felder — vorher war
// jede Einstellung ein eigener Aufklapper, vier Überschriften mit Pfeil und
// Info-Punkt untereinander, hinter jeder ein kleines Feld. Der Zustand liegt im
// localStorage: wer sein Schuljahr jede Woche anfasst, findet es offen vor.
const Abschnitt = ({ id, titel, zu = true, kopf = null, children }) => {
  const [offen, setOffen] = useState(() => {
    try {
      const v = localStorage.getItem(`nuvora_profil_${id}`);
      return v === null ? !zu : v === "1";
    } catch { return !zu; }
  });
  const um = () => setOffen((v) => {
    try { localStorage.setItem(`nuvora_profil_${id}`, v ? "0" : "1"); } catch { /* egal */ }
    return !v;
  });
  return (
    <div style={abschnitt}>
      <button type="button" onClick={um}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none",
          border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}>
        <Icon d={offen ? ICONS.chevronUp : ICONS.chevronDown} size={15} />
        <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", flex: 1 }}>{titel}</span>
        {/* Was auch zugeklappt sichtbar bleiben muss (die eigene Adresse). */}
        {!offen && kopf}
      </button>
      {offen && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
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
    gradeScale: user.grade_scale || DEFAULT_SCALE,
    gradeTendency: user.grade_tendency !== false,   // Voreinstellung: mit Tendenz (2+)
    // Schuljahr. Am Konto und nicht an der Klasse: es ist fuer alle Klassen
    // dieser Lehrkraft dasselbe — je Klasse waere es dieselbe Angabe
    // fuenfzehnmal, und beim ersten Abweichen wuesste niemand, welche stimmt.
    hj1: user.hj1_start || "", hj2: user.hj2_start || "", ende: user.jahr_ende || "",
  });
  const profil = useEntwurf(profilBasis, (w) => saveProfile(w));
  const { gradeScale, gradeTendency } = profil.wert;
  // Der Name, unter dem Beiträge im Marktplatz stehen. Er hängt an keinem
  // zweiten Wert und wirkt sofort — deshalb steht er bei den Umschaltern und
  // nicht im Entwurf; geschrieben wird beim Verlassen des Feldes und mit Enter.
  const [marktName, setMarktName] = useState(user.marketplace_name || "");
  const [marktStand, setMarktStand] = useState(user.marketplace_name || "");
  const marktSpeichern = async () => {
    const wert = marktName.trim();
    if (wert === marktStand) return;
    const res = await fetch(`${API}/auth/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, salutation, marketplace_name: wert }),
    }).catch(() => null);
    if (!res || !res.ok) { setProfileMsg(t("profile.saveError")); return; }
    const data = await res.json();
    setMarktStand(wert); setMarktName(wert);
    const updated = { ...user, ...data };
    localStorage.setItem("user", JSON.stringify(updated));
    onUserUpdate?.(updated);
  };
  const [showPw, setShowPw] = useState(false);
  // Die ladbaren Apps kommen vom Server (er holt sie beim Release-Anbieter) —
  // aus dem Browser waere der Aufruf durch die CSP geblockt.
  const [apps, setApps] = useState(null);
  useEffect(() => {
    fetch("/api/apps").then((r) => (r.ok ? r.json() : null)).then(setApps).catch(() => {});
  }, []);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminMsg, setAdminMsg] = useState("");
  const [setup, setSetup] = useState(null);
  // Die installierte Version kommt aus VERSION ("4.1.0"), die neueste als
  // GitHub-Tag ("v4.1.0"). Ein "v" davorzuschreiben ergab deshalb einmal
  // "v4.1.0" und einmal "vv4.1.0". Angezeigt wird die nackte Nummer — das "v"
  // gehoert zum Tag, nicht zur Version.
  const nummer = (s) => String(s || "").replace(/^v/i, "");
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

  // Update-Kanal und Sprache sind die zwei begründeten Ausnahmen von „ohne
  // Speichern-Knopf geht nichts": beide sind ein UMSCHALTER, kein Formular.
  // Was sie tun, sieht man sofort (die Oberfläche wechselt die Sprache, die
  // Versionsanzeige den Kanal) — ein „Speichern" daneben hieße, dieselbe
  // Entscheidung zweimal zu treffen, und die Speicherleiste stand hier
  // dauerhaft neben einem Reiter, der längst umgeschaltet aussah. Es geht dabei
  // nichts verloren: es gibt keinen zweiten Wert, der zum ersten passen muss.
  const [kanalBusy, setKanalBusy] = useState(false);
  const kanalWechseln = async (ch) => {
    if (kanalBusy || ch === versionInfo?.channel) return;
    setKanalBusy(true); setVersionLoading(true);
    // Sofort umschalten, damit der Reiter der Antwort nicht hinterherhinkt;
    // was der Server meldet, gilt gleich darauf.
    setVersionInfo((v) => (v ? { ...v, channel: ch } : v));
    await fetch(`${API}/version/channel`, alsJson("PUT", { channel: ch })).catch(() => {});
    const d = await fetch(`${API}/version`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d) setVersionInfo(d);
    setVersionLoading(false); setKanalBusy(false);
  };

  const saveProfile = async (w) => {
    setProfileMsg("");
    const res = await fetch(`${API}/auth/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, salutation, grade_scale: w.gradeScale, grade_tendency: w.gradeTendency,
                             hj1_start: w.hj1 || "", hj2_start: w.hj2 || "", jahr_ende: w.ende || "" }),
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

      {/* Drei Karten, und jede hat GENAU EINE Art zu speichern: das Konto
          (jede Aenderung ihr eigenes Formular mit eigenem Knopf), der
          Unterricht (ein Entwurf, eine Speicherleiste) und ganz unten die
          Umschalter, die sofort wirken. Vorher lagen Sofort-Umschalter und
          Entwurfsfelder in derselben Karte — man sah einer Zeile nicht an, ob
          sie schon gespeichert war. */}
      <Abschnitt id="konto" titel={t("profile.account")} zu={false}
        kopf={<span style={{ fontSize: 13, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</span>}>
        <div style={{ fontSize: 13, color: "var(--text3)" }}>{t("profile.email")}</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{user.email}</div>
        {pendingEmail && (
          <div style={{ fontSize: 12, color: C.warning, marginBottom: 8 }}>
            {t("profile.pending", { email: pendingEmail })}
          </div>
        )}
        {!showEmailForm ? (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <button type="button" onClick={() => { setShowEmailForm(true); setEmailMsg(""); }} style={linkBtn}>{t("profile.changeEmail")}</button>
            <button type="button" onClick={() => setShowPw((o) => !o)} style={linkBtn}>{t("profile.changePw")}</button>
          </div>
        ) : (
          <form onSubmit={changeEmail}>
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
        {emailMsg && <div style={{ fontSize: 13, color: emailMsg === t("profile.linkSent") ? C.success : C.danger, marginTop: 8 }}>{emailMsg}</div>}

        {showPw && (
          <form onSubmit={changePw} autoComplete="on" style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <input type="hidden" name="username" autoComplete="username" value={user?.email || ""} />
            <input type="password" name="current-password" autoComplete="current-password" placeholder={t("profile.oldPw")} value={oldPw} onChange={(e) => setOldPw(e.target.value)}
              style={feldStyle} required />
            <input type="password" name="new-password" autoComplete="new-password" placeholder={t("profile.newPw")} value={newPw} onChange={(e) => setNewPw(e.target.value)}
              style={feldStyle} required />
            {msg && <div style={{ fontSize: 13, color: msg === t("profile.pwChanged") ? C.success : C.danger, marginBottom: 8 }}>{msg}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" style={btnPrimary}>{t("profile.change")}</button>
              <button type="button" onClick={() => setShowPw(false)} style={btnSecondary}>{t("common.cancel")}</button>
            </div>
          </form>
        )}
      </Abschnitt>

      {/* Bewusst kein <form>: die Knöpfe der Speicherleiste wären darin
          Submit-Knöpfe, und „Abbrechen" schickte das Formular ab. */}
      <Abschnitt id="unterricht" titel={t("profile.settings")}>

        {/* Schuljahr zuerst: die Achse, auf der jede Planung liegt. */}
        <Zeile label={t("profile.schuljahr")} hint={t("profile.schuljahrHint")} block erste>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[["hj1", t("profile.hj1")], ["hj2", t("profile.hj2")], ["ende", t("profile.jahrEnde")]].map(([feld, label]) => (
              <label key={feld} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: "var(--text2)" }}>
                <span>{label}</span>
                <input type="date" value={profil.wert[feld] || ""} onChange={(e) => profil.setz({ [feld]: e.target.value })}
                  style={{ ...feldStyle, width: 170, marginBottom: 0 }} />
              </label>
            ))}
          </div>
        </Zeile>

        <style>{".nice-num::-webkit-inner-spin-button,.nice-num::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.nice-num{-moz-appearance:textfield;appearance:textfield}"}</style>
        <Zeile label={t("profile.gradeScale")} hint={t("profile.gradeScaleHint")} block>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
        </Zeile>

        <Zeile label={t("profile.gradeTendency")} hint={t("profile.gradeTendencyHint")}>
          <Tabs value={gradeTendency ? "an" : "aus"} onChange={(v) => profil.setz({ gradeTendency: v === "an" })}
            options={[["an", t("profile.gradeTendencyOn")], ["aus", t("profile.gradeTendencyOff")]]} />
        </Zeile>

        {profileMsg && <div style={{ fontSize: 13, color: profileMsg === t("profile.saved") ? C.success : C.danger, marginTop: 12 }}>{profileMsg}</div>}
        {/* Ohne `immer`: die Leiste erscheint erst, wenn wirklich etwas offen
            ist. Dauerhaft sichtbar stand dort ein Speichern-Knopf, der nichts
            zu speichern hatte. */}
        <Speicherleiste entwurf={profil} style={{ marginTop: 16 }} />
      </Abschnitt>

      {/* Was sofort wirkt, steht zusammen und ohne Speicherleiste: die Sprache
          wechselt die Oberflaeche im selben Augenblick, das Tutorial startet.
          Beides sind die begruendeten Ausnahmen von „ohne Speichern-Knopf geht
          nichts" (siehe CLAUDE.md) — in einer eigenen Karte sieht man, dass
          hier eine andere Regel gilt als eine Karte weiter oben. */}
      <Abschnitt id="sofort" titel={t("profile.sofort")}>
        <Zeile label={t("nav.language")} erste>
          <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ ...selectStyle, minWidth: 160 }}>
            {Object.entries(LANGUAGES).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </Zeile>
        {/* Zwei verschiedene Dinge, deshalb zwei Knöpfe: die Tutorial-SEITE zum
            Nachlesen und der Neustart der eingeblendeten Führung. Der Weg zur
            Seite hing bisher in der Fußzeile — dort sucht ihn niemand, und
            neben dem Neustart steht er bei der Frage, zu der er gehört. */}
        <Zeile label={t("profile.username")} hint={t("profile.usernameHint")}>
          <input placeholder={t("profile.usernamePlaceholder")} value={marktName}
            onChange={(e) => setMarktName(e.target.value)} onBlur={marktSpeichern}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            style={{ ...feldStyle, marginBottom: 0, width: 220 }} />
        </Zeile>
        <Zeile label={t("profile.tutorialTitle")}>
          <Link to="/tutorial" style={{ ...btnSecondary, display: "inline-block", textDecoration: "none", marginRight: 8 }}>
            {t("profile.tutorialOpen")}
          </Link>
          <button type="button" onClick={() => {
            try { localStorage.removeItem(`nuvora_onboarded_${user?.id ?? "x"}`); } catch { /* egal */ }
            window.location.href = "/";
          }} style={btnSecondary}>{t("profile.tutorialRestart")}</button>
        </Zeile>
      </Abschnitt>

      {/* App laden: derselbe Nuvora-Server, nur in einem eigenen Fenster. Es
          steht hier und nicht in der Fusszeile, weil es zur eigenen
          Arbeitsumgebung gehoert wie die Sprache. Plattformen ohne fertige
          Datei bleiben SICHTBAR und sagen „in Vorbereitung" — die Frage „gibt
          es das fuer Windows?" beantwortet die Seite sonst gar nicht. */}
      <Abschnitt id="apps" titel={t("profile.apps")}>
        {(apps?.plattformen || []).map((p, i) => (
          <Zeile key={p.key} label={p.label} erste={i === 0}
            hint={p.datei ? `${p.datei.name} · ${Math.round((p.datei.size || 0) / 1048576)} MB` : t("profile.appsBald")}>
            {p.datei ? (
              <a href={p.datei.url} style={{ ...btnSecondary, display: "inline-block", textDecoration: "none" }}>
                {t("profile.appsLaden")}
              </a>
            ) : (
              <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span>
            )}
          </Zeile>
        ))}
        {apps && !apps.version && <p style={{ fontSize: 13, color: "var(--text3)", margin: "8px 0 0" }}>{t("profile.appsKeine")}</p>}
        {apps?.version && <p style={{ fontSize: 12, color: "var(--text3)", margin: "8px 0 0" }}>{t("profile.appsStand", { version: apps.version })}</p>}
      </Abschnitt>

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
                    <span style={{ fontSize: 14, color: "var(--text)" }}>{t("profile.installed")} <strong>{nummer(versionInfo.current)}</strong></span>
                    {!versionInfo.update_available && (
                      <Icon d={ICONS.checkCircle} size={16} color={C.success} />
                    )}
                  </div>
                  {versionInfo.update_available && (
                    <div style={{ marginTop: 12, padding: 12, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: CONTROL_R, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Icon d={ICONS.download} size={18} color="var(--text)" />
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{t("profile.updateAvailable")} {nummer(versionInfo.latest)}</span>
                      <a href={versionInfo.repo_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>{t("profile.toGithub")}</a>
                    </div>
                  )}
                </div>
                {versionInfo.channels && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("profile.channel")}</span>
                    <Tabs value={versionInfo.channel} onChange={kanalWechseln}
                      options={versionInfo.channels.map((ch) => [ch, t(`profile.channel.${ch}`)])} />
                    <InfoDot text={t(`profile.channelHint.${versionInfo.channel}`)} />
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
                {/* Zwei Spalten, kein `minWidth`: die E-Mail nimmt den Platz,
                    rechts stehen Kennzeichen und Handgriffe. Die Wortspalten
                    „Rolle" und „Status" sind weggefallen — sie brachen auf dem
                    Handy mitten im Wort um und sagten in fast jeder Zeile
                    dasselbe. */}
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t("profile.email")}</th>
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminUsers.map(u => (
                      <tr key={u.id}>
                        <td style={tdStyle}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {/* Nur zwei Dinge sind eine Abweichung vom Normalfall,
                                und beide tragen ihr Wort im `title`: die
                                Administration (Person) und ein Konto, das seine
                                E-Mail noch nicht bestätigt hat (Uhr) — das kann
                                sich nie anmelden. */}
                            {/* Der Titel sitzt am span, nicht am svg: ein
                                title-Attribut am SVG zeigt nicht jeder Browser. */}
                            {u.admin && <span title={t("profile.roleAdmin")} style={{ display: "inline-flex" }}>
                              <Icon d={ICONS.user} size={15} color={C.info} /></span>}
                            {!u.email_verified && <span title={t("profile.unverified")} style={{ display: "inline-flex" }}>
                              <Icon d={ICONS.clock} size={15} color={C.warning} /></span>}
                            {u.email}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                          {/* Ernennen und zurücknehmen. Nicht am ersten Konto
                              (ohne es käme niemand mehr an die Verwaltung) und
                              nicht am eigenen — wer sich selbst herabstuft,
                              steht danach vor einer Seite, die er nicht mehr
                              öffnen darf. */}
                          {!u.fest && u.id !== user.id && (
                            <button
                              className="icon-btn"
                              title={u.admin ? t("profile.roleRevoke") : t("profile.roleGrant")}
                              aria-label={u.admin ? t("profile.roleRevoke") : t("profile.roleGrant")}
                              onClick={async () => {
                                const res = await fetch(`${API}/auth/admin/users/${u.id}/admin`,
                                  alsJson("PUT", { admin: !u.admin }));
                                if (res.ok) setAdminUsers(adminUsers.map((x) => (x.id === u.id ? { ...x, admin: !u.admin } : x)));
                              }}
                              style={{ ...iconBtn, border: "1px solid var(--border2)", borderRadius: CONTROL_R, marginRight: 8 }}
                            ><Icon d={u.admin ? ICONS.userMinus : ICONS.userPlus} size={15} /></button>
                          )}
                          {u.id !== 1 && u.id !== user.id && (
                            <button
                              title={t("profile.deleteUser")}
                              aria-label={t("profile.deleteUser")}
                              onClick={async () => {
                                if (!await askConfirm(t("profile.deleteUserConfirm", { email: u.email }))) return;
                                const res = await fetch(`${API}/auth/admin/users/${u.id}`, { method: "DELETE" });
                                if (res.ok) {
                                  setAdminUsers(adminUsers.filter(x => x.id !== u.id));
                                  setAdminMsg(t("profile.deleted", { email: u.email }));
                                }
                              }}
                              style={{ ...iconBtn, border: "1px solid var(--border2)", borderRadius: CONTROL_R }}
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
