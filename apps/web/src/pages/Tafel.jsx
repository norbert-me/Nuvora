// Modul Tafel (Classroom-Screen) — frei platzierbare Textfelder für den Beamer.
// Jedes Feld ist verschiebbar, in der Größe änderbar und hat eine Schriftgröße.
// Reiner Client; der Stand liegt lokal (localStorage), damit er den Reload übersteht.
import { useState, useRef, useEffect } from "react";
import { btnSecondary, cardStyle, CONTROL_R, Icon, ICONS, iconBtn, popoverPanel, toolbarBtn, toolbarIconBtn, COLORS as C, pageFull, SHADOW } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useAktiv } from "../core/modules.js";
import { alsJson, hol, sende } from "../core/melden.js";
import { askConfirm, askPrompt } from "../core/dialog.jsx";
import SuchSelect from "../components/SuchSelect.jsx";
import { hmToMin, minToHm, ymd } from "../core/datum.js";
import { stundenZeit } from "../core/stunden";

const KEY = "nuvora_tafel_v1";
// Stiftfarben der Tafel. Bewusst feste Werte wie ANTWORT_COLORS: die Farbe IST
// die Wahl der Lehrkraft und darf nicht mit dem Design-Theme wandern.
// Ausnahme ist die erste: „Schwarz" ist die Schriftfarbe des Designs — ein
// festes #111827 verschwand im dunklen Design auf der dunklen Fläche.
const COLORS = ["var(--text)", "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed"];
// Bestand: vor dem Wechsel gespeicherte Felder tragen noch das feste Schwarz.
const farbe = (c) => (c === "#111827" ? "var(--text)" : c);
// Feste Referenzfläche (16:9). Alle Element-Koordinaten liegen in diesem Raum;
// die Anzeige skaliert per transform an die tatsächliche Breite.
const REF_W = 1600, REF_H = 900;

// Knopf in der schwebenden Steuerleiste. Nur das Gewicht weicht ab (die Leiste
// liegt ueber der Tafel und muss aus der Entfernung lesbar sein) — Hoehe, Form
// und Groesse kommen aus `toolbarBtn`.
const leistenBtn = { ...toolbarBtn, padding: "0 12px", fontWeight: 700, gap: 4 };

// Alt-Stände lagen in ungefähren Pixeln eines ~1000px breiten Boards. Einmalig
// in den REF-Raum hochskalieren (Faktor ~1.6), danach _ref markiert.
const load = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY)) || [];
    return arr.map((it) => (it._ref ? it : {
      ...it, _ref: true,
      x: (it.x || 0) * 1.6, y: (it.y || 0) * 1.6,
      w: (it.w || 240) * 1.6, h: (it.h || 90) * 1.6,
      fontSize: Math.round((it.fontSize || 28) * 1.6),
    }));
  } catch { return []; }
};

export default function Tafel() {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const kalenderAktiv = aktiv("kalender");
  const [items, setItems] = useState(load);
  const [sel, setSel] = useState(null);
  const outerRef = useRef(null);   // misst die verfügbare Breite, Ziel für Vollbild
  const [scale, setScale] = useState(1); // REF-Koordinaten -> Bildschirm
  const scaleRef = useRef(1);
  const drag = useRef(null); // { id, mode, sx, sy, ox, oy, ow, oh }
  // Steht weit oben, weil die Messung der Flaeche (gleich darunter) davon
  // abhaengt: erst im Vollbild zaehlt die Hoehe mit.
  const [fs, setFs] = useState(false); // Pseudo-Vollbild (iOS kennt kein requestFullscreen für divs)

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* voll — egal */ } }, [items]);

  // Board hat eine feste Referenzgröße (REF_W×REF_H); die Anzeige wird über
  // transform:scale an die Breite angepasst. So bleiben alle Elemente relativ zur
  // Fläche stehen und verschwinden nie unten/rechts, egal wie breit der Bildschirm.
  useEffect(() => {
    const el = outerRef.current; if (!el) return;
    // NUR im Vollbild zaehlt die Hoehe mit — dort gibt `inset: 0` sie vor.
    //
    // Im normalen Fall waere das eine Rueckkopplung: die Hoehe des Rahmens IST
    // `scale * REF_H`, also wuerde eine Messung der Hoehe das Ergebnis
    // beeinflussen, das sie gerade erzeugt hat. Der ResizeObserver feuert dann
    // endlos, `scale` faellt in kleinen Schritten gegen null und springt
    // zurueck; sichtbar ist eine Flaeche, die nie still steht (der
    // Browser-Systemtest brach daran mit „element is not stable" ab). Also:
    // aussen die Breite, im Vollbild beides.
    const measure = () => {
      const w = el.clientWidth || REF_W;
      const h = fs ? el.clientHeight || 0 : 0;
      const s = h ? Math.min(w / REF_W, h / REF_H) : w / REF_W;
      scaleRef.current = s; setScale(s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    document.addEventListener("fullscreenchange", measure);
    return () => { ro.disconnect(); document.removeEventListener("fullscreenchange", measure); };
  }, [fs]);

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const clampX = (x, w) => Math.max(0, Math.min(REF_W - w, x));
  const clampY = (y, h) => Math.max(0, Math.min(REF_H - h, y));
  const add = () => {
    const w = 460, h = 150;
    // fontSize 48 ist ein Wert im REF-Raum der Tafel (Inhalt, keine Bedienung).
    const it = { id: uid(), type: "text", x: (REF_W - w) / 2, y: 120, w, h, text: "", fontSize: 48, color: COLORS[0], _ref: true };
    setItems((p) => [...p, it]); setSel(it.id);
  };
  const addTimer = () => {
    const w = 460, h = 340;
    const it = { id: uid(), type: "timer", x: (REF_W - w) / 2, y: 140, w, h, minutes: 5, _ref: true };
    setItems((p) => [...p, it]); setSel(it.id);
  };
  // Verlaufsplan der laufenden Stunde — nur mit dem Modul Kalender (Regel 3):
  // ohne es gibt es keine Stunde, aus der man ihn lesen koennte.
  const addVerlauf = () => {
    const w = 560, h = 460;
    const it = { id: uid(), type: "verlauf", x: (REF_W - w) / 2, y: 120, w, h, _ref: true };
    setItems((p) => [...p, it]); setSel(it.id);
  };
  // Lautstaerke-Anzeige. Sie misst NUR — nichts wird aufgenommen und nichts
  // verlaesst den Browser (siehe TafelLaerm).
  const addLaerm = () => {
    const w = 520, h = 300;
    const it = { id: uid(), type: "laerm", x: (REF_W - w) / 2, y: 140, w, h, schwelle: 55, _ref: true };
    setItems((p) => [...p, it]); setSel(it.id);
  };
  const patch = (id, o) => setItems((p) => p.map((i) => (i.id === id ? { ...i, ...o } : i)));
  const del = (id) => { setItems((p) => p.filter((i) => i.id !== id)); if (sel === id) setSel(null); };

  const onDown = (e, id, mode) => {
    e.preventDefault(); e.stopPropagation(); setSel(id);
    const it = items.find((i) => i.id === id); if (!it) return;
    drag.current = { id, mode, sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y, ow: it.w, oh: it.h };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    const s = scaleRef.current || 1;
    const dx = (e.clientX - d.sx) / s, dy = (e.clientY - d.sy) / s; // Bildschirm -> REF
    if (d.mode === "move") patch(d.id, { x: clampX(d.ox + dx, d.ow), y: clampY(d.oy + dy, d.oh) });
    else {
      const w = Math.max(140, Math.min(REF_W - d.ox, d.ow + dx));
      const h = Math.max(90, Math.min(REF_H - d.oy, d.oh + dy));
      patch(d.id, { w, h });
    }
  };
  const onUp = () => { drag.current = null; window.removeEventListener("pointermove", onMove); };

  const selItem = items.find((i) => i.id === sel);
  const [fontPop, setFontPop] = useState(false);
  const setFont = (v) => { if (selItem) patch(selItem.id, { fontSize: Math.max(16, Math.min(280, Math.round(v))) }); };
  const bumpFont = (delta) => { if (selItem) setFont((selItem.fontSize || 48) + delta); };
  // Wählt ein Element und holt es nach vorn — so lässt sich bei Überlappung das
  // obere greifen und wegziehen, um das untere freizulegen.
  const select = (id) => {
    setSel(id);
    setItems((p) => { const i = p.findIndex((x) => x.id === id); if (i < 0 || i === p.length - 1) return p; const n = [...p]; const [it] = n.splice(i, 1); n.push(it); return n; });
  };
  // Solange das Vollbild steht, scrollt die Seite dahinter nicht: sonst
  // bewegt eine Wischgeste auf der Tafel den Rahmen darunter, und beim
  // Verlassen steht die Seite woanders.
  useEffect(() => {
    if (!fs) return undefined;
    const vorher = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = vorher; };
  }, [fs]);

  // ── Gespeicherte Tafeln ──
  //
  // Die Flaeche auf dem Bildschirm bleibt die Arbeitsfassung im localStorage
  // (sie ueberlebt das Neuladen, auch ohne dass jemand speichert). Wer eine
  // Tafel behalten will, gibt ihr einen Namen — dann liegt sie am KONTO und
  // ist am Rechner im Klassenraum da. Gespeichert wird auf Knopfdruck, wie
  // ueberall sonst; „automatisch" waere hier besonders falsch, weil die Tafel
  // im Unterricht laufend umgeraeumt wird.
  const [tafeln, setTafeln] = useState([]);
  const [offene, setOffene] = useState("");     // id der geladenen Tafel ("" = Arbeitsfassung)
  const [gespeichert, setGespeichert] = useState(true);
  const tafelnLaden = () => hol("/api/tafel", []).then((d) => setTafeln(Array.isArray(d) ? d : []));
  useEffect(() => { tafelnLaden(); }, []);
  useEffect(() => { setGespeichert(false); }, [items]);

  const tafelOeffnen = async (id) => {
    if (!id) { setOffene(""); return; }
    if (!gespeichert && !(await askConfirm(t("speichern.verlassen")))) return;
    const d = await hol(`/api/tafel/${id}`, null);
    if (!d) return;
    setItems(Array.isArray(d.items) ? d.items : []);
    setSel(null);
    setOffene(String(id));
    setGespeichert(true);
  };
  const tafelSpeichern = async () => {
    if (offene) {
      if (!(await sende(`/api/tafel/${offene}`, alsJson("PUT", { items }), t("tafel.speichern")))) return;
    } else {
      const name = await askPrompt(t("tafel.nameFrage"));
      if (!name || !name.trim()) return;
      const d = await sende("/api/tafel", alsJson("POST", { name: name.trim(), items }), t("tafel.speichern"));
      if (!d) return;
      setOffene(String(d.id));
    }
    setGespeichert(true);
    tafelnLaden();
  };
  const tafelLoeschen = async () => {
    const t2 = tafeln.find((x) => String(x.id) === offene);
    if (!t2 || !(await askConfirm(t("tafel.loeschenFrage", { name: t2.name })))) return;
    if (!(await sende(`/api/tafel/${offene}`, { method: "DELETE" }, t("common.delete")))) return;
    setOffene("");
    tafelnLaden();
  };

  // Beim Auswählen die Farb-/Größen-Optik eingeklappt lassen (erst Stift zeigen).
  useEffect(() => { setFontPop(false); }, [sel]);

  return (
    <div style={{ ...pageFull }}>
      <style>{`@keyframes tafelFlash{0%,100%{background:transparent}50%{background:rgba(220,38,38,0.55)}}.tafel-flash{animation:tafelFlash .5s steps(1) 6}`}</style>
      <Werkzeugleiste
        links={<SuchSelect value={offene} onChange={tafelOeffnen} leerLabel={t("tafel.arbeitsfassung")}
          optionen={tafeln.map((x) => ({ wert: String(x.id), label: x.name }))} style={{ minWidth: 180 }} />}
        mehr={[
          offene && { key: "loeschen", label: t("tafel.loeschen"), icon: ICONS.trash, gefahr: true, onClick: tafelLoeschen },
        ]}>
        <button data-tour="tafel-speichern" onClick={tafelSpeichern} style={toolbarBtn} title={t("tafel.speichern")}>
          <Icon d={ICONS.check} size={15} /> {gespeichert && offene ? t("tafel.gespeichert") : t("tafel.speichern")}
        </button>
        <span style={{ flex: 1 }} />
        {/* Je Elementart ein Symbol, der Name steht im title (Werkzeugleisten-
            Regel). Vier Knöpfe mit „+ Wort" drückten die Leiste in die zweite
            Zeile; das Textfeld bleibt der hervorgehobene Haupthandgriff. */}
        <button data-tour="tafel-text" onClick={add} style={{ ...toolbarIconBtn, background: "var(--text)", borderColor: "var(--text)" }}
          title={t("tafel.add")} aria-label={t("tafel.add")}><Icon d={ICONS.note} size={17} color="var(--bg)" /></button>
        <button data-tour="tafel-timer" onClick={addTimer} className="icon-btn" style={toolbarIconBtn} title={t("tafel.addTimer")} aria-label={t("tafel.addTimer")}>
          <Icon d={ICONS.hourglass} size={17} /></button>
        <button onClick={addLaerm} className="icon-btn" style={toolbarIconBtn} title={t("tafel.addLaerm")} aria-label={t("tafel.addLaerm")}>
          <Icon d={ICONS.volume} size={17} /></button>
        {kalenderAktiv && <button onClick={addVerlauf} className="icon-btn" style={toolbarIconBtn} title={t("tafel.addVerlauf")} aria-label={t("tafel.addVerlauf")}>
          <Icon d={ICONS.clock} size={17} /></button>}
        <button onClick={() => setFs((v) => !v)} className="icon-btn" style={toolbarIconBtn}
          title={fs ? t("common.close") : t("tafel.fullscreen")} aria-label={fs ? t("common.close") : t("tafel.fullscreen")}>
          <Icon d={fs ? ICONS.close : ICONS.fit} size={17} /></button>
      </Werkzeugleiste>

      {/* Tafel-Fläche: äußerer Rahmen misst die Breite, das innere Board hat feste
          Referenzgröße und wird per transform:scale eingepasst. Die Steuerleiste
          schwebt am gewählten Element (kein fester Balken oben). */}
      <div ref={outerRef} onPointerDown={() => setSel(null)}
        style={{ position: "relative", width: "100%",
          // Im Vollbild bestimmt `inset: 0` die Groesse; eine gesetzte Hoehe
          // schluege sie und die Flaeche ragte unten aus dem Bild.
          height: fs ? "auto" : scale * REF_H, border: "1px solid var(--border)", borderRadius: fs ? 0 : cardStyle.borderRadius, background: "var(--card)", overflow: "hidden",
          // `inset: 0` allein — NICHT 100vw/100vh: `100vw` zaehlt die
          // Bildlaufleiste mit, die Flaeche steht dann um deren Breite zu weit
          // rechts, und der Schliessen-Knopf in der Ecke haengt halb
          // ausserhalb. Mit dem Fenster kleiner zu ziehen half nur, weil die
          // Leiste dabei verschwand.
          ...(fs ? { position: "fixed", inset: 0, zIndex: 9999 } : {}) }}>
        {fs && (
          <button onClick={() => setFs(false)}
            style={{ ...toolbarBtn, position: "absolute", zIndex: 20,
              // Am iPad liegt oben rechts die Kamera-Insel bzw. die abgerundete
              // Ecke; `env()` haelt den Knopf davon frei.
              top: "max(12px, env(safe-area-inset-top))",
              right: "max(12px, env(safe-area-inset-right))" }}>
            <Icon d={ICONS.close} size={16} /> {t("common.close")}
          </button>
        )}
        <div style={{ position: "absolute", top: 0, left: 0, width: REF_W, height: REF_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          {items.length === 0 && (
            /* Schriftgroessen INNERHALB der Tafelflaeche stehen im REF-Raum
               (1600x900) und werden mit der Flaeche herunterskaliert — auf dem
               Bildschirm bleiben davon rund 60 %. Sie folgen deshalb bewusst
               nicht der Schriftleiter der Bedienoberflaeche. */
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 28, pointerEvents: "none" }}>{t("tafel.empty")}</div>
          )}
          {items.map((it) => (
            <div key={it.id} onPointerDown={(e) => { e.stopPropagation(); select(it.id); }}
              style={{ position: "absolute", left: it.x, top: it.y, width: it.w, height: it.h,
                border: sel === it.id ? "3px solid var(--accent)" : "2px dashed transparent",
                borderRadius: CONTROL_R, boxSizing: "border-box", background: sel === it.id ? "rgba(10,132,255,0.04)" : "transparent" }}>
              {it.type === "timer" ? (
                <TafelTimer item={it} onPatch={(o) => patch(it.id, o)} t={t} />
              ) : it.type === "laerm" ? (
                <TafelLaerm item={it} onPatch={(o) => patch(it.id, o)} t={t} />
              ) : it.type === "verlauf" ? (
                <TafelVerlauf t={t} />
              ) : (
                <textarea value={it.text} onChange={(e) => patch(it.id, { text: e.target.value })} placeholder={t("tafel.placeholder")} className="keep-fontsize"
                  style={{ width: "100%", height: "100%", boxSizing: "border-box", border: "none", outline: "none", resize: "none", background: "transparent",
                    color: farbe(it.color), fontSize: it.fontSize, fontWeight: 700, lineHeight: 1.15, padding: "18px 16px 12px", overflow: "hidden", fontFamily: "inherit" }} />
              )}
              {/* Größen-Griff unten rechts (groß genug fürs Handy) */}
              <div onPointerDown={(e) => onDown(e, it.id, "resize")}
                style={{ position: "absolute", right: -3, bottom: -3, width: 44, height: 44, cursor: "nwse-resize", display: sel === it.id ? "block" : "none",
                  borderRight: "7px solid var(--accent)", borderBottom: "7px solid var(--accent)", borderBottomRightRadius: CONTROL_R }} />
            </div>
          ))}
        </div>

        {/* Steuerleiste schwebt direkt am gewählten Element (in Bildschirm-Pixeln,
            darum außerhalb der skalierten Fläche gerendert). */}
        {selItem && (() => {
          const ex = selItem.x * scale, ey = selItem.y * scale, eh = selItem.h * scale;
          const top = ey - 52 >= 4 ? ey - 52 : ey + eh + 8; // sonst unter das Element
          return (
            <div onPointerDown={(e) => e.stopPropagation()}
              style={{ ...popoverPanel, position: "absolute", left: Math.max(4, ex), top, zIndex: 10, display: "flex", alignItems: "center", gap: 4, padding: "6px 8px", boxShadow: SHADOW.schwebend, flexWrap: "wrap", maxWidth: "94%" }}>
              {/* Verschieben-Griff (in Bildschirmpixeln — auf dem Handy gut greifbar) */}
              <button onPointerDown={(e) => onDown(e, selItem.id, "move")} className="icon-btn" style={{ ...toolbarIconBtn, border: "1px solid var(--border2)", cursor: "grab", touchAction: "none" }} title={t("tafel.move") || ""} aria-label={t("tafel.move") || ""}>
                <Icon d={ICONS.moveAll} size={18} color="var(--text2)" />
              </button>
              {selItem.type !== "timer" && selItem.type !== "verlauf" && selItem.type !== "laerm" && (<>
                <button onClick={() => setFontPop((v) => !v)} className="icon-btn" style={{ ...toolbarIconBtn, border: fontPop ? "1px solid var(--accent)" : "1px solid var(--border2)" }} title={t("tafel.textSize")} aria-label={t("tafel.textSize")}>
                  <Icon d={ICONS.edit} size={16} color={fontPop ? "var(--accent)" : "var(--text2)"} />
                </button>
                {fontPop && (<>
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => patch(selItem.id, { color: c })} title={t("tafel.color")}
                      style={{ width: 22, height: 22, borderRadius: CONTROL_R, background: c, border: farbe(selItem.color) === c ? "2px solid var(--accent)" : "1px solid var(--border2)", cursor: "pointer" }} />
                  ))}
                  <button onClick={() => bumpFont(-2)} style={leistenBtn} title={t("tafel.textSmaller")} aria-label={t("tafel.textSmaller")}>A<Icon d={ICONS.minus} size={13} color="var(--text2)" /></button>
                  <span style={{ fontSize: 13, minWidth: 40, textAlign: "center", fontWeight: 600 }}>{selItem.fontSize}</span>
                  <button onClick={() => bumpFont(2)} style={leistenBtn} title={t("tafel.textLarger")} aria-label={t("tafel.textLarger")}>A<Icon d={ICONS.plus} size={13} color="var(--text2)" /></button>
                </>)}
              </>)}
              {selItem.type === "laerm" && (<>
                <button onClick={() => patch(selItem.id, { schwelle: Math.max(10, (selItem.schwelle ?? 55) - 5) })} style={leistenBtn}
                  title={t("tafel.laermStrenger")} aria-label={t("tafel.laermStrenger")}><Icon d={ICONS.minus} size={13} color="var(--text2)" /></button>
                <span style={{ fontSize: 13, minWidth: 74, textAlign: "center", fontWeight: 600 }}>{t("tafel.laermSchwelle", { n: selItem.schwelle ?? 55 })}</span>
                <button onClick={() => patch(selItem.id, { schwelle: Math.min(95, (selItem.schwelle ?? 55) + 5) })} style={leistenBtn}
                  title={t("tafel.laermLockerer")} aria-label={t("tafel.laermLockerer")}><Icon d={ICONS.plus} size={13} color="var(--text2)" /></button>
              </>)}
              {selItem.type === "laerm" && !selItem.muted && (
                <button onClick={() => warnton()} style={{ ...leistenBtn, fontWeight: 500 }}
                  title={t("tafel.laermTestHint")}>{t("tafel.laermTest")}</button>
              )}
              {(selItem.type === "timer" || selItem.type === "laerm") && (
                <button onClick={() => patch(selItem.id, { muted: !selItem.muted })} style={{ ...leistenBtn, gap: 4, fontWeight: 500 }}>
                  <Icon d={selItem.muted ? ICONS.volumeOff : ICONS.volume} size={15} color="var(--text2)" />
                  {selItem.muted ? t("tafel.soundOff") : t("tafel.soundOn")}
                </button>
              )}
              <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 2px" }} />
              <button onClick={() => del(selItem.id)} className="icon-btn" style={{ ...iconBtn }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={16} color={C.danger} /></button>
            </div>
          );
        })()}
      </div>
      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 8 }}>{t("tafel.hint")}</p>
    </div>
  );
}

/**
 * Toene auf der Tafel — und der Grund, warum sie einen Kontext MITBRINGEN
 * duerfen.
 *
 * Ein frisch gebauter `AudioContext` startet im Zustand „suspended", wenn ihn
 * keine Nutzergeste ausgeloest hat; er spielt dann still vor sich hin. Beim
 * Timer faellt das kaum auf (der Start-Klick liegt Sekunden zurueck), beim
 * Laermwarner dagegen immer: die Warnung kommt Minuten spaeter und von selbst.
 * Deshalb reicht die Laerm-Anzeige ihren eigenen Kontext herein — der wurde im
 * Klick auf „Messen starten" gebaut und laeuft. `resume()` steht zusaetzlich
 * da, weil der Browser einen laufenden Kontext zwischendurch anhalten darf.
 */
function tonAus(ctx, { typ, hz, mal, an, aus, laut }) {
  try {
    const c = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (c.state === "suspended") c.resume().catch(() => {});
    const o = c.createOscillator(); const g = c.createGain();
    o.connect(g); g.connect(c.destination); o.type = typ; o.frequency.value = hz;
    let ti = c.currentTime; o.start();
    for (let i = 0; i < mal; i++) { g.gain.setValueAtTime(laut, ti); g.gain.setValueAtTime(0.0001, ti + an); ti += an + aus; }
    o.stop(ti + 0.05);
  } catch { /* Ton optional */ }
}

function beep(ctx) {
  tonAus(ctx, { typ: "sine", hz: 880, mal: 3, an: 0.15, aus: 0.15, laut: 0.3 });
}

// Warnton bei zu viel Laerm — bewusst ANDERS als der Timer-Ton: tiefer und
// zweimal kurz. Beide auf derselben Tafel muessen sich unterscheiden lassen,
// ohne hinzusehen („ist die Zeit um oder sind wir zu laut?").
function warnton(ctx) {
  tonAus(ctx, { typ: "triangle", hz: 330, mal: 2, an: 0.22, aus: 0.12, laut: 0.3 });
}

/**
 * Lautstaerke-Anzeige mit Warnton.
 *
 * Vier Entscheidungen:
 *
 * (a) **Das Mikrofon laeuft erst auf Knopfdruck.** Ein Werkzeug, das sich beim
 *     Oeffnen einer Seite selbst einschaltet, hoert im Klassenraum mit, ohne
 *     dass jemand zugestimmt hat. Der Knopf ist die Zustimmung, und der
 *     Browser fragt zusaetzlich.
 * (b) **Es wird NICHTS aufgenommen und nichts verschickt.** Gemessen wird der
 *     Pegel im Browser (AnalyserNode), der Ton selbst wird nirgends
 *     gespeichert. Das steht auch im Feld — eine Datenschutz-Angabe gehoert zu
 *     den Texten, die bleiben duerfen.
 * (c) **Der Warnton kommt erst nach ein paar Sekunden ueber der Schwelle**
 *     (HALTE_S) und danach fruehestens alle RUHE_S wieder. Ein Ton bei jedem
 *     Huster waere nach zwei Minuten abgeschaltet — und eine Klasse, die
 *     dauerpiept, ist lauter als vorher.
 * (d) **Der Balken zeigt den geglaetteten Pegel**, nicht den Augenblickswert:
 *     ein zappelnder Balken laesst sich aus der letzten Reihe nicht lesen.
 */
// Der Ton kommt SOFORT, nicht nach einer Bedenkzeit: wer ihn hoert, soll
// wissen, WORAUF er sich bezieht — drei Sekunden spaeter ist der Moment vorbei,
// und die Klasse sucht den Grund. Eine halbe Sekunde bleibt trotzdem stehen:
// ein einzelner Knall (Buch faellt, Stuhl rueckt) ist keine Lautstaerke.
const LAERM_HALTE_S = 0.5;
// Danach eine Ruhezeit, sonst piept es im Dauerlaerm ununterbrochen — und eine
// Klasse, die dauerpiept, ist lauter als vorher.
const LAERM_RUHE_S = 20;

function TafelLaerm({ item, onPatch, t }) {
  const [an, setAn] = useState(false);
  const [pegel, setPegel] = useState(0);      // 0..100, geglaettet
  const [fehler, setFehler] = useState("");
  const [warnt, setWarnt] = useState(false);
  const technik = useRef(null);               // { stream, ctx, raf }
  const ueber = useRef(0);                    // seit wann ueber der Schwelle (ms)
  const letzteWarnung = useRef(0);
  const schwelle = item.schwelle ?? 55;
  const stumm = !!item.muted;
  // Die Schwelle steckt in einem Ref: die Messschleife laeuft ausserhalb von
  // React und saehe sonst den Wert von ihrem Start.
  const schwelleRef = useRef(schwelle); schwelleRef.current = schwelle;
  const stummRef = useRef(stumm); stummRef.current = stumm;

  const stopp = () => {
    const tk = technik.current;
    if (!tk) return;
    cancelAnimationFrame(tk.raf);
    tk.stream.getTracks().forEach((sp) => sp.stop());
    tk.ctx.close().catch(() => {});
    technik.current = null;
    setAn(false); setPegel(0); setWarnt(false); ueber.current = 0;
  };
  // Das Mikrofon muss auch dann aus, wenn das Feld geloescht oder die Seite
  // verlassen wird — sonst leuchtet die Aufnahme-Anzeige des Browsers weiter.
  useEffect(() => () => stopp(), []);   // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setFehler("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Keine Aufbereitung: die Automatiken regeln genau das weg, was hier
        // gemessen werden soll.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const quelle = ctx.createMediaStreamSource(stream);
      const analyse = ctx.createAnalyser();
      analyse.fftSize = 1024;
      quelle.connect(analyse);
      const puffer = new Float32Array(analyse.fftSize);
      let geglaettet = 0, vorher = performance.now();
      const schleife = () => {
        analyse.getFloatTimeDomainData(puffer);
        let summe = 0;
        for (let i = 0; i < puffer.length; i++) summe += puffer[i] * puffer[i];
        const rms = Math.sqrt(summe / puffer.length);
        // dBFS auf 0..100: -60 dB (sehr leise) bis -10 dB (sehr laut).
        const db = 20 * Math.log10(Math.max(rms, 1e-7));
        const roh = Math.max(0, Math.min(100, ((db + 60) / 50) * 100));
        geglaettet = geglaettet * 0.85 + roh * 0.15;
        const wert = Math.round(geglaettet);
        setPegel(wert);

        const jetzt = performance.now();
        const delta = jetzt - vorher; vorher = jetzt;
        if (wert >= schwelleRef.current) {
          ueber.current += delta;
          if (ueber.current >= LAERM_HALTE_S * 1000 && jetzt - letzteWarnung.current >= LAERM_RUHE_S * 1000) {
            letzteWarnung.current = jetzt;
            ueber.current = 0;
            setWarnt(true);
            setTimeout(() => setWarnt(false), 4000);
            if (!stummRef.current) warnton(technik.current && technik.current.ctx);
          }
        } else {
          ueber.current = 0;
        }
        technik.current.raf = requestAnimationFrame(schleife);
      };
      technik.current = { stream, ctx, raf: 0 };
      setAn(true);
      technik.current.raf = requestAnimationFrame(schleife);
    } catch {
      // Abgelehnt, kein Mikrofon, oder unsicherer Kontext (http): alle drei
      // enden hier, und alle drei helfen mit demselben Satz.
      setFehler(t("tafel.laermKeinMikro"));
    }
  };

  const farbe = pegel >= schwelle ? C.danger : pegel >= schwelle * 0.75 ? C.warning : C.success;
  const bh = item.h || 300;
  return (
    <div className={warnt ? "tafel-flash" : ""}
      style={{ width: "100%", height: "100%", boxSizing: "border-box", borderRadius: CONTROL_R,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "20px 18px" }}>
      {/* Der Balken ist die Anzeige — die Zahl daneben ist fuer die Lehrkraft,
          die Klasse liest die Farbe. */}
      <div style={{ position: "relative", width: "100%", height: Math.max(40, bh * 0.28), background: "var(--bg2)", borderRadius: CONTROL_R, overflow: "hidden" }}>
        <div style={{ width: `${pegel}%`, height: "100%", background: farbe, transition: "width .12s linear, background .2s" }} />
        {/* Die Schwelle als Strich: man sieht, wie weit es noch hin ist. */}
        <div style={{ position: "absolute", left: `${schwelle}%`, top: 0, bottom: 0, width: 4, background: "var(--text)", opacity: 0.55 }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
        {!an
          ? <button onClick={start} style={miniBtn}>{t("tafel.laermStart")}</button>
          : <button onClick={stopp} style={miniBtn}>{t("tafel.laermStop")}</button>}
        {an && <span style={{ fontSize: 34, fontWeight: 800, color: farbe, fontVariantNumeric: "tabular-nums", minWidth: 90, textAlign: "center" }}>{pegel}</span>}
      </div>
      {fehler && <div style={{ fontSize: 24, color: C.danger, textAlign: "center" }}>{fehler}</div>}
      {/* Datenschutz-Angabe: sie sagt etwas, das man dem Bildschirm nicht
          ansieht, und bleibt deshalb stehen. */}
      <div style={{ fontSize: 22, color: "var(--text3)", textAlign: "center", lineHeight: 1.3 }}>{t("tafel.laermHinweis")}</div>
    </div>
  );
}

// Countdown-Widget auf der Tafel. Zeit skaliert mit der Feldhöhe; die eingestellte
// Minutenzahl wird gespeichert (onMinutes), der Lauf selbst ist flüchtig.
function TafelTimer({ item, onPatch, t }) {
  const total = Math.max(1, item.minutes || 5) * 60;
  const [remaining, setRemaining] = useState(total);
  const [running, setRunning] = useState(false);
  const [flash, setFlash] = useState(false); // Aufblitzen am Ende
  const tick = useRef(null);
  // Ein im START-Klick gebauter Tonkontext. Ein erst beim Ablauf erzeugter
  // startet je nach Browser „suspended" und bleibt still — genau der Fehler,
  // der beim Laermwarner auffiel (dort immer, hier nur manchmal).
  const tonCtx = useRef(null);
  useEffect(() => () => { if (tonCtx.current) tonCtx.current.close().catch(() => {}); }, []);
  const tonBereit = () => {
    if (!tonCtx.current) {
      try { tonCtx.current = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ohne Ton */ }
    }
    if (tonCtx.current && tonCtx.current.state === "suspended") tonCtx.current.resume().catch(() => {});
  };
  useEffect(() => { setRemaining(total); setRunning(false); setFlash(false); }, [total]);
  useEffect(() => {
    if (!running) return;
    tick.current = setInterval(() => setRemaining((r) => {
      if (r <= 1) { setRunning(false); if (!item.muted) beep(tonCtx.current); setFlash(true); setTimeout(() => setFlash(false), 3000); return 0; }
      return r - 1;
    }), 1000);
    return () => clearInterval(tick.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const done = remaining === 0;
  const bump = (d) => onPatch({ minutes: Math.max(1, Math.min(180, (item.minutes || 5) + d)) });
  const bh = item.h || 150;
  return (
    <div className={flash ? "tafel-flash" : ""} style={{ width: "100%", height: "100%", boxSizing: "border-box", borderRadius: CONTROL_R, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "22px 12px 16px" }}>
      <div style={{ fontSize: Math.max(28, Math.min(bh * 0.42, item.w * 0.32)), fontWeight: 800, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: done ? C.danger : "var(--text)" }}>{fmt(remaining)}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={() => bump(-1)} style={{ ...miniBtn }} title={t("tafel.timerLess")} aria-label={t("tafel.timerLess")}><Icon d={ICONS.minus} size={30} color="var(--text)" /></button>
        {/* 30 px im REF-Raum der Tafel (~18 px auf dem Bildschirm) — Inhalt der
            Projektionsflaeche, nicht der Bedienoberflaeche. */}
        <span style={{ fontSize: 30, color: "var(--text2)", minWidth: 120, textAlign: "center", fontWeight: 600 }}>{item.minutes || 5} {t("tafel.min")}</span>
        <button onClick={() => bump(1)} style={{ ...miniBtn }} title={t("tafel.timerMore")} aria-label={t("tafel.timerMore")}><Icon d={ICONS.plus} size={30} color="var(--text)" /></button>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        {!running
          ? <button onClick={() => { if (!done) { tonBereit(); setRunning(true); } }} disabled={done} style={{ ...miniBtn, opacity: done ? 0.5 : 1 }} title={t("tafel.timerStart")} aria-label={t("tafel.timerStart")}><Icon d={ICONS.play} size={30} color="var(--text)" /></button>
          : <button onClick={() => setRunning(false)} style={{ ...miniBtn }} title={t("tafel.timerPause")} aria-label={t("tafel.timerPause")}><Icon d={ICONS.pause} size={30} color="var(--text)" /></button>}
        <button onClick={() => { setRunning(false); setRemaining(total); }} style={{ ...miniBtn }} title={t("tafel.timerReset")} aria-label={t("tafel.timerReset")}><Icon d={ICONS.refresh} size={30} color="var(--text)" /></button>
      </div>
    </div>
  );
}

// Timer-Knopf auf der Tafelfläche: bewusst groß (er steht im REF-Raum der
// Tafel und wird mit ihr herunterskaliert), aber aus btnSecondary abgeleitet
// statt frei erfunden.
const miniBtn = {
  ...btnSecondary, padding: "8px 22px", fontSize: 32, lineHeight: 1,
  border: "2px solid var(--border2)", borderRadius: CONTROL_R, background: "var(--bg)",
  display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
};

// Der Verlaufsplan der Stunde, die GERADE laeuft — aus dem Kalender gelesen,
// nicht abgetippt. Hervorgehoben ist die Phase, in der man steckt, samt
// Restzeit; das beantwortet an der Tafel die eine Frage, die im Unterricht
// zaehlt („wie lange noch?"), und die Kinder sehen sie mit.
//
// Welche Stunde gemeint ist, entscheidet die Uhr: der Eintrag von heute, dessen
// Zeitfenster jetzt enthaelt (eigene Zeit vor der Zeit seiner Stunde — dieselbe
// Regel wie im Kalender und im ICS-Feed). Gibt es keine, sagt das Feld das,
// statt eine beliebige Stunde zu zeigen.
function TafelVerlauf({ t }) {
  const [data, setData] = useState(null);   // { entries, times, zero }
  const [jetzt, setJetzt] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  useEffect(() => {
    const id = setInterval(() => { const d = new Date(); setJetzt(d.getHours() * 60 + d.getMinutes()); }, 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let ab = false;
    const laden = async () => {
      const heute = new Date();
      const frm = new Date(heute); frm.setHours(0, 0, 0, 0);
      const to = new Date(heute); to.setHours(23, 59, 59, 0);
      const j = (r) => (r.ok ? r.json() : null);
      const [tt, entries] = await Promise.all([
        fetch("/api/kalender/timetable").then(j).catch(() => null),
        fetch(`/api/kalender/entries?frm=${frm.toISOString()}&to=${to.toISOString()}`).then(j).catch(() => null),
      ]);
      if (!ab) setData({ entries: Array.isArray(entries) ? entries : [], times: tt?.times || [], zero: tt?.zero || null });
    };
    laden();
    // Der Plan kann sich waehrend der Stunde aendern (Kalender in einem zweiten
    // Fenster). Alle fuenf Minuten nachsehen reicht — die Uhr laeuft ohnehin.
    const id = setInterval(laden, 300000);
    return () => { ab = true; clearInterval(id); };
  }, []);

  const fenster = (e) => {
    const st = stundenZeit(data.times, data.zero, e.period);
    const von = hmToMin(e.start_time) ?? (st ? hmToMin(st.start) : null);
    const bis = hmToMin(e.end_time) ?? (st ? hmToMin(st.end) : null);
    return { von, bis };
  };
  const heuteStr = ymd(new Date());
  const laufend = !data ? null : (data.entries || [])
    .filter((e) => String(e.date || "").slice(0, 10) === heuteStr)
    .map((e) => ({ e, ...fenster(e) }))
    .filter((x) => x.von != null && x.bis != null && jetzt >= x.von && jetzt < x.bis)
    .sort((a, b) => a.von - b.von)[0];

  const rahmen = { width: "100%", height: "100%", boxSizing: "border-box", padding: "18px 20px", overflow: "hidden" };
  if (!data) return <div style={rahmen} />;
  if (!laufend) return <div style={{ ...rahmen, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 28, textAlign: "center" }}>{t("tafel.verlaufKeineStunde")}</div>;

  const plan = Array.isArray(laufend.e.verlaufsplan) ? laufend.e.verlaufsplan : [];
  if (!plan.length) return <div style={{ ...rahmen, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 28, textAlign: "center" }}>{t("tafel.verlaufKeinPlan")}</div>;

  // Die Phasen liegen ab dem Beginn der Stunde hintereinander — dieselbe
  // Rechnung wie im Kalender-Dialog.
  let cur = laufend.von;
  const zeilen = plan.map((p) => {
    const d = Number(p.dauer);
    const von = cur;
    const bis = Number.isFinite(d) && d > 0 ? von + d : null;
    if (bis != null) cur = bis;
    return { p, von, bis };
  });
  const aktivI = zeilen.findIndex((z) => jetzt >= z.von && (z.bis == null || jetzt < z.bis));

  return (
    <div style={rahmen}>
      <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text3)", marginBottom: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {laufend.e.title || ""} {minToHm(laufend.von)}–{minToHm(laufend.bis)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {zeilen.map((z, i) => {
          const an = i === aktivI;
          const rest = an && z.bis != null ? Math.max(0, z.bis - jetzt) : null;
          return (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "8px 12px", borderRadius: CONTROL_R,
              background: an ? "rgba(10,132,255,0.12)" : "transparent",
              border: an ? "3px solid var(--accent)" : "3px solid transparent",
              opacity: aktivI >= 0 && i < aktivI ? 0.45 : 1 }}>
              <span style={{ fontSize: 26, color: "var(--text3)", minWidth: 150, fontVariantNumeric: "tabular-nums" }}>
                {minToHm(z.von)}{z.bis != null ? `–${minToHm(z.bis)}` : ""}
              </span>
              <span style={{ fontSize: 34, fontWeight: an ? 800 : 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {z.p.phase || z.p.text || "—"}
              </span>
              {rest != null && <span style={{ fontSize: 30, fontWeight: 800, color: "var(--accent)", whiteSpace: "nowrap" }}>{t("tafel.verlaufRest", { min: rest })}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
