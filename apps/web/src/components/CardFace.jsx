// Karteikarten-Ansicht mit fixer Größe: optionales Bild oben-zentral, Text
// darunter. Mit oder ohne Bild bleibt die Karte gleich groß. Klick aufs Bild
// öffnet es groß (Lightbox). imageUrl muss direkt in <img src> nutzbar sein
// (SuS: Token-URL; Lehrkraft: über AuthImage ein Object-URL).
import { useState } from "react";

export default function CardFace({ imageUrl = null, text = "" }) {
  const [zoom, setZoom] = useState(false);
  return (
    <div style={{ width: "100%", height: 300, display: "flex", flexDirection: "column",
      border: "1px solid var(--border)", borderRadius: 18, background: "var(--card)", overflow: "hidden" }}>
      {imageUrl && (
        <div style={{ flex: "0 0 150px", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 10, borderBottom: "1px solid var(--border)", background: "var(--bg2, var(--bg))" }}>
          <img src={imageUrl} alt="" onClick={(e) => { e.stopPropagation(); setZoom(true); }}
            style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", cursor: "zoom-in", borderRadius: 8 }} />
        </div>
      )}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center",
        padding: 20, fontSize: 19, lineHeight: 1.5, whiteSpace: "pre-wrap", overflow: "auto", minHeight: 0 }}>
        {text}
      </div>
      {zoom && imageUrl && (
        <div onClick={(e) => { e.stopPropagation(); setZoom(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.86)", display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 1000, padding: 20, cursor: "zoom-out" }}>
          <img src={imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
      )}
    </div>
  );
}
