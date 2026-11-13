// Kurse zusammenfuehren: dieser Kurs bleibt (Ziel), die angehakten gehen hinein. Vorschau
// zeigt vorher, was wandert; ausgefuehrt wird mit dem Passwort. Nichts wird zusammengelegt —
// Doppeltes (zwei Notenbereiche „Muendlich") steht danach nebeneinander. Die Quellkurse
// kommen in den Papierkorb.
import { useEffect, useState } from "react";
import { COLORS as C, CONTROL_R, Modal } from "./Icons.jsx";
import { DialogFuss } from "./Speichern.jsx";
import { askPrompt } from "../core/dialog.jsx";
import { alsJson, hol } from "../core/melden.js";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/kurse";

export default function KurseZusammen({ ziel, kurse, onClose, onFertig }) {
  const { t } = useLanguage();
  const andere = kurse.filter((k) => k.id !== ziel.id);
  const [wahl, setWahl] = useState([]);
  const [vor, setVor] = useState(null);
  const [fehler, setFehler] = useState("");
  const umschalten = (id) => setWahl((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));
  useEffect(() => {
    setVor(null);
    if (!wahl.length) return;
    let weg = false;
    hol(`${API}/${ziel.id}/zusammenfuehren?quellen=${wahl.join(",")}`, null).then((d) => { if (!weg) setVor(Array.isArray(d) ? d : null); });
    return () => { weg = true; };
  }, [wahl, ziel.id]);
  const summe = (z) => Object.values(z || {}).reduce((a, b) => a + b, 0);
  const ausfuehren = async () => {
    setFehler("");
    const pw = await askPrompt(t("kurse.zusammenPasswort"), { typ: "password" });
    if (!pw) return;
    const res = await fetch(`${API}/${ziel.id}/zusammenfuehren`, alsJson("POST", { quellen: wahl, password: pw })).catch(() => null);
    if (res && res.ok) { onFertig(); return; }
    const b = res ? await res.json().catch(() => ({})) : {};
    setFehler(typeof b.detail === "string" ? b.detail : t("common.notWork"));
  };
  return (
    <Modal onClose={onClose} width={480} title={t("kurse.zusammenTitel", { name: ziel.name })}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: 8, fontSize: 13 }}>
          {andere.map((k) => (
            <label key={k.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={wahl.includes(k.id)} disabled={!wahl.includes(k.id) && wahl.length >= 5} onChange={() => umschalten(k.id)} />
              <span style={{ flex: 1, minWidth: 0 }}>{k.fach ? `${k.fach} · ` : ""}{k.name}</span>
              {vor && vor.find((v) => v.id === k.id) && (
                <span style={{ color: "var(--text3)", whiteSpace: "nowrap" }}>{t("kurse.zusammenZeilen", { n: summe(vor.find((v) => v.id === k.id).zeilen) })}</span>
              )}
            </label>
          ))}
        </div>
        {wahl.length > 0 && <p style={{ fontSize: 13, color: "var(--text2)", margin: 0 }}>{t("kurse.zusammenHinweis", { name: ziel.name })}</p>}
        {fehler && <div style={{ color: C.danger, fontSize: 13 }}>{fehler}</div>}
      </div>
      <DialogFuss onAbbrechen={onClose} onSpeichern={ausfuehren} aus={!wahl.length || !vor} speichern={t("kurse.zusammenAusfuehren")} />
    </Modal>
  );
}
