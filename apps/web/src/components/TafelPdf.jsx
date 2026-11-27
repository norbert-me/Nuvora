// PDF auf der Tafel: Seiten untereinander zum Scrollen, darueber eine Zeichenebene je Seite.
//
// Die Datei liegt in der Ablage (Material mit `tafel_id`), das Element merkt sich nur `material_id` und die
// Striche je Seite (`striche: {"1": [{c, w, p: [x, y, …]}]}`, Koordinaten 0..1 der Seite — so passen sie bei jeder
// Groesse des Feldes). Gezeichnet wird als SVG, nicht ins Bild: ein Strich laesst sich einzeln wegradieren.
// PowerPoint kann der Browser nicht darstellen — dafuer in PowerPoint „Als PDF speichern".
//
// pdf.js wird erst geladen, wenn ein PDF-Feld auf der Tafel liegt (eigener Chunk), und laeuft ohne eval
// (CSP: script-src 'self').
import { useEffect, useRef, useState } from "react";
import { CONTROL_R, COLORS as C, ICONS, Icon, Segment, segmentBtn } from "./Icons.jsx";

const FARBEN = ["#d11a2a", "#1d4ed8", "#111111", "#16a34a", "#f5c400"];

let pdfjsLaden = null;
async function pdfjs() {
  if (!pdfjsLaden) {
    pdfjsLaden = Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]).then(([lib, worker]) => { lib.GlobalWorkerOptions.workerSrc = worker.default; return lib; });
  }
  return pdfjsLaden;
}

export default function TafelPdf({ item, t, onPatch }) {
  const [doc, setDoc] = useState(null);
  const [fehler, setFehler] = useState("");
  const [werkzeug, setWerkzeug] = useState("zeigen");   // zeigen | stift | marker | radierer
  const [farbe, setFarbe] = useState(FARBEN[0]);
  const rahmen = useRef(null);
  const [breite, setBreite] = useState(800);
  const striche = item.striche || {};

  // Datei holen und oeffnen — einmal je Material.
  useEffect(() => {
    let ab = false;
    setDoc(null); setFehler("");
    if (!item.material_id) return undefined;
    (async () => {
      try {
        const r = await fetch(`/api/material/${item.material_id}/download`);
        if (!r.ok) throw new Error(String(r.status));
        const daten = new Uint8Array(await r.arrayBuffer());
        const lib = await pdfjs();
        const d = await lib.getDocument({ data: daten, isEvalSupported: false, useSystemFonts: true }).promise;
        if (!ab) setDoc(d);
      } catch {
        if (!ab) setFehler(t("tafel.pdfFehler"));
      }
    })();
    return () => { ab = true; };
  }, [item.material_id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Breite des Feldes beobachten: die Seiten werden in dieser Breite gezeichnet.
  useEffect(() => {
    const el = rahmen.current;
    if (!el) return undefined;
    const beob = new ResizeObserver(() => setBreite(Math.max(200, Math.round(el.clientWidth))));
    beob.observe(el);
    return () => beob.disconnect();
  }, []);

  const strichSetzen = (seite, liste) => onPatch({ striche: { ...striche, [seite]: liste } });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--card)", borderRadius: CONTROL_R, overflow: "hidden" }}>
      {/* Werkzeuge: pointerdown nicht weitergeben — sonst waehlt/zieht der Klick das Feld. */}
      <div onPointerDown={(e) => e.stopPropagation()}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <Segment>
          {[["zeigen", "tafel.pdfZeigen"], ["stift", "tafel.pdfStift"], ["marker", "tafel.pdfMarker"], ["radierer", "tafel.pdfRadierer"]].map(([k, l]) => (
            <button key={k} onClick={() => setWerkzeug(k)} aria-pressed={werkzeug === k}
              style={{ ...segmentBtn, fontWeight: werkzeug === k ? 700 : 500, color: werkzeug === k ? "var(--accent)" : "var(--text2)" }}>{t(l)}</button>
          ))}
        </Segment>
        {(werkzeug === "stift" || werkzeug === "marker") && FARBEN.map((f) => (
          <button key={f} onClick={() => setFarbe(f)} aria-label={f} aria-pressed={farbe === f}
            style={{ width: 24, height: 24, borderRadius: 12, background: f, cursor: "pointer",
              border: farbe === f ? "3px solid var(--accent)" : "2px solid var(--border2)" }} />
        ))}
        {Object.values(striche).some((l) => l && l.length) && (
          <button onClick={() => onPatch({ striche: {} })} title={t("tafel.pdfAllesWeg")} aria-label={t("tafel.pdfAllesWeg")}
            style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer", color: C.danger, display: "inline-flex" }}>
            <Icon d={ICONS.trash} size={16} color={C.danger} />
          </button>
        )}
      </div>
      <div ref={rahmen} onPointerDown={(e) => { if (werkzeug !== "zeigen") e.stopPropagation(); }}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", background: "var(--bg2)" }}>
        {fehler && <p style={{ padding: 16, color: C.danger }}>{fehler}</p>}
        {!doc && !fehler && <p style={{ padding: 16, color: "var(--text3)" }}>{t("common.loading")}</p>}
        {doc && Array.from({ length: doc.numPages }, (_, i) => (
          <PdfSeite key={i + 1} doc={doc} nr={i + 1} breite={breite} werkzeug={werkzeug} farbe={farbe}
            striche={striche[String(i + 1)] || []} onStriche={(l) => strichSetzen(String(i + 1), l)} />
        ))}
      </div>
    </div>
  );
}

function PdfSeite({ doc, nr, breite, werkzeug, farbe, striche, onStriche }) {
  const canvas = useRef(null);
  const [verh, setVerh] = useState(1.414);   // Hoehe / Breite
  const [laufend, setLaufend] = useState(null);   // Strich im Entstehen
  const svg = useRef(null);

  useEffect(() => {
    let ab = false, aufgabe = null;
    (async () => {
      const seite = await doc.getPage(nr);
      if (ab) return;
      const roh = seite.getViewport({ scale: 1 });
      setVerh(roh.height / roh.width);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = seite.getViewport({ scale: (breite / roh.width) * dpr });
      const c = canvas.current;
      if (!c) return;
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      aufgabe = seite.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: vp });
      try { await aufgabe.promise; } catch { /* abgebrochen: neue Breite */ }
    })();
    return () => { ab = true; if (aufgabe) aufgabe.cancel(); };
  }, [doc, nr, breite]);

  const punkt = (e) => {
    const r = svg.current.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * verh];
  };
  const zeichnet = werkzeug === "stift" || werkzeug === "marker";
  const runter = (e) => {
    if (werkzeug === "zeigen") return;
    e.preventDefault(); e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* egal */ }
    if (zeichnet) {
      const [x, y] = punkt(e);
      setLaufend({ c: farbe, w: werkzeug === "marker" ? 18 : 3, a: werkzeug === "marker" ? 0.35 : 1, p: [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000] });
    } else radieren(e);
  };
  const bewegen = (e) => {
    if (laufend) {
      const [x, y] = punkt(e);
      setLaufend((l) => (l ? { ...l, p: [...l.p, Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000] } : l));
    } else if (werkzeug === "radierer" && e.buttons) radieren(e);
  };
  const hoch = () => {
    if (laufend && laufend.p.length >= 4) onStriche([...striche, { c: laufend.a < 1 ? `${laufend.c}59` : laufend.c, w: laufend.w, p: laufend.p }]);
    setLaufend(null);
  };
  // Radieren: jeder Strich, dessen Punkte nahe am Zeiger liegen, faellt weg (Strich fuer Strich, nicht Pixel).
  const radieren = (e) => {
    const [x, y] = punkt(e);
    const nah = 0.02;
    const rest = striche.filter((s) => { for (let i = 0; i < s.p.length; i += 2) if (Math.abs(s.p[i] - x) < nah && Math.abs(s.p[i + 1] - y) < nah) return false; return true; });
    if (rest.length !== striche.length) onStriche(rest);
  };
  const pfad = (p) => p.reduce((acc, v, i) => (i % 2 ? `${acc},${v * 1000}` : `${acc}${i ? " " : ""}${v * 1000}`), "");

  return (
    <div style={{ position: "relative", width: "100%", margin: "0 0 8px", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.15)" }}>
      <canvas ref={canvas} style={{ display: "block", width: "100%", height: "auto" }} />
      <svg ref={svg} viewBox={`0 0 1000 ${verh * 1000}`} preserveAspectRatio="none"
        onPointerDown={runter} onPointerMove={bewegen} onPointerUp={hoch} onPointerCancel={hoch}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: werkzeug === "zeigen" ? "auto" : "none",
          pointerEvents: werkzeug === "zeigen" ? "none" : "auto", cursor: werkzeug === "radierer" ? "cell" : zeichnet ? "crosshair" : "default" }}>
        {[...striche, ...(laufend ? [{ ...laufend, c: laufend.a < 1 ? `${laufend.c}59` : laufend.c }] : [])].map((s, i) => (
          <polyline key={i} points={pfad(s.p)} fill="none" stroke={s.c} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
    </div>
  );
}
