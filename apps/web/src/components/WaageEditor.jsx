// Die Waage — eine Gleichung zum Anfassen, umgeformt per Drag and Drop.
//
//   • Ein Teil von EINER Schale wegziehen: die Waage kippt — schon beim Ziehen
//     als Vorschau. Erst wenn auf der anderen Seite dasselbe passiert, steht
//     sie wieder gerade. Genau das ist der Gedanke hinter „auf beiden Seiten
//     dasselbe tun“, und man sieht ihn, statt ihn zu lesen.
//   • Teilen laesst sich nicht wegziehen: dafuer liegen Teiler-Chips (: 2,
//     : 3 …) bereit, die man auf die Waage zieht. Auch hier zeigt die Waage
//     beim Darueberziehen, wie es aussaehe.
// Keine Eingabefelder, keine Rechenknoepfe (Wunsch des Nutzers): die Kinder
// lesen die Gleichung von der Waage ab und handeln an ihr.
// Ein Schritt zaehlt erst, wenn die Waage wieder im Gleichgewicht ist; der Weg
// erscheint nach dem Loesen als Zeilen „3x + 2 = 14 | − 2“.
//
// Gerechnet wird in core/waage.js (Spiegel im Server). Gezeichnet als SVG;
// bewegt ueber SVG-Attribute statt CSS-Transforms (Safari verrechnete sonst
// die Trefferflaechen).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { COLORS as C, CONTROL_R, btnSecondary, btnSmall, panelStyle } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { ablesen, geloest, gleich, gleichungText, kopie, loesung, neigung, opText, probeText, term, umformen, MAX_SCHRITTE } from "../core/waage.js";

export const leererWeg = () => ({ schritte: [] });

const FARBE_X = "#3b82f6";
const FARBE_E = "#9ca3af";
const FARBE_10 = "#f59e0b";
const TEILER = [2, 3, 4, 5, 6, 7, 8, 9, 10];
// Wie weit ein Teil von seiner Schale weg muss, damit es als weggenommen gilt.
const WEG_ABSTAND = 115;

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

  // Geometrie: Drehpunkt in der Mitte, Balken ± 220, Schalen 150 darunter.
  // Die Schalenmitten fuer den Abstand werden aus dem GERADEN Balken genommen
  // — beim Kippen wanderten sie sonst unter dem Finger weg.
  const schaleMitte = { l: [80, 170], r: [520, 170] };

  // Vorschau: was waere, wenn jetzt losgelassen wuerde?
  let vorschau = null, vorschauFehler = "";
  if (zug && zug.typ === "teil") {
    const neu = kopie(basis);
    if (neu[zug.seite][zug.art] > 0) neu[zug.seite][zug.art] -= 1;
    vorschau = neu;
  } else if (zug && zug.typ === "teiler" && zug.ueber) {
    const r = umformen(basis, ":", zug.n);
    if (r.fehler) vorschauFehler = t(`waage.fehler.${r.fehler}`, { n: zug.n }); else vorschau = r.stand;
  }
  // Angezeigt wird beim Ziehen eines Teils immer der Stand OHNE es (es hängt
  // ja am Finger); kippen tut die Waage aber erst, wenn es weit genug weg ist.
  const anzeige = vorschau || basis;
  const kippStand = zug && zug.typ === "teil" && !zug.weg ? basis : anzeige;
  const kipp = xWahr == null ? 0 : neigung(kippStand, xWahr);

  const festhalten = (neu, op, hand = false) => {
    if (schritte.length >= MAX_SCHRITTE) { setFehler(t("waage.fehler.zuViele")); return; }
    onChange({ schritte: [...schritte, { l: neu.l, r: neu.r, op, ...(hand ? { hand: true } : {}) }] });
    setArbeit(null);
    setFehler("");
  };

  const nehmen = (seite, art) => {
    const neu = kopie(basis);
    neu[seite][art] -= 1;
    if (neu[seite][art] < 0) return;
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
        if (zusammen.art !== "frei" && zusammen.art === einzeln.art) {
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

  const teilen = (n) => {
    if (arbeit) { setFehler(t("waage.erstGerade")); return; }
    const r = umformen(festerStand, ":", n);
    if (r.fehler) { setFehler(t(`waage.fehler.${r.fehler}`, { n })); return; }
    festhalten(r.stand, opText(":", n));
  };

  // ── Ziehen: ein Zeiger, verfolgt am Dokument (der Finger verlaesst das Teil) ──
  const svgPunkt = (cx, cy) => {
    const svg = svgRef.current;
    if (!svg || !svg.getScreenCTM()) return [0, 0];
    const p = svg.createSVGPoint(); p.x = cx; p.y = cy;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return [q.x, q.y];
  };
  const ueberWaage = (cx, cy) => {
    const r = svgRef.current?.getBoundingClientRect();
    return !!r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  };
  const zugRef = useRef(null);
  zugRef.current = zug;
  // Was der Zug beim Bewegen und Loslassen braucht, steht in einem Ref: der
  // Effekt haengt nur daran, OB gezogen wird, nicht an jedem Render.
  const helfer = useRef(null);
  helfer.current = { svgPunkt, ueberWaage, nehmen, teilen, schaleMitte };
  const aktiv = zug ? zug.id : null;
  useEffect(() => {
    if (aktiv == null) return undefined;
    const { svgPunkt: punkt, ueberWaage: ueber } = helfer.current;
    const bewegen = (e) => {
      const z = zugRef.current; if (!z || e.pointerId !== z.id) return;
      e.preventDefault();
      const [sx, sy] = punkt(e.clientX, e.clientY);
      const neu = { ...z, cx: e.clientX, cy: e.clientY, sx, sy };
      if (z.typ === "teil") {
        const [mx, my] = helfer.current.schaleMitte[z.seite];
        neu.weg = Math.hypot(sx - mx, sy - my) > WEG_ABSTAND;
      } else {
        neu.ueber = ueber(e.clientX, e.clientY);
      }
      setZug(neu);
    };
    const loslassen = (e) => {
      const z = zugRef.current; if (!z || e.pointerId !== z.id) return;
      setZug(null);
      if (e.type === "pointercancel") return;   // iOS nimmt den Finger: nichts tun
      if (z.typ === "teil" && z.weg) helfer.current.nehmen(z.seite, z.art);
      if (z.typ === "teiler" && z.ueber) helfer.current.teilen(z.n);
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
    setZug({ typ: "teil", seite, art, g, id: e.pointerId, cx: e.clientX, cy: e.clientY, sx, sy, weg: false });
  };
  const greifenTeiler = (n) => (e) => {
    e.preventDefault();
    setFehler("");
    setZug({ typ: "teiler", n, id: e.pointerId, cx: e.clientX, cy: e.clientY, ueber: false });
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
        style={{ width: "100%", maxHeight: 340, display: "block", touchAction: "none", overflow: "visible",
          outline: zug && zug.typ === "teiler" && zug.ueber ? `3px dashed ${vorschauFehler ? C.danger : C.success}` : "none", borderRadius: CONTROL_R }}>
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
        {zug && zug.typ === "teil" && (
          <g transform={`translate(${zug.sx} ${zug.sy})`} opacity={zug.weg ? 1 : 0.55} pointerEvents="none">
            <TeilBild art={zug.art} n={1} g={zug.g} />
          </g>
        )}
      </svg>

      {bedienbar && (
        <>
          {arbeit && !zug && (
            <div style={{ fontSize: 14, color: C.warning, textAlign: "center", fontWeight: 600, margin: "4px 0 8px" }}>{t("waage.kippt")}</div>
          )}
          {vorschauFehler && (
            <div style={{ fontSize: 14, color: C.danger, textAlign: "center", fontWeight: 600, margin: "4px 0 8px" }}>{vorschauFehler}</div>
          )}
          {/* Teiler zum Ziehen — die Zahl steht auf dem Chip, keine Eingabe. */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", justifyContent: "center", margin: "8px 0" }}>
            <span style={{ fontSize: 13, color: "var(--text2)" }}>{t("waage.teilen")}</span>
            {TEILER.map((k) => (
              <span key={k} onPointerDown={greifenTeiler(k)} title={t("waage.teilerZiehen")}
                style={{ ...btnSecondary, ...btnSmall, minWidth: 44, textAlign: "center", cursor: "grab", touchAction: "none",
                  fontVariantNumeric: "tabular-nums", opacity: zug && zug.typ === "teiler" && zug.n === k ? 0.35 : 1 }}>: {k}</span>
            ))}
          </div>
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

      {/* Der Teiler-Chip unter dem Finger (am body, sonst sperrt ein
          transform/overflow weiter oben das position: fixed ein). */}
      {zug && zug.typ === "teiler" && typeof document !== "undefined" && createPortal(
        <div style={{ position: "fixed", left: zug.cx, top: zug.cy, transform: "translate(-50%, -50%)", pointerEvents: "none", zIndex: 2000,
          ...btnSecondary, ...btnSmall, background: "var(--card)", boxShadow: "0 4px 14px rgba(0,0,0,0.25)" }}>: {zug.n}</div>,
        document.body,
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
