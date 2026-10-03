// Modul „Körper" — geometrische Körper im Unterricht: drehen, aufklappen,
// Flächen einfärben, gegenüberliegende Flächen entdecken, Maße verändern und
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
import { KOERPER, baue, gefaltet, gegenueberVon, projiziere } from "../core/koerper.js";

const ARTEN = ["quader", "wuerfel", "prisma", "pyramide", "zylinder", "kegel", "kugel"];
// Eine ruhige Grundfarbe je Flaeche — damit man Flaechen schon vor dem
// Einfaerben unterscheidet. Bewusst gedeckt: kraeftige Farben gehoeren dem
// Einfaerben, sonst sieht man nicht, was man selbst gemacht hat.
const GRUND = ["#c9d6e3", "#e3d5c9", "#d2e3c9", "#e3c9d8", "#d8d2e8", "#e8e2c4"];
// Die Farben zum Einfaerben: vier kraeftige plus Radieren.
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
  const [werkzeug, setWerkzeug] = useState("faerben");
  const [stift, setStift] = useState(STIFTE[0]);
  const [farben, setFarben] = useState({});       // { art: { gruppe: farbe } }
  const [markiert, setMarkiert] = useState(null); // Gruppe (Werkzeug „Gegenüber")
  const [beschriftung, setBeschriftung] = useState(true);

  const def = KOERPER[art];
  const m = useMemo(() => Object.fromEntries(def.masse.map(([k, v]) => [k, masse[art]?.[k] ?? v])), [art, masse, def]);
  const k = useMemo(() => baue(art, m), [art, m]);
  const flaechen = useMemo(() => gefaltet(k, falte), [k, falte]);
  const bild = useMemo(() => projiziere(flaechen, { ...sicht, breite: BREITE, hoehe: HOEHE }), [flaechen, sicht]);
  const meineFarben = farben[art] || {};
  const gruppen = k.gruppen.map((g) => g.id);
  const grundFarbe = (g) => GRUND[Math.max(0, gruppen.indexOf(g)) % GRUND.length];
  const gegen = markiert ? gegenueberVon(k, markiert) : null;

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
    setArt(a); setMarkiert(null);
    if (!KOERPER[a] || (a === "kugel" && falte < 1)) { setFalte(1); setSicht(SICHT_KOERPER); }
  };
  const setzeMass = (key, wert) => {
    const v = Math.max(0.5, Math.min(20, rund(Number(wert) || 0.5, 1)));
    setMasse((alt) => ({ ...alt, [art]: { ...(alt[art] || {}), [key]: v } }));
  };

  // Drehen mit Maus oder Finger. Ein Klick (ohne Bewegung) bleibt ein Klick auf
  // die Flaeche — sonst faerbt jeder Dreh-Versuch etwas ein.
  const zug = useRef(null);
  // Den Zeiger erst festhalten, wenn wirklich gezogen wird: sofort beim
  // Druecken festgehalten, landete der Klick bei der Zeichenflaeche statt bei
  // der Flaeche — und Faerben tat nichts.
  const druck = (e) => { zug.current = { x: e.clientX, y: e.clientY, gier: sicht.gier, nick: sicht.nick, bewegt: false, ziel: e.currentTarget, id: e.pointerId }; };
  const bewegen = (e) => {
    const z = zug.current; if (!z) return;
    const dx = e.clientX - z.x, dy = e.clientY - z.y;
    if (!z.bewegt && Math.abs(dx) + Math.abs(dy) > 4) { z.bewegt = true; try { z.ziel.setPointerCapture?.(z.id); } catch { /* egal */ } }
    if (!z.bewegt) return;
    setZiel(null);
    setSicht({ gier: z.gier - dx * 0.01, nick: Math.max(-1.3, Math.min(Math.PI / 2, z.nick + dy * 0.01)) });
  };
  const los = () => { setTimeout(() => { zug.current = null; }, 0); };
  const klickFlaeche = (gruppe) => {
    if (zug.current?.bewegt) return;
    if (werkzeug === "faerben") {
      setFarben((alt) => {
        const eigene = { ...(alt[art] || {}) };
        if (stift === null || eigene[gruppe] === stift) delete eigene[gruppe]; else eigene[gruppe] = stift;
        return { ...alt, [art]: eigene };
      });
    } else if (werkzeug === "gegenueber") {
      setMarkiert((x) => (x === gruppe ? null : gruppe));
    }
  };
  const dreh = (dg, dn) => { setZiel(null); setSicht((s) => ({ gier: s.gier + dg, nick: Math.max(-1.3, Math.min(Math.PI / 2, s.nick + dn)) })); };

  // Im Modus „Gegenueber" zaehlt nur das Paar: die gewaehlte Flaeche blau, ihr
  // Gegenueber gelb, alles andere in der ruhigen Grundfarbe — eigene
  // Einfaerbungen daneben machten das Paar unkenntlich.
  const fuellung = (g) => {
    if (werkzeug === "gegenueber") {
      if (g === markiert) return STIFTE[1];
      if (g === gegen) return STIFTE[2];
      return grundFarbe(g);
    }
    return meineFarben[g] || grundFarbe(g);
  };
  const name = (g) => t(`koerper.fl.${g.replace(/\d+$/, "")}`, { n: (g.match(/\d+$/) || [""])[0] });
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
              <button key={a} onClick={() => waehleArt(a)} aria-pressed={art === a}
                style={{ ...segmentBtn, fontWeight: art === a ? 700 : 500, color: art === a ? "var(--accent)" : "var(--text2)" }}>
                {t(`koerper.art.${a}`)}
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

      {/* Werkzeug: einfaerben oder gegenueberliegende Flaechen entdecken. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <Segment>
          {["faerben", "gegenueber"].map((w) => (
            <button key={w} onClick={() => { setWerkzeug(w); setMarkiert(null); }} aria-pressed={werkzeug === w}
              style={{ ...segmentBtn, fontWeight: werkzeug === w ? 700 : 500, color: werkzeug === w ? "var(--accent)" : "var(--text2)" }}>
              {t(`koerper.wz.${w}`)}
            </button>
          ))}
        </Segment>
        {werkzeug === "faerben" && (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {STIFTE.map((f) => (
              <button key={f} onClick={() => setStift(f)} aria-label={f} aria-pressed={stift === f}
                style={{ width: 28, height: 28, borderRadius: CONTROL_R, background: f, cursor: "pointer",
                  border: stift === f ? "3px solid var(--text)" : "1px solid var(--border2)" }} />
            ))}
            <button onClick={() => setStift(null)} aria-pressed={stift === null} title={t("koerper.radieren")}
              style={{ ...toolbarBtn, ...(stift === null ? { borderColor: "var(--text)", fontWeight: 700 } : {}) }}>{t("koerper.radieren")}</button>
            <button onClick={() => setFarben((alt) => ({ ...alt, [art]: {} }))} style={toolbarBtn}>{t("koerper.allesWeg")}</button>
          </span>
        )}
        {werkzeug === "gegenueber" && (
          <span style={{ fontSize: 14, color: "var(--text2)" }}>
            {!markiert ? t("koerper.gegenueberHilfe")
              : gegen ? t("koerper.gegenueberIst", { a: name(markiert), b: name(gegen) })
                : t("koerper.gegenueberKeins", { a: name(markiert) })}
          </span>
        )}
        <span style={{ marginLeft: "auto" }}><Toggle checked={beschriftung} onChange={setBeschriftung} label={t("koerper.beschriftung")} /></span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
        <div style={{ position: "relative", ...cardStyle, padding: 0, overflow: "hidden", background: "var(--bg3)" }}>
          <svg viewBox={`0 0 ${BREITE} ${HOEHE}`} style={{ width: "100%", height: "auto", display: "block", touchAction: "none", cursor: "grab" }}
            onPointerDown={druck} onPointerMove={bewegen} onPointerUp={los} onPointerCancel={los}>
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
            <button onClick={() => dreh(0.26, 0)} className="icon-btn" style={toolbarIconBtn} aria-label={t("koerper.links")} title={t("koerper.links")}>←</button>
            <button onClick={() => dreh(0, -0.2)} className="icon-btn" style={toolbarIconBtn} aria-label={t("koerper.hoch")} title={t("koerper.hoch")}>↑</button>
            <button onClick={() => dreh(0, 0.2)} className="icon-btn" style={toolbarIconBtn} aria-label={t("koerper.runter")} title={t("koerper.runter")}>↓</button>
            <button onClick={() => dreh(-0.26, 0)} className="icon-btn" style={toolbarIconBtn} aria-label={t("koerper.rechts")} title={t("koerper.rechts")}>→</button>
            <button onClick={() => setZiel(falte < 0.5 ? { falte, ...SICHT_NETZ } : { falte, ...SICHT_KOERPER })} className="icon-btn" style={toolbarIconBtn}
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
