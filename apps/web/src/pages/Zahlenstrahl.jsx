// Modul „Zahlenstrahl" — Rechnen mit Pfeilen auf dem Zahlenstrahl: ganze Zahlen,
// Dezimalzahlen und die Frage, warum „minus eine negative Zahl" plus ist.
//
// Zwei Wege in dieselbe Zeichnung, wie bei der Waage:
//  • „Aufgabe": eine Aufgabe steht da, die Pfeile sind FEST und erscheinen
//    Schritt fuer Schritt — man sieht, wie die Pfeile fuer diese Aufgabe gelegt
//    werden und wo das Ergebnis liegt.
//  • „Frei": ohne Aufgabe. Start und Pfeile lassen sich ziehen und eintragen;
//    der Term darunter entsteht aus dem, was man gelegt hat. So findet man die
//    Regel selbst.
// Reiner Client, keine Daten. Gerechnet wird in core/zahlenstrahl.js.
import { useEffect, useMemo, useRef, useState } from "react";
import { COLORS as C, CONTROL_R, ICONS, Icon, Segment, btnPrimary, btnSecondary, cardStyle, pageApp, segmentBtn, toolbarBtn, toolbarInput } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { ARTEN, GRENZE, aufgabe, bereich, berechne, leseZahl, rastern, regel, schreibe, termText } from "../core/zahlenstrahl.js";

const B = 900, H = 330, RAND = 40, ACHSE = 200;

export default function Zahlenstrahl() {
  const { t } = useLanguage();
  const [modus, setModus] = useState("aufgabe");          // "aufgabe" | "frei"
  const [art, setArt] = useState("minusMinus");
  const [aufg, setAufg] = useState(() => aufgabe("minusMinus"));
  const [gezeigt, setGezeigt] = useState(0);              // wie viele Pfeile der Aufgabe schon liegen
  const [frei, setFrei] = useState({ start: 2, schritte: [{ op: "-", zahl: -3 }] });
  const [raster, setRaster] = useState(1);                // 1 | 0.5 | 0.1
  const svg = useRef(null);
  const zug = useRef(null);

  const modell = modus === "aufgabe" ? aufg : frei;
  const w = useMemo(() => berechne(modell.start, modell.schritte), [modell]);
  const nSichtbar = modus === "aufgabe" ? gezeigt : w.pfeile.length;
  const fertig = nSichtbar >= w.pfeile.length;
  const { von, bis } = useMemo(() => bereich(modell.start, modell.schritte), [modell]);
  const xOf = (v) => RAND + ((v - von) / (bis - von)) * (B - 2 * RAND);
  const vOf = (x) => von + ((x - RAND) / (B - 2 * RAND)) * (bis - von);

  const neueAufgabe = (a = art) => { setAufg(aufgabe(a)); setGezeigt(0); };
  const waehleArt = (a) => { setArt(a); neueAufgabe(a); };

  // ── Ziehen (nur „Frei"): Spitze eines Pfeils oder der Start ──
  const clientZuWert = (clientX) => {
    const rect = svg.current.getBoundingClientRect();
    return vOf(((clientX - rect.left) / rect.width) * B);
  };
  useEffect(() => {
    const bewegen = (e) => {
      const z = zug.current;
      if (!z) return;
      const x = rastern(clientZuWert(e.clientX), raster);
      setFrei((f) => {
        if (z.was === "start") return { ...f, start: x };
        const pf = berechne(f.start, f.schritte).pfeile[z.i];
        if (!pf) return f;
        const zahl = rastern(pf.op === "-" ? pf.von - x : x - pf.von, raster);
        return { ...f, schritte: f.schritte.map((s, k) => (k === z.i ? { ...s, zahl } : s)) };
      });
    };
    const los = () => { zug.current = null; };
    window.addEventListener("pointermove", bewegen);
    window.addEventListener("pointerup", los);
    window.addEventListener("pointercancel", los);
    return () => { window.removeEventListener("pointermove", bewegen); window.removeEventListener("pointerup", los); window.removeEventListener("pointercancel", los); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raster, von, bis]);
  const fasse = (was, i = null) => (e) => { if (modus !== "frei") return; e.preventDefault(); zug.current = { was, i }; };

  const setzeSchritt = (i, teil) => setFrei((f) => ({ ...f, schritte: f.schritte.map((s, k) => (k === i ? { ...s, ...teil } : s)) }));
  const zuFrei = () => { setFrei({ start: aufg.start, schritte: aufg.schritte.map((s) => ({ ...s })) }); setModus("frei"); };

  // ── Zeichnung ──
  const ticks = [];
  const gross = bis - von > 24 ? 2 : 1;
  for (let v = Math.ceil(von); v <= bis; v += 1) ticks.push({ v, label: v % gross === 0 });
  const feinSchritt = raster < 1 && bis - von <= 24 ? raster : null;
  const fein = [];
  if (feinSchritt) for (let v = Math.ceil(von / feinSchritt) * feinSchritt; v <= bis + 1e-9; v += feinSchritt) { const q = Math.round(v * 1e6) / 1e6; if (!Number.isInteger(q)) fein.push(q); }

  const bogen = (a, b, hoehe, unten = false) => {
    const x1 = xOf(a), x2 = xOf(b), s = unten ? 1 : -1;
    return `M ${x1} ${ACHSE} C ${x1} ${ACHSE + s * hoehe}, ${x2} ${ACHSE + s * hoehe}, ${x2} ${ACHSE + s * 4}`;
  };
  const spitze = (x, unten = false) => {
    const s = unten ? 1 : -1;     // der Pfeil kommt von oben (s = −1) und zeigt nach unten
    return `${x - 6},${ACHSE + s * 14} ${x + 6},${ACHSE + s * 14} ${x},${ACHSE + s * 2}`;
  };
  const hoehe = (p, i) => Math.min(120, 26 + Math.abs(xOf(p.bis) - xOf(p.von)) * 0.28) + (i % 2) * 30;

  const farbeVon = (p) => (p.richtung > 0 ? C.success : p.richtung < 0 ? C.danger : "var(--text3)");
  const sichtbar = w.pfeile.slice(0, nSichtbar);
  const punkt = nSichtbar > 0 ? w.pfeile[nSichtbar - 1].bis : w.start;
  const regeln = sichtbar.map((p) => ({ p, k: regel(modell.schritte[p.i]) }));

  return (
    <div style={{ ...pageApp }}>
      <Werkzeugleiste style={{ marginBottom: 12 }}
        links={(
          <Segment>
            {[["aufgabe", t("zahlenstrahl.aufgabe")], ["frei", t("zahlenstrahl.frei")]].map(([k, l]) => (
              <button key={k} onClick={() => setModus(k)} aria-pressed={modus === k}
                style={{ ...segmentBtn, fontWeight: modus === k ? 700 : 500, color: modus === k ? "var(--accent)" : "var(--text2)" }}>{l}</button>
            ))}
          </Segment>
        )}>
        <span title={t("zahlenstrahl.rasterTitel")}>
          <Segment>
            {[[1, "1"], [0.5, "0,5"], [0.1, "0,1"]].map(([v, l]) => (
              <button key={v} onClick={() => setRaster(v)} aria-pressed={raster === v}
                style={{ ...segmentBtn, fontWeight: raster === v ? 700 : 500, color: raster === v ? "var(--accent)" : "var(--text2)" }}>{l}</button>
            ))}
          </Segment>
        </span>
      </Werkzeugleiste>

      {modus === "aufgabe" && (
        <div style={{ ...cardStyle, padding: 14, marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Segment>
            {ARTEN.map((a) => (
              <button key={a} onClick={() => waehleArt(a)} aria-pressed={art === a}
                style={{ ...segmentBtn, fontWeight: art === a ? 700 : 500, color: art === a ? "var(--accent)" : "var(--text2)" }}>{t(`zahlenstrahl.art.${a}`)}</button>
            ))}
          </Segment>
          <div style={{ flex: 1, minWidth: 160, fontSize: 22, fontWeight: 700, textAlign: "center" }}>
            {termText(aufg.start, aufg.schritte)} = {fertig ? <span style={{ color: "var(--accent)" }}>{schreibe(w.ergebnis)}</span> : "?"}
          </div>
          <button onClick={() => neueAufgabe()} style={toolbarBtn}>{t("zahlenstrahl.neueAufgabe")}</button>
        </div>
      )}

      <div style={{ ...cardStyle, padding: 8, marginBottom: 12 }}>
        <svg ref={svg} viewBox={`0 0 ${B} ${H}`} style={{ width: "100%", height: "auto", display: "block", touchAction: "none" }}
          role="img" aria-label={t("zahlenstrahl.title")}>
          {/* Achse */}
          <line x1={RAND - 14} y1={ACHSE} x2={B - RAND + 14} y2={ACHSE} stroke="var(--text2)" strokeWidth={2} />
          <polygon points={`${B - RAND + 14},${ACHSE} ${B - RAND + 6},${ACHSE - 5} ${B - RAND + 6},${ACHSE + 5}`} fill="var(--text2)" />
          {fein.map((v) => <line key={`f${v}`} x1={xOf(v)} y1={ACHSE - 5} x2={xOf(v)} y2={ACHSE + 5} stroke="var(--border2)" strokeWidth={1} />)}
          {ticks.map(({ v, label }) => (
            <g key={v}>
              <line x1={xOf(v)} y1={ACHSE - 9} x2={xOf(v)} y2={ACHSE + 9} stroke={v === 0 ? "var(--text)" : "var(--text2)"} strokeWidth={v === 0 ? 3 : 1.5} />
              {label && <text x={xOf(v)} y={ACHSE + 30} textAnchor="middle" fontSize={14} fontWeight={v === 0 ? 800 : 500} fill="var(--text)">{schreibe(v)}</text>}
            </g>
          ))}

          {/* Pfeile. Bei „minus" erscheint der Pfeil der Zahl selbst gestrichelt UNTER der
              Achse — und der echte Pfeil darueber zeigt in die Gegenrichtung. */}
          {sichtbar.map((p, i) => {
            const farbe = farbeVon(p);
            const h = hoehe(p, i);
            const mitte = (xOf(p.von) + xOf(p.bis)) / 2;
            const text = `${p.op === "-" ? "−" : "+"} ${p.zahl < 0 ? `(${schreibe(p.zahl)})` : schreibe(p.zahl)}`;
            return (
              <g key={i}>
                {p.umgedreht && (
                  <g opacity={0.8}>
                    <path d={bogen(p.eigenVon, p.eigenBis, 84, true)} fill="none" stroke="var(--text3)" strokeWidth={2.5} strokeDasharray="6 5" />
                    <polygon points={spitze(xOf(p.eigenBis), true)} fill="var(--text3)" />
                    <text x={(xOf(p.eigenVon) + xOf(p.eigenBis)) / 2} y={ACHSE + 116} textAnchor="middle" fontSize={13} fill="var(--text2)">
                      {t("zahlenstrahl.eigenPfeil", { zahl: schreibe(p.zahl) })}
                    </text>
                  </g>
                )}
                {p.zahl !== 0 && (<>
                  <path d={bogen(p.von, p.bis, h)} fill="none" stroke={farbe} strokeWidth={4} strokeLinecap="round" />
                  <polygon points={spitze(xOf(p.bis))} fill={farbe} />
                </>)}
                <g transform={`translate(${mitte}, ${ACHSE - h * 0.75 - 14})`}>
                  <rect x={-34} y={-13} width={68} height={26} rx={6} fill="var(--card)" stroke={farbe} strokeWidth={1.5} />
                  <text textAnchor="middle" y={5} fontSize={14} fontWeight={700} fill="var(--text)">{text}</text>
                </g>
              </g>
            );
          })}

          {/* Start, Spitzen (ziehbar in „Frei") und Ergebnis */}
          <circle cx={xOf(w.start)} cy={ACHSE} r={8} fill="var(--text)" />
          <text x={xOf(w.start)} y={ACHSE - 20} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--text)">{t("zahlenstrahl.start")}</text>
          {modus === "frei" && (
            <circle cx={xOf(w.start)} cy={ACHSE} r={16} fill="transparent" style={{ cursor: "ew-resize" }} onPointerDown={fasse("start")} />
          )}
          {modus === "frei" && sichtbar.map((p, i) => (
            <circle key={`g${i}`} cx={xOf(p.bis)} cy={ACHSE} r={16} fill="transparent" style={{ cursor: "ew-resize" }} onPointerDown={fasse("spitze", i)} />
          ))}
          {fertig && w.pfeile.length > 0 && (
            <g>
              <circle cx={xOf(w.ergebnis)} cy={ACHSE} r={12} fill="none" stroke="var(--accent)" strokeWidth={4} />
              <text x={xOf(w.ergebnis)} y={ACHSE + 58} textAnchor="middle" fontSize={22} fontWeight={800} fill="var(--accent)">{schreibe(w.ergebnis)}</text>
            </g>
          )}
          {!fertig && <circle cx={xOf(punkt)} cy={ACHSE} r={5} fill="var(--accent)" />}
        </svg>
      </div>

      {modus === "aufgabe" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button onClick={() => setGezeigt((g) => Math.min(w.pfeile.length, g + 1))} disabled={fertig}
            style={{ ...btnPrimary, opacity: fertig ? 0.5 : 1 }}>{t("zahlenstrahl.naechster")}</button>
          <button onClick={() => setGezeigt(0)} disabled={gezeigt === 0} style={{ ...btnSecondary, opacity: gezeigt === 0 ? 0.5 : 1 }}>{t("zahlenstrahl.nochmal")}</button>
          <button onClick={zuFrei} style={btnSecondary}>{t("zahlenstrahl.selbst")}</button>
        </div>
      )}

      {modus === "frei" && (
        <div style={{ ...cardStyle, padding: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <label style={{ fontSize: 13, color: "var(--text2)" }}>{t("zahlenstrahl.start")}</label>
            <ZahlFeld wert={frei.start} onChange={(v) => setFrei((f) => ({ ...f, start: v }))} />
            {frei.schritte.map((s, i) => (
              <span key={i} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                <button onClick={() => setzeSchritt(i, { op: s.op === "+" ? "-" : "+" })} style={{ ...toolbarBtn, minWidth: 34, fontWeight: 800, fontSize: 16 }}
                  title={t("zahlenstrahl.opWechseln")} aria-label={t("zahlenstrahl.opWechseln")}>{s.op === "-" ? "−" : "+"}</button>
                <ZahlFeld wert={s.zahl} onChange={(v) => setzeSchritt(i, { zahl: v })} />
                <button onClick={() => setFrei((f) => ({ ...f, schritte: f.schritte.filter((_, k) => k !== i) }))} className="icon-btn"
                  style={{ ...toolbarBtn, minWidth: 28, padding: 4 }} title={t("common.delete")} aria-label={t("common.delete")}>
                  <Icon d={ICONS.close} size={14} />
                </button>
              </span>
            ))}
            {frei.schritte.length < 5 && (
              <button onClick={() => setFrei((f) => ({ ...f, schritte: [...f.schritte, { op: "+", zahl: 1 }] }))} style={toolbarBtn}>+ {t("zahlenstrahl.pfeil")}</button>
            )}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {termText(frei.start, frei.schritte)} = <span style={{ color: "var(--accent)" }}>{schreibe(w.ergebnis)}</span>
          </div>
        </div>
      )}

      {/* Warum? Je Pfeil, der liegt, die Regel dazu — auch ohne Aufgabe zu verstehen. */}
      {regeln.length > 0 && (
        <div style={{ ...cardStyle, padding: 14 }}>
          {regeln.map(({ p, k }) => (
            <p key={p.i} style={{ margin: "0 0 8px", fontSize: 14, lineHeight: 1.55 }}>
              <strong style={{ color: farbeVon(p) }}>{p.op === "-" ? "−" : "+"} {p.zahl < 0 ? `(${schreibe(p.zahl)})` : schreibe(p.zahl)}:</strong>{" "}
              {t(`zahlenstrahl.regel.${k}`, { z: schreibe(p.zahl), betrag: schreibe(Math.abs(p.zahl)) })}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// Eingabe einer Zahl: Komma oder Punkt, auch negativ. Unlesbares bleibt stehen, bis
// es wieder lesbar ist — der Wert dahinter aendert sich erst bei einer gueltigen Zahl.
function ZahlFeld({ wert, onChange }) {
  const [text, setText] = useState(schreibe(wert));
  const [fokus, setFokus] = useState(false);
  useEffect(() => { if (!fokus) setText(schreibe(wert)); }, [wert, fokus]);
  const ok = leseZahl(text) !== null;
  return (
    <input value={text} inputMode="decimal" aria-label={`±${GRENZE}`}
      onFocus={() => setFokus(true)} onBlur={() => { setFokus(false); setText(schreibe(wert)); }}
      onChange={(e) => { setText(e.target.value); const v = leseZahl(e.target.value); if (v !== null) onChange(v); }}
      style={{ ...toolbarInput, width: 70, textAlign: "center", ...(ok ? null : { borderColor: C.danger }) }} />
  );
}
