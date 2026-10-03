// Die Waage — eine Gleichung zum Anfassen.
//
// Zwei Wege, eine Gleichung umzuformen, und beide gehören dazu:
//   • ein Teil von EINER Schale nehmen (antippen): die Waage kippt. Erst wenn
//     auf der anderen Seite dasselbe passiert, steht sie wieder gerade — genau
//     das ist der Gedanke hinter „auf beiden Seiten dasselbe tun“, und man
//     sieht ihn, statt ihn zu lesen;
//   • eine Umformung für BEIDE Seiten wählen (− 2, − x, : 3 …).
// Ein Schritt zählt erst, wenn die Waage wieder im Gleichgewicht ist; jeder
// steht darunter als Zeile „3x + 2 = 14 | − 2“.
//
// Gerechnet wird in core/waage.js (Spiegel im Server). Gezeichnet als SVG wie
// der PAP-Editor und die Körper: ein Gewicht ist ein Element, antippbar.
import { useMemo, useState } from "react";
import { COLORS as C, CONTROL_R, btnSecondary, btnSmall, inputStyle, panelStyle } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { ablesen, geloest, gleich, gleichungText, kopie, loesung, neigung, opText, probeText, term, umformen, MAX_SCHRITTE } from "../core/waage.js";

export const leererWeg = () => ({ schritte: [] });

const FARBE_X = "#3b82f6";
const FARBE_E = "#9ca3af";
const FARBE_10 = "#f59e0b";

// Was auf einer Schale liegt, als Teile: Päckchen, Zehner-Stangen, Einer.
// Zehner nur ab 20 Einern — bei 14 will man die Einzelnen sehen und zählen.
function teile(seite) {
  const out = [];
  for (let i = 0; i < seite.x; i++) out.push({ art: "x", n: 1 });
  const zehner = seite.e >= 20 ? Math.floor(seite.e / 10) : 0;
  for (let i = 0; i < zehner; i++) out.push({ art: "e", n: 10 });
  for (let i = 0; i < seite.e - zehner * 10; i++) out.push({ art: "e", n: 1 });
  return out;
}

function Schale({ seite, cx, cy, lesen, onNehmen, t }) {
  const liste = teile(seite);
  const breite = 200;
  const spalten = 6;
  const zeilen = Math.max(1, Math.ceil(liste.length / spalten));
  const zelle = Math.min(32, Math.floor(130 / zeilen));
  const g = zelle - 4;
  return (
    <g style={{ transform: `translate(${cx}px, ${cy}px)`, transition: "transform .45s ease" }}>
      {/* Aufhängung */}
      <line x1={-breite / 2 + 10} y1={0} x2={0} y2={-150} stroke="#6b7280" strokeWidth={1.5} />
      <line x1={breite / 2 - 10} y1={0} x2={0} y2={-150} stroke="#6b7280" strokeWidth={1.5} />
      <path d={`M ${-breite / 2} 0 Q 0 22 ${breite / 2} 0 Z`} fill="#d1d5db" stroke="#6b7280" strokeWidth={1.5} />
      {liste.map((it, i) => {
        const sp = i % spalten, ze = Math.floor(i / spalten);
        const x = (sp - (Math.min(liste.length, spalten) - 1) / 2) * zelle;
        const y = -zelle / 2 - 2 - ze * zelle;
        // Ein Tipp nimmt immer EIN Teil — auch von der Zehner-Stange (sie
        // bricht auf). Sonst laesst sich rechts keine einzelne 1 abziehen,
        // wenn dort nur Zehner liegen, und die Waage kommt nie ins Lot.
        const klick = lesen ? undefined : () => onNehmen(it.art, 1);
        const titel = it.art === "x" ? t("waage.nimmX") : t("waage.nimmE", { n: 1 });
        return (
          <g key={i} transform={`translate(${x} ${y})`} onClick={klick} style={{ cursor: lesen ? "default" : "pointer" }}>
            <title>{titel}</title>
            {it.art === "x" ? (
              <>
                <rect x={-g / 2} y={-g / 2} width={g} height={g} rx={4} fill={FARBE_X} />
                <text pointerEvents="none" y={g * 0.18} textAnchor="middle" fontSize={g * 0.55} fontWeight={700} fill="#fff">x</text>
              </>
            ) : it.n === 10 ? (
              <>
                <rect x={-g / 2} y={-g / 2} width={g} height={g} rx={g / 2} fill={FARBE_10} />
                <text pointerEvents="none" y={g * 0.18} textAnchor="middle" fontSize={g * 0.45} fontWeight={700} fill="#fff">10</text>
              </>
            ) : (
              <>
                <circle r={g / 2.4} fill={FARBE_E} />
                <text pointerEvents="none" y={g * 0.15} textAnchor="middle" fontSize={g * 0.42} fontWeight={700} fill="#fff">1</text>
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}

export default function WaageEditor({ start, wert, onChange, lesen = false }) {
  const { t } = useLanguage();
  const schritte = (wert && wert.schritte) || [];
  const festerStand = schritte.length ? schritte[schritte.length - 1] : start;
  const xWahr = useMemo(() => loesung(start), [start]);
  // Was gerade auf der Waage liegt — kann vom festen Stand abweichen, solange
  // jemand von einer Seite etwas genommen hat und die Waage schief hängt.
  const [arbeit, setArbeit] = useState(null);
  const [n, setN] = useState(1);
  const [fehler, setFehler] = useState("");
  const jetzt = arbeit || festerStand;
  const kipp = xWahr == null ? 0 : neigung(jetzt, xWahr);
  const fertig = geloest(festerStand) && !arbeit;

  const festhalten = (neu, op) => {
    if (schritte.length >= MAX_SCHRITTE) { setFehler(t("waage.fehler.zuViele")); return; }
    onChange({ schritte: [...schritte, { l: neu.l, r: neu.r, op }] });
    setArbeit(null);
    setFehler("");
  };

  const nehmen = (seite, art, k) => {
    const neu = kopie(jetzt);
    neu[seite][art] -= k;
    if (neu[seite][art] < 0) return;
    setFehler("");
    // Wieder im Gleichgewicht und anders als vorher: das ist ein Schritt.
    if (xWahr != null && neigung(neu, xWahr) === 0 && !gleich(neu, festerStand)) {
      const o = ablesen(festerStand, neu);
      festhalten(neu, o.art === "frei" ? "frei" : opText(o.art, o.n));
      return;
    }
    setArbeit(gleich(neu, festerStand) ? null : neu);
  };

  const beide = (art) => {
    if (arbeit) return;
    const zahl = Number(n);
    const r = umformen(festerStand, art, zahl);
    if (r.fehler) { setFehler(t(`waage.fehler.${r.fehler}`, { n: zahl })); return; }
    festhalten(r.stand, opText(art, zahl));
  };

  const zurueck = () => {
    if (arbeit) { setArbeit(null); return; }
    if (schritte.length) onChange({ schritte: schritte.slice(0, -1) });
    setFehler("");
  };

  // Geometrie: Drehpunkt in der Mitte, Balken ± 220, Schalen 150 darunter.
  const winkel = kipp * 7 * (Math.PI / 180);
  const ende = (dx) => [300 + dx * Math.cos(winkel), 60 + dx * Math.sin(winkel)];
  const [lx, ly] = ende(-220);
  const [rx, ry] = ende(220);

  // Die Umformung steht an der Zeile, AUS der sie hervorgeht: „3x + 2 = 14 | − 2“.
  const protokoll = protokollZeilen(start, schritte);

  return (
    <div>
      <div style={{ textAlign: "center", fontSize: 22, fontWeight: 700, margin: "4px 0 8px", fontVariantNumeric: "tabular-nums" }}>
        {gleichungText(jetzt)}
        {fertig && <span style={{ color: C.success, marginLeft: 8 }}>✓</span>}
      </div>
      <svg viewBox="0 0 600 300" style={{ width: "100%", maxHeight: 340, display: "block", touchAction: "manipulation" }} role="img" aria-label={gleichungText(jetzt)}>
        {/* Ständer */}
        <path d="M 300 60 L 270 290 L 330 290 Z" fill="#9ca3af" />
        <rect x={230} y={286} width={140} height={8} rx={4} fill="#6b7280" />
        {/* Balken */}
        <g style={{ transform: `rotate(${kipp * 7}deg)`, transformOrigin: "300px 60px", transition: "transform .45s ease" }}>
          <rect x={76} y={55} width={448} height={10} rx={5} fill="#4b5563" />
        </g>
        <circle cx={300} cy={60} r={9} fill="#374151" />
        <Schale seite={jetzt.l} cx={lx} cy={ly + 150} lesen={lesen || fertig} onNehmen={(art, k) => nehmen("l", art, k)} t={t} />
        <Schale seite={jetzt.r} cx={rx} cy={ry + 150} lesen={lesen || fertig} onNehmen={(art, k) => nehmen("r", art, k)} t={t} />
      </svg>

      {!lesen && (
        <>
          {arbeit && (
            <div style={{ fontSize: 14, color: C.warning, textAlign: "center", fontWeight: 600, margin: "4px 0 8px" }}>
              {t("waage.kippt")}
            </div>
          )}
          {fertig ? (
            <div style={{ fontSize: 14, color: C.success, textAlign: "center", fontWeight: 600, margin: "4px 0 8px" }}>
              {t("waage.fertig", { probe: probeText(start, xWahr) })}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "center", margin: "8px 0" }}>
              <span style={{ fontSize: 13, color: "var(--text2)" }}>{t("waage.beide")}</span>
              <input type="number" min={1} max={60} value={n} onChange={(e) => setN(Math.max(1, Math.min(60, Math.round(Number(e.target.value) || 1))))}
                aria-label={t("waage.zahl")} style={{ ...inputStyle, width: 64, textAlign: "center" }} />
              {[["-e", `− ${n}`], ["-x", `− ${n === 1 ? "" : n}x`], [":", `: ${n}`], ["+e", `+ ${n}`], ["+x", `+ ${n === 1 ? "" : n}x`]].map(([art, label]) => (
                <button key={art} onClick={() => beide(art)} disabled={!!arbeit}
                  style={{ ...btnSecondary, ...btnSmall, minWidth: 52, fontVariantNumeric: "tabular-nums", opacity: arbeit ? 0.5 : 1 }}>{label}</button>
              ))}
            </div>
          )}
          {fehler && <div style={{ fontSize: 13, color: C.danger, textAlign: "center", marginBottom: 8 }}>{fehler}</div>}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
            <button onClick={zurueck} disabled={!arbeit && !schritte.length} style={{ ...btnSecondary, ...btnSmall }}>{t("waage.zurueck")}</button>
          </div>
        </>
      )}

      {/* Der Lösungsweg — so, wie er ins Heft gehört: am „=" ausgerichtet. */}
      <div style={{ ...panelStyle, padding: "8px 12px" }}>
        <Protokoll zeilen={protokoll} t={t} />
      </div>
      <div style={{ display: "flex", gap: 16, justifyContent: "center", fontSize: 12, color: "var(--text3)", marginTop: 8 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: FARBE_X, marginRight: 4 }} />{t("waage.legX")}</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: FARBE_E, borderRadius: CONTROL_R, marginRight: 4 }} />{t("waage.legE")}</span>
      </div>
    </div>
  );
}

// Gleichungen untereinander, am Gleichheitszeichen ausgerichtet, die Umformung
// rechts daneben — die Form aus dem Heft. Auch die Lehrkraft-Sicht nimmt sie.
export function Protokoll({ zeilen, t, klein = false }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto 1fr", columnGap: 8, rowGap: 2,
      fontSize: klein ? 13 : 16, fontVariantNumeric: "tabular-nums", alignItems: "baseline" }}>
      {zeilen.map((z, i) => {
        const fett = !klein && i === zeilen.length - 1 ? 700 : 400;
        return [
          <span key={`l${i}`} style={{ textAlign: "right", fontWeight: fett }}>{term(z.s.l)}</span>,
          <span key={`g${i}`} style={{ fontWeight: fett }}>=</span>,
          <span key={`r${i}`} style={{ fontWeight: fett }}>{term(z.s.r)}</span>,
          <span key={`o${i}`} style={{ minWidth: klein ? 50 : 80, color: z.op === "frei" ? C.warning : "var(--text3)" }}
            title={z.op === "frei" && t ? t("waage.freiHinweis") : undefined}>{z.op === "frei" ? "| ?" : z.op}</span>,
        ];
      })}
    </div>
  );
}

export const protokollZeilen = (start, schritte) => [
  { s: start, op: schritte[0] ? schritte[0].op : "" },
  ...schritte.map((s, i) => ({ s, op: schritte[i + 1] ? schritte[i + 1].op : "" })),
];
