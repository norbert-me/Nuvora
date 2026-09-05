import { useMemo, useRef, useState } from "react";
import { Icon, ICONS, COLORS as C, CONTROL_R, toolbarBtn, toolbarBtnPrimary, toolbarInput } from "./Icons.jsx";
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
// Unterprogramm (Rechteck mit Doppelstrich). Eine freie Form wäre kein PAP mehr.
export const ARTEN = ["start", "anweisung", "verzweigung", "eingabe", "ausgabe", "unterprogramm", "ende"];

const B = 150;   // Breite eines Symbols
const H = 60;    // Höhe
const RASTER = 10;

const FARBE = {
  start: "#16a34a", ende: "#dc2626", anweisung: "#2563eb",
  verzweigung: "#d97706", eingabe: "#7c3aed", ausgabe: "#7c3aed", unterprogramm: "#0891b2",
};

function uid() {
  return "n" + Math.random().toString(36).slice(2, 9);
}

export function leeresDiagramm() {
  return { knoten: [], kanten: [] };
}

// Die Umrisse. Ein Symbol sitzt mit (x, y) an seiner linken oberen Ecke — so
// rechnet auch das Ziehen, und der Verbindungspunkt ist immer die Mitte einer
// Kante.
function Form({ art, x, y, aktiv }) {
  const f = FARBE[art] || "#2563eb";
  const gem = { fill: "var(--card)", stroke: f, strokeWidth: aktiv ? 3 : 2 };
  if (art === "start" || art === "ende") {
    return <rect x={x} y={y} width={B} height={H} rx={H / 2} ry={H / 2} {...gem} />;
  }
  if (art === "verzweigung") {
    return <polygon points={`${x + B / 2},${y} ${x + B},${y + H / 2} ${x + B / 2},${y + H} ${x},${y + H / 2}`} {...gem} />;
  }
  if (art === "eingabe" || art === "ausgabe") {
    const s = 18;
    return <polygon points={`${x + s},${y} ${x + B},${y} ${x + B - s},${y + H} ${x},${y + H}`} {...gem} />;
  }
  if (art === "unterprogramm") {
    return (
      <>
        <rect x={x} y={y} width={B} height={H} {...gem} />
        <line x1={x + 10} y1={y} x2={x + 10} y2={y + H} stroke={f} strokeWidth={2} />
        <line x1={x + B - 10} y1={y} x2={x + B - 10} y2={y + H} stroke={f} strokeWidth={2} />
      </>
    );
  }
  return <rect x={x} y={y} width={B} height={H} {...gem} />;
}

// Verbindungspunkt zweier Symbole: von Kante zu Kante, nicht Mitte zu Mitte —
// sonst läuft die Linie durch das Symbol hindurch.
function anschluss(a, b) {
  const am = { x: a.x + B / 2, y: a.y + H / 2 };
  const bm = { x: b.x + B / 2, y: b.y + H / 2 };
  const dx = bm.x - am.x, dy = bm.y - am.y;
  const rand = (m, dx2, dy2) => (Math.abs(dy2) * B > Math.abs(dx2) * H
    ? { x: m.x + (dx2 === 0 ? 0 : (dx2 / Math.abs(dy2)) * (H / 2)), y: m.y + Math.sign(dy2) * (H / 2) }
    : { x: m.x + Math.sign(dx2) * (B / 2), y: m.y + (dy2 === 0 ? 0 : (dy2 / Math.abs(dx2)) * (B / 2)) });
  return [rand(am, dx, dy), rand(bm, -dx, -dy)];
}

export default function PapEditor({ wert, onChange, lesen = false, hoehe = 520 }) {
  const { t } = useLanguage();
  const d = wert && wert.knoten ? wert : leeresDiagramm();
  const [gewaehlt, setGewaehlt] = useState(null);
  const [verbindeVon, setVerbindeVon] = useState(null);
  const svgRef = useRef(null);
  const zieh = useRef(null);

  const setz = (next) => onChange && onChange(next);
  const knotenVon = useMemo(() => Object.fromEntries(d.knoten.map((k) => [k.id, k])), [d.knoten]);

  const platz = () => {
    // Neue Symbole stapeln sich sonst übereinander: jedes kommt eine Reihe
    // tiefer als das unterste, das schon da ist.
    const unten = d.knoten.reduce((m, k) => Math.max(m, k.y), -H);
    return { x: 60, y: unten + H + 40 };
  };

  const hinzu = (art) => {
    const p = platz();
    const k = { id: uid(), art, text: t(`pap.art.${art}`), x: p.x, y: p.y };
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

  const verbinde = (id) => {
    if (!verbindeVon) { setVerbindeVon(id); return; }
    if (verbindeVon === id) { setVerbindeVon(null); return; }
    const schon = d.kanten.some((e) => e.von === verbindeVon && e.nach === id);
    if (!schon) {
      // Eine Verzweigung hat zwei Ausgänge — der erste heißt „ja", der zweite
      // „nein". Ohne Beschriftung wäre ein Diagramm mehrdeutig, und niemand
      // tippt sie freiwillig an jede Linie.
      const von = knotenVon[verbindeVon];
      const raus = d.kanten.filter((e) => e.von === verbindeVon).length;
      const label = von && von.art === "verzweigung" ? (raus === 0 ? t("pap.ja") : raus === 1 ? t("pap.nein") : "") : "";
      setz({ ...d, kanten: [...d.kanten, { von: verbindeVon, nach: id, label }] });
    }
    setVerbindeVon(null);
  };

  const punkt = (ev) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const cy = (ev.touches ? ev.touches[0].clientY : ev.clientY) - r.top;
    return { x: cx, y: cy };
  };

  const startZiehen = (ev, k) => {
    if (lesen) return;
    ev.stopPropagation();
    const p = punkt(ev);
    zieh.current = { id: k.id, dx: p.x - k.x, dy: p.y - k.y, bewegt: false };
    setGewaehlt(k.id);
  };

  const beimZiehen = (ev) => {
    if (!zieh.current) return;
    const p = punkt(ev);
    const x = Math.max(0, Math.round((p.x - zieh.current.dx) / RASTER) * RASTER);
    const y = Math.max(0, Math.round((p.y - zieh.current.dy) / RASTER) * RASTER);
    zieh.current.bewegt = true;
    aendere(zieh.current.id, { x, y });
  };

  const endeZiehen = () => { zieh.current = null; };

  const gew = gewaehlt ? knotenVon[gewaehlt] : null;
  const breite = Math.max(640, ...d.knoten.map((k) => k.x + B + 40));
  const tiefe = Math.max(hoehe, ...d.knoten.map((k) => k.y + H + 40));

  return (
    <div>
      {!lesen && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {ARTEN.map((a) => (
            <button key={a} onClick={() => hinzu(a)} style={{ ...toolbarBtn, borderLeft: `4px solid ${FARBE[a]}` }}
              title={t(`pap.art.${a}`)}>{t(`pap.art.${a}`)}</button>
          ))}
        </div>
      )}

      <div style={{ border: "1px solid var(--border)", borderRadius: CONTROL_R, overflow: "auto", background: "var(--bg)" }}>
        <svg ref={svgRef} width={breite} height={tiefe} className="pap-blatt"
          onMouseMove={beimZiehen} onMouseUp={endeZiehen} onMouseLeave={endeZiehen}
          onTouchMove={beimZiehen} onTouchEnd={endeZiehen}
          onClick={() => { setGewaehlt(null); setVerbindeVon(null); }}
          style={{ display: "block", touchAction: "none" }}>
          <defs>
            <marker id="pap-pfeil" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="var(--text3)" />
            </marker>
          </defs>
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
          {d.knoten.map((k) => (
            <g key={k.id} style={{ cursor: lesen ? "default" : "move" }}
              onMouseDown={(ev) => startZiehen(ev, k)} onTouchStart={(ev) => startZiehen(ev, k)}
              onClick={(ev) => {
                ev.stopPropagation();
                if (lesen) return;
                if (verbindeVon) { verbinde(k.id); return; }
                if (!zieh.current || !zieh.current.bewegt) setGewaehlt(k.id);
              }}>
              <Form art={k.art} x={k.x} y={k.y} aktiv={gewaehlt === k.id || verbindeVon === k.id} />
              <text x={k.x + B / 2} y={k.y + H / 2 + 4} textAnchor="middle" fontSize={13} fill="var(--text)"
                style={{ pointerEvents: "none" }}>
                {(k.text || "").length > 20 ? (k.text || "").slice(0, 19) + "…" : k.text}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {!lesen && gew && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          <input value={gew.text} onChange={(ev) => aendere(gew.id, { text: ev.target.value.slice(0, 200) })}
            placeholder={t("pap.text")} style={{ ...toolbarInput, flex: 1, minWidth: 160 }} />
          <button onClick={() => setVerbindeVon(gew.id)} style={verbindeVon === gew.id ? toolbarBtnPrimary : toolbarBtn}>
            {verbindeVon === gew.id ? t("pap.verbindeZiel") : t("pap.verbinde")}
          </button>
          <button onClick={() => loesche(gew.id)} className="icon-btn" style={{ ...toolbarBtn, color: C.danger }}
            title={t("common.delete")} aria-label={t("common.delete")}>
            <Icon d={ICONS.trash} size={15} color={C.danger} />
          </button>
        </div>
      )}
    </div>
  );
}
