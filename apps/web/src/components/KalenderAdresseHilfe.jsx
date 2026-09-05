import { useState } from "react";
import { modalOverlay, modalPanel, overlayGuard, btnSecondary, btnPrimary, Icon, ICONS, CONTROL_R } from "./Icons.jsx";
import { useLanguage } from "../i18n";

// „Wo finde ich die Adresse meines Kalenders?" — die eine Frage, an der das
// Abonnieren eines fremden Kalenders scheitert. Der Weg dorthin heißt bei jedem
// Anbieter anders und liegt überall drei Klicks tief; ohne Anleitung sucht man
// im falschen Menü und gibt auf.
//
// Als Dialog auf Nachfrage und nicht als Absatz neben dem Feld (siehe die Regel
// gegen Erklärtexte): wer die Adresse hat, fügt sie ein und will nichts lesen.
//
// Keine Fremd-Screenshots: die Oberflächen von Apple, Google und WebUntis
// ändern sich ohne uns, und ein Bild von vorgestern führt sicherer in die Irre
// als ein Satz. Stattdessen die Menüwege als Text — sie halten länger.
const ANBIETER = ["apple", "google", "untis", "outlook"];

export default function KalenderAdresseHilfe({ offen, onClose }) {
  const { t } = useLanguage();
  const [wer, setWer] = useState("apple");
  if (!offen) return null;
  const schritte = t(`kalhilfe.${wer}.schritte`).split("|");
  return (
    <div {...overlayGuard(onClose)} style={modalOverlay}>
      <div style={{ ...modalPanel, maxWidth: 560 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{t("kalhilfe.titel")}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {ANBIETER.map((a) => (
            <button key={a} onClick={() => setWer(a)}
              style={{ ...btnSecondary, borderRadius: CONTROL_R, ...(wer === a ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" } : {}) }}>
              {t(`kalhilfe.${a}.name`)}
            </button>
          ))}
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
          {schritte.map((s, i) => (
            <li key={i} style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>{s}</li>
          ))}
        </ol>
        <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 16, display: "flex", gap: 6, alignItems: "flex-start" }}>
          <Icon d={ICONS.info} size={14} color="var(--text3)" />
          <span>{t("kalhilfe.merke")}</span>
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onClose} style={btnPrimary}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}
