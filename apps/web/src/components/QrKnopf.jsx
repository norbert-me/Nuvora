// Ein Knopf „QR", der zu einem Link ein QR-Bild zeigt — zum Abfotografen am
// Beamer oder Ausdrucken, statt den Link abzutippen. Das Bild macht der Server
// (`/api/qr`), gezeigt wird es im Dialog mit dem Link darunter.
import { useState } from "react";
import { Modal, btnSecondary, btnSmall } from "./Icons.jsx";
import AuthImage from "./AuthImage.jsx";
import { useLanguage } from "../i18n/index.jsx";

export default function QrKnopf({ url, titel = "" }) {
  const { t } = useLanguage();
  const [offen, setOffen] = useState(false);
  if (!url) return null;
  return (
    <>
      <button onClick={() => setOffen(true)} style={{ ...btnSecondary, ...btnSmall }} title={t("qr.zeigen")}>QR</button>
      {offen && (
        <Modal onClose={() => setOffen(false)} width={360} title={titel || t("qr.titel")}>
          <div style={{ display: "flex", justifyContent: "center", background: "#fff", borderRadius: 12, padding: 12 }}>
            <AuthImage src={`/api/qr?text=${encodeURIComponent(url)}`} alt="QR" zoomable={false} style={{ width: 280, height: 280, imageRendering: "pixelated" }} />
          </div>
          <p style={{ fontSize: 12, color: "var(--text3)", margin: "10px 0 0", overflowWrap: "anywhere", textAlign: "center" }}>{url}</p>
        </Modal>
      )}
    </>
  );
}
