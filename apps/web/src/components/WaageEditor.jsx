// Die Waage — eine Gleichung zum Anfassen, umgeformt per Drag and Drop.
//
//   • Ein Teil ziehen: auf den Muelleimer (er erscheint nur waehrend des
//     Ziehens) loescht es, auf die andere Schale legt es hinueber, anderswo
//     losgelassen kehrt es zurueck. Die Waage zeigt schon beim Ziehen, was das
//     Loslassen taete. Nimmt man nur auf einer Seite etwas, kippt sie — erst
//     wenn auf der anderen Seite dasselbe passiert, steht sie wieder gerade.
//   • Teilen ist dasselbe Wegnehmen: wer bei 3x = 12 zwei x und acht Einer
//     wegnimmt, hat gedrittelt; steht die Waage dann gerade, steht „| : 3“ im
//     Weg (core/waage.js: ablesen).
// Keine Eingabefelder, keine Rechenknoepfe (Wunsch des Nutzers): die Kinder
// lesen die Gleichung von der Waage ab und handeln an ihr.
// Ein Schritt zaehlt erst, wenn die Waage wieder im Gleichgewicht ist; der Weg
// erscheint nach dem Loesen als Zeilen „3x + 2 = 14 | − 2“.
//
// Gerechnet wird in core/waage.js (Spiegel im Server). Gezeichnet als SVG;
// bewegt ueber SVG-Attribute statt CSS-Transforms (Safari verrechnete sonst
// die Trefferflaechen).
import { useEffect, useMemo, useRef, useState } from "react";
import { COLORS as C, CONTROL_R, btnSecondary, btnSmall, panelStyle } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { ablesen, geloest, gleich, gleichungText, kopie, loesung, neigung, opText, probeText, term, MAX_SCHRITTE } from "../core/waage.js";

export const leererWeg = () => ({ schritte: [] });

const FARBE_X = "#3b82f6";
const FARBE_E = "#9ca3af";
const FARBE_10 = "#f59e0b";
// Ablageziele beim Ziehen: Muelleimer unter dem Drehpunkt, die Schalen.
const MUELL = [300, 215];
const MUELL_R = 46;
const SCHALE_R = 105;

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

// Ein Teil, wie es aussieht — auf der Schale und als Geist unter dem Finger.
function TeilBild({ art, n, g }) {
  if (art === "x") return (<>
    <rect x={-g / 2} y={-g / 2} width={g} height={g} rx={4} fill={FARBE_X} />
    <text pointerEvents="none" y={g * 0.18} textAnchor="middle" fontSize={g * 0.55} fontWeight={700} fill="#fff">x</text>
  </>);
  if (n === 10) return (<>
    <rect x={-g / 2} y={-g / 2} width={g} height={g} rx={g / 2} fill={FARBE_10} />
    <text pointerEvents="none" y={g * 0.18} textAnchor="middle" fontSize={g * 0.45} fontWeight={700} fill="#fff">10</text>
  </>);
  return (<>
    <circle r={g / 2.4} fill={FARBE_E} />
    <text pointerEvents="none" y={g * 0.15} textAnchor="middle" fontSize={g * 0.42} fontWeight={700} fill="#fff">1</text>
  </>);
}

function Schale({ seite, cx, cy, lesen, onGreifen, t }) {
  const liste = teile(seite);
  const breite = 200;
  const spalten = 6;
  const zeilen = Math.max(1, Math.ceil(liste.length / spalten));
  const zelle = Math.min(32, Math.floor(130 / zeilen));
  const g = zelle - 4;
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <line x1={-breite / 2 + 10} y1={0} x2={0} y2={-150} stroke="#6b7280" strokeWidth={1.5} />
      <line x1={breite / 2 - 10} y1={0} x2={0} y2={-150} stroke="#6b7280" strokeWidth={1.5} />
      <path d={`M ${-breite / 2} 0 Q 0 22 ${breite / 2} 0 Z`} fill="#d1d5db" stroke="#6b7280" strokeWidth={1.5} />
      {liste.map((it, i) => {
        const sp = i % spalten, ze = Math.floor(i / spalten);
        const x = (sp - (Math.min(liste.length, spalten) - 1) / 2) * zelle;
        const y = -zelle / 2 - 2 - ze * zelle;
        // Gezogen wird immer EIN Teil — auch von der Zehner-Stange (sie bricht
        // auf). Sonst liesse sich rechts keine einzelne 1 abziehen, wenn dort
        // nur Zehner liegen, und die Waage kaeme nie ins Lot.
        return (
          <g key={i} transform={`translate(${x} ${y})`} style={{ cursor: lesen ? "default" : "grab", touchAction: "none" }}
            onPointerDown={lesen ? undefined : (e) => onGreifen(e, it.art, g)}>
            <title>{it.art === "x" ? t("waage.nimmX") : t("waage.nimmE", { n: 1 })}</title>
            <rect x={-zelle / 2} y={-zelle / 2} width={zelle} height={zelle} fill="transparent" />
            <TeilBild art={it.art} n={it.n} g={g} />
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
  const [fehler, setFehler] = useState("");
  // Laufender Zug: { typ: "teil", seite, art, g } oder { typ: "teiler", n },
  // dazu die Zeigerlage (Bildschirm und SVG) und ob gerade abgelegt wuerde.
  const [zug, setZug] = useState(null);
  const svgRef = useRef(null);
  const basis = arbeit || festerStand;
  const fertig = geloest(festerStand) && !arbeit;


  // Vorschau: was waere, wenn jetzt losgelassen wuerde? `ziel` ist "muell",
  // die andere Schale ("l"/"r") oder null (zurueck an den Platz).
  const ohne = (st) => { const neu = kopie(st); if (zug && neu[zug.seite][zug.art] > 0) neu[zug.seite][zug.art] -= 1; return neu; };
  const ergebnis = (z) => {
    if (!z) return basis;
    if (z.ziel === "muell") return ohne(basis);
    if (z.ziel === "l" || z.ziel === "r") { const neu = ohne(basis); neu[z.ziel][z.art] += 1; return neu; }
    return basis;
  };
  // Angezeigt wird beim Ziehen der Stand OHNE das Teil (es hängt am Finger),
  // auf der Zielschale schon mit ihm; gekippt wird nach dem Ergebnis.
  const anzeige = zug ? (zug.ziel === "l" || zug.ziel === "r" ? ergebnis(zug) : ohne(basis)) : basis;
  const kippStand = ergebnis(zug);
  const kipp = xWahr == null ? 0 : neigung(kippStand, xWahr);

  const festhalten = (neu, op, hand = false) => {
    if (schritte.length >= MAX_SCHRITTE) { setFehler(t("waage.fehler.zuViele")); return; }
    onChange({ schritte: [...schritte, { l: neu.l, r: neu.r, op, ...(hand ? { hand: true } : {}) }] });
    setArbeit(null);
    setFehler("");
  };

  const aendern = (neu) => {
    setFehler("");
    // Wieder im Gleichgewicht und anders als vorher: das ist ein Schritt.
    if (xWahr != null && neigung(neu, xWahr) === 0 && !gleich(neu, festerStand)) {
      // Zweimal je ein Gewicht von beiden Seiten ist EIN Schritt „− 2“, nicht
      // zwei Zeilen „− 1“.
      const letzter = schritte[schritte.length - 1];
      if (letzter && letzter.hand) {
        const davor = schritte.length > 1 ? schritte[schritte.length - 2] : start;
        const zusammen = ablesen(davor, neu);
        const einzeln = ablesen(festerStand, neu);
        // Zusammenlegen, wenn beide Griffe zusammen eine Umformung ergeben:
        // gleiche Art (− 1, − 1 → − 2), ein Teilen (über einen Zwischenstand
        // „2x = 8" bis „x = 4" → : 3) oder der vorige Griff war unbestimmt.
        if (zusammen.art !== "frei" && (zusammen.art === einzeln.art || zusammen.art === ":" || letzter.op === "frei")) {
          onChange({ schritte: [...schritte.slice(0, -1), { l: neu.l, r: neu.r, op: opText(zusammen.art, zusammen.n), hand: true }] });
          setArbeit(null);
          return;
        }
      }
      const o = ablesen(festerStand, neu);
      festhalten(neu, o.art === "frei" ? "frei" : opText(o.art, o.n), true);
      return;
    }
    setArbeit(gleich(neu, festerStand) ? null : neu);
  };

  // ── Ziehen: ein Zeiger, verfolgt am Dokument (der Finger verlaesst das Teil) ──
  const svgPunkt = (cx, cy) => {
    const svg = svgRef.current;
    if (!svg || !svg.getScreenCTM()) return [0, 0];
    const p = svg.createSVGPoint(); p.x = cx; p.y = cy;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return [q.x, q.y];
  };
  const zugRef = useRef(null);
  zugRef.current = zug;
  // Was der Zug beim Bewegen und Loslassen braucht, steht in einem Ref: der
  // Effekt haengt nur daran, OB gezogen wird, nicht an jedem Render.
  const helfer = useRef(null);
  helfer.current = { svgPunkt, aendern, ergebnis, schaleMitte: () => schaleMitteJetzt };
  const aktiv = zug ? zug.id : null;
  useEffect(() => {
    if (aktiv == null) return undefined;
    const punkt = (x, y) => helfer.current.svgPunkt(x, y);
    const bewegen = (e) => {
      const z = zugRef.current; if (!z || e.pointerId !== z.id) return;
      e.preventDefault();
      const [sx, sy] = punkt(e.clientX, e.clientY);
      const neu = { ...z, cx: e.clientX, cy: e.clientY, sx, sy };
      const mitten = helfer.current.schaleMitte();
      const anders = z.seite === "l" ? "r" : "l";
      neu.ziel = Math.hypot(sx - MUELL[0], sy - MUELL[1]) < MUELL_R ? "muell"
        : Math.hypot(sx - mitten[anders][0], sy - mitten[anders][1]) < SCHALE_R ? anders : null;
      setZug(neu);
    };
    const loslassen = (e) => {
      const z = zugRef.current; if (!z || e.pointerId !== z.id) return;
      setZug(null);
      if (e.type === "pointercancel") return;   // iOS nimmt den Finger: nichts tun
      if (z.ziel) helfer.current.aendern(helfer.current.ergebnis(z));
    };
    window.addEventListener("pointermove", bewegen, { passive: false });
    window.addEventListener("pointerup", loslassen);
    window.addEventListener("pointercancel", loslassen);
    return () => {
      window.removeEventListener("pointermove", bewegen);
      window.removeEventListener("pointerup", loslassen);
      window.removeEventListener("pointercancel", loslassen);
    };
  }, [aktiv]);

  const greifenTeil = (seite) => (e, art, g) => {
    e.preventDefault();
    const [sx, sy] = svgPunkt(e.clientX, e.clientY);
    setFehler("");
    setZug({ typ: "teil", seite, art, g, id: e.pointerId, cx: e.clientX, cy: e.clientY, sx, sy, ziel: null });
  };

  const zurueck = () => {
    if (arbeit) { setArbeit(null); return; }
    if (schritte.length) onChange({ schritte: schritte.slice(0, -1) });
    setFehler("");
  };

  const grad = useWinkel(kipp * 7);
  const winkel = grad * (Math.PI / 180);
  const ende = (dx) => [300 + dx * Math.cos(winkel), 60 + dx * Math.sin(winkel)];
  const [lx, ly] = ende(-220);
  const [rx, ry] = ende(220);
  // Mitten der Schalen fuer die Ablage — aus der gezeichneten Lage, damit das
  // Ziel dort ist, wo man es sieht.
  const schaleMitteJetzt = { l: [lx, ly + 110], r: [rx, ry + 110] };
  const protokoll = protokollZeilen(start, schritte);
  const bedienbar = !lesen && !fertig;

  return (
    <div style={{ userSelect: "none", WebkitUserSelect: "none" }}>
      {/* Die Gleichung steht NICHT da: die Kinder lesen sie von der Waage ab
          und schreiben sie selbst auf. Erst wenn x allein steht, kommt sie. */}
      {(fertig || lesen) && (
        <div style={{ textAlign: "center", fontSize: 22, fontWeight: 700, margin: "4px 0 8px", fontVariantNumeric: "tabular-nums" }}>
          {gleichungText(basis)}
          {fertig && <span style={{ color: C.success, marginLeft: 8 }}>✓</span>}
        </div>
      )}
      <svg ref={svgRef} viewBox="0 0 600 300" role="img" aria-label={t("waage.titel")}
        style={{ width: "100%", maxHeight: 340, display: "block", touchAction: "none", overflow: "visible" }}>
        <path d="M 300 60 L 270 290 L 330 290 Z" fill="#9ca3af" />
        <rect x={230} y={286} width={140} height={8} rx={4} fill="#6b7280" />
        <g transform={`rotate(${grad} 300 60)`}>
          <rect x={76} y={55} width={448} height={10} rx={5} fill="#4b5563" />
        </g>
        <circle cx={300} cy={60} r={9} fill="#374151" />
        <Schale seite={anzeige.l} cx={lx} cy={ly + 150} lesen={!bedienbar} onGreifen={greifenTeil("l")} t={t} />
        <Schale seite={anzeige.r} cx={rx} cy={ry + 150} lesen={!bedienbar} onGreifen={greifenTeil("r")} t={t} />
        {/* Das gezogene Teil unter dem Finger — blass, solange es noch über
            seiner Schale ist (Loslassen legt es zurück). */}
        {/* Waehrend des Ziehens: die andere Schale leuchtet als Ziel, darunter
            der Muelleimer. Ausserhalb eines Zugs gibt es beides nicht. */}
        {zug && (() => {
          const anders = zug.seite === "l" ? "r" : "l";
          const [ax, ay] = schaleMitteJetzt[anders];
          return (
            <g pointerEvents="none">
              <ellipse cx={ax} cy={ay + 25} rx={108} ry={70} fill={zug.ziel === anders ? "rgba(46,134,171,0.15)" : "none"}
                stroke="rgba(46,134,171,0.7)" strokeWidth={2} strokeDasharray="6 5" />
              <g transform={`translate(${MUELL[0]} ${MUELL[1]})`}>
                <circle r={MUELL_R - 8} fill={zug.ziel === "muell" ? C.danger : "#fff"} stroke={C.danger} strokeWidth={2.5} />
                <g stroke={zug.ziel === "muell" ? "#fff" : C.danger} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M -13 -9 H 13" /><path d="M -5 -9 V -13 H 5 V -9" />
                  <path d="M -10 -9 L -8 14 H 8 L 10 -9" /><path d="M -3 -3 V 9 M 3 -3 V 9" />
                </g>
              </g>
            </g>
          );
        })()}
        {zug && (
          <g transform={`translate(${zug.sx} ${zug.sy})`} opacity={zug.ziel ? 1 : 0.6} pointerEvents="none">
            <TeilBild art={zug.art} n={1} g={zug.g} />
          </g>
        )}
      </svg>

      {bedienbar && (
        <>
          {arbeit && !zug && (
            <div style={{ fontSize: 14, color: C.warning, textAlign: "center", fontWeight: 600, margin: "4px 0 8px" }}>{t("waage.kippt")}</div>
          )}
          {fehler && <div style={{ fontSize: 13, color: C.danger, textAlign: "center", marginBottom: 8 }}>{fehler}</div>}
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 8 }}>
            <button onClick={zurueck} disabled={!arbeit && !schritte.length} style={{ ...btnSecondary, ...btnSmall }}>{t("waage.zurueck")}</button>
          </div>
        </>
      )}
      {fertig && !lesen && (
        <div style={{ fontSize: 14, color: C.success, textAlign: "center", fontWeight: 600, margin: "4px 0 8px" }}>
          {t("waage.fertig", { probe: probeText(start, xWahr) })}
        </div>
      )}
      {fertig && !lesen && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
          <button onClick={zurueck} style={{ ...btnSecondary, ...btnSmall }}>{t("waage.zurueck")}</button>
        </div>
      )}

      {/* Der Lösungsweg — erst nach dem Lösen; vorher wäre er die Lösung zum Abschreiben. */}
      {(fertig || lesen) && (
        <div style={{ ...panelStyle, padding: "8px 12px" }}>
          <Protokoll zeilen={protokoll} t={t} />
        </div>
      )}
      <div style={{ display: "flex", gap: 16, justifyContent: "center", fontSize: 12, color: "var(--text3)", marginTop: 8 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: FARBE_X, marginRight: 4 }} />{t("waage.legX")}</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: FARBE_E, borderRadius: CONTROL_R, marginRight: 4 }} />{t("waage.legE")}</span>
      </div>
    </div>
  );
}

// Gleichungen untereinander, am Gleichheitszeichen ausgerichtet, die Umformung
// rechts daneben — die Form aus dem Heft. Auch die Lehrkraft-Sicht nimmt sie.
// Der Winkel des Balkens, weich nachgezogen — ohne CSS-Transition (siehe
// oben, Safari). Ein Bild je Frame, 450 ms.
function useWinkel(ziel) {
  const [w, setW] = useState(ziel);
  const vorher = useRef(ziel);
  useEffect(() => {
    const von = vorher.current;
    if (von === ziel) return undefined;
    const t0 = performance.now();
    let raf = 0;
    const schritt = (jetzt) => {
      const p = Math.min(1, (jetzt - t0) / 450);
      const e = 1 - (1 - p) * (1 - p);
      const wert = von + (ziel - von) * e;
      vorher.current = wert;
      setW(wert);
      if (p < 1) raf = requestAnimationFrame(schritt);
    };
    raf = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(raf);
  }, [ziel]);
  return w;
}

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
