// Karteikarten-Ansicht mit fixer Größe: optionales Bild oben-zentral, Text
// darunter. Mit oder ohne Bild bleibt die Karte gleich groß. Klick aufs Bild
// öffnet es groß (Lightbox). imageUrl muss direkt in <img src> nutzbar sein
// (SuS: Token-URL; Lehrkraft: über AuthImage ein Object-URL).
import { useState } from "react";
import { cardStyle, CONTROL_R, modalOverlay } from "./Icons.jsx";

export default function CardFace({ imageUrl = null, text = "" }) {
  const [zoom, setZoom] = useState(false);
  return (
    <div style={{ ...cardStyle, width: "100%", height: 300, display: "flex", flexDirection: "column",
      padding: 0, overflow: "hidden" }}>
      {imageUrl && (
        <div style={{ flex: "0 0 150px", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 12, borderBottom: "1px solid var(--border)", background: "var(--bg2, var(--bg))" }}>
          <img src={imageUrl} alt="" onClick={(e) => { e.stopPropagation(); setZoom(true); }}
            style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", cursor: "zoom-in", borderRadius: CONTROL_R }} />
        </div>
      )}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
        padding: 16, fontSize: 16, lineHeight: 1.5, whiteSpace: "pre-wrap", overflow: "auto", minHeight: 0 }}>
        {text}
      </div>
      {zoom && imageUrl && (
        // Dunkler als modalOverlay: vor einem Bild soll die Seite ganz zuruecktreten.
        <div onClick={(e) => { e.stopPropagation(); setZoom(false); }}
          style={{ ...modalOverlay, background: "rgba(0,0,0,0.86)", cursor: "zoom-out" }}>
          <img src={imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}
