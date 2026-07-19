// Einheitlicher „Zum Marktplatz veröffentlichen"-Dialog für alle Module.
// Vorher: CardVote hatte ein Modal mit Beschreibungsfeld, Karten/Einstiege nur
// einen kargen Prompt. Jetzt überall dieselbe Form.
//
// onPublish(description) muss ein Promise liefern, das bei Erfolg truthy ist
// (z.B. die fetch-Response mit .ok). Der Dialog zeigt dann kurz „veröffentlicht"
// und schließt sich.
import { useState } from "react";
import { useLanguage } from "../i18n/index.jsx";
import { Modal, btnPrimary, btnSecondary, inputStyle } from "./Icons.jsx";

export default function PublishModal({ name, onPublish, onClose }) {
  const { t } = useLanguage();
  const [desc, setDesc] = useState("");
  const [state, setState] = useState(""); // "" | "busy" | "ok" | "error"

  const submit = async () => {
    setState("busy");
    const r = await onPublish(desc.trim());
    const ok = r === true || (r && r.ok);
    if (ok) { setState("ok"); setTimeout(onClose, 1200); }
    else setState("error");
  };

  return (
    <Modal onClose={onClose} width={460}>
      <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>{t("publish.title")}</h3>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 16px" }}>{t("publish.text", { name })}</p>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text3)", display: "block", marginBottom: 4 }}>{t("publish.description")}</label>
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("publish.descriptionPh")} rows={3}
        style={{ ...inputStyle, width: "100%", marginBottom: 12, resize: "vertical", fontFamily: "inherit" }} />
      {state === "error" && <div style={{ fontSize: 13, color: "#d1350f", marginBottom: 10 }}>{t("publish.error")}</div>}
      {state === "ok" && <div style={{ fontSize: 13, color: "#0a7d3e", marginBottom: 10 }}>{t("publish.done")}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} disabled={state === "busy" || state === "ok"} style={{ ...btnPrimary, opacity: state === "busy" ? 0.6 : 1 }}>{t("publish.btn")}</button>
        <button onClick={onClose} style={btnSecondary}>{t("common.cancel")}</button>
      </div>
    </Modal>
  );
}
