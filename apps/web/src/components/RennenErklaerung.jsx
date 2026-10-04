// KI-Rennen: „Wie lernt die KI?" — Schritt fuer Schritt, mit Bildern statt
// eines Absatzes. Gedacht fuer den Beamer: ein Gedanke je Schritt, dazu ein
// Bild, das man an der Tafel zeigen kann. Die Bilder sind einfache SVGs in
// derselben Bildsprache wie die Strecke (grauer Asphalt, roter Rand, gelbe
// Strahlen, blaue Autos).
import { useState } from "react";
import { AUTO } from "../core/rennauto.js";
import { CONTROL_R, panelStyle, toolbarBtn, toolbarBtnPrimary } from "./Icons.jsx";

const SCHRITTE = ["augen", "zahlen", "ausgaenge", "beispiel", "zufall", "auswahl", "zuschauen"];

export default function RennenErklaerung({ t, onLos }) {
  const [i, setI] = useState(0);
  const k = SCHRITTE[i];
  const letzter = i === SCHRITTE.length - 1;
  return (
    <div>
      <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 4 }}>{t("rennen.erk.schritt", { n: i + 1, von: SCHRITTE.length })}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{t(`rennen.erk.${k}.titel`)}</div>
      <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: panelStyle.borderRadius, padding: 8, marginBottom: 10 }}>
        <Bild art={k} t={t} />
      </div>
      <p style={{ margin: "0 0 12px", lineHeight: 1.5 }}>{t(`rennen.erk.${k}.text`)}</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {i > 0 && <button onClick={() => setI(i - 1)} style={hell}>{t("rennen.erk.zurueck")}</button>}
        {!letzter && <button onClick={() => setI(i + 1)} style={toolbarBtnPrimary}>{t("rennen.erk.weiter")}</button>}
        {letzter && <button onClick={onLos} style={toolbarBtnPrimary}>{t("rennen.los")}</button>}
        {!letzter && <button onClick={onLos} style={{ ...hell, marginLeft: "auto", opacity: 0.8 }}>{t("rennen.erk.ueberspringen")}</button>}
        <span style={{ display: "inline-flex", gap: 4, marginLeft: letzter ? "auto" : 0 }}>
          {SCHRITTE.map((_, j) => <span key={j} style={{ width: 8, height: 8, borderRadius: "50%", background: j === i ? "#fff" : "rgba(255,255,255,0.3)" }} />)}
        </span>
      </div>
    </div>
  );
}

const hell = { ...toolbarBtn, background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,0.45)" };

// ── Bilder ──
const ASPHALT = "#555", RAND = "#d33", GRAS = "#6aa84f", STRAHL = "#ffeb3b";

// Dieselbe Form wie auf der Strecke (core/rennauto.js).
function Auto({ x, y, w = 0, farbe = "#1e88e5", s = 1 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${w}) scale(${s})`}>
      <path d={AUTO.schatten} fill="rgba(0,0,0,0.3)" transform="translate(1.5 2)" />
      {AUTO.reifen.map((d, i) => <path key={i} d={d} fill="#1b1b1b" />)}
      <path d={AUTO.heckfluegel} fill="#1b1b1b" />
      <path d={AUTO.frontfluegel} fill="#1b1b1b" />
      <path d={AUTO.karosserie} fill={farbe} />
      <path d={AUTO.streifen} stroke="rgba(255,255,255,0.75)" strokeWidth={1.4} />
      <path d={AUTO.cockpit} fill="rgba(20,30,40,0.85)" />
      <circle cx={AUTO.helm.x} cy={AUTO.helm.y} r={AUTO.helm.r} fill="#ffd54f" />
    </g>
  );
}

// Ein gerades Stueck Strasse von links nach rechts, Auto in der Mitte.
function Strasse({ oben = 30, unten = 130 }) {
  return (
    <>
      <rect x={0} y={0} width={320} height={160} fill={GRAS} />
      <rect x={0} y={oben - 4} width={320} height={unten - oben + 8} fill={RAND} />
      <rect x={0} y={oben} width={320} height={unten - oben} fill={ASPHALT} />
    </>
  );
}

// Fuenf Strahlen: -60°, -30°, 0°, 30°, 60° — bis zum Strassenrand.
function strahlen(x, y, oben, unten, rechts = 320) {
  return [-60, -30, 0, 30, 60].map((g) => {
    const a = (g * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    let d = 0;
    while (d < 400) {
      const px = x + c * d, py = y + s * d;
      if (py <= oben || py >= unten || px >= rechts) break;
      d += 1;
    }
    return { g, x2: x + c * d, y2: y + s * d, d };
  });
}

function Bild({ art, t }) {
  const svg = (inhalt) => <svg viewBox="0 0 320 160" style={{ width: "100%", display: "block", borderRadius: CONTROL_R }}>{inhalt}</svg>;
  const txt = (x, y, s, fill = "#fff", anchor = "middle", size = 12) => <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontWeight={600}>{s}</text>;

  if (art === "augen") {
    const st = strahlen(110, 80, 30, 130, 300);
    return svg(<>
      <Strasse />
      {st.map((r, i) => (
        <g key={i}>
          <line x1={110} y1={80} x2={r.x2} y2={r.y2} stroke={STRAHL} strokeWidth={2} />
          <circle cx={r.x2} cy={r.y2} r={4} fill={STRAHL} />
          {txt(r.x2 + (i === 2 ? -10 : 0), r.y2 + (r.y2 < 80 ? -8 : 16), i + 1, "#fff")}
        </g>
      ))}
      <Auto x={110} y={80} />
    </>);
  }

  if (art === "zahlen") {
    // Ein Auto nah am linken (oberen) Rand: Strahlen 1 und 2 kurz.
    const werte = [0.15, 0.3, 1.0, 0.7, 0.55];
    return svg(<>
      <rect x={0} y={0} width={320} height={160} fill="#2b2b2b" />
      {werte.map((v, i) => (
        <g key={i}>
          {txt(30, 22 + i * 24, `${t("rennen.strahl", { n: i + 1 })}`, "#ddd", "start", 11)}
          <rect x={90} y={12 + i * 24} width={160} height={12} rx={6} fill="rgba(255,255,255,0.15)" />
          <rect x={90} y={12 + i * 24} width={160 * v} height={12} rx={6} fill={v < 0.35 ? "#ef5350" : STRAHL} />
          {txt(262, 22 + i * 24, v.toFixed(2), "#fff", "start", 11)}
        </g>
      ))}
      {txt(30, 22 + 5 * 24, t("rennen.tempo"), "#ddd", "start", 11)}
      <rect x={90} y={12 + 5 * 24} width={160} height={12} rx={6} fill="rgba(255,255,255,0.15)" />
      <rect x={90} y={12 + 5 * 24} width={80} height={12} rx={6} fill="#64b5f6" />
      {txt(262, 22 + 5 * 24, "0.50", "#fff", "start", 11)}
    </>);
  }

  if (art === "ausgaenge") {
    const skala = (y, titel, links, rechts, wert) => (
      <g>
        {txt(160, y - 18, titel, "#fff", "middle", 13)}
        <line x1={40} y1={y} x2={280} y2={y} stroke="rgba(255,255,255,0.5)" strokeWidth={3} />
        {[-1, 0, 1].map((v) => (
          <g key={v}>
            <line x1={160 + v * 120} y1={y - 6} x2={160 + v * 120} y2={y + 6} stroke="#fff" strokeWidth={2} />
            {txt(160 + v * 120, y + 20, v > 0 ? "+1" : String(v), "#ddd", "middle", 11)}
          </g>
        ))}
        {txt(40, y + 34, links, "#bbb", "start", 10)}
        {txt(280, y + 34, rechts, "#bbb", "end", 10)}
        <circle cx={160 + wert * 120} cy={y} r={7} fill={STRAHL} />
      </g>
    );
    return svg(<>
      <rect x={0} y={0} width={320} height={160} fill="#2b2b2b" />
      {skala(42, t("rennen.lenken"), t("rennen.erk.links"), t("rennen.erk.rechts"), 0.6)}
      {skala(112, t("rennen.gasAus"), t("rennen.erk.bremsen"), t("rennen.erk.vollgas"), 0.9)}
    </>);
  }

  if (art === "beispiel") {
    const st = strahlen(110, 50, 30, 130, 300);
    return svg(<>
      <Strasse />
      {st.map((r, i) => <line key={i} x1={110} y1={50} x2={r.x2} y2={r.y2} stroke={i < 2 ? "#ef5350" : STRAHL} strokeWidth={2} />)}
      <Auto x={110} y={50} />
      {/* der Weg, den die Entscheidung einschlaegt: nach rechts, weg von der Wand */}
      <path d="M 128 52 Q 190 60 230 92" fill="none" stroke="#fff" strokeWidth={2.5} strokeDasharray="6 5" markerEnd="url(#pfeil)" />
      <defs><marker id="pfeil" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#fff" /></marker></defs>
      <rect x={196} y={112} width={118} height={40} rx={8} fill="rgba(0,0,0,0.65)" />
      {txt(255, 128, `${t("rennen.lenken")} +0.7`, "#fff", "middle", 12)}
      {txt(255, 144, `${t("rennen.gasAus")} +0.8`, "#fff", "middle", 12)}
    </>);
  }

  if (art === "zufall") {
    const wege = ["M 40 80 Q 90 70 120 10", "M 40 80 Q 70 110 60 158", "M 40 80 Q 120 80 170 150", "M 40 80 Q 130 75 200 20", "M 40 80 Q 60 80 70 82"];
    return svg(<>
      <Strasse />
      {wege.map((d, i) => <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth={2} strokeDasharray="5 5" />)}
      {[[120, 12], [60, 150], [170, 146], [200, 22]].map(([x, y], i) => (
        <g key={i}><Auto x={x} y={y} w={i * 70} farbe="rgba(30,136,229,0.6)" s={0.8} />{txt(x + 16, y + 4, "✗", "#ffcdd2", "start", 16)}</g>
      ))}
      <Auto x={72} y={82} farbe="rgba(30,136,229,0.6)" s={0.8} />
      {txt(90, 98, "?", "#fff", "start", 16)}
      <Auto x={40} y={80} />
    </>);
  }

  if (art === "auswahl") {
    const reihe1 = [1.4, 0.3, 2.1, 0.8, 0.1, 1.1];
    const besten = [2, 0];
    return svg(<>
      <rect x={0} y={0} width={320} height={160} fill="#2b2b2b" />
      {txt(10, 16, t("rennen.erk.genA"), "#bbb", "start", 11)}
      {reihe1.map((p, i) => (
        <g key={i}>
          <Auto x={30 + i * 50} y={38} s={0.9} farbe={besten.includes(i) ? "#1e88e5" : "rgba(30,136,229,0.35)"} />
          {txt(30 + i * 50, 62, p.toFixed(1), besten.includes(i) ? "#fff" : "#888", "middle", 11)}
          {besten.includes(i) && txt(30 + i * 50, 24, "★", "#ffd54f", "middle", 14)}
        </g>
      ))}
      {txt(10, 96, t("rennen.erk.genB"), "#bbb", "start", 11)}
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const von = i < 2 ? besten[i] : besten[i % 2];
        return (
          <g key={i}>
            <line x1={30 + von * 50} y1={66} x2={30 + i * 50} y2={110} stroke="rgba(255,255,255,0.25)" />
            <Auto x={30 + i * 50} y={120} s={0.9} farbe={i < 2 ? "#1e88e5" : `hsl(${205 + (i - 3) * 14} 70% ${52 + (i % 2) * 8}%)`} />
            {txt(30 + i * 50, 146, i < 2 ? t("rennen.erk.gleich") : t("rennen.erk.mutiert"), "#bbb", "middle", 9)}
          </g>
        );
      })}
    </>);
  }

  // zuschauen: der Bildschirm im Kleinen — wo was steht.
  const kasten = (x, y, w, h, s) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill="rgba(0,0,0,0.6)" stroke="rgba(255,255,255,0.5)" />
      {txt(x + w / 2, y + h / 2 + 4, s, "#fff", "middle", 11)}
    </g>
  );
  return svg(<>
    <rect x={0} y={0} width={320} height={160} fill={GRAS} />
    <rect x={60} y={40} width={200} height={80} rx={40} fill="none" stroke={ASPHALT} strokeWidth={22} />
    {kasten(6, 6, 90, 30, t("rennen.generation"))}
    {kasten(204, 6, 110, 30, t("rennen.erk.einstellungen"))}
    {kasten(6, 118, 110, 36, t("rennen.erk.gehirn"))}
    {kasten(204, 118, 110, 36, t("rennen.erk.kurve"))}
  </>);
}
