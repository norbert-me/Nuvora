import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
// Inter lokal gebundelt statt Google Fonts (DSGVO: keine IP-Uebermittlung an Google)
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import { LanguageProvider, useLanguage, LANGUAGES } from "./i18n/index.jsx";

// Global fetch interceptor: add auth token to all /api/ requests
const _origFetch = window.fetch;
window.fetch = function(input, init) {
  const url = typeof input === "string" ? input : input?.url;
  if (url && url.startsWith("/api/") && !url.includes("/auth/login") && !url.includes("/auth/register")) {
    const token = localStorage.getItem("token");
    if (token) {
      init = init || {};
      const h = new Headers(init.headers || {});
      if (!h.has("Authorization")) h.set("Authorization", `Bearer ${token}`);
      init = { ...init, headers: h };
    }
  }
  const isApi = url && url.startsWith("/api/");
  return _origFetch.call(this, input, init).then((res) => {
    // Server ist erreichbar (auch bei 4xx/5xx) → online
    if (isApi) window.dispatchEvent(new CustomEvent("cardvote:online"));
    if (res.status === 401 && isApi && !url.includes("/auth/")) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      location.reload();
    }
    return res;
  }).catch((err) => {
    // Netzwerkfehler (Server nicht erreichbar) → offline melden, Fehler weiterreichen
    if (isApi) window.dispatchEvent(new CustomEvent("cardvote:offline"));
    throw err;
  });
};
import { BrowserRouter, Routes, Route, NavLink, Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import Session from "./pages/Session.jsx";
import Scanner from "./pages/Scanner.jsx";
import Classes from "./pages/Classes.jsx";
import Tests from "./pages/Tests.jsx";
import Evaluation from "./pages/Evaluation.jsx";
import ClassEvaluation from "./pages/ClassEvaluation.jsx";
import StudentEvaluation from "./pages/StudentEvaluation.jsx";
import Login from "./pages/Login.jsx";
import Profile from "./pages/Profile.jsx";
import Legal from "./pages/Legal.jsx";
import Changelog from "./pages/Changelog.jsx";
import Landing from "./pages/Landing.jsx";
import Marketplace from "./pages/Marketplace.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import VerifyEmail from "./pages/VerifyEmail.jsx";
import ConfirmEmailChange from "./pages/ConfirmEmailChange.jsx";
import Contact from "./pages/Contact.jsx";
import Help from "./pages/Help.jsx";
import NuvoraHome from "./pages/NuvoraHome.jsx";
import Modules from "./pages/Modules.jsx";
import Topics from "./pages/Topics.jsx";
import LernpfadModule from "./pages/LernpfadModule.jsx";
import Cards from "./pages/Cards.jsx";
import Tutorial from "./pages/Tutorial.jsx";
import NotenModul from "./pages/Noten.jsx";
import { useModules } from "./core/modules.js";
// Navigation ist modulbezogen: die Shell zeigt die Punkte des Moduls, in dem
// man gerade ist. Ausserhalb eines Moduls navigiert Nuvora selbst.
const CV = "/cardvote";

// Bereich fuer die kontextsensitive Hilfe aus dem aktuellen Pfad.
function helpArea(pathname) {
  if (pathname.startsWith("/cardvote")) return "cardvote";
  if (pathname.startsWith("/lernpfad")) return "lernpfad";
  if (pathname.startsWith("/noten")) return "noten";
  return "core";
}
const LP = "/lernpfad";
const NO = "/noten";

// Menue passend zum Bereich. Man soll im Modul-Menue bleiben, auch auf
// modulneutralen Seiten (Hilfe, Impressum), solange man aus einem Modul kam —
// dafuer traegt der Hilfe-Link ?area, sonst greift der Pfad.
const getModuleNavItems = (t, location) => {
  const { pathname, search } = location;
  const params = new URLSearchParams(search);
  const area = pathname.startsWith(CV) ? "cardvote"
    : pathname.startsWith(LP) ? "lernpfad"
    : pathname.startsWith(NO) ? "noten"
    : params.get("area"); // Hilfe u.ae.: Bereich aus der Query

  if (area === "cardvote") {
    return [
      { to: "/classes", label: t("nav.classes") },
      { to: `${CV}/questions`, label: t("nav.questions") },
      { to: `${CV}/session`, label: t("nav.session") },
      { to: `${CV}/tests`, label: t("nav.tests") },
      { to: `${CV}/cards`, label: t("nav.cards") },
      { to: `${CV}/marketplace`, label: t("nav.marketplace") },
    ];
  }
  if (area === "lernpfad") {
    // Tabs der eingebetteten App: steuern das iframe per ?tab. Aktiv = tab-Query.
    const cur = params.get("tab") || "aufgaben";
    return [
      { to: `${LP}?tab=aufgaben`, label: t("nav.exercises"), active: cur === "aufgaben" },
      { to: `${LP}?tab=klasse`, label: t("nav.classes"), active: cur === "klasse" },
      { to: `${LP}?tab=generator`, label: "Lernleiter", active: cur === "generator" },
      { to: `${LP}?tab=lernpfade`, label: t("nav.topics") === "Themen" ? "Lernpfade" : "Lernpfade", active: cur === "lernpfade" },
    ];
  }
  if (area === "noten") {
    return [{ to: NO, label: t("nav.grades") }];
  }
  // Kern: der Nuvora-Schriftzug links fuehrt zur Startseite.
  return [
    { to: "/classes", label: t("nav.classes") },
    { to: "/topics", label: t("nav.topics") },
    { to: "/modules", label: t("nav.modules") },
  ];
};

// Ein Modul ist nur erreichbar, wenn es aktiviert ist — sonst waere das
// Register reine Anzeige. Wer eine Modul-Adresse aufruft ohne es aktiviert zu
// haben, landet bei der Modulauswahl statt auf einer kaputten Seite.
function ModuleGate({ moduleKey, children }) {
  const { modules, loading } = useModules();
  if (loading) return null;
  const mod = modules.find((m) => m.key === moduleKey);
  if (!mod?.active) return <Navigate to="/modules" replace />;
  return children;
}

function ConnectionMonitor() {
  const [online, setOnline] = useState(true);
  const [reason, setReason] = useState("server"); // "server" | "db"
  const [reconnecting, setReconnecting] = useState(false);
  const hasBeenOffline = useRef(false);

  const check = async (aliveRef) => {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000); // toter Host darf nicht in den langen TCP-Timeout laufen
    try {
      const r = await _origFetch("/api/health", { cache: "no-store", signal: ctrl.signal });
      if (aliveRef && !aliveRef.alive) return;
      if (r.ok) { setOnline(true); return; }
      // Server antwortet, aber nicht ok → z.B. Datenbank down (503 db_down)
      let body = {};
      try { body = await r.json(); } catch {}
      setReason(body.status === "db_down" ? "db" : "server");
      setOnline(false);
    } catch {
      if (aliveRef && !aliveRef.alive) return;
      setReason("server");
      setOnline(false);
    } finally {
      clearTimeout(to);
    }
  };

  useEffect(() => {
    const ref = { alive: true };
    check(ref);
    const iv = setInterval(() => check(ref), 5000);
    const goOff = () => { setReason("server"); setOnline(false); };
    const goOn = () => setOnline(true);
    const onBrowserOffline = () => { setReason("server"); setOnline(false); };
    const onBrowserOnline = () => check(ref);
    window.addEventListener("cardvote:offline", goOff);
    window.addEventListener("cardvote:online", goOn);
    window.addEventListener("offline", onBrowserOffline);
    window.addEventListener("online", onBrowserOnline);
    return () => {
      ref.alive = false;
      clearInterval(iv);
      window.removeEventListener("cardvote:offline", goOff);
      window.removeEventListener("cardvote:online", goOn);
      window.removeEventListener("offline", onBrowserOffline);
      window.removeEventListener("online", onBrowserOnline);
    };
  }, []);

  // Im Offline-Zustand schneller nachprüfen (bestätigt DB-/Server-Status live)
  useEffect(() => {
    if (online) return;
    hasBeenOffline.current = true;
    const ref = { alive: true };
    const fast = setInterval(() => check(ref), 4000);
    return () => { ref.alive = false; clearInterval(fast); };
  }, [online]);

  // Auto-Reconnect: nach einem Ausfall Seite neu laden, damit alle Daten frisch sind
  useEffect(() => {
    if (online && hasBeenOffline.current) {
      hasBeenOffline.current = false;
      setReconnecting(true);
      const t = setTimeout(() => window.location.reload(), 1800);
      return () => clearTimeout(t);
    }
  }, [online]);

  // Nav-Header per CSS-Variable unter den Offline-Balken schieben (statt zu überdecken)
  useEffect(() => {
    const root = document.documentElement;
    if (!online) root.style.setProperty("--offline-banner-h", "34px");
    else root.style.removeProperty("--offline-banner-h");
    return () => root.style.removeProperty("--offline-banner-h");
  }, [online]);

  if (reconnecting) {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 1100,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}>
        <style>{`@keyframes cmpop{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}`}</style>
        <div style={{
          background: "var(--card, #fff)", borderRadius: 20, padding: "28px 32px", maxWidth: 360, width: "100%",
          textAlign: "center", boxShadow: "0 12px 40px rgba(0,0,0,0.3)", animation: "cmpop 0.2s ease-out",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 28, margin: "0 auto 14px",
            background: "rgba(10,125,62,0.12)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0a7d3e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text, #1d1d1f)", marginBottom: 6 }}>Verbindung wiederhergestellt</div>
          <p style={{ fontSize: 14, color: "var(--text3, #6e6e73)", margin: "0 0 18px", lineHeight: 1.5 }}>
            Der Server ist wieder erreichbar. Die Seite wird jetzt aktualisiert…
          </p>
          <button onClick={() => window.location.reload()} style={{
            padding: "10px 24px", fontSize: 15, fontWeight: 600, cursor: "pointer",
            background: "#0a7d3e", color: "#fff", border: "none", borderRadius: 980,
          }}>
            Jetzt aktualisieren
          </button>
        </div>
      </div>
    );
  }

  if (online) return null;

  const text = reason === "db"
    ? "Datenbank nicht erreichbar — Änderungen können gerade nicht gespeichert werden. Neuversuch läuft…"
    : "Keine Verbindung zum Server — Änderungen können gerade nicht gespeichert werden. Neuversuch läuft…";

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 200, height: 34,
      background: "#d1350f", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
      padding: "0 16px", fontSize: 13, fontWeight: 600,
      boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
    }}>
      <style>{`@keyframes cmspin{to{transform:rotate(360deg)}}`}</style>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "cmspin 0.9s linear infinite", flexShrink: 0 }}>
        <path d="M21 12a9 9 0 1 1-6.2-8.5"/>
      </svg>
      <span>{text}</span>
    </div>
  );
}

function DarkModeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("darkMode", String(next));
  };
  return (
    <button onClick={toggle} style={{
      background: "none", border: "none", cursor: "pointer", padding: 6,
      lineHeight: 1, borderRadius: 8, flexShrink: 0, color: "var(--text2)",
    }} title={dark ? "Light Mode" : "Dark Mode"}>
      {dark ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  );
}

function LanguageSwitcher() {
  const { lang, setLang, t } = useLanguage();
  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value)}
      title={t("nav.language")}
      style={{
        background: "none", border: "none", cursor: "pointer", padding: "6px 2px",
        fontSize: 13, fontWeight: 600, color: "var(--text2)", flexShrink: 0,
      }}
    >
      {Object.entries(LANGUAGES).map(([code, label]) => (
        <option key={code} value={code}>{code.toUpperCase()}</option>
      ))}
    </select>
  );
}

function Nav({ user, onLogout }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useLanguage();

  const navItems = getModuleNavItems(t, location);
  const allPages = [...navItems, { to: `${CV}/tutorial`, label: t("nav.tutorial") }, { to: `${CV}/scan`, label: t("nav.scanner") }, { to: "/profile", label: t("nav.profile") }, { to: `${CV}/evaluation`, label: t("nav.evaluation") }, { to: "/changelog", label: t("nav.changelog") }, { to: "/login", label: t("nav.login") }];
  const pageTitle = allPages.find((item) => location.pathname.startsWith(item.to))?.label || "";

  const showNav = !!user;

  return (
    <>
      <style>{`
        @media (max-width: 640px) {
          .nav-links-desktop { display: none !important; }
          .nav-burger { display: flex !important; }
          .nav-profile-name { display: none !important; }
          .nav-page-title { display: block !important; }
          .page-title { display: none !important; }
        }
        @media (min-width: 641px) {
          .nav-links-desktop { display: flex !important; }
          .nav-burger { display: none !important; }
          .nav-profile-name { display: inline !important; }
          .nav-page-title { display: none !important; }
          .nav-mobile-menu { display: none !important; }
        }
      `}</style>
      <nav style={{
        padding: "0 16px",
        borderBottom: "1px solid var(--nav-border)",
        background: "var(--nav-bg)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        position: "sticky",
        top: "var(--offline-banner-h, 0px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        height: 52,
        gap: 4,
      }}>
        <NavLink to="/" style={{ textDecoration: "none", flexShrink: 0 }}>
          <div style={{
            fontWeight: 700,
            fontSize: 20,
            marginRight: 8,
            color: "var(--text)",
            letterSpacing: "-0.5px",
          }}>
            Nuvora
          </div>
        </NavLink>

        {showNav && (
          <button
            className="nav-burger"
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              display: "none", background: "none", border: "none", cursor: "pointer",
              padding: 6, fontSize: 20, color: "var(--text)", lineHeight: 1, borderRadius: 8,
            }}
          >
            {menuOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            )}
          </button>
        )}

        {showNav && (
          <span className="nav-page-title" style={{
            display: "none", fontSize: 15, fontWeight: 600, color: "var(--text)",
            flex: 1, textAlign: "center",
          }}>
            {pageTitle}
          </span>
        )}

        <div className={showNav ? "nav-links-desktop" : ""} style={{ display: showNav ? "flex" : "block", gap: 2, overflow: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", msOverflowStyle: "none", flex: 1, minWidth: 0, marginLeft: 8 }}>
          {showNav && navItems.map((item) => {
            const isActive = item.active !== undefined ? item.active : location.pathname.startsWith(item.to.split("?")[0]) && !item.to.includes("?");
            return (
              <NavLink
                key={item.to}
                to={item.to}
                style={{
                  padding: "6px 12px",
                  borderRadius: 980,
                  textDecoration: "none",
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? "var(--text)" : "var(--text2)",
                  background: isActive ? "var(--bg2)" : "transparent",
                  transition: "all 0.2s ease",
                  letterSpacing: "-0.1px",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {item.label}
              </NavLink>
            );
          })}
        </div>

        <LanguageSwitcher />
        <DarkModeToggle />
        <NavLink to={user ? "/profile" : "/login"} onClick={() => { setMenuOpen(false); if (!user) window.dispatchEvent(new Event("cardvote:reset-login-mode")); }} style={{
          padding: 6,
          borderRadius: 980,
          textDecoration: "none",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--text2)",
          background: "transparent",
          whiteSpace: "nowrap",
          flexShrink: 0,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/>
          </svg>
          <span className="nav-profile-name">{user ? t("nav.profile") : t("nav.login")}</span>
        </NavLink>
      </nav>

      {showNav && menuOpen && (
        <div className="nav-mobile-menu" style={{
          position: "fixed", top: 52, left: 0, right: 0, bottom: 0, zIndex: 99,
          background: "var(--nav-bg)", backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          padding: "8px 16px",
        }}>
          {navItems.map((item) => {
            const isActive = item.active !== undefined ? item.active : location.pathname.startsWith(item.to.split("?")[0]) && !item.to.includes("?");
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMenuOpen(false)}
                style={{
                  display: "block", padding: "14px 16px", borderRadius: 12,
                  textDecoration: "none", fontSize: 17, fontWeight: isActive ? 700 : 500,
                  color: isActive ? "var(--text)" : "var(--text2)",
                  background: isActive ? "var(--bg2)" : "transparent",
                  marginBottom: 2,
                }}
              >
                {item.label}
              </NavLink>
            );
          })}
        </div>
      )}
    </>
  );
}

const HOME_STEP_LINKS = ["/classes", `${CV}/questions`, `${CV}/session`, `${CV}/scan`, `${CV}/tests`];

function Home() {
  const { t } = useLanguage();
  const homeSteps = HOME_STEP_LINKS.map((link, i) => ({
    link,
    title: t(`home.step${i + 1}.title`),
    desc: t(`home.step${i + 1}.desc`),
  }));
  const [contribBefore, contribAfter] = t("home.contribute").split("{{link}}");
  return (
    <div>
      <style>{`@media (max-width: 640px) { .home-box { padding: 20px 18px !important; } }`}</style>
      <div className="home-box" style={{ padding: "32px 36px", background: "var(--bg3)", borderRadius: 20, marginBottom: 40, border: "1px solid var(--border)" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 28, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.5px" }}>{t("home.title")}</h2>
        <p style={{ color: "var(--text3)", margin: "0 0 28px", fontSize: 15, lineHeight: 1.6 }}>
          {t("home.intro")}
        </p>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
          {homeSteps.map((step, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", maxWidth: 480 }}>
              <Link to={step.link} style={{
                display: "flex", alignItems: "center", gap: 16, width: "100%",
                padding: "18px 22px", background: "var(--card)", borderRadius: 14,
                border: "1px solid var(--border)", textDecoration: "none",
                transition: "border-color 0.2s",
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 17, flexShrink: 0,
                  background: "var(--text)", color: "var(--bg)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700,
                }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)", marginBottom: 2, letterSpacing: "-0.2px" }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.4 }}>{step.desc}</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </Link>
              {i < homeSteps.length - 1 && (
                <div style={{ width: 2, height: 24, background: "var(--border2)", borderRadius: 1 }} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ display: "inline-block", padding: "18px 28px", background: "var(--bg3)", borderRadius: 16, border: "1px solid var(--border)", maxWidth: 480 }}>
          <p style={{ fontSize: 14, color: "var(--text2)", margin: 0, lineHeight: 1.6 }}>
            {contribBefore}
            <Link to="/contact" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>{t("footer.contact")}</Link>
            {contribAfter}
          </p>
        </div>
      </div>
    </div>
  );
}

const footerLink = { color: "var(--text3)", textDecoration: "none", whiteSpace: "nowrap" };
const footerSep = { color: "var(--text3)" };

function ContentWrapper({ children }) {
  const location = useLocation();
  const isSession = location.pathname.startsWith("/session");
  if (isSession) return <div style={{ padding: "24px 16px 64px" }}>{children}</div>;
  return (
    <>
      <style>{`@media (max-width: 640px) { .content-wrap { padding: 16px 12px 64px !important; } }`}</style>
      <div className="content-wrap" style={{ padding: "32px 32px 64px", maxWidth: 920, margin: "0 auto" }}>{children}</div>
    </>
  );
}

function AppRoutes({ user, setUser, logout }) {
  const location = useLocation();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const handleLogin = (u) => {
    setUser(u);
    navigate("/");
  };

  return (
    <>
      <Nav user={user} onLogout={logout} />
      <ContentWrapper>
        <Routes>
          {/* ─── Nuvora-Rahmen ─── */}
          <Route path="/" element={user ? <NuvoraHome user={user} /> : <Landing />} />
          <Route path="/modules" element={user ? <Modules /> : <Landing />} />
          <Route path="/classes" element={user ? <Classes /> : <Landing />} />
          <Route path="/topics" element={user ? <Topics /> : <Landing />} />
          <Route path="/login" element={user ? <NuvoraHome user={user} /> : <Login onLogin={handleLogin} />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/confirm-email-change" element={<ConfirmEmailChange />} />
          <Route path="/profile" element={user ? <Profile user={user} onLogout={logout} onUserUpdate={setUser} /> : <Landing />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/help" element={<Help />} />

          {/* ─── Modul Noten ─── */}
          <Route path={NO} element={user ? <ModuleGate moduleKey="noten"><NotenModul /></ModuleGate> : <Landing />} />

          {/* ─── Modul Lernpfad ─── */}
          {/* Die App laeuft eingebettet (siehe LernpfadModule) — nicht in React
              nachgebaut. Ihre eigene Navigation bleibt darin erhalten. */}
          <Route path={LP} element={user ? <ModuleGate moduleKey="lernpfad"><LernpfadModule /></ModuleGate> : <Landing />} />

          {/* ─── Modul CardVote ─── */}
          <Route path={CV} element={user ? <Navigate to={`${CV}/questions`} replace /> : <Landing />} />
          <Route path={`${CV}/questions`} element={user ? <ModuleGate moduleKey="cardvote"><Dashboard /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/session`} element={user ? <ModuleGate moduleKey="cardvote"><Session /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/session/:id`} element={user ? <ModuleGate moduleKey="cardvote"><Session /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/tests`} element={user ? <ModuleGate moduleKey="cardvote"><Tests /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/evaluation/:id`} element={user ? <ModuleGate moduleKey="cardvote"><Evaluation /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/class-evaluation/:id`} element={user ? <ModuleGate moduleKey="cardvote"><ClassEvaluation /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/student-evaluation/:classId/:cardId`} element={user ? <ModuleGate moduleKey="cardvote"><StudentEvaluation /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/scan`} element={user ? <ModuleGate moduleKey="cardvote"><Scanner /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/tutorial`} element={user ? <ModuleGate moduleKey="cardvote"><Tutorial /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/cards`} element={user ? <ModuleGate moduleKey="cardvote"><Cards /></ModuleGate> : <Landing />} />
          <Route path={`${CV}/marketplace`} element={user ? <ModuleGate moduleKey="cardvote"><Marketplace /></ModuleGate> : <Landing />} />

          {/* Alte CardVote-Adressen (Lesezeichen, Links in Mails) umleiten. */}
          <Route path={`${CV}/classes`} element={<Navigate to="/classes" replace />} />
          {["questions", "session", "tests", "scan", "marketplace"].map((p) => (
            <Route key={p} path={`/${p}/*`} element={<Navigate to={`${CV}/${p}`} replace />} />
          ))}
        </Routes>
      </ContentWrapper>
      <footer style={{ textAlign: "center", padding: "16px 0 24px", fontSize: 12, color: "var(--text3)" }}>
        {/* Rueckmeldungs-Hinweis: stand frueher nur auf der Landing- und der
            CardVote-Startseite. In der Fussleiste laeuft er auf jeder Seite mit. */}
        <p style={{ margin: "0 auto 12px", maxWidth: 520, lineHeight: 1.6, padding: "0 16px" }}>
          {t("home.contribute").split("{{link}}")[0]}
          <Link to="/contact" style={{ color: "var(--accent)", textDecoration: "none" }}>{t("footer.contact")}</Link>
          {t("home.contribute").split("{{link}}")[1]}
        </p>
        {/* Auf schmalen Bildschirmen brach "Impressum & Datenschutz" mitten im
            Link um und las sich wie zwei Eintraege — es ist aber eine Seite.
            Deshalb umbruchfest, und die Trenner duerfen umbrechen statt der
            Beschriftungen. Kontakt steht vor den Rechtsseiten: er wird
            haeufiger gebraucht. */}
        <span style={{ display: "inline-flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: "0 8px", padding: "0 16px" }}>
          <Link to={`/help?area=${helpArea(location.pathname)}`} style={footerLink}>{t("footer.help")}</Link>
          <span style={footerSep}>·</span>
          <Link to={`${CV}/tutorial`} style={footerLink}>Tutorial</Link>
          <span style={footerSep}>·</span>
          <Link to="/changelog" style={footerLink}>{t("footer.changelog")}</Link>
          <span style={footerSep}>·</span>
          <Link to="/contact" style={footerLink}>{t("footer.contact")}</Link>
          <span style={footerSep}>·</span>
          <Link to="/legal" style={footerLink}>{t("footer.legal")}</Link>
          <span style={footerSep}>·</span>
          <a href="https://github.com/norbert-me/CardVote" target="_blank" rel="noopener noreferrer" style={footerLink}>GitHub</a>
        </span>
      </footer>
    </>
  );
}

function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("user")); } catch { return null; }
  });

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  };

  return (
    <LanguageProvider>
      <BrowserRouter>
        <ConnectionMonitor />
        <AppRoutes user={user} setUser={setUser} logout={logout} />
      </BrowserRouter>
    </LanguageProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
