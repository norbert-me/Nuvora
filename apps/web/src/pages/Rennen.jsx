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
  BREITE, HOEHE, NETZ, PHYSIK, SPUR, STRAHLEN, STRAHL_MAX, ZEITGRENZE, baueStrecke, denkeInnen, fahre, fitness, gewichtAus, gewichtEin,
  kiSchritt, naechsteGeneration, neuesAuto, sensoren, zeitText, zufallsGehirn,
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
  const [grenze, setGrenze] = useState(ZEITGRENZE);   // maximale Fahrzeit je Generation (s)
  const [hud, setHud] = useState({ gen: 0, lebend: 0, zeit: 0, runde: null, beste: null, letzte: null, verlauf: [] });
  const canvas = useRef(null);
  const tasten = useRef({});
  const welt = useRef(null);   // alles, was je Bild weiterlaeuft

  // ── Welt aufbauen, wenn der Modus wechselt ──
  const neueWelt = (m = modus) => {
    const gespeichert = ladeKi();
    const w = { mensch: null, autos: [], gehirne: [], gen: gespeichert?.gen || 0, verlauf: gespeichert?.verlauf || [],
      zeiten: gespeichert?.zeiten || [], schnitte: gespeichert?.schnitte || [], geschafft: gespeichert?.geschafft || [],
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
  }, [laeuft, modus, tempo]);   // grenze: liest schritt() ueber tun.current

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
      // Den roten Rand beruehrt: Unfall — zurueck an den Start, die Runde
      // zaehlt neu. Dieselbe Regel wie fuer die KI, sonst waere „Abkuerzen
      // ueber die Wiese" der schnellste Weg.
      if (!strecke.aufStrasse(w.mensch.x, w.mensch.y)) {
        w.mensch = neuesAuto(strecke);
        w.unfall = 1.2;
      }
    }
    if (w.unfall > 0) w.unfall -= 1 / 60;
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
      if (a.runden >= 1) a.lebt = false;   // eine Runde — fertig, gewertet wird ihre Zeit
      if (a.lebt) lebend += 1;
    });
    if (!lebend || w.simZeit >= grenze) generationFertig(w);
  };

  const generationFertig = (w) => {
    const punkte = w.autos.map(fitness);
    let bi = 0;
    punkte.forEach((p, i) => { if (p > punkte[bi]) bi = i; });
    const zeiten = w.autos.flatMap((a) => a.runden_zeiten);
    const beste = zeiten.length ? Math.min(...zeiten) : null;
    if (beste != null && (w.besteZeit == null || beste < w.besteZeit)) w.besteZeit = beste;
    w.gen += 1;
    // Je Generation: beste und durchschnittliche Rundenzeit derer, die eine
    // Runde geschafft haben, und wie viele das waren — daran sieht man das Lernen.
    const schnitt = zeiten.length ? zeiten.reduce((a, b) => a + b, 0) / zeiten.length : null;
    w.zeiten = [...w.zeiten, beste].slice(-200);
    w.schnitte = [...w.schnitte, schnitt].slice(-200);
    w.geschafft = [...w.geschafft, zeiten.length / w.autos.length].slice(-200);
    w.besteKi = w.gehirne[bi];
    w.letzte = beste;
    try {
      localStorage.setItem(SPEICHER, JSON.stringify({ beste: Array.from(w.besteKi), gen: w.gen, zeiten: w.zeiten, schnitte: w.schnitte, geschafft: w.geschafft, besteZeit: w.besteZeit }));
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
    // Das Netz der besten noch fahrenden KI, mit den Werten dieses Augenblicks.
    let netz = null;
    let bi = -1;
    w.autos.forEach((a, i) => { if (a.lebt && (bi < 0 || a.weg > w.autos[bi].weg)) bi = i; });
    if (bi >= 0 && w.gehirne[bi]) {
      const a = w.autos[bi];
      netz = { g: w.gehirne[bi], werte: denkeInnen(w.gehirne[bi], [...sensoren(a, strecke), a.v / PHYSIK.max]) };
    }
    setHud({
      netz,
      gen: w.gen, lebend: w.autos.filter((a) => a.lebt).length, zeit: m ? m.t - m.rundeSeit : w.simZeit,
      runde: m ? m.runden_zeiten[m.runden_zeiten.length - 1] ?? null : null,
      beste: m ? w.menschBest : w.besteZeit, kiBeste: w.besteZeit, letzte: w.letzte ?? null, zeiten: w.zeiten, schnitte: w.schnitte, geschafft: w.geschafft,
      runden: m ? m.runden : null, unfall: (w.unfall || 0) > 0,
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
  // Rundenzeiten je Generation: oben = schneller. Beste (gruen) und Schnitt
  // (weiss) derer mit Runde; Generationen ohne Runde bleiben Luecken.
  const zs = hud.zeiten || [], ss = hud.schnitte || [];
  const zda = [...zs, ...ss].filter((z) => z != null);
  const zmin = zda.length ? Math.min(...zda) : 0, zmax = zda.length ? Math.max(...zda) : 1;
  const linie = (reihe) => reihe.map((z, i) => (z == null ? null
    : `${reihe.length > 1 ? (i / (reihe.length - 1)) * 280 : 0},${8 + ((z - zmin) / Math.max(0.01, zmax - zmin)) * 56}`)).filter(Boolean).join(" ");
  const geschafftJetzt = (hud.geschafft || []).slice(-1)[0];
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

      <div style={{ ...cardStyle, padding: 0, overflow: "hidden", position: "relative" }}>
        <canvas ref={canvas} width={BREITE} height={HOEHE} style={{ width: "100%", height: "auto", display: "block" }} />

        {/* Startbild mit Erklaerung — beim Oeffnen und bei jeder Pause. Es liegt UNTER
            den Feldern auf der Karte: die Einstellungen sollen vor dem Start erreichbar sein. Wer
            das Werkzeug zum ersten Mal sieht, soll wissen, was er tut. */}
        {!laeuft && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)", padding: 16 }}>
            <div style={{ ...ueber, position: "static", maxWidth: 520, fontSize: 14, lineHeight: 1.5, padding: "16px 20px", background: "rgba(20,20,20,0.88)" }}>
              <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{t(`rennen.modus.${modus}`)}</div>
              <p style={{ margin: "0 0 10px" }}>{t(`rennen.erklaer.${modus}`)}</p>
              {modus !== "ki" && <p style={{ margin: "0 0 10px", opacity: 0.85 }}>{t("rennen.tastenHinweis")}</p>}
              {modus === "ki" && <p style={{ margin: "0 0 10px", opacity: 0.85 }}>{t("rennen.kiHinweis")}</p>}
              <button onClick={() => setLaeuft(true)} style={{ ...toolbarBtnPrimary, marginTop: 4 }}>{t("rennen.los")}</button>
            </div>
          </div>
        )}
        {/* Oben links: Zeiten bzw. Generation */}
        <div style={{ ...ueber, top: 10, left: 10 }}>
          {modus === "ki" ? (<>
            <div><b>{t("rennen.generation")} {hud.gen + 1}</b> · {t("rennen.lebend", { n: hud.lebend })}</div>
            <div>{t("rennen.zeitGen")} {zeitText(hud.zeit)} / {zeitText(grenze)}</div>
            <div>{t("rennen.kiBeste")} {zeitText(hud.beste)}</div>
          </>) : (<>
            <div><b>{t("rennen.runde")}</b> {zeitText(hud.zeit)}</div>
            <div>{t("rennen.letzte")} {zeitText(hud.runde)}</div>
            <div>{t("rennen.beste")} {zeitText(hud.beste)}</div>
            {modus === "gegen" && <div>{t("rennen.kiBeste")} {zeitText(hud.kiBeste)}</div>}
          </>)}
        </div>
        {hud.unfall && (
          <div style={{ ...ueber, top: "45%", left: "50%", transform: "translate(-50%, -50%)", fontSize: 22, fontWeight: 800, background: "rgba(229,57,53,0.9)" }}>
            {t("rennen.unfall")}
          </div>
        )}

        {/* Oben rechts: Einstellungen der KI — auf der Karte, damit Karte und
            Regler zusammen auf den Beamer passen. */}
        {modus === "ki" && (
          <div style={{ ...ueber, top: 10, right: 10, width: 250, fontSize: 13 }}>
            <Regler label={t("rennen.mutation")} wert={`${Math.round(rate * 100)} %`} min={1} max={60} value={Math.round(rate * 100)} onChange={(x) => setRate(x / 100)} />
            <Regler label={t("rennen.anzahl")} wert={anzahl} min={5} max={60} value={anzahl} onChange={setAnzahl} />
            <Regler label={t("rennen.grenze")} wert={`${grenze} s`} min={5} max={90} value={grenze} onChange={setGrenze} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ minWidth: 70 }}>{t("rennen.tempo")}</span>
              {[1, 2, 5, 10].map((x) => (
                <button key={x} onClick={() => setTempo(x)} aria-pressed={tempo === x}
                  style={{ ...chip, background: tempo === x ? "#fff" : "transparent", color: tempo === x ? "#111" : "#fff" }}>{x}×</button>
              ))}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <input type="checkbox" checked={nurBeste} onChange={(e) => setNurBeste(e.target.checked)} /> {t("rennen.nurBeste")}
            </label>
            <button onClick={kiVergessen} style={{ ...chip, marginTop: 8, color: "#ffb4b4", borderColor: "#ffb4b4" }}>{t("rennen.vergessen")}</button>
          </div>
        )}

        {/* Unten links: das Gehirn der besten KI, live. */}
        {(modus === "ki" || modus === "gegen") && hud.netz && laeuft && (
          <div style={{ ...ueber, bottom: 10, left: 10, width: 270, fontSize: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("rennen.netz")}</div>
            <NetzBild netz={hud.netz} t={t} />
          </div>
        )}

        {/* Unten rechts: wie die KI lernt — Rundenzeit je Generation. */}
        {modus === "ki" && (
          <div style={{ ...ueber, bottom: 10, right: 10, width: 260, fontSize: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("rennen.zeitVerlauf")}</div>
            {zda.length < 2 ? <div style={{ opacity: 0.8 }}>{t("rennen.nochKeineRunde")}</div> : (
              <svg viewBox="0 0 280 72" style={{ width: "100%", height: 70, display: "block" }}>
                <text x={2} y={12} fontSize={10} fill="rgba(255,255,255,0.75)">{zeitText(zmin)}</text>
                <text x={2} y={70} fontSize={10} fill="rgba(255,255,255,0.75)">{zeitText(zmax)}</text>
                <polyline points={linie(ss)} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={1.6} strokeDasharray="4 3" />
                <polyline points={linie(zs)} fill="none" stroke="#81c784" strokeWidth={2.2} />
              </svg>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 4, opacity: 0.9 }}>
              <span style={{ color: "#81c784" }}>— {t("rennen.linieBeste")}</span>
              <span>- - {t("rennen.linieSchnitt")}</span>
            </div>
            {geschafftJetzt != null && (
              <div style={{ marginTop: 4 }}>{t("rennen.geschafft", { p: Math.round(geschafftJetzt * 100) })}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const ueber = { position: "absolute", background: "rgba(0,0,0,0.62)", color: "#fff", borderRadius: CONTROL_R, padding: "8px 12px",
  fontSize: 14, fontVariantNumeric: "tabular-nums", lineHeight: 1.5 };
const chip = { border: "1px solid rgba(255,255,255,0.5)", borderRadius: CONTROL_R, padding: "2px 8px", fontSize: 12, cursor: "pointer", background: "transparent", color: "#fff" };

// Das neuronale Netz: links die Eingaenge (fuenf Strahlen, Tempo), in der Mitte
// acht Knoten, rechts Lenken und Gas. Linien: blau positiv, rot negativ, je
// dicker desto staerker; Knoten: je heller, desto staerker gerade aktiv.
function NetzBild({ netz, t }) {
  const { g, werte } = netz;
  const B = 260, H = 170;
  const spalte = (n, x) => Array.from({ length: n }, (_, i) => [x, 14 + (i + 0.5) * ((H - 20) / n)]);
  const E = spalte(NETZ.ein, 70), M = spalte(NETZ.mitte, 145), A = spalte(NETZ.aus, 210);
  const linie = (w, p, q, key) => (
    <line key={key} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={w >= 0 ? "#64b5f6" : "#ef5350"}
      strokeWidth={Math.min(3, Math.abs(w) * 1.4)} strokeOpacity={Math.min(0.9, 0.15 + Math.abs(w) * 0.35)} />
  );
  const knoten = (wert, p, key) => (
    <circle key={key} cx={p[0]} cy={p[1]} r={6} fill={`rgba(255,255,255,${0.1 + 0.9 * Math.min(1, Math.abs(wert))})`}
      stroke={wert >= 0 ? "#64b5f6" : "#ef5350"} strokeWidth={1.5} />
  );
  const einNamen = [...STRAHLEN.map((_, i) => t("rennen.strahl", { n: i + 1 })), t("rennen.tempo")];
  const ausNamen = [t("rennen.lenken"), t("rennen.gasAus")];
  return (
    <svg viewBox={`0 0 ${B} ${H}`} style={{ width: "100%", display: "block" }}>
      {E.flatMap((p, i) => M.map((q, j) => linie(gewichtEin(g, i, j), p, q, `e${i}-${j}`)))}
      {M.flatMap((p, j) => A.map((q, k) => linie(gewichtAus(g, j, k), p, q, `a${j}-${k}`)))}
      {E.map((p, i) => (
        <g key={`ek${i}`}>
          <text x={p[0] - 10} y={p[1] + 3} fontSize={9} textAnchor="end" fill="rgba(255,255,255,0.85)">{einNamen[i]}</text>
          {knoten(werte.ein[i], p, `en${i}`)}
        </g>
      ))}
      {M.map((p, j) => knoten(werte.mitte[j], p, `m${j}`))}
      {A.map((p, k) => (
        <g key={`ak${k}`}>
          {knoten(werte.aus[k], p, `an${k}`)}
          <text x={p[0] + 10} y={p[1] - 2} fontSize={9} fill="rgba(255,255,255,0.85)">{ausNamen[k]}</text>
          <text x={p[0] + 10} y={p[1] + 9} fontSize={9} fill="rgba(255,255,255,0.65)">{werte.aus[k].toFixed(2)}</text>
        </g>
      ))}
    </svg>
  );
}

function Regler({ label, wert, ...rest }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 4 }}>
      <span style={{ minWidth: 70 }}>{label}</span>
      <input type="range" {...rest} onChange={(e) => rest.onChange(Number(e.target.value))} style={{ flex: 1, minWidth: 80 }} />
      <span style={{ minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{wert}</span>
    </label>
  );
}

