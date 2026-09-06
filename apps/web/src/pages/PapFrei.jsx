import PapEditor, { leeresDiagramm } from "../components/PapEditor.jsx";
import { useEffect, useState } from "react";
import { cardStyle, pageApp, pageTitle, toolbarBtn, COLORS as C } from "../components/Icons.jsx";
import { askConfirm } from "../core/dialog.jsx";
import { useLanguage } from "../i18n";

// Der unüberwachte Weg: der Editor als eigene Seite, OHNE Login und ohne
// Zuordnung. Der Link lässt sich austeilen (Tafel, Klassenchat), jede und jeder
// zeichnet für sich, gespeichert wird nur im eigenen Browser.
//
// Bewusst eine eigene Route und nicht das Modul mit ausgeblendeter Navigation:
// wer den Link bekommt, hat kein Nuvora-Konto — eine Seite, die erst zum Login
// führt, wäre für die Kinder eine Sackgasse.
const KEY = "nuvora_pap_frei";

export default function PapFrei() {
  const { t } = useLanguage();
  const [d, setD] = useState(leeresDiagramm());

  useEffect(() => {
    try { setD(JSON.parse(localStorage.getItem(KEY)) || leeresDiagramm()); } catch { /* leer */ }
  }, []);

  const setzen = (next) => {
    setD(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* voll oder gesperrt */ }
  };

  return (
    <div style={{ ...pageApp, padding: "16px" }}>
      <h1 style={pageTitle}>{t("pap.titel")}</h1>
      <div style={{ ...cardStyle, padding: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button onClick={() => window.print()} style={toolbarBtn}>{t("pap.drucken")}</button>
          <button onClick={async () => { if (await askConfirm(t("pap.leerenFrage"))) setzen(leeresDiagramm()); }}
            style={{ ...toolbarBtn, color: C.danger }}>{t("pap.leeren")}</button>
        </div>
        <PapEditor wert={d} onChange={setzen} />
      </div>
      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 12 }}>{t("pap.freiHinweis")}</p>
    </div>
  );
}
