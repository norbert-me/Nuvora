import { useRef, useEffect } from "react";

// KaTeX lokal gebundelt statt CDN (DSGVO: keine IP-Uebermittlung an jsdelivr).
// Lazy geladen: der grosse KaTeX-Chunk kommt nur ueber die Leitung, wenn
// tatsaechlich eine Formel ($...$) gerendert wird.
let katexPromise = null;
function loadKatex() {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import("katex"),
      import("katex/dist/katex.min.css"),
    ]).then(([mod]) => mod.default);
  }
  return katexPromise;
}

export default function Latex({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    const text = children || "";
    if (!ref.current) return;
    if (!text.includes("$")) return; // kein LaTeX -> Klartext reicht, KaTeX nicht laden

    let cancelled = false;
    loadKatex().then((katex) => {
      if (cancelled || !ref.current) return;
      const parts = text.split(/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g);
      ref.current.innerHTML = "";
      parts.forEach((part) => {
        if (part.startsWith("$$") && part.endsWith("$$")) {
          const span = document.createElement("div");
          try { katex.render(part.slice(2, -2), span, { displayMode: true, throwOnError: false }); } catch {}
          ref.current.appendChild(span);
        } else if (part.startsWith("$") && part.endsWith("$")) {
          const span = document.createElement("span");
          try { katex.render(part.slice(1, -1), span, { throwOnError: false }); } catch {}
          ref.current.appendChild(span);
        } else {
          ref.current.appendChild(document.createTextNode(part));
        }
      });
    });
    return () => { cancelled = true; };
  }, [children]);
  return <span ref={ref}>{children}</span>;
}
