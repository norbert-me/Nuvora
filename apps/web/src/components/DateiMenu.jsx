import { useState, useRef, useEffect } from "react";
import { Icon, ICONS, menuRow, Popover, toolbarIconBtn } from "./Icons.jsx";

// item: { label, onClick } für Aktionen, { label, href } für Downloads.
// `icon` überschreibt das Sinnbild der Zeile — sonst entscheidet es die Form:
// ein href lädt herunter (export), ein onClick holt etwas herein (import).
function MenuRow({ item, onClose }) {
  const isDownload = !!item.href;
  const Tag = isDownload ? "a" : "button";
  return (
    <Tag
      href={item.href}
      download={isDownload || undefined}
      onClick={(e) => { if (!isDownload) item.onClick?.(e); onClose(); }}
      style={{ ...menuRow, boxSizing: "border-box", fontWeight: 500, textDecoration: "none" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      <Icon d={item.icon || (isDownload ? ICONS.export : ICONS.import)} size={14} />
      {item.label}
    </Tag>
  );
}

/**
 * Ein Menü für Datei-Handgriffe — hinein (Import, Vorlagen) wie hinaus (Export).
 *
 * Es war zuerst nur das Import-Menü. Beim Export standen daneben zwei
 * Sinnbilder nebeneinander (JSON, Tabelle), die man auseinanderhalten musste,
 * indem man auf den Tooltip wartete — zwei Knöpfe für eine Frage („wie
 * hinaus?"). Eine zweite, fast gleiche Komponente dafür wäre die Stelle
 * gewesen, an der die beiden nach dem ersten Umbau auseinanderlaufen; deshalb
 * eine Komponente mit Sinnbild und Beschriftung als Angabe.
 *
 * `gruppen` ist eine Liste von Listen: zwischen zwei Gruppen steht ein Strich.
 * Leere Gruppen fallen heraus, damit ein Strich nie am Rand steht.
 */
export default function DateiMenu({ icon = ICONS.import, label, gruppen = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const echte = gruppen.filter((g) => g && g.length);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={label} aria-label={label} aria-expanded={open}
        className="icon-btn"
        // Nur das Symbol, wie bei jedem anderen Knopf einer Werkzeugleiste: die
        // Beschriftung steht im `title`. Ein Knopf mit Text UND zwei Symbolen
        // war dreimal so breit wie seine Nachbarn und drueckte die Leiste in
        // die zweite Zeile.
        style={{ ...toolbarIconBtn, color: open ? "var(--accent)" : "var(--text3)" }}
      >
        <Icon d={icon} size={17} />
      </button>

      {open && (
        <Popover style={{ minWidth: 230, padding: 4 }}>
          {echte.map((gruppe, gi) => (
            <div key={gi}>
              {gi > 0 && <div style={{ height: 1, background: "var(--border3)", margin: "4px" }} />}
              {gruppe.map((item, i) => <MenuRow key={i} item={item} onClose={() => setOpen(false)} />)}
            </div>
          ))}
        </Popover>
      )}
    </div>
  );
}
