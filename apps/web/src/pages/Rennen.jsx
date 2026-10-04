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
import RennenExperiment from "../components/RennenExperiment.jsx";
import RennenErklaerung from "../components/RennenErklaerung.jsx";
import { useLanguage } from "../i18n/index.jsx";
import {
  BREITE, HOEHE, PHYSIK, SPUR, STRAHLEN, STRAHL_MAX, ZEITGRENZE, STRECKEN, strecke as streckeVon, denkeInnen, fahre, fitness, gewicht,
  gehirnAusJson, gehirnZuJson, gleicheForm, netzForm,
  kiSchritt, mutiere, rundenSchnitt, naechsteGeneration, neuesAuto, sensoren, zeitText, zufallsGehirn,
} from "../core/rennen.js";

// Je Strecke ihre beste KI. Die Rundkurs-KI lag frueher unter dem Schluessel
// ohne Namen — sie bleibt die des Rundkurses.
const SPEICHER = "nuvora_rennen_ki";
const speicherKey = (name) => (name === "rundkurs" ? SPEICHER : `${SPEICHER}_${name}`);

function ladeKi(name) {
  try {
    const x = JSON.parse(localStorage.getItem(speicherKey(name)) || "null");
    const beste = x ? gehirnAusJson(x.beste) : null;
    if (beste) return { ...x, beste };
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
  const [grenze, setGrenze] = useState(ZEITGRENZE);
  // In welchen Modi schon einmal gestartet wurde (diese Sitzung).
  const [gestartet, setGestartet] = useState(() => new Set());
  useEffect(() => { if (laeuft) setGestartet((g) => (g.has(modus) ? g : new Set([...g, modus]))); }, [laeuft, modus]);
  const erklaerungZeigen = () => {
    setLaeuft(false);
    setGestartet((g) => { const n = new Set(g); n.delete(modus); return n; });
    if (modus === "ki") setErklaert(false);
  };
  // Hat dieses Geraet die Schritt-fuer-Schritt-Erklaerung schon durchlaufen?
  const [erklaert, setErklaert] = useState(() => { try { return localStorage.getItem("nuvora_rennen_erklaert") === "1"; } catch { return false; } });
  const merkeErklaert = () => { setErklaert(true); try { localStorage.setItem("nuvora_rennen_erklaert", "1"); } catch { /* egal */ } };   // maximale Fahrzeit je Generation (s)
  const [hud, setHud] = useState({ gen: 0, lebend: 0, zeit: 0, runde: null, beste: null, letzte: null, verlauf: [] });
  const canvas = useRef(null);
  const tasten = useRef({});
  const welt = useRef(null);   // alles, was je Bild weiterlaeuft
  const [streckeName, setStreckeName] = useState("rundkurs");
  // Form des Netzes: versteckte Schichten und Neuronen je Schicht. Eine andere
  // Form ist ein anderes Gehirn — die KI faengt dann von vorn an.
  const [schichten, setSchichten] = useState(1);
  const [neuronen, setNeuronen] = useState(8);
  const strecke = streckeVon(streckeName);

  // ── Welt aufbauen, wenn der Modus wechselt ──
  const neueWelt = (m = modus, formNeu = null) => {
    // Eine neu gewaehlte Netzform verwirft das Gespeicherte (es passt nicht
    // mehr); sonst uebernimmt die Seite die Form der gespeicherten KI.
    let gespeichert = formNeu ? null : ladeKi(streckeName);
    const form = formNeu || (gespeichert ? gespeichert.beste.form : netzForm(schichten, neuronen));
    if (!formNeu && gespeichert) { setSchichten(form.length - 2); setNeuronen(form.length > 2 ? form[1] : neuronen); }
    // Noch keine KI fuer diese Strecke? Dann faengt sie mit dem an, was sie
    // auf der vorigen gelernt hat — so sieht man, ob Gelerntes uebertragbar ist.
    const mitgebracht = !gespeichert && welt.current?.besteKi && gleicheForm(welt.current.besteKi.form, form) ? welt.current.besteKi : null;
    const w = { mensch: null, autos: [], gehirne: [], gen: gespeichert?.gen || 0, verlauf: gespeichert?.verlauf || [],
      zeiten: gespeichert?.zeiten || [], geschafft: gespeichert?.geschafft || [],
      aufwand: gespeichert?.aufwand || 0,
      besteKi: gespeichert?.beste || null, form, besteZeit: gespeichert?.besteZeit ?? null, menschBest: null, simZeit: 0 };
    if (m === "selbst" || m === "gegen") w.mensch = neuesAuto(strecke);
    if (m === "gegen" && w.besteKi) { w.gehirne = [w.besteKi]; w.autos = [neuesAuto(strecke)]; }
    if (m === "ki") {
      // Weiterlernen heisst: ALLE fangen bei der gespeicherten KI an (zwei
      // unveraendert, der Rest leicht mutiert). Vorher waren nur zwei davon
      // Kopien und 28 Zufall — das sah aus, als sei die KI geloescht.
      const start = w.besteKi || mitgebracht;
      w.gehirne = Array.from({ length: anzahl }, (_, i) => (!start ? zufallsGehirn(Math.random, form) : i < 2 ? start : mutiere(start, rate)));
      w.autos = w.gehirne.map(() => neuesAuto(strecke));
    }
    welt.current = w;
    zeichne();
    meldeHud(w);   // Anzeige gleich auf die neue Strecke/den neuen Modus
  };
  // Die Funktionen sehen immer den aktuellen Stand (Regler, Modus) — die
  // Effekte haengen nur an dem, wonach sie sich wirklich neu aufbauen.
  const tun = useRef(null);
  useEffect(() => { setLaeuft(false); tun.current.neueWelt(modus); }, [modus, streckeName]);

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
      if (a.lebt) lebend += 1;
    });
    if (!lebend || w.simZeit >= grenze) generationFertig(w);
  };

  const generationFertig = (w) => {
    const punkte = w.autos.map(fitness);
    let bi = 0;
    punkte.forEach((p, i) => { if (p > punkte[bi]) bi = i; });
    // Der Rundenschnitt des besten Autos — das ist, was gelernt werden soll.
    const beste = rundenSchnitt(w.autos[bi]);
    if (beste != null && (w.besteZeit == null || beste < w.besteZeit)) w.besteZeit = beste;
    w.gen += 1;
    w.besteKi = w.gehirne[bi];
    w.letzte = beste;
    w.zeiten = [...w.zeiten, beste].slice(-200);
    w.geschafft = [...w.geschafft, w.autos.filter((a) => a.runden > 0).length / w.autos.length].slice(-200);
    // Was das gekostet hat: gefahrene Sekunden aller Autos zusammen.
    w.aufwand = (w.aufwand || 0) + w.autos.reduce((x, a) => x + a.t, 0);
    try {
      localStorage.setItem(speicherKey(streckeName), JSON.stringify({ beste: gehirnZuJson(w.besteKi), gen: w.gen, zeiten: w.zeiten, geschafft: w.geschafft, aufwand: w.aufwand, besteZeit: w.besteZeit }));
    } catch { /* voll oder gesperrt */ }
    // Die Populationsgroesse kann sich geaendert haben: auffuellen bzw. kuerzen.
    let gehirne = naechsteGeneration(w.gehirne, punkte, rate);
    while (gehirne.length < anzahl) gehirne.push(zufallsGehirn(Math.random, w.form));
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
      netz, aufwand: (w.aufwand || 0) + w.autos.reduce((x, a) => x + a.t, 0),
      gen: w.gen, lebend: w.autos.filter((a) => a.lebt).length, zeit: m ? m.t - m.rundeSeit : w.simZeit,
      runde: m ? m.runden_zeiten[m.runden_zeiten.length - 1] ?? null : null,
      beste: m ? w.menschBest : w.besteZeit, kiBeste: w.besteZeit, letzte: w.letzte ?? null, zeiten: w.zeiten, geschafft: w.geschafft,
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
  const formAendern = (sch, neu) => {
    setSchichten(sch); setNeuronen(neu); setLaeuft(false);
    if (welt.current) welt.current.besteKi = null;
    neueWelt(modus, netzForm(sch, neu));
  };
  const neuStart = () => { setLaeuft(false); neueWelt(modus); };
  const kiVergessen = () => {
    try { localStorage.removeItem(speicherKey(streckeName)); } catch { /* egal */ }
    if (welt.current) welt.current.besteKi = null;   // auch nichts mitbringen
    setLaeuft(false); neueWelt(modus);
  };
  // Rundenschnitt des besten Autos je Generation: oben = schneller.
  // Generationen ohne volle Runde bleiben Luecken.
  const zs = hud.zeiten || [];
  const zda = zs.filter((z) => z != null);
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
            {["selbst", "ki", "gegen", "experiment"].map((m) => (
              <button key={m} onClick={() => setModus(m)} aria-pressed={modus === m} disabled={m === "gegen" && !hatKi && modus !== "gegen"}
                title={m === "gegen" && !hatKi ? t("rennen.erstLernen") : undefined}
                style={{ ...segmentBtn, fontWeight: modus === m ? 700 : 500, color: modus === m ? "var(--accent)" : "var(--text2)" }}>
                {t(`rennen.modus.${m}`)}
              </button>
            ))}
          </Segment>
        )}>
        {modus !== "experiment" && (<>
          <button onClick={() => setLaeuft((x) => !x)} style={toolbarBtnPrimary}>{laeuft ? t("rennen.pause") : t("rennen.los")}</button>
          <button onClick={neuStart} style={toolbarBtn}>{t("rennen.neu")}</button>
          <button onClick={erklaerungZeigen} style={toolbarBtn} title={t("rennen.erklaerungZeigen")} aria-label={t("rennen.erklaerungZeigen")}>?</button>
        </>)}
        {/* Strecken: als kleine Bilder der Mittellinie — man erkennt sie schneller, als man sie liest. */}
        <Segment>
          {Object.keys(STRECKEN).map((k) => (
            <button key={k} onClick={() => setStreckeName(k)} aria-pressed={streckeName === k} title={t(`rennen.strecke.${k}`)} aria-label={t(`rennen.strecke.${k}`)}
              style={{ ...segmentBtn, padding: "0 6px", color: streckeName === k ? "var(--accent)" : "var(--text3)" }}>
              <StreckenBild punkte={streckeVon(k).mitte} />
            </button>
          ))}
        </Segment>
      </Werkzeugleiste>

      {modus === "experiment" && <RennenExperiment strecke={strecke} t={t} />}
      <div style={{ ...cardStyle, padding: 0, overflow: "hidden", position: "relative", display: modus === "experiment" ? "none" : "block" }}>
        <canvas ref={canvas} width={BREITE} height={HOEHE} style={{ width: "100%", height: "auto", display: "block" }} />

        {/* Startbild mit Erklaerung — beim Oeffnen und bei jeder Pause. Es liegt UNTER
            den Feldern auf der Karte: die Einstellungen sollen vor dem Start erreichbar sein. Wer
            das Werkzeug zum ersten Mal sieht, soll wissen, was er tut. */}
        {/* Nach dem ersten Start eines Modus: Pause und Kartenwechsel zeigen
            nur noch einen kleinen Knopf — die Erklaerung holt „?" zurueck. */}
        {!laeuft && gestartet.has(modus) && (
          <button onClick={() => setLaeuft(true)}
            style={{ ...toolbarBtnPrimary, position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", fontSize: 16, padding: "10px 20px", height: "auto" }}>
            ▶ {t("rennen.weiter")}
          </button>
        )}
        {!laeuft && !gestartet.has(modus) && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)", padding: 16 }}>
            <div style={{ ...ueber, position: "static", maxWidth: modus === "ki" && !erklaert ? 560 : 520, maxHeight: "100%", overflowY: "auto", fontSize: 14, lineHeight: 1.5, padding: "16px 20px", background: "rgba(20,20,20,0.88)" }}>
              {/* „KI lernt": beim ersten Mal Schritt fuer Schritt erklaert, danach
                  nur die Kurzfassung — mit dem Weg zurueck zur Erklaerung. */}
              {modus === "ki" && !erklaert ? (
                <RennenErklaerung t={t} onLos={() => { merkeErklaert(); setLaeuft(true); }} />
              ) : (<>
                <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{t(`rennen.modus.${modus}`)}</div>
                <p style={{ margin: "0 0 10px" }}>{t(`rennen.erklaer.${modus}`)}</p>
                {modus === "ki" && <p style={{ margin: "0 0 10px", opacity: 0.85 }}>{t("rennen.kiHinweis")}</p>}
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button onClick={() => setLaeuft(true)} style={toolbarBtnPrimary}>{t("rennen.los")}</button>
                  {modus === "ki" && (
                    <button onClick={() => setErklaert(false)} style={{ ...toolbarBtn, background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,0.45)" }}>
                      {t("rennen.erk.vonVorn")}
                    </button>
                  )}
                </div>
              </>)}
            </div>
          </div>
        )}
        {/* Oben links: Zeiten bzw. Generation */}
        <div style={{ ...ueber, top: 10, left: 10 }}>
          {modus === "ki" ? (<>
            <div><b>{t("rennen.generation")} {hud.gen + 1}</b> · {t("rennen.lebend", { n: hud.lebend })}</div>
            <div>{t("rennen.zeitGen")} {zeitText(hud.zeit)} / {zeitText(grenze)}</div>
            <div>{t("rennen.kiBeste")} {zeitText(hud.beste)}</div>
            <div title={t("rennen.aufwandHint")}>{t("rennen.aufwand", { n: Math.round((hud.aufwand || 0) / 60) })}</div>
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
            {/* Netzform: eine andere Form ist ein neues Gehirn — die KI beginnt von vorn. */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }} title={t("rennen.formHinweis")}>
              <span style={{ minWidth: 70 }}>{t("rennen.schichten")}</span>
              {[0, 1, 2, 3].map((x) => (
                <button key={x} onClick={() => formAendern(x, neuronen)} aria-pressed={schichten === x}
                  style={{ ...chip, background: schichten === x ? "#fff" : "transparent", color: schichten === x ? "#111" : "#fff" }}>{x}</button>
              ))}
            </div>
            {schichten > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }} title={t("rennen.formHinweis")}>
                <span style={{ minWidth: 70 }}>{t("rennen.neuronen")}</span>
                {[2, 4, 8, 12, 16].map((x) => (
                  <button key={x} onClick={() => formAendern(schichten, x)} aria-pressed={neuronen === x}
                    style={{ ...chip, background: neuronen === x ? "#fff" : "transparent", color: neuronen === x ? "#111" : "#fff" }}>{x}</button>
                ))}
              </div>
            )}
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
            {zda.length === 0 ? <div style={{ opacity: 0.8 }}>{t("rennen.nochKeineRunde")}</div> : (
              <svg viewBox="0 0 280 72" style={{ width: "100%", height: 70, display: "block" }}>
                <text x={2} y={12} fontSize={10} fill="rgba(255,255,255,0.75)">{zeitText(zmin)}</text>
                <text x={2} y={70} fontSize={10} fill="rgba(255,255,255,0.75)">{zeitText(zmax)}</text>
                <polyline points={linie(zs)} fill="none" stroke="#81c784" strokeWidth={2.2} />
                {/* Punkte dazu: bei einer einzigen Generation mit Runde gibt es noch keine Linie. */}
                {linie(zs).split(" ").filter(Boolean).map((pt, i) => { const [x, y] = pt.split(",").map(Number); return <circle key={i} cx={x} cy={y} r={2.2} fill="#81c784" />; })}
              </svg>
            )}
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
  const form = g.form;
  const B = 260, H = 170;
  // Spalten gleichmaessig zwischen Eingaengen (links) und Ausgaengen (rechts).
  const xs = form.map((_, l) => 70 + (l / (form.length - 1)) * 140);
  const spalte = (n, x) => Array.from({ length: n }, (_, i) => [x, 14 + (i + 0.5) * ((H - 20) / n)]);
  const pos = form.map((n, l) => spalte(n, xs[l]));
  const r = Math.max(2.5, Math.min(6, (H - 20) / Math.max(...form) / 2.6));
  const linie = (w, p, q, key) => (
    <line key={key} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={w >= 0 ? "#64b5f6" : "#ef5350"}
      strokeWidth={Math.min(3, Math.abs(w) * 1.2)} strokeOpacity={Math.min(0.9, 0.12 + Math.abs(w) * 0.3)} />
  );
  const knoten = (wert, p, key) => (
    <circle key={key} cx={p[0]} cy={p[1]} r={r} fill={`rgba(255,255,255,${0.1 + 0.9 * Math.min(1, Math.abs(wert))})`}
      stroke={wert >= 0 ? "#64b5f6" : "#ef5350"} strokeWidth={1.3} />
  );
  const einNamen = [...STRAHLEN.map((_, i) => t("rennen.strahl", { n: i + 1 })), t("rennen.tempo")];
  const ausNamen = [t("rennen.lenken"), t("rennen.gasAus")];
  const letzte = form.length - 1;
  return (
    <svg viewBox={`0 0 ${B} ${H}`} style={{ width: "100%", display: "block" }}>
      {form.slice(0, -1).flatMap((_, l) => pos[l].flatMap((p, i) => pos[l + 1].map((q, j) => linie(gewicht(g, l, i, j), p, q, `${l}-${i}-${j}`))))}
      {pos.map((spalteP, l) => spalteP.map((p, i) => (
        <g key={`k${l}-${i}`}>
          {knoten(werte.schichten[l][i], p, `n${l}-${i}`)}
          {l === 0 && <text x={p[0] - 10} y={p[1] + 3} fontSize={9} textAnchor="end" fill="rgba(255,255,255,0.85)">{einNamen[i]}</text>}
          {l === letzte && (<>
            <text x={p[0] + 10} y={p[1] - 2} fontSize={9} fill="rgba(255,255,255,0.85)">{ausNamen[i]}</text>
            <text x={p[0] + 10} y={p[1] + 9} fontSize={9} fill="rgba(255,255,255,0.65)">{werte.aus[i].toFixed(2)}</text>
          </>)}
        </g>
      )))}
    </svg>
  );
}

function StreckenBild({ punkte }) {
  const d = punkte.filter((_, i) => i % 3 === 0).map(([x, y], i) => `${i ? "L" : "M"}${(x / BREITE * 34).toFixed(1)} ${(y / HOEHE * 22).toFixed(1)}`).join(" ") + " Z";
  return <svg viewBox="0 0 34 22" width={34} height={22} aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" /></svg>;
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

