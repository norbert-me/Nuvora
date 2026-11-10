// Modul „Zahlenstrahl" — Rechnen mit Pfeilen auf dem Zahlenstrahl: ganze Zahlen,
// Dezimalzahlen und die Frage, warum „minus eine negative Zahl" plus ist.
//
// Zwei Wege in dieselbe Zeichnung, wie bei der Waage:
//  • „Aufgabe": eine Aufgabe steht da, die Pfeile sind FEST und entstehen
//    Schritt fuer Schritt. Bei „minus" sind es zwei Schritte: erst entsteht der
//    Pfeil der Zahl selbst, DANACH wird er umgedreht.
//  • „Frei": ohne Aufgabe. Start und Pfeile lassen sich ziehen und eintragen;
//    der Term darunter entsteht aus dem, was man gelegt hat.
// Die Achse ist FEST (−10 … +10, bei Zehnteln −2 … +2): eine Achse, die mit den
// Pfeilen waechst und schrumpft, wandert beim Ziehen unter dem Finger weg.
// Reiner Client, keine Daten. Gerechnet wird in core/zahlenstrahl.js.
import { useEffect, useMemo, useRef, useState } from "react";
import { COLORS as C, ICONS, Icon, Segment, btnPrimary, btnSecondary, cardStyle, pageApp, segmentBtn, toolbarBtn, toolbarInput } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { RASTER, achsenRadius, aufgabe, begrenze, berechne, leseZahl, phasen, rastern, regel, schreibe, termText } from "../core/zahlenstrahl.js";

const B = 900, H = 330, RAND = 40, ACHSE = 200;
const ARTEN_GROB = ["ganz", "dezimal", "minusMinus"];
const ARTEN_FEIN = ["dezimal", "minusMinus"];
// Freie Pfeile beginnen mit einem Beispiel, das auf die Achse passt.
const freiVorgabe = (raster) => (raster <= 0.1
  ? { start: 0.2, schritte: [{ op: "-", zahl: -0.3 }] }
  : { start: 2, schritte: [{ op: "-", zahl: -3 }] });

export default function Zahlenstrahl() {
  const { t } = useLanguage();
  const [modus, setModus] = useState("aufgabe");          // "aufgabe" | "frei"
  const [raster, setRaster] = useState(1);                // 1 | 0.5 | 0.1
  const R = achsenRadius(raster);                         // FESTE Achse: −R … +R
  const [art, setArt] = useState("minusMinus");
  const [aufg, setAufg] = useState(() => aufgabe("minusMinus"));
  const [gezeigt, setGezeigt] = useState(0);              // wie viele Schritte der Aufgabe schon gezeigt sind
  const [frei, setFrei] = useState(() => freiVorgabe(1));
  const svg = useRef(null);
  const zug = useRef(null);

  const modell = modus === "aufgabe" ? aufg : frei;
  const w = useMemo(() => berechne(modell.start, modell.schritte), [modell]);
  const folge = useMemo(() => phasen(w.pfeile), [w]);    // die Schritte, in denen die Aufgabe gezeigt wird
  const nPhasen = modus === "aufgabe" ? gezeigt : folge.length;
  const fertig = nPhasen >= folge.length;
  // Wie weit ist jeder Pfeil? 0 = noch nicht da, 1 = (nur bei „minus") der Pfeil der Zahl liegt, 2 = fertig.
  const stufen = w.pfeile.map((p) => {
    const eigene = folge.slice(0, nPhasen).filter((x) => x.i === p.i).length;
    return p.umgedreht ? eigene : Math.min(eigene, 1) * 2;
  });
  const naechste = folge[nPhasen];                        // was der nächste Klick tut
  const von = -R, bis = R;
  const xOf = (v) => RAND + ((v - von) / (bis - von)) * (B - 2 * RAND);
  const vOf = (x) => von + ((x - RAND) / (B - 2 * RAND)) * (bis - von);

  const neueAufgabe = (a = art, ra = raster) => { setAufg(aufgabe(a, Math.random, ra)); setGezeigt(0); };
  const waehleArt = (a) => { setArt(a); neueAufgabe(a); };
  // Raster wechseln heisst andere Achse, also andere Zahlen: Aufgabe und freie Pfeile beginnen neu.
  const waehleRaster = (ra) => {
    const a = ra <= 0.1 && art === "ganz" ? "dezimal" : art;
    setRaster(ra); setArt(a); setFrei(freiVorgabe(ra)); neueAufgabe(a, ra);
  };

  // ── Ziehen (nur „Frei"): Spitze eines Pfeils oder der Start ──
  useEffect(() => {
    const bewegen = (e) => {
      const z = zug.current;
      if (!z || !svg.current) return;
      const rect = svg.current.getBoundingClientRect();
      const x = rastern(vOf(((e.clientX - rect.left) / rect.width) * B), raster, R);
      setFrei((f) => {
        if (z.was === "start") return begrenze(x, f.schritte, R);
        const pf = berechne(f.start, f.schritte).pfeile[z.i];
        if (!pf) return f;
        const zahl = rastern(pf.op === "-" ? pf.von - x : x - pf.von, raster, 2 * R);
        return begrenze(f.start, f.schritte.map((s, k) => (k === z.i ? { ...s, zahl } : s)), R);
      });
    };
    const los = () => { zug.current = null; };
    window.addEventListener("pointermove", bewegen);
    window.addEventListener("pointerup", los);
    window.addEventListener("pointercancel", los);
    return () => { window.removeEventListener("pointermove", bewegen); window.removeEventListener("pointerup", los); window.removeEventListener("pointercancel", los); };
  }, [raster, R]);
  const fasse = (was, i = null) => (e) => { if (modus !== "frei") return; e.preventDefault(); zug.current = { was, i }; };

  const setzeSchritt = (i, teil) => setFrei((f) => begrenze(f.start, f.schritte.map((s, k) => (k === i ? { ...s, ...teil } : s)), R));
  const zuFrei = () => { setFrei(begrenze(aufg.start, aufg.schritte.map((s) => ({ ...s })), R)); setModus("frei"); };

  // ── Zeichnung ──
  // Beschriftet wird alle 1 (grobe Achse) bzw. alle 0,5 (Zehntel); die feinen Striche folgen dem Raster.
  const beschriftet = R > 5 ? 1 : 0.5;
  const grob = [], fein = [];
  for (let v = -R; v <= R + 1e-9; v += raster) {
    const q = Math.round(v * 1e6) / 1e6;
    const g = Math.abs(q / beschriftet - Math.round(q / beschriftet)) < 1e-6;
    (g ? grob : fein).push(q);
  }
  if (raster > beschriftet) { grob.length = 0; for (let v = -R; v <= R + 1e-9; v += beschriftet) grob.push(Math.round(v * 1e6) / 1e6); }

  const bogen = (a, b, hoehe, unten = false) => {
    const x1 = xOf(a), x2 = xOf(b), s = unten ? 1 : -1;
    return `M ${x1} ${ACHSE} C ${x1} ${ACHSE + s * hoehe}, ${x2} ${ACHSE + s * hoehe}, ${x2} ${ACHSE + s * 4}`;
  };
  const spitze = (x, unten = false) => {
    const s = unten ? 1 : -1;     // der Pfeil kommt von oben (s = −1) und zeigt nach unten
    return `${x - 6},${ACHSE + s * 14} ${x + 6},${ACHSE + s * 14} ${x},${ACHSE + s * 2}`;
  };
  const hoehe = (p, i) => Math.min(120, 26 + Math.abs(xOf(p.bis) - xOf(p.von)) * 0.28) + (i % 2) * 30;

  const farbe = (richtung) => (richtung > 0 ? C.success : richtung < 0 ? C.danger : "var(--text3)");
  const eigenRichtung = (p) => Math.sign(p.zahl);
  const minus = (n) => (n < 0 ? `(${schreibe(n)})` : schreibe(n));
  // Der Punkt, an dem die Zeichnung gerade steht: Ende des letzten FERTIGEN Pfeils.
  const letzterFertig = w.pfeile.reduce((acc, p, k) => (stufen[k] === 2 ? p : acc), null);
  const punkt = letzterFertig ? letzterFertig.bis : w.start;
  // Was unter der Zeichnung steht: je Pfeil, der (ganz oder teilweise) liegt, die passende Aussage.
  const texte = w.pfeile.map((p, k) => ({ p, k, st: stufen[k] })).filter((x) => x.st > 0);

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
            {RASTER.map((v) => (
              <button key={v} onClick={() => waehleRaster(v)} aria-pressed={raster === v}
                style={{ ...segmentBtn, fontWeight: raster === v ? 700 : 500, color: raster === v ? "var(--accent)" : "var(--text2)" }}>{schreibe(v)}</button>
            ))}
          </Segment>
        </span>
      </Werkzeugleiste>

      {modus === "aufgabe" && (
        <div style={{ ...cardStyle, padding: 14, marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Segment>
            {(raster <= 0.1 ? ARTEN_FEIN : ARTEN_GROB).map((a) => (
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
          {grob.map((v) => (
            <g key={v}>
              <line x1={xOf(v)} y1={ACHSE - 9} x2={xOf(v)} y2={ACHSE + 9} stroke={v === 0 ? "var(--text)" : "var(--text2)"} strokeWidth={v === 0 ? 3 : 1.5} />
              <text x={xOf(v)} y={ACHSE + 30} textAnchor="middle" fontSize={14} fontWeight={v === 0 ? 800 : 500} fill="var(--text)">{schreibe(v)}</text>
            </g>
          ))}

          {/* Pfeile. Bei „minus" entsteht zuerst der Pfeil der Zahl SELBST (unter der Achse, in
              seiner eigenen Richtung); erst im naechsten Schritt entsteht darueber der
              umgedrehte Pfeil, und der erste wird blass. */}
          {w.pfeile.map((p, i) => {
            const st = stufen[i];
            if (st === 0) return null;
            const f = farbe(p.richtung);
            const h = hoehe(p, i);
            const mitte = (xOf(p.von) + xOf(p.bis)) / 2;
            const text = `${p.op === "-" ? "−" : "+"} ${minus(p.zahl)}`;
            return (
              <g key={i}>
                {p.umgedreht && p.zahl !== 0 && (
                  <g opacity={st === 1 ? 1 : 0.55}>
                    <path d={bogen(p.eigenVon, p.eigenBis, 84, true)} fill="none" stroke={st === 1 ? farbe(eigenRichtung(p)) : "var(--text3)"} strokeWidth={st === 1 ? 4 : 2.5} strokeDasharray={st === 1 ? undefined : "6 5"} strokeLinecap="round" />
                    <polygon points={spitze(xOf(p.eigenBis), true)} fill={st === 1 ? farbe(eigenRichtung(p)) : "var(--text3)"} />
                    <text x={(xOf(p.eigenVon) + xOf(p.eigenBis)) / 2} y={ACHSE + 116} textAnchor="middle" fontSize={13} fill="var(--text2)">
                      {t("zahlenstrahl.eigenPfeil", { zahl: schreibe(p.zahl) })}
                    </text>
                  </g>
                )}
                {st === 2 && p.zahl !== 0 && (<>
                  <path d={bogen(p.von, p.bis, h)} fill="none" stroke={f} strokeWidth={4} strokeLinecap="round" />
                  <polygon points={spitze(xOf(p.bis))} fill={f} />
                </>)}
                {st === 2 && (
                  <g transform={`translate(${mitte}, ${ACHSE - h * 0.75 - 14 - (Math.abs(xOf(p.bis) - xOf(p.von)) < 90 ? 26 : 0)})`}>
                    <rect x={-34} y={-13} width={68} height={26} rx={6} fill="var(--card)" stroke={f} strokeWidth={1.5} />
                    <text textAnchor="middle" y={5} fontSize={14} fontWeight={700} fill="var(--text)">{text}</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Start, Spitzen (ziehbar in „Frei") und Ergebnis */}
          <circle cx={xOf(w.start)} cy={ACHSE} r={8} fill="var(--text)" />
          <text x={xOf(w.start)} y={ACHSE - 20} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--text)">{t("zahlenstrahl.start")}</text>
          {modus === "frei" && (
            <circle cx={xOf(w.start)} cy={ACHSE} r={16} fill="transparent" style={{ cursor: "ew-resize" }} onPointerDown={fasse("start")} />
          )}
          {modus === "frei" && w.pfeile.map((p, i) => (
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
          <button onClick={() => setGezeigt((g) => Math.min(folge.length, g + 1))} disabled={fertig}
            style={{ ...btnPrimary, opacity: fertig ? 0.5 : 1 }}>{naechste && naechste.art === "drehen" ? t("zahlenstrahl.umdrehen") : t("zahlenstrahl.naechster")}</button>
          <button onClick={() => setGezeigt(0)} disabled={gezeigt === 0} style={{ ...btnSecondary, opacity: gezeigt === 0 ? 0.5 : 1 }}>{t("zahlenstrahl.nochmal")}</button>
          <button onClick={zuFrei} style={btnSecondary}>{t("zahlenstrahl.selbst")}</button>
        </div>
      )}

      {modus === "frei" && (
        <div style={{ ...cardStyle, padding: 14, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <label style={{ fontSize: 13, color: "var(--text2)" }}>{t("zahlenstrahl.start")}</label>
            <ZahlFeld wert={frei.start} grenze={R} onChange={(v) => setFrei((f) => begrenze(v, f.schritte, R))} />
            {frei.schritte.map((s, i) => (
              <span key={i} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                <button onClick={() => setzeSchritt(i, { op: s.op === "+" ? "-" : "+" })} style={{ ...toolbarBtn, minWidth: 34, fontWeight: 800, fontSize: 16 }}
                  title={t("zahlenstrahl.opWechseln")} aria-label={t("zahlenstrahl.opWechseln")}>{s.op === "-" ? "−" : "+"}</button>
                <ZahlFeld wert={s.zahl} grenze={R} onChange={(v) => setzeSchritt(i, { zahl: v })} />
                <button onClick={() => setFrei((f) => ({ ...f, schritte: f.schritte.filter((_, k) => k !== i) }))} className="icon-btn"
                  style={{ ...toolbarBtn, minWidth: 28, padding: 4 }} title={t("common.delete")} aria-label={t("common.delete")}>
                  <Icon d={ICONS.close} size={14} />
                </button>
              </span>
            ))}
            {frei.schritte.length < 5 && (
              <button onClick={() => setFrei((f) => begrenze(f.start, [...f.schritte, { op: "+", zahl: raster <= 0.1 ? 0.1 : 1 }], R))} style={toolbarBtn}>+ {t("zahlenstrahl.pfeil")}</button>
            )}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {termText(frei.start, frei.schritte)} = <span style={{ color: "var(--accent)" }}>{schreibe(w.ergebnis)}</span>
          </div>
        </div>
      )}

      {/* Warum? Je Pfeil die passende Aussage — auch ohne Aufgabe zu verstehen. Ist erst der
          Pfeil der Zahl da (bei „minus"), steht dort, was gleich geschieht. */}
      {texte.length > 0 && (
        <div style={{ ...cardStyle, padding: 14 }}>
          {texte.map(({ p, st }) => (
            <p key={p.i} style={{ margin: "0 0 8px", fontSize: 14, lineHeight: 1.55 }}>
              <strong style={{ color: st === 1 ? farbe(eigenRichtung(p)) : farbe(p.richtung) }}>{p.op === "-" ? "−" : "+"} {minus(p.zahl)}:</strong>{" "}
              {st === 1
                ? t(p.zahl < 0 ? "zahlenstrahl.erzeugtLinks" : "zahlenstrahl.erzeugtRechts", { z: schreibe(p.zahl), betrag: schreibe(Math.abs(p.zahl)) })
                : t(`zahlenstrahl.regel.${regel(modell.schritte[p.i])}`, { z: schreibe(p.zahl), betrag: schreibe(Math.abs(p.zahl)) })}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// Eingabe einer Zahl: Komma oder Punkt, auch negativ. Unlesbares bleibt stehen, bis
// es wieder lesbar ist — der Wert dahinter aendert sich erst bei einer gueltigen Zahl.
function ZahlFeld({ wert, onChange, grenze }) {
  const [text, setText] = useState(schreibe(wert));
  const [fokus, setFokus] = useState(false);
  useEffect(() => { if (!fokus) setText(schreibe(wert)); }, [wert, fokus]);
  const ok = leseZahl(text, grenze) !== null;
  return (
    <input value={text} inputMode="decimal" aria-label={`±${schreibe(grenze)}`}
      onFocus={() => setFokus(true)} onBlur={() => { setFokus(false); setText(schreibe(wert)); }}
      onChange={(e) => { setText(e.target.value); const v = leseZahl(e.target.value, grenze); if (v !== null) onChange(v); }}
      style={{ ...toolbarInput, width: 70, textAlign: "center", ...(ok ? null : { borderColor: C.danger }) }} />
  );
}
