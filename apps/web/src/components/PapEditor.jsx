import { useMemo, useRef, useState } from "react";
import { Icon, ICONS, COLORS as C, CONTROL_R, toolbarBtn, toolbarBtnPrimary, toolbarInput, Toggle } from "./Icons.jsx";
import { useLanguage } from "../i18n";

// Editor für Programmablaufpläne (DIN 66001).
//
// Gezeichnet wird als SVG und nicht auf einem Canvas: ein Symbol ist ein
// Element mit einer id, es lässt sich anklicken, verschieben und wieder
// beschriften — auf einem Canvas müsste jeder Treffer selbst ausgerechnet
// werden, und Drucken hieße ein Bild statt Text.
//
// Die Formen sind die des Normblatts, mehr gibt es nicht: Start/Ende (Oval),
// Anweisung (Rechteck), Verzweigung (Raute), Ein-/Ausgabe (Parallelogramm),
// Unterprogramm (Rechteck mit Doppelstrich). Der Kommentar ist die eine
// Zutat, die kein Ablaufschritt ist: eckige Klammer am Rand, nie im Weg der
// Pfeile — genau dafür kennt ihn das Normblatt.
export const ARTEN = ["start", "anweisung", "verzweigung", "eingabe", "ausgabe", "unterprogramm", "ende", "kommentar"];

const B = 150;   // Grundbreite eines Symbols
const H = 60;    // Grundhöhe
const RASTER = 10;

const FARBE = {
  start: "#16a34a", ende: "#dc2626", anweisung: "#2563eb",
  verzweigung: "#d97706", eingabe: "#7c3aed", ausgabe: "#7c3aed",
  unterprogramm: "#0891b2", kommentar: "#6b7280",
};

function uid() {
  return "n" + Math.random().toString(36).slice(2, 9);
}

export function leeresDiagramm() {
  return { knoten: [], kanten: [] };
}

// Wie viel Platz braucht dieser Text? Ein Symbol wächst mit seiner Beschriftung,
// statt sie abzuschneiden: „Wenn die Zahl größer als 100 ist" ist ein normaler
// Satz in einem Ablaufplan, und ein Kästchen mit „Wenn die Zahl gr…" beantwortet
// keine Frage. Umgebrochen wird an Wortgrenzen, das Symbol wächst in der Höhe;
// nur ein einzelnes sehr langes Wort macht es breiter.
const ZEICHEN_PRO_ZEILE = 20;
const ZEILE_H = 17;

export function umbruch(text) {
  const worte = String(text || "").split(/\s+/).filter(Boolean);
  if (!worte.length) return [""];
  const zeilen = [];
  let cur = "";
  for (const w of worte) {
    if (!cur) { cur = w; continue; }
    if ((cur + " " + w).length <= ZEICHEN_PRO_ZEILE) cur += " " + w;
    else { zeilen.push(cur); cur = w; }
  }
  zeilen.push(cur);
  return zeilen;
}

export function masse(knoten) {
  const zeilen = umbruch(knoten.text);
  const laengste = zeilen.reduce((m, z) => Math.max(m, z.length), 0);
  // Raute und Parallelogramm verlieren an den Schrägen Platz — sie brauchen
  // mehr Fläche für denselben Text, sonst steht die Schrift über der Kante.
  const zuschlag = knoten.art === "verzweigung" ? 1.35 : (knoten.art === "eingabe" || knoten.art === "ausgabe") ? 1.15 : 1;
  const breite = Math.max(B, Math.round(laengste * 8.2 * zuschlag) + 28);
  const hoehe = Math.max(H, Math.round(zeilen.length * ZEILE_H * zuschlag) + 26);
  return { w: breite, h: hoehe, zeilen };
}

// Die Umrisse. Ein Symbol sitzt mit (x, y) an seiner linken oberen Ecke — so
// rechnet auch das Ziehen, und der Verbindungspunkt ist immer die Mitte einer
// Kante.
function Form({ art, x, y, w, h, aktiv }) {
  const f = FARBE[art] || "#2563eb";
  const gem = { fill: "var(--card)", stroke: f, strokeWidth: aktiv ? 3 : 2 };
  if (art === "start" || art === "ende") {
    return <rect x={x} y={y} width={w} height={h} rx={h / 2} ry={h / 2} {...gem} />;
  }
  if (art === "verzweigung") {
    return <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} {...gem} />;
  }
  if (art === "eingabe" || art === "ausgabe") {
    const s = Math.min(24, w / 6);
    return <polygon points={`${x + s},${y} ${x + w},${y} ${x + w - s},${y + h} ${x},${y + h}`} {...gem} />;
  }
  if (art === "unterprogramm") {
    return (
      <>
        <rect x={x} y={y} width={w} height={h} {...gem} />
        <line x1={x + 10} y1={y} x2={x + 10} y2={y + h} stroke={f} strokeWidth={2} />
        <line x1={x + w - 10} y1={y} x2={x + w - 10} y2={y + h} stroke={f} strokeWidth={2} />
      </>
    );
  }
  if (art === "kommentar") {
    // Eckige Klammer links, offener Kasten rechts — die Normform der Anmerkung.
    return (
      <>
        <rect x={x} y={y} width={w} height={h} fill="var(--card)" stroke={f} strokeWidth={aktiv ? 2 : 1}
          strokeDasharray="4 3" />
        <path d={`M${x + 8},${y + 6} h-6 v${h - 12} h6`} fill="none" stroke={f} strokeWidth={2} />
      </>
    );
  }
  return <rect x={x} y={y} width={w} height={h} {...gem} />;
}

// Verbindungspunkt zweier Symbole: von Kante zu Kante, nicht Mitte zu Mitte —
// sonst läuft die Linie durch das Symbol hindurch.
function anschluss(a, b) {
  const am = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bm = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bm.x - am.x, dy = bm.y - am.y;
  const rand = (m, dx2, dy2, w, h) => (Math.abs(dy2) * w > Math.abs(dx2) * h
    ? { x: m.x + (dx2 === 0 ? 0 : (dx2 / Math.abs(dy2)) * (h / 2)), y: m.y + Math.sign(dy2) * (h / 2) }
    : { x: m.x + Math.sign(dx2) * (w / 2), y: m.y + (dy2 === 0 ? 0 : (dy2 / Math.abs(dx2)) * (w / 2)) });
  return [rand(am, dx, dy, a.w, a.h), rand(bm, -dx, -dy, b.w, b.h)];
}

// Ein Symbol in seiner echten Form als Knopf — die Palette zeigt, was entsteht.
// Vorher standen dort sieben gleich aussehende Textknöpfe: welches Wort welche
// Form meint, muss man dann auswendig wissen.
function Palette({ art, label, onClick }) {
  const w = 54, h = 26, pad = 3;
  return (
    <button onClick={onClick} title={label} aria-label={label}
      style={{ ...toolbarBtn, padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 6, height: "auto" }}>
      <svg width={w + pad * 2} height={h + pad * 2} aria-hidden style={{ display: "block", flexShrink: 0 }}>
        <Form art={art} x={pad} y={pad} w={w} h={h} />
      </svg>
      <span style={{ fontSize: 12 }}>{label}</span>
    </button>
  );
}

export default function PapEditor({ wert, onChange, lesen = false, hoehe = 520, raster: rasterVon, onRaster }) {
  const { t } = useLanguage();
  const d = wert && wert.knoten ? wert : leeresDiagramm();
  const [gewaehlt, setGewaehlt] = useState(null);
  // Verbinden ist ein MODUS, kein Knopf am Symbol: einmal einschalten, dann
  // Start und Ziel anklicken — und der Modus bleibt an, weil man Verbindungen
  // fast nie einzeln zieht. Vorher musste man erst ein Symbol wählen, dann
  // „Verbinden", dann das Ziel; für jede Linie dreimal.
  const [verbinden, setVerbinden] = useState(false);
  const [von, setVon] = useState(null);
  const [rasterIntern, setRasterIntern] = useState(true);
  const raster = rasterVon === undefined ? rasterIntern : rasterVon;
  const setRaster = onRaster || setRasterIntern;
  const svgRef = useRef(null);
  const zieh = useRef(null);

  const setz = (next) => onChange && onChange(next);
  // Jeder Knoten bekommt seine gerechnete Größe dazu — einmal je Änderung,
  // nicht in jeder Zeichenschleife neu.
  const knoten = useMemo(() => d.knoten.map((k) => ({ ...k, ...masse(k) })), [d.knoten]);
  const knotenVon = useMemo(() => Object.fromEntries(knoten.map((k) => [k.id, k])), [knoten]);

  const hinzu = (art) => {
    // Neue Symbole stapeln sich sonst übereinander: jedes kommt eine Reihe
    // tiefer als das unterste, das schon da ist.
    const unten = knoten.reduce((m, k) => Math.max(m, k.y + k.h), 0);
    const k = { id: uid(), art, text: t(`pap.art.${art}`), x: 60, y: unten ? unten + 40 : 20 };
    setz({ ...d, knoten: [...d.knoten, k] });
    setGewaehlt(k.id);
  };

  const aendere = (id, patch) => setz({ ...d, knoten: d.knoten.map((k) => (k.id === id ? { ...k, ...patch } : k)) });

  const loesche = (id) => {
    setz({
      knoten: d.knoten.filter((k) => k.id !== id),
      kanten: d.kanten.filter((e) => e.von !== id && e.nach !== id),
    });
    setGewaehlt(null);
  };

  const treffer = (id) => {
    if (!verbinden) { setGewaehlt(id); return; }
    if (!von) { setVon(id); return; }
    if (von === id) { setVon(null); return; }
    const schon = d.kanten.some((e) => e.von === von && e.nach === id);
    if (!schon) {
      // Eine Verzweigung hat zwei Ausgänge — der erste heißt „ja", der zweite
      // „nein". Ohne Beschriftung wäre ein Diagramm mehrdeutig, und niemand
      // tippt sie freiwillig an jede Linie.
      const q = knotenVon[von];
      const raus = d.kanten.filter((e) => e.von === von).length;
      const label = q && q.art === "verzweigung" ? (raus === 0 ? t("pap.ja") : raus === 1 ? t("pap.nein") : "") : "";
      setz({ ...d, kanten: [...d.kanten, { von, nach: id, label }] });
    }
    setVon(null);
  };

  const punkt = (ev) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return {
      x: (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left,
      y: (ev.touches ? ev.touches[0].clientY : ev.clientY) - r.top,
    };
  };

  const startZiehen = (ev, k) => {
    if (lesen || verbinden) return;   // im Verbinden-Modus wird geklickt, nicht geschoben
    ev.stopPropagation();
    const p = punkt(ev);
    zieh.current = { id: k.id, dx: p.x - k.x, dy: p.y - k.y, bewegt: false };
    setGewaehlt(k.id);
  };

  const beimZiehen = (ev) => {
    if (!zieh.current) return;
    const p = punkt(ev);
    const roh = { x: p.x - zieh.current.dx, y: p.y - zieh.current.dy };
    const auf = (v) => (raster ? Math.round(v / RASTER) * RASTER : Math.round(v));
    zieh.current.bewegt = true;
    aendere(zieh.current.id, { x: Math.max(0, auf(roh.x)), y: Math.max(0, auf(roh.y)) });
  };

  const endeZiehen = () => { zieh.current = null; };

  const gew = gewaehlt ? knotenVon[gewaehlt] : null;
  const breite = Math.max(640, ...knoten.map((k) => k.x + k.w + 40));
  const tiefe = Math.max(hoehe, ...knoten.map((k) => k.y + k.h + 40));

  return (
    <div>
      {!lesen && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
          {ARTEN.map((a) => <Palette key={a} art={a} label={t(`pap.art.${a}`)} onClick={() => hinzu(a)} />)}
          <span style={{ flex: 1, minWidth: 0 }} />
          <button onClick={() => { setVerbinden((v) => !v); setVon(null); }}
            style={verbinden ? toolbarBtnPrimary : toolbarBtn}
            title={t("pap.verbindeHinweis")}>
            {verbinden ? (von ? t("pap.verbindeZiel") : t("pap.verbindeStart")) : t("pap.verbinde")}
          </button>
          <Toggle checked={!!raster} onChange={setRaster} label={t("pap.raster")} />
        </div>
      )}

      <div style={{ border: "1px solid var(--border)", borderRadius: CONTROL_R, overflow: "auto", background: "var(--bg)" }}>
        <svg ref={svgRef} width={breite} height={tiefe} className="pap-blatt"
          onMouseMove={beimZiehen} onMouseUp={endeZiehen} onMouseLeave={endeZiehen}
          onTouchMove={beimZiehen} onTouchEnd={endeZiehen}
          onClick={() => { setGewaehlt(null); setVon(null); }}
          style={{ display: "block", touchAction: "none" }}>
          <defs>
            <marker id="pap-pfeil" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="var(--text3)" />
            </marker>
            {/* Das Raster liegt UNTER allem und wird nie angeklickt. Es ist eine
                Zeichenhilfe, kein Inhalt — deshalb steht es auch nicht im
                gespeicherten Diagramm, sondern nur in der Ansicht. */}
            <pattern id="pap-raster" width={RASTER} height={RASTER} patternUnits="userSpaceOnUse">
              <circle cx={0.5} cy={0.5} r={0.5} fill="var(--border2)" />
            </pattern>
          </defs>
          {raster && !lesen && <rect width={breite} height={tiefe} fill="url(#pap-raster)" />}
          {d.kanten.map((e, i) => {
            const a = knotenVon[e.von], b = knotenVon[e.nach];
            if (!a || !b) return null;
            const [p1, p2] = anschluss(a, b);
            return (
              <g key={i}>
                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="var(--text3)" strokeWidth={1.5} markerEnd="url(#pap-pfeil)" />
                {e.label && (
                  <text x={(p1.x + p2.x) / 2 + 6} y={(p1.y + p2.y) / 2 - 4} fontSize={12} fill="var(--text2)">{e.label}</text>
                )}
                {!lesen && (
                  <circle cx={(p1.x + p2.x) / 2} cy={(p1.y + p2.y) / 2} r={7} fill="transparent" style={{ cursor: "pointer" }}
                    onClick={(ev) => { ev.stopPropagation(); setz({ ...d, kanten: d.kanten.filter((_, j) => j !== i) }); }}>
                    <title>{t("pap.kanteWeg")}</title>
                  </circle>
                )}
              </g>
            );
          })}
          {knoten.map((k) => (
            <g key={k.id} style={{ cursor: lesen ? "default" : verbinden ? "crosshair" : "move" }}
              onMouseDown={(ev) => startZiehen(ev, k)} onTouchStart={(ev) => startZiehen(ev, k)}
              onClick={(ev) => {
                ev.stopPropagation();
                if (lesen) return;
                if (!zieh.current || !zieh.current.bewegt) treffer(k.id);
              }}>
              <Form art={k.art} x={k.x} y={k.y} w={k.w} h={k.h}
                aktiv={gewaehlt === k.id || von === k.id} />
              {k.zeilen.map((z, i) => (
                <text key={i} x={k.x + k.w / 2} y={k.y + k.h / 2 + (i - (k.zeilen.length - 1) / 2) * ZEILE_H + 4}
                  textAnchor="middle" fontSize={13} fill="var(--text)" style={{ pointerEvents: "none" }}>
                  {z}
                </text>
              ))}
            </g>
          ))}
        </svg>
      </div>

      {!lesen && gew && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <input value={gew.text} onChange={(ev) => aendere(gew.id, { text: ev.target.value.slice(0, 200) })}
            placeholder={t("pap.text")} style={{ ...toolbarInput, flex: 1, minWidth: 160 }} />
          <button onClick={() => loesche(gew.id)} className="icon-btn" style={{ ...toolbarBtn, color: C.danger }}
            title={t("common.delete")} aria-label={t("common.delete")}>
            <Icon d={ICONS.trash} size={15} color={C.danger} />
          </button>
        </div>
      )}
    </div>
  );
}
