// Stille-Safari: ein Feld auf der Tafel, in dem nach und nach Tiere auftauchen,
// solange die Klasse leise ist — und wieder verschwinden (oder innehalten),
// wenn es zu laut wird. Die Idee kennt man von Ruhe-Apps fuer den Unterricht;
// Landschaft und Ablauf sind hier eigen gezeichnet (einfache Formen, Tiere als
// Emoji), nichts ist uebernommen.
//
// Gemessen wird mit core/mikroPegel.js — derselben Messung wie die
// Lautstaerke-Anzeige, mit denselben Regeln: Mikrofon nur auf Knopfdruck,
// nichts wird aufgenommen oder verschickt.
//
// Einstellungen am Element (gespeichert mit der Tafel): `schwelle` (0..100,
// wie die Lautstaerke-Anzeige), `takt` (Minuten je Tier, im Mittel) und
// `modus` ("weglaufen": bei Laerm laeuft alle WEG_S Sekunden ein Tier weg;
// "pause": die Szene haelt an, es kommt keins dazu). Die Tiere selbst sind
// Zustand der Stunde und werden nicht gespeichert.
import { useEffect, useRef, useState } from "react";
import { CONTROL_R, COLORS as C, btnSecondary } from "./Icons.jsx";
import { useMikroPegel } from "../core/mikroPegel.js";

const TIERE = ["🦒", "🐘", "🦓", "🦁", "🐆", "🦛", "🦏", "🐃", "🦩", "🐒", "🐊", "🦅", "🐗", "🦔"];
// Bei Laerm: alle WEG_S Sekunden laeuft ein Tier weg — nicht alle auf einmal,
// sonst ist ein einziger Ausrutscher die Arbeit einer halben Stunde.
const WEG_S = 5;
// Ein kurzer Knall ist kein Laerm: erst nach LAUT_HALTE_S Sekunden ueber der
// Schwelle gilt der Raum als zu laut.
const LAUT_HALTE_S = 1;
const MAX_TIERE = 40;

// Zufaellige Wartezeit um den Takt herum (0,6- bis 1,4-fach): genau alle fuenf
// Minuten waere nach dem zweiten Tier vorhersehbar.
const naechsteWartezeit = (takt) => takt * 60000 * (0.6 + Math.random() * 0.8);

function neuesTier(vorhandene) {
  const frei = TIERE.filter((e) => !vorhandene.some((x) => x.e === e));
  const e = (frei.length ? frei : TIERE)[Math.floor(Math.random() * (frei.length || TIERE.length))];
  // Auf dem Boden (unteres Drittel), mit etwas Tiefe: weiter hinten = kleiner.
  const y = 62 + Math.random() * 28;
  return { id: `${Date.now()}-${Math.random()}`, e, x: 6 + Math.random() * 84, y, spiegeln: Math.random() < 0.5, weg: false };
}

export default function TafelSafari({ item, t }) {
  const schwelle = item.schwelle ?? 40;
  const takt = item.takt ?? 5;
  const modus = item.modus === "pause" ? "pause" : "weglaufen";
  const [tiere, setTiere] = useState([]);
  const [laut, setLaut] = useState(false);
  const ruhig = useRef(0);                         // gesammelte Ruhezeit (ms)
  const warte = useRef(naechsteWartezeit(takt));   // bis zum naechsten Tier
  const ueber = useRef(0);                         // seit wann ueber der Schwelle (ms)
  const lautSeit = useRef(0);                      // fuer das Weglaufen
  const tiereRef = useRef(tiere);
  tiereRef.current = tiere;

  // Neu anfangen (Knopf in der Leiste, `_reset` am Element).
  useEffect(() => {
    if (!item._reset) return;
    setTiere([]); ruhig.current = 0; warte.current = naechsteWartezeit(takt);
  }, [item._reset]);
  // Anderer Takt: die Wartezeit neu wuerfeln, sonst gilt bis zum naechsten
  // Tier noch der alte.
  useEffect(() => { warte.current = naechsteWartezeit(takt); }, [takt]);

  const wegLaufen = () => {
    const da = tiereRef.current.filter((x) => !x.weg);
    if (!da.length) return;
    const opfer = da[da.length - 1];
    setTiere((l) => l.map((x) => (x.id === opfer.id ? { ...x, weg: true } : x)));
    setTimeout(() => setTiere((l) => l.filter((x) => x.id !== opfer.id)), 1200);
  };

  const { an, pegel, fehler, start, stopp } = useMikroPegel((wert, delta) => {
    if (wert >= schwelle) {
      ueber.current += delta;
      if (ueber.current >= LAUT_HALTE_S * 1000) {
        if (!laut) setLaut(true);
        if (modus === "weglaufen") {
          lautSeit.current += delta;
          if (lautSeit.current >= WEG_S * 1000) { lautSeit.current = 0; wegLaufen(); }
        }
      }
      return;
    }
    ueber.current = 0;
    lautSeit.current = 0;
    if (laut) setLaut(false);
    ruhig.current += delta;
    if (ruhig.current >= warte.current) {
      ruhig.current = 0;
      warte.current = naechsteWartezeit(takt);
      setTiere((l) => (l.length >= MAX_TIERE ? l : [...l, neuesTier(l)]));
    }
  });

  const anzahl = tiere.filter((x) => !x.weg).length;
  const status = !an ? t("tafel.safariAus") : laut ? (modus === "pause" ? t("tafel.safariPause") : t("tafel.safariWeg")) : t("tafel.safariKommen");
  const statusFarbe = !an ? "var(--text3)" : laut ? C.danger : C.success;
  const balkenFarbe = pegel >= schwelle ? C.danger : pegel >= schwelle * 0.75 ? C.warning : C.success;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", borderRadius: CONTROL_R }}>
      <style>{`
        @keyframes safariKommt { from { opacity: 0; transform: translateY(30px) scale(.7); } to { opacity: 1; transform: none; } }
        @keyframes safariWeg { to { opacity: 0; transform: translateX(260px); } }
      `}</style>
      {/* Landschaft: Himmel, Sonne, Berg, Huegel, Boden, Wasserloch, Baeume —
          alles einfache Formen, die mit dem Feld mitwachsen. */}
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden="true">
        <defs>
          <linearGradient id="safHimmel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9cc9dc" /><stop offset="1" stopColor="#f3e6c4" />
          </linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#safHimmel)" />
        <circle cx="300" cy="190" r="110" fill="#fbeec4" opacity="0.5" />
        <circle cx="300" cy="190" r="70" fill="#fdf1c2" />
        <ellipse cx="620" cy="140" rx="150" ry="34" fill="#f7f2e4" />
        <ellipse cx="1350" cy="230" rx="120" ry="26" fill="#f7f2e4" />
        <polygon points="1050,500 1330,250 1420,270 1650,500" fill="#d9c0b0" />
        <polygon points="1290,285 1330,250 1420,270 1380,300" fill="#f1e8e2" />
        <path d="M0 480 Q 300 400 650 470 T 1600 460 L1600 900 L0 900 Z" fill="#d6b79c" opacity="0.8" />
        <path d="M0 540 Q 400 500 800 540 T 1600 530 L1600 900 L0 900 Z" fill="#e2c27f" />
        <path d="M0 640 Q 500 600 900 650 T 1600 640 L1600 900 L0 900 Z" fill="#d8b46a" />
        <ellipse cx="1150" cy="600" rx="230" ry="38" fill="#c9a46a" />
        <ellipse cx="1150" cy="598" rx="200" ry="28" fill="#8fbcc9" />
        {[[300, 560, 1], [1400, 580, 0.9], [130, 740, 1.6]].map(([x, y, g], i) => (
          <g key={i} transform={`translate(${x} ${y}) scale(${g})`}>
            <rect x="-6" y="-10" width="12" height="70" fill="#7a5a44" />
            <ellipse cx="0" cy="-18" rx="90" ry="26" fill="#8fa36a" />
            <ellipse cx="0" cy="-30" rx="70" ry="18" fill="#9cb075" />
          </g>
        ))}
      </svg>

      {/* Die Tiere — Emoji, weiter hinten kleiner. */}
      {tiere.map((x) => (
        <span key={x.id} style={{
          position: "absolute", left: `${x.x}%`, top: `${x.y}%`, transform: "translate(-50%, -100%)",
          fontSize: `${2.2 + (x.y - 60) * 0.12}em`, lineHeight: 1, pointerEvents: "none",
        }}>
          <span style={{
            display: "inline-block",
            animation: x.weg ? "safariWeg 1.2s ease-in forwards" : "safariKommt .8s ease-out both",
          }}>
            <span style={{ display: "inline-block", transform: x.spiegeln ? "scaleX(-1)" : undefined }}>{x.e}</span>
          </span>
        </span>
      ))}

      {/* Kopf: Pegel und Zustand. Ohne Mikrofon steht der Knopf zum Starten da. */}
      <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", background: "rgba(255,255,255,0.9)",
        borderRadius: CONTROL_R, padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6, minWidth: "40%", color: "#1d1d1f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", fontSize: 22, fontWeight: 700 }}>
          <span style={{ color: statusFarbe }}>● {status}</span>
          <span>{anzahl} 🐾</span>
        </div>
        <div style={{ position: "relative", height: 14, background: "#e5e7eb", borderRadius: CONTROL_R, overflow: "hidden" }}>
          <div style={{ width: `${pegel}%`, height: "100%", background: balkenFarbe, transition: "width .12s linear" }} />
          <div style={{ position: "absolute", left: `${schwelle}%`, top: 0, bottom: 0, width: 3, background: "#1d1d1f", opacity: 0.6 }} />
        </div>
      </div>
      <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)" }}>
        {!an
          ? <button onClick={start} style={safariBtn}>{t("tafel.laermStart")}</button>
          : <button onClick={stopp} style={safariBtn}>{t("tafel.laermStop")}</button>}
      </div>
      {fehler && (
        <div style={{ position: "absolute", bottom: 80, left: 16, right: 16, textAlign: "center", fontSize: 22, color: C.danger, background: "rgba(255,255,255,0.9)", borderRadius: CONTROL_R, padding: 8 }}>
          {t(`tafel.mikro.${fehler}`)}
        </div>
      )}
    </div>
  );
}

const safariBtn = {
  ...btnSecondary, padding: "8px 22px", fontSize: 22, lineHeight: 1, fontWeight: 700,
  background: "rgba(255,255,255,0.92)", color: "#1d1d1f", border: "2px solid rgba(0,0,0,0.12)", borderRadius: CONTROL_R,
};
