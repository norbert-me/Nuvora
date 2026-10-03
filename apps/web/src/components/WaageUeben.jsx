// Freies Üben an der Waage — für die offene Seite (/waage-frei) und den
// Reiter „Üben" im Modul. Eine Gleichung würfeln (Stufe 1–4) oder selbst
// eintippen; der Stand liegt nur im Browser (localStorage), wie beim
// PAP-Editor: wer den Link hat, übt für sich, nichts wird zugeordnet.
import { useState } from "react";
import { COLORS as C, Segment, btnPrimary, btnSecondary, btnSmall, cardStyle, inputStyle, segmentBtn } from "./Icons.jsx";
import WaageEditor, { leererWeg } from "./WaageEditor.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { pruefeGleichung, stand, zufall } from "../core/waage.js";

function laden(key) {
  try {
    const x = JSON.parse(localStorage.getItem(key) || "null");
    if (x && x.start && !pruefeGleichung(x.start)) return x;
  } catch { /* leer oder gesperrt */ }
  return { stufe: 3, start: zufall(3), weg: leererWeg() };
}

export default function WaageUeben({ speicher = "nuvora_waage_frei" }) {
  const { t } = useLanguage();
  const [z, setZ] = useState(() => laden(speicher));
  const [eigene, setEigene] = useState(null);   // { a, b, c, d } beim Eintippen
  const setzen = (next) => {
    setZ(next);
    try { localStorage.setItem(speicher, JSON.stringify(next)); } catch { /* voll oder gesperrt */ }
  };
  const neu = (stufe) => setzen({ stufe, start: zufall(stufe), weg: leererWeg() });
  const eigeneStand = eigene ? stand(...["a", "b", "c", "d"].map((k) => Math.round(Number(eigene[k]) || 0))) : null;
  const eigeneFehler = eigeneStand ? pruefeGleichung(eigeneStand) : null;

  return (
    <div style={{ ...cardStyle, padding: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <Segment>
          {[1, 2, 3, 4].map((s) => (
            <button key={s} onClick={() => neu(s)} aria-pressed={z.stufe === s} title={t(`waage.stufe${s}`)}
              style={{ ...segmentBtn, fontWeight: z.stufe === s ? 700 : 500, color: z.stufe === s ? "var(--accent)" : "var(--text2)" }}>
              {t("waage.stufe", { n: s })}
            </button>
          ))}
        </Segment>
        <button onClick={() => neu(z.stufe || 3)} style={{ ...btnPrimary, ...btnSmall }}>{t("waage.neue")}</button>
        <button onClick={() => setEigene(eigene ? null : { a: 2, b: 3, c: 0, d: 11 })} style={{ ...btnSecondary, ...btnSmall }}>{t("waage.eigene")}</button>
      </div>
      {eigene && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 12, fontSize: 16 }}>
          <GleichungEingabe wert={eigene} onChange={setEigene} />
          <button disabled={!!eigeneFehler} onClick={() => { setzen({ stufe: 0, start: eigeneStand, weg: leererWeg() }); setEigene(null); }}
            style={{ ...btnPrimary, ...btnSmall, opacity: eigeneFehler ? 0.5 : 1 }}>{t("waage.losgehts")}</button>
          {eigeneFehler && <span style={{ fontSize: 13, color: C.danger }}>{t(`waage.gl.${eigeneFehler}`)}</span>}
        </div>
      )}
      <WaageEditor key={JSON.stringify(z.start)} start={z.start} wert={z.weg} onChange={(weg) => setzen({ ...z, weg })} />
    </div>
  );
}

// Vier Zahlenfelder als Gleichung: [a] x + [b] = [c] x + [d].
export function GleichungEingabe({ wert, onChange }) {
  const feld = (k) => (
    <input type="number" min={0} max={60} value={wert[k]} aria-label={k}
      onChange={(e) => onChange({ ...wert, [k]: e.target.value === "" ? "" : Math.max(0, Math.min(60, Math.round(Number(e.target.value)))) })}
      style={{ ...inputStyle, width: 56, textAlign: "center", padding: "6px 4px" }} />
  );
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
      {feld("a")} x + {feld("b")} = {feld("c")} x + {feld("d")}
    </span>
  );
}
