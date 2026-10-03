// Modul „Körper" — geometrische Körper im Unterricht: drehen, aufklappen,
// Flächen einfärben, Maße verändern und
// dabei Oberfläche und Volumen mitlaufen sehen.
//
// Reiner Client, keine Daten. Gerechnet wird in core/koerper.js; hier steht
// nur, was man sieht und anfasst. Gezeichnet wird als SVG (wie der PAP-Editor):
// jede Flaeche ist ein Element, anklickbar, und auf dem Beamer scharf.
import { useEffect, useMemo, useRef, useState } from "react";
import { CONTROL_R, Icon, ICONS, Segment, segmentBtn, cardStyle, inputStyle, pageFull, toolbarBtn, toolbarIconBtn, Toggle } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { komma, rund } from "../core/zahl.js";
import { KOERPER, baue, bodenRaster, gefaltet, projiziere } from "../core/koerper.js";

const ARTEN = ["quader", "wuerfel", "prisma", "pyramide", "zylinder", "kegel", "kugel"];
// Eine ruhige Grundfarbe je Flaeche — damit man Flaechen schon vor dem
// Einfaerben unterscheidet. Bewusst gedeckt: kraeftige Farben gehoeren dem
// Einfaerben, sonst sieht man nicht, was man selbst gemacht hat.
const GRUND = ["#c9d6e3", "#e3d5c9", "#d2e3c9", "#e3c9d8", "#d8d2e8", "#e8e2c4"];
// Die Farben zum Einfaerben. Einen Radierer gibt es nicht: dieselbe Farbe
// noch einmal auf dieselbe Flaeche nimmt sie wieder weg, „Alle Farben weg"
// raeumt alles.
const STIFTE = ["#e4572e", "#2e86ab", "#f2c14e", "#4caf50", "#8e5ad6"];
const BREITE = 900, HOEHE = 560;
const SICHT_KOERPER = { gier: -0.65, nick: 0.5 };
const SICHT_NETZ = { gier: 0, nick: Math.PI / 2 };

export default function Koerper() {
  const { t } = useLanguage();
  const [art, setArt] = useState("quader");
  // Maße je Koerper merken: wer vom Quader zum Zylinder und zurueck geht, will
  // seinen Quader wiederfinden.
  const [masse, setMasse] = useState({});
  const [falte, setFalte] = useState(1);          // 1 = geschlossen, 0 = Netz
  const [ziel, setZiel] = useState(null);         // laufende Animation dorthin
  const [sicht, setSicht] = useState(SICHT_KOERPER);
  const [stift, setStift] = useState(STIFTE[0]);
  const [farben, setFarben] = useState({});       // { art: { gruppe: farbe } }
  const [beschriftung, setBeschriftung] = useState(true);
  const [zoom, setZoom] = useState(1);
  // Dauerdrehung: langsam einmal herum und weiter, ohne Pause — bis man sie
  // anhaelt, zieht oder einen Pfeil drueckt.
  const [kreisel, setKreisel] = useState(false);

  const def = KOERPER[art];
  const m = useMemo(() => Object.fromEntries(def.masse.map(([k, v]) => [k, masse[art]?.[k] ?? v])), [art, masse, def]);
  const k = useMemo(() => baue(art, m), [art, m]);
  const flaechen = useMemo(() => gefaltet(k, falte), [k, falte]);
  const bild = useMemo(() => projiziere(flaechen, { ...sicht, breite: BREITE, hoehe: HOEHE, zoom }), [flaechen, sicht, zoom]);
  const raster = useMemo(() => bodenRaster(bild), [bild]);
  const meineFarben = farben[art] || {};
  const gruppen = k.gruppen.map((g) => g.id);
  const grundFarbe = (g) => GRUND[Math.max(0, gruppen.indexOf(g)) % GRUND.length];

  // Ein Umlauf in 24 Sekunden — langsam genug, um mitzudenken.
  useEffect(() => {
    if (!kreisel) return undefined;
    let raf = 0, vorher = performance.now();
    const schritt = (jetzt) => {
      const dt = jetzt - vorher; vorher = jetzt;
      setSicht((s) => ({ ...s, gier: s.gier - (dt / 24000) * 2 * Math.PI }));
      raf = requestAnimationFrame(schritt);
    };
    raf = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(raf);
  }, [kreisel]);

  // Weich zwischen Koerper und Netz wechseln: Faltung UND Blickwinkel laufen
  // mit, sonst springt das Bild — und gerade das Aufklappen soll man sehen.
  useEffect(() => {
    if (!ziel) return undefined;
    const start = performance.now(), von = { falte, ...sicht };
    let raf = 0;
    const schritt = (jetzt) => {
      const p = Math.min(1, (jetzt - start) / 1100);
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      setFalte(von.falte + (ziel.falte - von.falte) * e);
      setSicht({ gier: von.gier + (ziel.gier - von.gier) * e, nick: von.nick + (ziel.nick - von.nick) * e });
      if (p < 1) raf = requestAnimationFrame(schritt); else setZiel(null);
    };
    raf = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(raf);
  }, [ziel]);

  const zeigeKoerper = () => setZiel({ falte: 1, ...SICHT_KOERPER });
  const zeigeNetz = () => k.faltbar && setZiel({ falte: 0, ...SICHT_NETZ });
  const ansicht = falte < 0.5 ? "netz" : "koerper";

  const waehleArt = (a) => {
    setArt(a);
    if (!KOERPER[a] || (a === "kugel" && falte < 1)) { setFalte(1); setSicht(SICHT_KOERPER); }
  };
  const setzeMass = (key, wert) => {
    const v = Math.max(0.5, Math.min(20, rund(Number(wert) || 0.5, 1)));
    setMasse((alt) => ({ ...alt, [art]: { ...(alt[art] || {}), [key]: v } }));
  };

  // Drehen mit Maus oder Finger. Ein Klick (ohne Bewegung) bleibt ein Klick auf
  // die Flaeche — sonst faerbt jeder Dreh-Versuch etwas ein.
  const zug = useRef(null);
  // Zwei Finger: Abstand merken — Zoom wie im Sitzplan (Zange).
  const finger = useRef(new Map());
  const zange = useRef(null);
  const zoomen = (f) => setZoom((z) => Math.max(0.4, Math.min(4, z * f)));
  // Den Zeiger erst festhalten, wenn wirklich gezogen wird: sofort beim
  // Druecken festgehalten, landete der Klick bei der Zeichenflaeche statt bei
  // der Flaeche — und Faerben tat nichts.
  const druck = (e) => {
    finger.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (finger.current.size === 2) {
      const [p, q] = [...finger.current.values()];
      zange.current = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), zoom };
      zug.current = null;
      return;
    }
    zug.current = { x: e.clientX, y: e.clientY, gier: sicht.gier, nick: sicht.nick, bewegt: false, ziel: e.currentTarget, id: e.pointerId };
  };
  const bewegen = (e) => {
    if (finger.current.has(e.pointerId)) finger.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (zange.current && finger.current.size === 2) {
      const [p, q] = [...finger.current.values()];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      setZoom(Math.max(0.4, Math.min(4, zange.current.zoom * (d / Math.max(1, zange.current.d)))));
      return;
    }
    const z = zug.current; if (!z) return;
    const dx = e.clientX - z.x, dy = e.clientY - z.y;
    if (!z.bewegt && Math.abs(dx) + Math.abs(dy) > 4) { z.bewegt = true; try { z.ziel.setPointerCapture?.(z.id); } catch { /* egal */ } }
    if (!z.bewegt) return;
    setZiel(null); setKreisel(false);
    // Die vordere Flaeche geht mit dem Finger mit: nach links ziehen dreht die
    // Vorderseite nach links. Vorher war das Vorzeichen andersherum, und wer
    // den Koerper „auf den Kopf" gedreht hatte, bekam beim Linksziehen eine
    // Drehung nach rechts.
    setSicht({ gier: z.gier + dx * 0.01, nick: Math.max(-1.3, Math.min(Math.PI / 2, z.nick + dy * 0.01)) });
  };
  const los = (e) => {
    finger.current.delete(e.pointerId);
    if (finger.current.size < 2) zange.current = null;
    setTimeout(() => { zug.current = null; }, 0);
  };
  // Mausrad mit Strg (so meldet auch das Trackpad die Zange) zoomt; ohne Strg
  // scrollt die Seite wie gewohnt.
  const flaeche = useRef(null);
  useEffect(() => {
    const el = flaeche.current;
    if (!el) return undefined;
    const rad = (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); zoomen(e.deltaY < 0 ? 1.08 : 1 / 1.08); };
    el.addEventListener("wheel", rad, { passive: false });
    return () => el.removeEventListener("wheel", rad);
  }, []);
  const klickFlaeche = (gruppe) => {
    if (zug.current?.bewegt) return;
    setFarben((alt) => {
      const eigene = { ...(alt[art] || {}) };
      if (eigene[gruppe] === stift) delete eigene[gruppe]; else eigene[gruppe] = stift;
      return { ...alt, [art]: eigene };
    });
  };
  const dreh = (dg, dn) => { setZiel(null); setKreisel(false); setSicht((s) => ({ gier: s.gier + dg, nick: Math.max(-1.3, Math.min(Math.PI / 2, s.nick + dn)) })); };

  const fuellung = (g) => meineFarben[g] || grundFarbe(g);
  // Was eine Flaeche IST, nicht wo sie gerade steht: „vorne/hinten/links"
  // aendert sich mit jedem Drehen und sagt nichts. Grundflaeche, Deckflaeche,
  // Seitenflaeche, Mantel — die Begriffe aus dem Unterricht.
  const name = (g) => t(`koerper.fl.${g === "boden" ? "grund" : g === "deckel" ? "deck" : g === "mantel" ? "mantel" : g === "oberflaeche" ? "oberflaeche" : "seite"}`);
  const inhalt = (g) => k.gruppen.find((x) => x.id === g)?.inhalt ?? 0;
  const zahl = (x) => komma(rund(x, 1));
  // Beschriftung je Gruppe: am Mittelpunkt ihrer sichtbaren Flaechen.
  const etiketten = beschriftung ? gruppen.map((g) => {
    const teile = bild.filter((f) => f.gruppe === g && (f.zugewandt || falte < 0.5));
    if (!teile.length) return null;
    const pts = teile.flatMap((f) => f.bild);
    const x = pts.reduce((s, p) => s + p[0], 0) / pts.length, y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return { g, x, y };
  }).filter(Boolean) : [];
  const viele = (g) => k.flaechen.filter((f) => f.gruppe === g).length > 1;

  return (
    <div style={{ ...pageFull }}>
      <Werkzeugleiste style={{ marginBottom: 12 }}
        links={(
          <Segment>
            {ARTEN.map((a) => (
              <button key={a} onClick={() => waehleArt(a)} aria-pressed={art === a} title={t(`koerper.art.${a}`)} aria-label={t(`koerper.art.${a}`)}
                style={{ ...segmentBtn, padding: "0 8px", color: art === a ? "var(--accent)" : "var(--text3)" }}>
                <KoerperBild art={a} />
              </button>
            ))}
          </Segment>
        )}>
        <Segment>
          <button onClick={zeigeKoerper} aria-pressed={ansicht === "koerper"}
            style={{ ...segmentBtn, fontWeight: ansicht === "koerper" ? 700 : 500, color: ansicht === "koerper" ? "var(--accent)" : "var(--text2)" }}>{t("koerper.ansichtKoerper")}</button>
          <button onClick={zeigeNetz} disabled={!k.faltbar} aria-pressed={ansicht === "netz"} title={k.faltbar ? undefined : t("koerper.keinNetz")}
            style={{ ...segmentBtn, fontWeight: ansicht === "netz" ? 700 : 500, color: ansicht === "netz" ? "var(--accent)" : "var(--text2)", ...(k.faltbar ? {} : { opacity: 0.45, cursor: "default" }) }}>{t("koerper.ansichtNetz")}</button>
        </Segment>
      </Werkzeugleiste>

      {/* Einfaerben: Farbe waehlen, Flaeche antippen; dieselbe Farbe noch einmal nimmt sie weg. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          {STIFTE.map((f) => (
            <button key={f} onClick={() => setStift(f)} aria-label={f} aria-pressed={stift === f}
              style={{ width: 28, height: 28, borderRadius: CONTROL_R, background: f, cursor: "pointer",
                border: stift === f ? "3px solid var(--text)" : "1px solid var(--border2)" }} />
          ))}
          <button onClick={() => setFarben((alt) => ({ ...alt, [art]: {} }))} style={toolbarBtn}>{t("koerper.allesWeg")}</button>
        </span>
        <span style={{ marginLeft: "auto" }}><Toggle checked={beschriftung} onChange={setBeschriftung} label={t("koerper.beschriftung")} /></span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
        <div style={{ position: "relative", ...cardStyle, padding: 0, overflow: "hidden", background: "var(--bg3)" }}>
          <svg ref={flaeche} viewBox={`0 0 ${BREITE} ${HOEHE}`} style={{ width: "100%", height: "auto", display: "block", touchAction: "none", cursor: "grab" }}
            onPointerDown={druck} onPointerMove={bewegen} onPointerUp={los} onPointerCancel={los}>
            {/* Bodenraster: dreht mit, darauf steht die Grundflaeche. Ein
                Kaestchen ist eine Einheit. Von unten gesehen blass — es laege
                sonst vor dem Koerper. */}
            <g style={{ pointerEvents: "none", opacity: sicht.nick < 0.05 ? 0.25 : 1 }}>
              <polygon points={raster.rahmen.map((p) => p.join(",")).join(" ")} fill="rgba(46,134,171,0.07)" stroke="rgba(46,134,171,0.55)" strokeWidth={1.5} />
              {raster.linien.map(([p, q], i) => (
                <line key={i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="rgba(46,134,171,0.3)" strokeWidth={1} />
              ))}
            </g>
            {bild.map((f) => {
              const farbe = fuellung(f.gruppe);
              const rund = viele(f.gruppe);
              return (
                <polygon key={f.id} points={f.bild.map((p) => p.join(",")).join(" ")}
                  onClick={() => klickFlaeche(f.gruppe)}
                  style={{ fill: farbe, filter: `brightness(${0.82 + 0.25 * f.hell})`, cursor: "pointer",
                    stroke: rund ? farbe : "#1d1d1f", strokeWidth: rund ? 0.8 : 2, strokeLinejoin: "round" }} />
              );
            })}
            {etiketten.map(({ g, x, y }) => (
              <g key={g} style={{ pointerEvents: "none" }}>
                <rect x={x - 58} y={y - 18} width={116} height={36} rx={6} fill="rgba(255,255,255,0.88)" stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
                <text x={x} y={y - 3} textAnchor="middle" fontSize={13} fontWeight={700} fill="#1d1d1f">{name(g)}</text>
                <text x={x} y={y + 12} textAnchor="middle" fontSize={12} fill="#1d1d1f">{zahl(inhalt(g))} {t("koerper.fe")}</text>
              </g>
            ))}
          </svg>
          {/* Drehen per Knopf — fuer alle, die nicht ziehen moegen (Beamer mit Fernbedienung). */}
          <div style={{ position: "absolute", bottom: 10, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4, background: "var(--card)", borderRadius: CONTROL_R, padding: 4, border: "1px solid var(--border)" }}>
            <button onClick={() => dreh(-0.26, 0)} className="icon-btn" style={toolbarIconBtn} aria-label={t("koerper.links")} title={t("koerper.links")}>←</button>
            <button onClick={() => dreh(0, -0.2)} className="icon-btn" style={toolbarIconBtn} aria-label={t("koerper.hoch")} title={t("koerper.hoch")}>↑</button>
            <button onClick={() => dreh(0, 0.2)} className="icon-btn" style={toolbarIconBtn} aria-label={t("koerper.runter")} title={t("koerper.runter")}>↓</button>
            <button onClick={() => dreh(0.26, 0)} className="icon-btn" style={toolbarIconBtn} aria-label={t("koerper.rechts")} title={t("koerper.rechts")}>→</button>
            <button onClick={() => setKreisel((v) => !v)} className="icon-btn" aria-pressed={kreisel}
              style={{ ...toolbarIconBtn, ...(kreisel ? { background: "var(--accent)", color: "#fff" } : {}) }}
              aria-label={t("koerper.kreisel")} title={t("koerper.kreisel")}>
              {/* Pause bzw. Kreispfeil als SVG: Textzeichen wie ❚❚ fehlen in manchen Schriften und erscheinen als Kästchen. */}
              <svg viewBox="0 0 20 20" width={16} height={16} aria-hidden="true">
                {kreisel
                  ? <><rect x={5} y={4} width={3.5} height={12} fill="currentColor" /><rect x={11.5} y={4} width={3.5} height={12} fill="currentColor" /></>
                  : <><path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" /><path d="M15.5 3.5v3.6h-3.6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></>}
              </svg>
            </button>
            <button onClick={() => zoomen(1 / 1.2)} className="icon-btn" style={toolbarIconBtn} aria-label={t("koerper.kleiner")} title={t("koerper.kleiner")}>−</button>
            <button onClick={() => zoomen(1.2)} className="icon-btn" style={toolbarIconBtn} aria-label={t("koerper.groesser")} title={t("koerper.groesser")}>+</button>
            <button onClick={() => { setKreisel(false); setZoom(1); setZiel(falte < 0.5 ? { falte, ...SICHT_NETZ } : { falte, ...SICHT_KOERPER }); }} className="icon-btn" style={toolbarIconBtn}
              aria-label={t("koerper.ansichtZurueck")} title={t("koerper.ansichtZurueck")}><Icon d={ICONS.refresh} size={16} /></button>
          </div>
        </div>

        {/* Auffalten: der Regler ist die Faltung selbst — 0 % Netz, 100 % Koerper. */}
        {k.faltbar ? (
          <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 14 }}>
            <span style={{ fontWeight: 600, minWidth: 90 }}>{t("koerper.auffalten")}</span>
            <input type="range" min={0} max={100} value={Math.round((1 - falte) * 100)}
              onChange={(e) => { setZiel(null); setFalte(1 - Number(e.target.value) / 100); }} style={{ flex: 1 }} />
            <span style={{ minWidth: 48, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round((1 - falte) * 100)} %</span>
          </label>
        ) : <div style={{ fontSize: 13, color: "var(--text3)" }}>{t("koerper.keinNetz")}</div>}

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {/* Maße: Zahl, ± und Regler — dieselbe Zahl drei Wege, damit am Beamer
              und am Tablet je der bequeme greift. */}
          <div style={{ ...cardStyle, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("koerper.masse")}</div>
            {def.masse.map(([key]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ width: 70, fontSize: 13, color: "var(--text2)" }}>{t(`koerper.mass.${key}`)}</span>
                <button onClick={() => setzeMass(key, m[key] - 0.5)} style={toolbarBtn} aria-label="−">−</button>
                <input type="number" min={0.5} max={20} step={0.5} value={m[key]} onChange={(e) => setzeMass(key, e.target.value)}
                  style={{ ...inputStyle, width: 64, textAlign: "center", padding: "6px 4px" }} />
                <button onClick={() => setzeMass(key, m[key] + 0.5)} style={toolbarBtn} aria-label="+">+</button>
                <input type="range" min={0.5} max={20} step={0.5} value={m[key]} onChange={(e) => setzeMass(key, e.target.value)} style={{ flex: 1, minWidth: 60 }} />
              </div>
            ))}
          </div>
          {/* Oberflaeche und Volumen, mit Formel — die Zahl allein erklaert nichts. */}
          <div style={{ ...cardStyle, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontWeight: 700, minWidth: 28 }}>O</span>
              <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{zahl(k.oberflaeche)}</span>
              <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("koerper.fe")}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>{t(`koerper.formelO.${art}`)}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontWeight: 700, minWidth: 28 }}>V</span>
              <span style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{zahl(k.volumen)}</span>
              <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("koerper.ve")}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)" }}>{t(`koerper.formelV.${art}`)}</div>
          </div>
          {/* Die Flaechen einzeln: Farbe, Name, Inhalt. Klick markiert sie. */}
          <div style={{ ...cardStyle, padding: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("koerper.flaechen")}</div>
            {k.gruppen.map((g) => (
              <button key={g.id} onClick={() => klickFlaeche(g.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: "none", background: "none", padding: "3px 0", cursor: "pointer", color: "var(--text)", fontSize: 13 }}>
                <span style={{ width: 16, height: 16, borderRadius: CONTROL_R, background: fuellung(g.id), border: "1px solid var(--border2)", flexShrink: 0 }} />
                <span style={{ flex: 1, textAlign: "left" }}>{name(g.id)}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{zahl(g.inhalt)} {t("koerper.fe")}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Kleine Bilder statt Namen in der Auswahl — ein Quader ist schneller
// erkannt als gelesen. Der Name steht im title.
function KoerperBild({ art }) {
  const st = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round", strokeLinecap: "round" };
  const pfad = {
    quader: <><path d="M3 9l5-4h13l-5 4z" {...st} /><path d="M3 9h13v10H3z" {...st} /><path d="M16 9l5-4v10l-5 4" {...st} /></>,
    wuerfel: <><path d="M5 8l4-4h11l-4 4z" {...st} /><path d="M5 8h11v12H5z" {...st} /><path d="M16 8l4-4v12l-4 4" {...st} /></>,
    prisma: <><path d="M4 19h12l4-3H8z" {...st} /><path d="M4 19l6-15 6 15M10 4l10 12" {...st} /></>,
    pyramide: <><path d="M3 18l7 3 11-4-8-2z" {...st} /><path d="M12 3L3 18M12 3l-2 18M12 3l9 14" {...st} /></>,
    zylinder: <><ellipse cx="12" cy="6" rx="7" ry="2.5" {...st} /><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" {...st} /></>,
    kegel: <><path d="M12 3L5 18M12 3l7 15" {...st} /><ellipse cx="12" cy="18" rx="7" ry="2.5" {...st} /></>,
    kugel: <><circle cx="12" cy="12" r="8.5" {...st} /><ellipse cx="12" cy="12" rx="8.5" ry="3" {...st} /></>,
  }[art];
  return <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden="true">{pfad}</svg>;
}
