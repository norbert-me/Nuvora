// Einen Kalender-Eintrag in eine Reihe uebernehmen — vom Eintrag selbst aus, ohne den Umweg
// ueber Kurs und Zeitraum: Reihe waehlen (oder neu anlegen), fertig. Nur mit Modul Reihen.
import { useEffect, useState } from "react";
import { COLORS as C, Modal, selectStyle } from "./Icons.jsx";
import { DialogFuss } from "./Speichern.jsx";
import { alsJson, hol } from "../core/melden.js";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/reihen";

export default function ZuReihe({ eintragId, onClose }) {
  const { t } = useLanguage();
  const [reihen, setReihen] = useState([]);
  const [wahl, setWahl] = useState("neu");
  const [fehler, setFehler] = useState("");
  const [fertig, setFertig] = useState(false);
  useEffect(() => { hol(API).then((d) => setReihen(Array.isArray(d) ? d : [])); }, []);
  const speichern = async () => {
    setFehler("");
    const url = wahl === "neu" ? `${API}/aus-kalender` : `${API}/${wahl}/aus-kalender`;
    const res = await fetch(url, alsJson("POST", { eintrag_ids: [eintragId] })).catch(() => null);
    if (res && res.ok) { setFertig(true); return; }
    const b = res ? await res.json().catch(() => ({})) : {};
    setFehler(typeof b.detail === "string" ? b.detail : t("common.notWork"));
  };
  return (
    <Modal onClose={onClose} width={420} title={t("reihen.inReihe")}>
      {fertig ? (
        <p style={{ fontSize: 14 }}>{t("reihen.uebernommen")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <select value={wahl} onChange={(e) => setWahl(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
            <option value="neu">{t("reihen.neueReihe")}</option>
            {reihen.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {fehler && <div style={{ color: C.danger, fontSize: 13 }}>{fehler}</div>}
        </div>
      )}
      <DialogFuss onAbbrechen={onClose} onSpeichern={fertig ? onClose : speichern} speichern={fertig ? t("noten.close") : t("reihen.uebernehmen")} />
    </Modal>
  );
}
