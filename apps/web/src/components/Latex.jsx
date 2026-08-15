import { useRef, useEffect } from "react";
import { COLORS } from "./Icons.jsx";

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

// KaTeX kennt `array` (mit \hline und |-Trennern), aber KEIN `tabular` — das
// gehoert zum LaTeX-Paket und nicht zum Formelsatz. Wer eine Tabelle aus einem
// Dokument oder einer KI-Antwort herueberkopiert, bringt fast immer `tabular`
// mit und sah bisher: nichts. Die Umschreibung ist verlustfrei, solange die
// Spaltenangabe dieselbe Form hat (`{|c|c|}`, `{cc}`) — das ist bei allem der
// Fall, was KaTeX ueberhaupt darstellen koennte.
function vorbereiten(tex) {
  return tex
    .replace(/\\begin\{tabular\}/g, "\\begin{array}")
    .replace(/\\end\{tabular\}/g, "\\end{array}");
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

      // Was KaTeX nicht kann, wird als Quelltext gezeigt — nicht verschluckt.
      // Ein leerer Fleck laesst die Lehrkraft raten, ob die Formel fehlt oder
      // die Anzeige kaputt ist; der Quelltext sagt, was zu reparieren ist.
      const rendern = (quelle, ziel, displayMode) => {
        try {
          katex.render(vorbereiten(quelle), ziel, { displayMode, throwOnError: true });
        } catch {
          ziel.textContent = displayMode ? `$$${quelle}$$` : `$${quelle}$`;
          ziel.style.color = `var(--danger, ${COLORS.danger})`;
          ziel.title = "Diese Formel kann nicht dargestellt werden";
        }
      };

      parts.forEach((part) => {
        if (part.startsWith("$$") && part.endsWith("$$")) {
          const el = document.createElement("div");
          rendern(part.slice(2, -2), el, true);
          ref.current.appendChild(el);
        } else if (part.startsWith("$") && part.endsWith("$")) {
          const el = document.createElement("span");
          rendern(part.slice(1, -1), el, false);
          ref.current.appendChild(el);
        } else {
          ref.current.appendChild(document.createTextNode(part));
        }
      });
    });
    return () => { cancelled = true; };
  }, [children]);
  return <span ref={ref}>{children}</span>;
}
