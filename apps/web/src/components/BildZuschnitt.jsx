// Ein Bild auf ein QUADRAT bringen — automatisch, mit der Möglichkeit,
// nachzuhelfen.
//
// Schülerfotos kommen aus der Kamera im Hochformat oder als Ausschnitt eines
// Gruppenbilds. Ungeschnitten stauchte die Anzeige sie in ihr quadratisches
// Feld (`object-fit: cover` schneidet mittig ab) — und mittig ist bei einem
// Porträt selten das Gesicht. Deshalb: der größte mittige Ausschnitt ist
// vorgeschlagen, verschieben und zoomen geht mit der Maus bzw. dem Finger.
//
// Zugeschnitten wird im Browser (Canvas), hochgeladen wird nur das Quadrat:
// das spart Übertragung und der Server bekommt genau das, was auch angezeigt
// wird — kein zweiter Zuschnitt an anderer Stelle mit anderem Ergebnis.
import { useEffect, useRef, useState } from "react";
import { btnPrimary, btnSecondary, DialogKopf, Modal, panelStyle } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const KANTE = 512;   // Kantenlänge des Ergebnisses in Pixeln

export default function BildZuschnitt({ datei, onFertig, onAbbruch }) {
  const { t } = useLanguage();
  const [bild, setBild] = useState(null);       // HTMLImageElement
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // Verschiebung in Anzeige-Pixeln
  const flaeche = 300;                           // Kantenlänge der Vorschau
  const zieh = useRef(null);

  useEffect(() => {
    if (!datei) return;
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => { setBild(img); setZoom(1); setPos({ x: 0, y: 0 }); };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [datei]);

  if (!datei) return null;

  // Der Maßstab, bei dem das Bild die Vorschau gerade ausfüllt — darunter
  // entstünden Ränder, und ein Foto mit weißem Rand will niemand.
  const basis = bild ? Math.max(flaeche / bild.width, flaeche / bild.height) : 1;
  const bw = bild ? bild.width * basis * zoom : 0;
  const bh = bild ? bild.height * basis * zoom : 0;
  const grenze = (p) => ({
    x: Math.min(0, Math.max(flaeche - bw, p.x)),
    y: Math.min(0, Math.max(flaeche - bh, p.y)),
  });

  const start = (e) => {
    zieh.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const ziehen = (e) => {
    const z = zieh.current;
    if (!z) return;
    setPos(grenze({ x: z.px + (e.clientX - z.x), y: z.py + (e.clientY - z.y) }));
  };
  const ende = () => { zieh.current = null; };

  const uebernehmen = () => {
    if (!bild) return;
    const c = document.createElement("canvas");
    c.width = KANTE; c.height = KANTE;
    const ctx = c.getContext("2d");
    // Von der Anzeige auf das Original umrechnen: was im Rahmen steht, wird
    // gezeichnet — derselbe Ausschnitt, nur in voller Auflösung.
    const f = KANTE / flaeche;
    ctx.drawImage(bild, pos.x * f, pos.y * f, bw * f, bh * f);
    c.toBlob((blob) => {
      if (!blob) { onAbbruch?.(); return; }
      onFertig(new File([blob], (datei.name || "foto").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
    }, "image/jpeg", 0.9);
  };

  return (
    <Modal onClose={onAbbruch} width={360} label={t("classes.cropTitle")}>
      <DialogKopf titel={t("classes.cropTitle")} onClose={onAbbruch} schliessenLabel={t("common.close")} />
      <div onPointerDown={start} onPointerMove={ziehen} onPointerUp={ende} onPointerCancel={ende}
        style={{ width: flaeche, height: flaeche, maxWidth: "100%", margin: "0 auto 12px", position: "relative",
          overflow: "hidden", borderRadius: panelStyle.borderRadius, background: "var(--bg2)", cursor: "grab", touchAction: "none" }}>
        {bild && (
          <img src={bild.src} alt="" draggable={false}
            style={{ position: "absolute", left: pos.x, top: pos.y, width: bw, height: bh, userSelect: "none" }} />
        )}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text2)", marginBottom: 12 }}>
        {t("classes.cropZoom")}
        <input type="range" min="1" max="3" step="0.01" value={zoom} style={{ flex: 1 }}
          onChange={(e) => { const z = Number(e.target.value); setZoom(z); setPos((p) => grenze(p)); }} />
      </label>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onAbbruch} style={btnSecondary}>{t("common.abort")}</button>
        <button onClick={uebernehmen} disabled={!bild} style={{ ...btnPrimary, opacity: bild ? 1 : 0.5 }}>
          {t("classes.cropUse")}
        </button>
      </div>
    </Modal>
  );
}
