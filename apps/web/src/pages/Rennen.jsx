// Modul „KI-Rennen" — ein Autorennen von oben, und eine KI, die durch
// Mutation fahren lernt. Gerechnet wird in core/rennen.js; hier steht, was man
// sieht und anfasst. Reiner Client, keine Daten am Server — nur die beste
// gelernte KI merkt sich der Browser, damit sie das Neuladen ueberlebt.
//
// Drei Modi in einer Seite:
//   • Selbst fahren — Pfeiltasten (auf dem Tablet Tasten am Bildschirm),
//     Rundenzeit und Bestzeit.
//   • KI lernt — eine Generation faehrt gleichzeitig; die Besten werden
//     kopiert und mutiert. Generation, Kurve und Bestzeit laufen mit;
//     Mutationsstaerke, Anzahl und Tempo sind einstellbar.
//   • Gegen die KI — selbst fahren gegen die beste bisher gelernte KI.
import { useEffect, useRef, useState } from "react";
import { CONTROL_R, Segment, segmentBtn, cardStyle, pageFull, toolbarBtn, toolbarBtnPrimary, panelStyle, COLORS as C } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { useLanguage } from "../i18n/index.jsx";
import {
  BREITE, HOEHE, SPUR, STRAHLEN, STRAHL_MAX, ZEITGRENZE, baueStrecke, fahre, fitness, kiSchritt, naechsteGeneration,
  neuesAuto, zeitText, zufallsGehirn,
} from "../core/rennen.js";

const SPEICHER = "nuvora_rennen_ki";
const strecke = baueStrecke();

function ladeKi() {
  try {
    const x = JSON.parse(localStorage.getItem(SPEICHER) || "null");
    if (x && Array.isArray(x.beste)) return { ...x, beste: Float32Array.from(x.beste) };
  } catch { /* leer oder gesperrt */ }
  return null;
}

export default function Rennen() {
  const { t } = useLanguage();
  const [modus, setModus] = useState("selbst");          // selbst | ki | gegen
  const [laeuft, setLaeuft] = useState(false);
  const [rate, setRate] = useState(0.15);
  const [anzahl, setAnzahl] = useState(30);
  const [tempo, setTempo] = useState(1);
  const [nurBeste, setNurBeste] = useState(false);
  const [hud, setHud] = useState({ gen: 0, lebend: 0, zeit: 0, runde: null, beste: null, letzte: null, verlauf: [] });
  const canvas = useRef(null);
  const tasten = useRef({});
  const welt = useRef(null);   // alles, was je Bild weiterlaeuft

  // ── Welt aufbauen, wenn der Modus wechselt ──
  const neueWelt = (m = modus) => {
    const gespeichert = ladeKi();
    const w = { mensch: null, autos: [], gehirne: [], gen: gespeichert?.gen || 0, verlauf: gespeichert?.verlauf || [],
      zeiten: gespeichert?.zeiten || [],
      besteKi: gespeichert?.beste || null, besteZeit: gespeichert?.besteZeit ?? null, menschBest: null, simZeit: 0 };
    if (m === "selbst" || m === "gegen") w.mensch = neuesAuto(strecke);
    if (m === "gegen" && w.besteKi) { w.gehirne = [w.besteKi]; w.autos = [neuesAuto(strecke)]; }
    if (m === "ki") {
      w.gehirne = Array.from({ length: anzahl }, (_, i) => (w.besteKi && i < 2 ? w.besteKi : zufallsGehirn()));
      w.autos = w.gehirne.map(() => neuesAuto(strecke));
    }
    welt.current = w;
    zeichne();
  };
  // Die Funktionen sehen immer den aktuellen Stand (Regler, Modus) — die
  // Effekte haengen nur an dem, wonach sie sich wirklich neu aufbauen.
  const tun = useRef(null);
  useEffect(() => { setLaeuft(false); tun.current.neueWelt(modus); }, [modus]);

  // ── Tastatur (nur, wenn ein Mensch faehrt) ──
  useEffect(() => {
    if (modus === "ki") return undefined;
    const PFEILE = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    const runter = (e) => {
      if (!PFEILE.includes(e.key)) return;
      e.preventDefault();             // sonst scrollt die Seite mit
      tasten.current[e.key] = true;
      if (!laeuftRef.current) setLaeuft(true);
    };
    const hoch = (e) => { if (PFEILE.includes(e.key)) tasten.current[e.key] = false; };
    window.addEventListener("keydown", runter);
    window.addEventListener("keyup", hoch);
    return () => { window.removeEventListener("keydown", runter); window.removeEventListener("keyup", hoch); };
  }, [modus]);
  const laeuftRef = useRef(laeuft);
  laeuftRef.current = laeuft;

  // ── Der Takt ──
  useEffect(() => {
    if (!laeuft) return undefined;
    let raf = 0, vorher = performance.now(), rest = 0, hudZeit = 0;
    const takt = (jetzt) => {
      const w = welt.current;
      const dt = Math.min(0.1, (jetzt - vorher) / 1000); vorher = jetzt;
      rest += dt;
      const schritte = modus === "ki" ? tempo : 1;
      while (rest >= 1 / 60) {
        rest -= 1 / 60;
        for (let k = 0; k < schritte; k++) tun.current.schritt(w);
      }
      tun.current.zeichne();
      hudZeit += dt;
      if (hudZeit > 0.15) { hudZeit = 0; tun.current.meldeHud(w); }
      raf = requestAnimationFrame(takt);
    };
    raf = requestAnimationFrame(takt);
    return () => cancelAnimationFrame(raf);
  }, [laeuft, modus, tempo]);

  const schritt = (w) => {
    if (w.mensch) {
      const k = tasten.current;
      const lenk = (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0);
      const gas = (k.ArrowUp ? 1 : 0) - (k.ArrowDown ? 1 : 0);
      const vor = w.mensch.runden_zeiten.length;
      fahre(w.mensch, strecke, lenk, gas, false);
      if (w.mensch.runden_zeiten.length > vor) {
        const z = w.mensch.runden_zeiten[w.mensch.runden_zeiten.length - 1];
        w.menschBest = w.menschBest == null ? z : Math.min(w.menschBest, z);
      }
    }
    if (modus === "gegen") {
      w.autos.forEach((a, i) => { if (a.lebt) kiSchritt(a, w.gehirne[i], strecke); });
      return;
    }
    if (modus !== "ki") return;
    w.simZeit += 1 / 60;
    let lebend = 0;
    w.autos.forEach((a, i) => {
      if (!a.lebt) return;
      kiSchritt(a, w.gehirne[i], strecke);
      if (a.runden >= 2) a.lebt = false;
      if (a.lebt) lebend += 1;
    });
    if (!lebend || w.simZeit >= ZEITGRENZE) generationFertig(w);
  };

  const generationFertig = (w) => {
    const punkte = w.autos.map(fitness);
    let bi = 0;
    punkte.forEach((p, i) => { if (p > punkte[bi]) bi = i; });
    const zeiten = w.autos.flatMap((a) => a.runden_zeiten);
    const beste = zeiten.length ? Math.min(...zeiten) : null;
    if (beste != null && (w.besteZeit == null || beste < w.besteZeit)) w.besteZeit = beste;
    w.gen += 1;
    // Fortschritt in Runden (1 = eine Runde geschafft), fuer die Kurve.
    w.verlauf = [...w.verlauf, Math.round((w.autos[bi].weg / strecke.n) * 100) / 100].slice(-200);
    // Und die beste Rundenzeit dieser Generation — sobald Runden gelingen,
    // sieht man das Lernen an der ZEIT (der Weg ist dann bei zwei Runden voll).
    w.zeiten = [...w.zeiten, beste].slice(-200);
    w.besteKi = w.gehirne[bi];
    w.letzte = beste;
    try {
      localStorage.setItem(SPEICHER, JSON.stringify({ beste: Array.from(w.besteKi), gen: w.gen, verlauf: w.verlauf, zeiten: w.zeiten, besteZeit: w.besteZeit }));
    } catch { /* voll oder gesperrt */ }
    // Die Populationsgroesse kann sich geaendert haben: auffuellen bzw. kuerzen.
    let gehirne = naechsteGeneration(w.gehirne, punkte, rate);
    while (gehirne.length < anzahl) gehirne.push(zufallsGehirn());
    gehirne = gehirne.slice(0, anzahl);
    w.gehirne = gehirne;
    w.autos = gehirne.map(() => neuesAuto(strecke));
    w.simZeit = 0;
  };

  const meldeHud = (w) => {
    const m = w.mensch;
    setHud({
      gen: w.gen, lebend: w.autos.filter((a) => a.lebt).length, zeit: m ? m.t - m.rundeSeit : w.simZeit,
      runde: m ? m.runden_zeiten[m.runden_zeiten.length - 1] ?? null : null,
      beste: m ? w.menschBest : w.besteZeit, kiBeste: w.besteZeit, letzte: w.letzte ?? null, verlauf: w.verlauf, zeiten: w.zeiten,
      runden: m ? m.runden : null,
    });
  };

  // ── Zeichnen ──
  const zeichne = () => {
    const cv = canvas.current, w = welt.current;
    if (!cv || !w) return;
    const g = cv.getContext("2d");
    g.fillStyle = "#6aa84f"; g.fillRect(0, 0, BREITE, HOEHE);
    const pfad = () => { g.beginPath(); strecke.mitte.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
    g.lineJoin = "round"; g.lineCap = "round";
    // Randsteine, Asphalt, Mittellinie
    pfad(); g.strokeStyle = "#e9e9e9"; g.lineWidth = SPUR + 8; g.stroke();
    pfad(); g.setLineDash([14, 14]); g.strokeStyle = "#d33"; g.lineWidth = SPUR + 8; g.stroke(); g.setLineDash([]);
    pfad(); g.strokeStyle = "#555"; g.lineWidth = SPUR; g.stroke();
    pfad(); g.setLineDash([10, 14]); g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 2; g.stroke(); g.setLineDash([]);
    // Start/Ziel: Schachbrett quer zur Fahrtrichtung
    const s = strecke.start, nx = -Math.sin(s.winkel), ny = Math.cos(s.winkel);
    for (let k = -SPUR / 2; k < SPUR / 2; k += 8) for (let r = 0; r < 2; r++) {
      g.fillStyle = ((k / 8 + r) & 1) ? "#fff" : "#111";
      const px = s.x + nx * k + Math.cos(s.winkel) * (r * 8 - 8), py = s.y + ny * k + Math.sin(s.winkel) * (r * 8 - 8);
      g.save(); g.translate(px, py); g.rotate(s.winkel); g.fillRect(0, 0, 8, 8); g.restore();
    }
    // Autos
    const beste = w.autos.length ? w.autos.reduce((b, a) => (a.lebt && a.weg > (b?.weg ?? -1e9) ? a : b), null) : null;
    w.autos.forEach((a) => {
      if (nurBeste && a !== beste) return;
      auto(g, a, a === beste ? "#1e88e5" : "rgba(30,136,229,0.35)", a.lebt ? 1 : 0.25);
    });
    // Sensorstrahlen der besten KI: so „sieht" sie die Strecke.
    if (beste && beste.lebt && modus === "ki") {
      g.strokeStyle = "rgba(255,235,59,0.85)"; g.lineWidth = 1.5;
      STRAHLEN.forEach((rw) => {
        const wi = beste.w + rw, c = Math.cos(wi), sn = Math.sin(wi);
        let d = 0; while (d < STRAHL_MAX && strecke.aufStrasse(beste.x + c * d, beste.y + sn * d)) d += 4;
        g.beginPath(); g.moveTo(beste.x, beste.y); g.lineTo(beste.x + c * d, beste.y + sn * d); g.stroke();
      });
    }
    if (w.mensch) auto(g, w.mensch, "#e53935", 1);
  };
  const auto = (g, a, farbe, alpha) => {
    g.save(); g.globalAlpha = alpha; g.translate(a.x, a.y); g.rotate(a.w);
    g.fillStyle = farbe; g.fillRect(-11, -6, 22, 12);
    g.fillStyle = "rgba(255,255,255,0.8)"; g.fillRect(3, -4, 5, 8);   // Scheibe = vorn
    g.restore();
  };

  tun.current = { neueWelt, schritt, zeichne, meldeHud };
  const neuStart = () => { setLaeuft(false); neueWelt(modus); };
  const kiVergessen = () => { try { localStorage.removeItem(SPEICHER); } catch { /* egal */ } setLaeuft(false); neueWelt(modus); };
  // Tasten am Bildschirm (Tablet): halten = fahren
  const taste = (key) => ({
    onPointerDown: (e) => { e.preventDefault(); tasten.current[key] = true; if (!laeuft) setLaeuft(true); },
    onPointerUp: () => { tasten.current[key] = false; },
    onPointerLeave: () => { tasten.current[key] = false; },
    onPointerCancel: () => { tasten.current[key] = false; },
  });

  const v = hud.verlauf || [];
  const vmax = Math.max(1, ...v);
  const kurve = v.map((y, i) => `${v.length > 1 ? (i / (v.length - 1)) * 280 : 0},${70 - (y / vmax) * 56}`).join(" ");
  // Rundenzeiten: oben = schneller (die beste steht oben, wie beim Weg). Generationen ohne Runde bleiben Luecken.
  const zs = (hud.zeiten || []);
  const zda = zs.filter((z) => z != null);
  const zmin = zda.length ? Math.min(...zda) : 0, zmax = zda.length ? Math.max(...zda) : 1;
  const zKurve = zs.map((z, i) => (z == null ? null : `${zs.length > 1 ? (i / (zs.length - 1)) * 280 : 0},${8 + ((z - zmin) / Math.max(0.01, zmax - zmin)) * 56}`)).filter(Boolean).join(" ");
  const hatKi = !!welt.current?.besteKi;

  return (
    <div style={pageFull}>
      <Werkzeugleiste style={{ marginBottom: 12 }}
        links={(
          <Segment>
            {["selbst", "ki", "gegen"].map((m) => (
              <button key={m} onClick={() => setModus(m)} aria-pressed={modus === m} disabled={m === "gegen" && !hatKi && modus !== "gegen"}
                title={m === "gegen" && !hatKi ? t("rennen.erstLernen") : undefined}
                style={{ ...segmentBtn, fontWeight: modus === m ? 700 : 500, color: modus === m ? "var(--accent)" : "var(--text2)" }}>
                {t(`rennen.modus.${m}`)}
              </button>
            ))}
          </Segment>
        )}>
        <button onClick={() => setLaeuft((x) => !x)} style={toolbarBtnPrimary}>{laeuft ? t("rennen.pause") : t("rennen.los")}</button>
        <button onClick={neuStart} style={toolbarBtn}>{t("rennen.neu")}</button>
      </Werkzeugleiste>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden", position: "relative" }}>
          <canvas ref={canvas} width={BREITE} height={HOEHE} style={{ width: "100%", height: "auto", display: "block" }} />
          {/* Anzeige oben links: Rundenzeiten bzw. Generation */}
          <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(0,0,0,0.6)", color: "#fff", borderRadius: CONTROL_R,
            padding: "6px 10px", fontSize: 14, fontVariantNumeric: "tabular-nums", lineHeight: 1.5 }}>
            {modus === "ki" ? (<>
              <div><b>{t("rennen.generation")} {hud.gen + 1}</b> · {t("rennen.lebend", { n: hud.lebend })}</div>
              <div>{t("rennen.zeitGen")} {zeitText(hud.zeit)} / {zeitText(ZEITGRENZE)}</div>
              <div>{t("rennen.kiBeste")} {zeitText(hud.beste)}</div>
            </>) : (<>
              <div><b>{t("rennen.runde")}</b> {zeitText(hud.zeit)}</div>
              <div>{t("rennen.letzte")} {zeitText(hud.runde)}</div>
              <div>{t("rennen.beste")} {zeitText(hud.beste)}</div>
              {modus === "gegen" && <div>{t("rennen.kiBeste")} {zeitText(hud.kiBeste)}</div>}
            </>)}
          </div>
          {!laeuft && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: CONTROL_R, padding: "10px 16px", fontSize: 16, fontWeight: 700 }}>
                {modus === "ki" ? t("rennen.startKi") : t("rennen.startSelbst")}
              </div>
            </div>
          )}
        </div>

        {modus !== "ki" && (
          // Fuer Tablets: Tasten zum Halten (links/rechts lenken, oben Gas, unten Bremse).
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, touchAction: "none", userSelect: "none" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button {...taste("ArrowLeft")} style={pedal} aria-label={t("rennen.links")}>◀</button>
              <button {...taste("ArrowRight")} style={pedal} aria-label={t("rennen.rechts")}>▶</button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button {...taste("ArrowDown")} style={pedal} aria-label={t("rennen.bremse")}>▼</button>
              <button {...taste("ArrowUp")} style={{ ...pedal, background: C.success, color: "#fff" }} aria-label={t("rennen.gas")}>▲</button>
            </div>
          </div>
        )}

        {modus === "ki" && (
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <div style={{ ...cardStyle, padding: 12 }}>
              <Regler label={t("rennen.mutation")} wert={`${Math.round(rate * 100)} %`} min={1} max={60} value={Math.round(rate * 100)} onChange={(x) => setRate(x / 100)} />
              <Regler label={t("rennen.anzahl")} wert={anzahl} min={5} max={60} value={anzahl} onChange={setAnzahl} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--text2)", minWidth: 110 }}>{t("rennen.tempo")}</span>
                <Segment>
                  {[1, 2, 5, 10].map((x) => (
                    <button key={x} onClick={() => setTempo(x)} aria-pressed={tempo === x}
                      style={{ ...segmentBtn, fontWeight: tempo === x ? 700 : 500, color: tempo === x ? "var(--accent)" : "var(--text2)" }}>{x}×</button>
                  ))}
                </Segment>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 10 }}>
                <input type="checkbox" checked={nurBeste} onChange={(e) => setNurBeste(e.target.checked)} /> {t("rennen.nurBeste")}
              </label>
              <button onClick={kiVergessen} style={{ ...toolbarBtn, marginTop: 10, color: C.danger }}>{t("rennen.vergessen")}</button>
            </div>
            {/* Wie weit kam die beste KI je Generation? 1 = eine Runde. */}
            <div style={{ ...cardStyle, padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("rennen.verlauf")}</div>
              {v.length < 2 ? <div style={{ fontSize: 13, color: "var(--text3)" }}>{t("rennen.verlaufLeer")}</div> : (
                <svg viewBox="0 0 280 72" style={{ width: "100%", height: 110, background: "var(--bg3)", borderRadius: CONTROL_R }}>
                  {[1, 2].filter((r) => r <= vmax).map((r) => (
                    <g key={r}>
                      <line x1={0} x2={280} y1={70 - (r / vmax) * 56} y2={70 - (r / vmax) * 56} stroke="var(--border2)" strokeDasharray="3 3" />
                      <text x={2} y={68 - (r / vmax) * 56} fontSize={8} fill="var(--text3)">{t("rennen.rundenN", { n: r })}</text>
                    </g>
                  ))}
                  <polyline points={kurve} fill="none" stroke="#1e88e5" strokeWidth={1.8} />
                </svg>
              )}
              {zda.length >= 2 && (<>
                <div style={{ fontWeight: 700, margin: "10px 0 6px" }}>{t("rennen.zeitVerlauf")}</div>
                <svg viewBox="0 0 280 72" style={{ width: "100%", height: 90, background: "var(--bg3)", borderRadius: CONTROL_R }}>
                  <text x={2} y={10} fontSize={8} fill="var(--text3)">{zeitText(zmin)}</text>
                  <text x={2} y={70} fontSize={8} fill="var(--text3)">{zeitText(zmax)}</text>
                  <polyline points={zKurve} fill="none" stroke={C.success} strokeWidth={1.8} />
                </svg>
              </>)}
              <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 6 }}>
                {t("rennen.letzteGen")} {zeitText(hud.letzte)} · {t("rennen.kiBeste")} {zeitText(hud.beste)}
              </div>
            </div>
          </div>
        )}
        <div style={{ ...panelStyle, padding: 12, fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
          {t(`rennen.erklaer.${modus}`)}
        </div>
      </div>
    </div>
  );
}

function Regler({ label, wert, ...rest }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6 }}>
      <span style={{ minWidth: 110, color: "var(--text2)" }}>{label}</span>
      <input type="range" {...rest} onChange={(e) => rest.onChange(Number(e.target.value))} style={{ flex: 1, minWidth: 80 }} />
      <span style={{ minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{wert}</span>
    </label>
  );
}

const pedal = { ...toolbarBtn, minWidth: 64, height: 56, fontSize: 22, justifyContent: "center", touchAction: "none" };
