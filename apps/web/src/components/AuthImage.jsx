// <img> für geschützte Endpoints: ein normales src schickt den Bearer-Token
// nicht mit, darum holen wir das Bild per fetch (globaler Interceptor hängt den
// Token an) und zeigen es über einen Object-URL. Klick öffnet es groß.
import { useState, useEffect } from "react";

export default function AuthImage({ src, alt = "", style, zoomable = true, reloadKey }) {
  const [url, setUrl] = useState(null);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    let tot = true; let obj = null;
    setUrl(null);
    fetch(src).then((r) => (r.ok ? r.blob() : null)).then((b) => {
      if (!tot || !b) return;
      obj = URL.createObjectURL(b); setUrl(obj);
    }).catch(() => {});
    return () => { tot = false; if (obj) URL.revokeObjectURL(obj); };
  }, [src, reloadKey]);
  if (!url) return null;
  return (
    <>
      <img src={url} alt={alt} onClick={zoomable ? () => setZoom(true) : undefined}
        style={{ cursor: zoomable ? "zoom-in" : undefined, ...style }} />
      {zoom && (
        <div onClick={() => setZoom(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.86)", display: "flex", alignItems: "center",
            justifyContent: "center", zIndex: 1000, padding: 20, cursor: "zoom-out" }}>
          <img src={url} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        </div>
      )}
    </>
  );
}
