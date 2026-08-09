// 404 — die aufgerufene Adresse gibt es nicht.
//
// Bis hierher fing die Shell unbekannte Adressen zwar ab (nginx liefert die
// index.html aus, siehe apps/web/nginx.conf), zeigte danach aber nur die
// Navigation und darunter nichts: keine Erklaerung, kein Weg zurueck. Diese
// Seite sagt, was los ist, zeigt die Adresse und hilft weiter.
//
// Nicht zu verwechseln mit dem ModuleGate in main.jsx: das leitet auf /modules
// um, wenn es die Seite gibt, das Modul aber nicht aktiviert ist. Hier geht es
// um Adressen, die es ueberhaupt nicht gibt.
import { Link, useLocation, useNavigate } from "react-router-dom";
import { pageForm, pageTitle, pageIntro, btnPrimary, btnSecondary, panelStyle, Icon, ICONS } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useModules, MODUL_KEYS } from "../core/modules.js";

// Sieht die Adresse nach einem Modul aus, das diese Lehrkraft nicht aktiviert
// hat? Dann ist das die wahrscheinlichste Erklaerung — z.B. ein Link aus einer
// Mail auf /karten, waehrend das Modul aus ist. Wird nur eingehaengt, wenn
// jemand angemeldet ist (sonst fragt useModules unnoetig gegen 401).
function ModulHinweis({ modulKey }) {
  const { t } = useLanguage();
  const { modules, loading } = useModules();
  if (loading) return null;
  const mod = modules.find((m) => m.key === modulKey);
  // Aktiv (oder unbekannt): dann liegt es nicht am Modul, sondern an der Adresse.
  if (!mod || mod.active) return null;
  return (
    <div style={{ ...panelStyle, marginTop: 22, textAlign: "left" }}>
      <p style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.6, margin: "0 0 12px" }}>
        {t("notfound.moduleHint", { modul: mod.name })}
      </p>
      <Link to="/modules" style={{ ...btnSecondary, display: "inline-block", textDecoration: "none" }}>
        {t("notfound.moduleLink")}
      </Link>
    </div>
  );
}

export default function NichtGefunden({ user }) {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();

  const adresse = `${location.pathname}${location.search}`;
  const ersterTeil = location.pathname.split("/").filter(Boolean)[0] || "";
  const modulKey = MODUL_KEYS.includes(ersterTeil) ? ersterTeil : null;

  // history.back nur, wenn es wirklich etwas zurueck gibt — sonst landet man
  // wieder auf derselben toten Adresse oder ausserhalb von Nuvora.
  const zurueck = () => { if (window.history.length > 1) navigate(-1); else navigate("/"); };

  return (
    <div style={{ ...pageForm, textAlign: "center", padding: "24px 0 8px" }}>
      <div style={{
        width: 56, height: 56, borderRadius: 28, margin: "0 auto 18px",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--bg3)", border: "1px solid var(--border)",
      }}>
        <Icon d={ICONS.ban} size={26} color="var(--text3)" />
      </div>

      <h1 style={{ ...pageTitle, marginBottom: 10 }}>{t("notfound.title")}</h1>
      <p style={{ ...pageIntro, marginBottom: 18 }}>{t("notfound.intro")}</p>

      <div style={{ ...panelStyle, textAlign: "left", marginBottom: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
          {t("notfound.address")}
        </div>
        {/* Lange Adressen duerfen umbrechen, sonst schiebt eine 404 auf dem
            Handy (390 px) die ganze Seite waagerecht raus. */}
        <code style={{ fontSize: 13, color: "var(--text)", wordBreak: "break-all", lineHeight: 1.5 }}>{adresse}</code>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <Link to="/" style={{ ...btnPrimary, display: "inline-block", textDecoration: "none" }}>{t("notfound.home")}</Link>
        <button onClick={zurueck} style={btnSecondary}>{t("notfound.back")}</button>
      </div>

      {user && modulKey && <ModulHinweis modulKey={modulKey} />}
    </div>
  );
}
