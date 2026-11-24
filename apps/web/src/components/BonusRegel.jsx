// Bonus-Regel der Anforderungsfragen (E/G): eine Oberflaeche fuer die Vorgabe im
// Profil und die einzelne Auswertung.
import { Tabs, Toggle } from "./Icons.jsx";
import { STANDARD_BONUS, bonusRegelVon } from "../core/scoring.js";
import { lokal } from "../core/ansichten.js";

// Vorgabe der Lehrkraft aus dem Profil (am Konto), sonst die eingebaute Regel.
export function profilBonus() {
  const x = lokal("bonus_regel");
  return x ? bonusRegelVon({ bonus_regel: x }) : { ...STANDARD_BONUS };
}

// Wie rechnet der Anforderungs-Bonus? Drei Stellschrauben, dieselben im Profil
// (Vorgabe) und je Auswertung.
export default function BonusRegel({ wert, onChange, t }) {
  const set = (teil) => onChange({ ...wert, ...teil });
  const zeile = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 };
  return (
    <div style={{ marginTop: 6 }}>
      <div style={zeile}>
        <span style={{ fontSize: 13, color: "var(--text2)" }}>{t("cv.bonusMax")}</span>
        <Tabs value={String(wert.maxStufen)} onChange={(v) => set({ maxStufen: Number(v) })} style={{ marginLeft: "auto" }}
          options={[["0.5", "½"], ["1", "1"], ["1.5", "1½"], ["2", "2"]]} />
      </div>
      <div style={zeile}>
        <span style={{ fontSize: 13, color: "var(--text2)" }}>{t("cv.bonusNenner")}</span>
        <Tabs value={String(wert.mindestNenner)} onChange={(v) => set({ mindestNenner: Number(v) })} style={{ marginLeft: "auto" }}
          options={[["1", t("cv.bonusNennerVoll")], ["2", "½"], ["3", "⅓"]]} />
      </div>
      <div style={zeile}>
        <Toggle checked={wert.falschZehrt} onChange={(v) => set({ falschZehrt: v })} label={t("cv.bonusFalsch")} />
      </div>
    </div>
  );
}
