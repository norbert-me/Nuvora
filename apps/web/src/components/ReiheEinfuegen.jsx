// Eine Reihe in den Kalender uebernehmen: die Stunden der Reihe der Reihe nach auf die freien
// Unterrichtsstunden eines Kurses legen (Vorschau vor dem Anlegen). Aufgerufen vom Editor der
// Reihe (feste Reihe) und aus dem Kalender (Reihe wird hier gewaehlt) — beides nur mit aktivem
// Kalender- und Reihen-Modul, den Schalter setzt der Aufrufer.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { COLORS as C, CONTROL_R, Modal, btnPrimary, btnSecondary, inputStyle, selectStyle } from "./Icons.jsx";
import { DialogFuss } from "./Speichern.jsx";
import { alsJson, hol } from "../core/melden.js";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/reihen";
const ymd = (d) => d.toISOString().slice(0, 10);

export default function InKurs({ reihe: reiheFix = null, kursId: kursVor = "", onClose }) {
  const { t } = useLanguage();
  const [kurse, setKurse] = useState([]);
  const [kursId, setKursId] = useState(kursVor ? String(kursVor) : "");
  // Ohne feste Reihe (Aufruf aus dem Kalender) wird sie hier gewaehlt.
  const [reihen, setReihen] = useState([]);
  const [reiheId, setReiheId] = useState(reiheFix ? reiheFix.id : "");
  const reihe = reiheFix || { id: reiheId };
  useEffect(() => { if (!reiheFix) hol(API).then((d) => setReihen(Array.isArray(d) ? d : [])); }, [reiheFix]);
  const [ab, setAb] = useState(ymd(new Date()));
  const [vor, setVor] = useState(null);
  const [fehler, setFehler] = useState("");
  const [fertig, setFertig] = useState(null);
  useEffect(() => { hol("/api/kurse").then((d) => setKurse(Array.isArray(d) ? d : [])); }, []);
  useEffect(() => {
    setVor(null);
    if (!kursId || !ab || !reihe.id) return;
    let abbruch = false;
    hol(`${API}/${reihe.id}/vorschau?kurs_id=${kursId}&ab=${ab}`, null).then((d) => { if (!abbruch) setVor(Array.isArray(d) ? d : null); });
    return () => { abbruch = true; };
  }, [kursId, ab, reihe.id]);
  const tag = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "2-digit" });
  const anlegen = async () => {
    setFehler("");
    const res = await fetch(`${API}/${reihe.id}/ausspielen`, alsJson("POST", { kurs_id: Number(kursId), ab })).catch(() => null);
    if (res && res.ok) { setFertig(await res.json()); return; }
    const b = res ? await res.json().catch(() => ({})) : {};
    setFehler(typeof b.detail === "string" ? b.detail : t("common.notWork"));
  };
  if (fertig) {
    return (
      <Modal onClose={onClose} width={440} title={t("reihen.inKurs")}>
        <p style={{ fontSize: 14 }}>{t("reihen.angelegt", { n: fertig.angelegt })}</p>
        {fertig.nicht_platziert.length > 0 && <p style={{ color: C.warning, fontSize: 13 }}>{t("reihen.nichtPlatziert", { n: fertig.nicht_platziert.length })}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Link to="/kalender" style={{ ...btnPrimary, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>{t("reihen.zumKalender")}</Link>
          <button onClick={onClose} style={btnSecondary}>{t("noten.close")}</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal onClose={onClose} width={520} title={t("reihen.inKurs")}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!reiheFix && (
          <select value={reiheId} onChange={(e) => setReiheId(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
            <option value="">{t("reihen.reiheWaehlen")}</option>
            {reihen.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
        <select value={kursId} onChange={(e) => setKursId(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
          <option value="">{t("reihen.kursWaehlen")}</option>
          {kurse.map((k) => <option key={k.id} value={k.id}>{k.fach ? `${k.fach} · ` : ""}{k.name}</option>)}
        </select>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--text2)" }}>
          {t("reihen.ab")} <input type="date" value={ab} onChange={(e) => setAb(e.target.value)} style={inputStyle} />
        </label>
        {vor && (
          <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: 8, fontSize: 13 }}>
            {vor.map((v) => (
              <div key={v.stunde_id} style={{ display: "flex", gap: 8, padding: "3px 0" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.titel || t("reihen.stundeOhneTitel")}</span>
                <span style={{ color: v.platziert ? "var(--text2)" : C.warning, whiteSpace: "nowrap" }}>
                  {v.platziert ? v.termine.map((x) => `${tag(x.date)} ${x.period}.`).join(", ") : t("reihen.keinPlatz")}
                </span>
              </div>
            ))}
          </div>
        )}
        {kursId && vor && vor.length === 0 && <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("reihen.keinePlaetze")}</p>}
        {fehler && <div style={{ color: C.danger, fontSize: 13 }}>{fehler}</div>}
      </div>
      <DialogFuss onAbbrechen={onClose} onSpeichern={anlegen} aus={!kursId || !reihe.id || !vor || vor.every((v) => !v.platziert)} speichern={t("reihen.anlegen")} />
    </Modal>
  );
}
