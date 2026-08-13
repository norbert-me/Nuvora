// Ein Vorschaubild, das sich anklicken lässt: Klick zeigt es gross.
//
// Für **öffentlich erreichbare** Bilder (`/api/uploads/...` ist ein
// StaticFiles-Mount). Liegt das Bild hinter einem angemeldeten Endpunkt, ist
// `AuthImage` zuständig — das holt es per fetch, damit der Token mitgeht.
//
// Warum überhaupt: die Vorschau im Frage-Editor ist 60 px hoch. Eine
// Dreieckszeichnung mit Winkelangaben ist darin nicht lesbar, und ohne Zoom
// bleibt nur „Bild ändern" und hoffen, dass es das richtige war.
import { useEffect, useState } from "react";

export default function ZoomImage({ src, alt = "", style, title }) {
  const [zoom, setZoom] = useState(false);

  // Escape schliesst, und jeder Klick im Overlay auch — auf dem Bild wie
  // daneben. Was per Klick aufgegangen ist, geht per Klick wieder zu; ein Bild,
  // das den Klick schluckt, laesst einen kurz suchen, wo man hindrücken muss.
  useEffect(() => {
    if (!zoom) return;
    const zu = (e) => { if (e.key === "Escape") setZoom(false); };
    window.addEventListener("keydown", zu);
    return () => window.removeEventListener("keydown", zu);
  }, [zoom]);

  if (!src) return null;
  return (
    <>
      <img src={src} alt={alt} title={title} onClick={() => setZoom(true)}
        style={{ cursor: "zoom-in", ...style }} />
      {zoom && (
        <div onClick={() => setZoom(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.86)", display: "flex",
            alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20, cursor: "zoom-out" }}>
          <img src={src} alt={alt}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", cursor: "zoom-out" }} />
        </div>
      )}
    </>
  );
}
