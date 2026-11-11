// Plaettchenmethode (Guthaben/Schulden) zu ganzen Zahlen: 5 − 3 = 2 heisst fuenf Guthaben,
// drei davon abziehen. Minus eine Schuld heisst: Schulden wegnehmen — und wo keine liegen,
// legt man erst Nullpaare dazu. Zwei Wege in dieselbe Zeichnung wie beim Zahlenstrahl:
// „Aufgabe" (Schritt fuer Schritt) und „Frei" (selbst legen und wegnehmen).
// Reiner Client; gerechnet wird in core/plaettchen.js.
import { useMemo, useState } from "react";
import { COLORS as C, Segment, btnPrimary, btnSecondary, cardStyle, segmentBtn, toolbarBtn } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { ARTEN, MAX, aufgabe, dazu, nullpaare, paarDazu, paareWeg, schritte, wert, weg } from "../core/plaettchen.js";
import { schreibe, termText } from "../core/zahlenstrahl.js";

const R = 18, ABSTAND = 46, LINKS = 96, REIHE_POS = 52, REIHE_NEG = 124, H = 176;
const klammer = (n) => (n < 0 ? `(${schreibe(n)})` : schreibe(n));

function Brett({ z, t }) {
  const spalten = Math.min(MAX, Math.max(z.pos, z.neg, 6));
  const B = LINKS + spalten * ABSTAND + 16;
  const paare = nullpaare(z);
  const chip = (i, y, farbe, zeichen) => (
    <g key={`${y}-${i}`}>
      <circle cx={LINKS + i * ABSTAND + R} cy={y} r={R} fill={farbe} />
      <text x={LINKS + i * ABSTAND + R} y={y + 6} textAnchor="middle" fontSize={22} fontWeight={800} fill="#fff">{zeichen}</text>
    </g>
  );
  return (
    <svg viewBox={`0 0 ${B} ${H}`} style={{ width: "100%", maxWidth: B * 1.5, height: "auto", display: "block", margin: "0 auto" }} role="img" aria-label={t("plaettchen.title")}>
      <text x={8} y={REIHE_POS + 5} fontSize={14} fontWeight={700} fill={C.success}>{t("plaettchen.guthaben")}</text>
      <text x={8} y={REIHE_NEG + 5} fontSize={14} fontWeight={700} fill={C.danger}>{t("plaettchen.schulden")}</text>
      <line x1={LINKS - 8} y1={(REIHE_POS + REIHE_NEG) / 2} x2={B - 8} y2={(REIHE_POS + REIHE_NEG) / 2} stroke="var(--border2)" strokeWidth={1.5} />
      {/* Nullpaare: Guthaben und Schuld in derselben Spalte, mit gestricheltem Rahmen — sie heben sich auf. */}
      {Array.from({ length: Math.min(paare, MAX) }, (_, i) => (
        <rect key={`p${i}`} x={LINKS + i * ABSTAND - 4} y={REIHE_POS - R - 6} width={2 * R + 8} height={REIHE_NEG - REIHE_POS + 2 * R + 12}
          rx={12} fill="none" stroke="var(--text3)" strokeWidth={1.5} strokeDasharray="5 4" />
      ))}
      {Array.from({ length: Math.min(z.pos, MAX) }, (_, i) => chip(i, REIHE_POS, C.success, "+"))}
      {Array.from({ length: Math.min(z.neg, MAX) }, (_, i) => chip(i, REIHE_NEG, C.danger, "−"))}
    </svg>
  );
}

export default function Plaettchen() {
  const { t } = useLanguage();
  const [modus, setModus] = useState("aufgabe");
  const [art, setArt] = useState("minusMinus");
  const [aufg, setAufg] = useState(() => aufgabe("minusMinus"));
  const [n, setN] = useState(0);                       // wie viele Schritte der Aufgabe schon liegen
  const [frei, setFrei] = useState({ pos: 3, neg: 0 });

  const sch = useMemo(() => schritte(aufg.a, aufg.op, aufg.b), [aufg]);
  const fertig = n >= sch.length;
  const zustand = modus === "aufgabe" ? (n > 0 ? sch[n - 1].nach : { pos: 0, neg: 0 }) : frei;
  const neu = (a = art) => { setAufg(aufgabe(a)); setN(0); };
  const waehle = (a) => { setArt(a); neu(a); };
  const letzter = modus === "aufgabe" && n > 0 ? sch[n - 1] : null;
  const satz = letzter ? t(`plaettchen.schritt.${letzter.art}.${letzter.art === "legen" && aufg.a === 0 ? "null" : letzter.vz}`,
    { n: letzter.n, z: klammer(aufg.b) }) : "";
  // Mehr als MAX Plaettchen je Sorte passen nicht mehr aufs Brett: dann bleibt es beim alten Stand.
  const knopf = (label, f, farbe) => (
    <button onClick={() => setFrei((alt) => (f.pos > MAX || f.neg > MAX ? alt : f))} style={{ ...toolbarBtn, ...(farbe ? { color: farbe, fontWeight: 700 } : null) }}>{label}</button>
  );
  const kontostand = wert(zustand);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <Segment>
          {[["aufgabe", t("zahlenstrahl.aufgabe")], ["frei", t("zahlenstrahl.frei")]].map(([k, l]) => (
            <button key={k} onClick={() => setModus(k)} aria-pressed={modus === k}
              style={{ ...segmentBtn, fontWeight: modus === k ? 700 : 500, color: modus === k ? "var(--accent)" : "var(--text2)" }}>{l}</button>
          ))}
        </Segment>
      </div>

      {modus === "aufgabe" && (
        <div style={{ ...cardStyle, padding: 14, marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Segment>
            {ARTEN.map((a) => (
              <button key={a} onClick={() => waehle(a)} aria-pressed={art === a}
                style={{ ...segmentBtn, fontWeight: art === a ? 700 : 500, color: art === a ? "var(--accent)" : "var(--text2)" }}>{t(`plaettchen.art.${a}`)}</button>
            ))}
          </Segment>
          <div style={{ flex: 1, minWidth: 160, fontSize: 22, fontWeight: 700, textAlign: "center" }}>
            {termText(aufg.a, [{ op: aufg.op, zahl: aufg.b }])} = {fertig ? <span style={{ color: "var(--accent)" }}>{schreibe(wert(sch[sch.length - 1].nach))}</span> : "?"}
          </div>
          <button onClick={() => neu()} style={toolbarBtn}>{t("zahlenstrahl.neueAufgabe")}</button>
        </div>
      )}

      <div style={{ ...cardStyle, padding: 12, marginBottom: 12 }}>
        <Brett z={zustand} t={t} />
        <div style={{ textAlign: "center", fontSize: 16, color: "var(--text2)", marginTop: 4 }}>
          {t("plaettchen.stand", { pos: zustand.pos, neg: zustand.neg })}
          {" → "}<strong style={{ color: kontostand < 0 ? C.danger : C.success }}>{schreibe(kontostand)}</strong>
        </div>
      </div>

      {modus === "aufgabe" ? (<>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button onClick={() => setN((x) => Math.min(sch.length, x + 1))} disabled={fertig} style={{ ...btnPrimary, opacity: fertig ? 0.5 : 1 }}>{t("plaettchen.naechster")}</button>
          <button onClick={() => setN(0)} disabled={n === 0} style={{ ...btnSecondary, opacity: n === 0 ? 0.5 : 1 }}>{t("zahlenstrahl.nochmal")}</button>
          <button onClick={() => { setFrei({ ...sch[0].nach }); setModus("frei"); }} style={btnSecondary}>{t("zahlenstrahl.selbst")}</button>
        </div>
        {satz && <div style={{ ...cardStyle, padding: 14, fontSize: 14, lineHeight: 1.55 }}>
          {satz}
          {fertig && <div style={{ marginTop: 8 }}><strong>{t("plaettchen.ergebnis", { pos: zustand.pos, neg: zustand.neg, wert: schreibe(kontostand) })}</strong></div>}
        </div>}
      </>) : (
        <div style={{ ...cardStyle, padding: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {knopf(`+ ${t("plaettchen.guthaben1")}`, dazu(frei, "pos"), C.success)}
          {knopf(`+ ${t("plaettchen.schuld1")}`, dazu(frei, "neg"), C.danger)}
          {knopf(t("plaettchen.nullpaar"), paarDazu(frei))}
          {knopf(`− ${t("plaettchen.guthaben1")}`, weg(frei, "pos"), C.success)}
          {knopf(`− ${t("plaettchen.schuld1")}`, weg(frei, "neg"), C.danger)}
          {nullpaare(frei) > 0 && knopf(t("plaettchen.paareWeg"), paareWeg(frei))}
          {knopf(t("plaettchen.leeren"), { pos: 0, neg: 0 })}
        </div>
      )}
    </div>
  );
}
