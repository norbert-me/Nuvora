// Tutorial für Nuvora — führt durch Kern und Module, jederzeit neu startbar.
//
// Bewusst kein Overlay über der App: Overlays verdecken genau das, was sie
// erklären, und lassen sich nicht nebenher lesen. Stattdessen eine eigene
// Seite mit Links in die echten Bereiche — wer abbricht, findet den Stand
// wieder, weil der Fortschritt im Konto-Browser gemerkt wird.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon, ICONS, btnPrimary, btnSecondary, cardStyle, pageTitle, COLORS as C, pageApp} from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useAktiv } from "../core/modules.js";

const STORAGE_KEY = "nuvora_tutorial_done";

// `modul`: der Abschnitt erscheint nur, wenn das Modul fuer diese Lehrkraft
// laeuft (Regel 3) — eine Anleitung zu einem Werkzeug, das man nicht hat,
// schickt auf eine Seite, die das ModuleGate gleich wieder verlaesst.
const BEREICHE = [
  { key: "willkommen", ziel: "/modules" },
  // Kinder werden im Kurs gepflegt (Umbau auf Kurse) — einen eigenen
  // Abschnitt „Klasse anlegen" gibt es deshalb nicht mehr.
  { key: "kurse", ziel: "/kurse" },
  { key: "personen", ziel: "/personen" },
  { key: "themen", ziel: "/topics" },
  { key: "module", ziel: "/modules" },
  { key: "cardvote", ziel: "/cardvote/questions", modul: "cardvote" },
  { key: "lernpfad", ziel: "/lernpfad", modul: "lernpfad" },
  { key: "karten", ziel: "/karten", modul: "karten" },
  // Der Kalender in beide Richtungen: fremde Termine herein, Nuvora hinaus.
  // Es ist die haeufigste Rueckfrage — beide Wege liegen hinter Menues, und wer
  // sie nicht kennt, tippt seinen Stundenplan ab.
  { key: "kalender", ziel: "/kalender", modul: "kalender" },
  // „Was sagen mir die Zahlen?" — die Frage, die nach ein paar Wochen kommt.
  { key: "auswerten", ziel: "/auswertung?tab=klassenarbeit", modul: "auswertung" },
  { key: "orga", ziel: "/orga", modul: "orga" },
  { key: "pap", ziel: "/pap", modul: "pap" },
  { key: "tafel", ziel: "/tafel", modul: "tafel" },
  { key: "zufall", ziel: "/zufall", modul: "zufall" },
  { key: "notizbrett", ziel: "/notizbrett", modul: "notizbrett" },
  { key: "einstiege", ziel: "/unterrichtsplanung", modul: "unterrichtsplanung" },
  { key: "mathespiele", ziel: "/mathespiele", modul: "mathespiele" },
  { key: "codedetektiv", ziel: "/code-detektiv", modul: "code-detektiv" },
  // „Wohin mit dem alten Jahr?"
  { key: "jahresende", ziel: "/kurse" },
  { key: "loslegen", ziel: "/modules" },
];

export default function Tutorial() {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const bereiche = BEREICHE.filter((b) => !b.modul || aktiv(b.modul));
  const [done, setDone] = useState({});
  const [offen, setOffen] = useState(BEREICHE[0].key);

  useEffect(() => {
    try { setDone(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch { /* egal */ }
  }, []);

  const merke = (next) => {
    setDone(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* egal */ }
  };

  const toggle = (key) => merke({ ...done, [key]: !done[key] });
  const neu = () => { merke({}); setOffen(BEREICHE[0].key); };

  const kb = (b) => b.keyBase || b.key;
  const fertig = bereiche.filter((b) => done[b.key]).length;

  return (
    <div style={{ ...pageApp }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={pageTitle}>{t("tut.title")}</h1>
        <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("tut.progress", { n: fertig, total: bereiche.length })}</span>
        {fertig > 0 && (
          <button onClick={neu} style={{ marginLeft: "auto", ...btnSecondary }}>{t("tut.restart")}</button>
        )}
      </div>
      <p style={{ color: "var(--text2)", marginBottom: 16, fontSize: 14 }}>
{t("tut.intro")}
      </p>
      <button onClick={() => window.dispatchEvent(new Event("nuvora:start-tour"))}
        style={{ ...btnPrimary, marginBottom: 22 }}>{t("tour.startGuided")}</button>

      {bereiche.map((b, i) => {
        const auf = offen === b.key;
        const erledigt = !!done[b.key];
        return (
          <div key={b.key} style={{ ...cardStyle, padding: 0, marginBottom: 12, overflow: "hidden" }}>
            <button
              onClick={() => setOffen(auf ? null : b.key)}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", padding: 16,
                background: "none", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)",
              }}
            >
              <span style={{
                // Zahlenkreis: der Radius ist die halbe Kante (26/2).
                width: 26, height: 26, borderRadius: 13, flexShrink: 0, fontSize: 13, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: erledigt ? C.success : "var(--bg)", color: erledigt ? C.aufAkzent : "var(--text3)",
                border: erledigt ? "none" : "1px solid var(--border2)",
              }}>
                {erledigt ? "✓" : i + 1}
              </span>
              <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>{t(`tut.${kb(b)}.title`)}</span>
              <span style={{ color: "var(--text3)", display: "inline-flex", transform: auf ? "rotate(90deg)" : "none" }}><Icon d={ICONS.open} size={12} /></span>
            </button>

            {/* 54 links ist kein Abstand, sondern eine Flucht: 16 Polsterung
                + 26 Zahlenkreis + 12 Luecke — der Text steht unter dem Titel. */}
            {auf && (
              <div style={{ padding: "0 16px 16px 54px" }}>
                <ul style={{ margin: "0 0 16px", paddingLeft: 16, color: "var(--text2)", fontSize: 14, lineHeight: 1.75 }}>
{[1,2,3,4,5,6,7].map((k) => { const key = `tut.${kb(b)}.${k}`; const v = t(key); return v === key ? null : <li key={k}>{v}</li>; })}
                </ul>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link to={b.ziel} style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}>{t(`tut.${kb(b)}.goto`)}</Link>
                  <button onClick={() => toggle(b.key)} style={btnSecondary}>
                    {erledigt ? t("tut.reopen") : t("tut.done")}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

