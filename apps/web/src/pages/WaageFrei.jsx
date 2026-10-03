import { pageApp, pageTitle } from "../components/Icons.jsx";
import WaageUeben from "../components/WaageUeben.jsx";
import { useLanguage } from "../i18n";

// Der unüberwachte Weg: die Waage als eigene Seite, OHNE Login und ohne
// Zuordnung — wie /pap-frei. Wer den Link hat, übt; gespeichert wird nur im
// eigenen Browser. Eine Seite, die erst zum Login führt, wäre für die Kinder
// eine Sackgasse.
export default function WaageFrei() {
  const { t } = useLanguage();
  return (
    <div style={{ ...pageApp, padding: "16px" }}>
      <h1 style={pageTitle}>{t("waage.titel")}</h1>
      <WaageUeben />
      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 12 }}>{t("waage.freiSpeicher")}</p>
    </div>
  );
}
