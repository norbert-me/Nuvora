import { useState, useRef, useEffect } from "react";
import { useLanguage } from "../i18n/index.jsx";
import { Icon, ICONS, menuRow, Popover, toolbarBtn } from "./Icons.jsx";

// item: { label, onClick } für Importieren, oder { label, href } für Vorlagen-Downloads
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
      <Icon d={isDownload ? ICONS.export : ICONS.import} size={14} />
      {item.label}
    </Tag>
  );
}

/**
 * Sammelt "Importieren"- und "Vorlage herunterladen"-Aktionen in einem Dropdown
 * statt vieler einzelner Buttons in der Werkzeugleiste.
 */
export default function ImportMenu({ importItems = [], templateItems = [] }) {
  const { t } = useLanguage();
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

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        // Der Knopf steht immer in einer Werkzeugleiste — also dieselbe Hoehe
        // und Form wie alles daneben, keine eigene Pille.
        style={toolbarBtn}
      >
        <Icon d={ICONS.import} size={14} />
        {t("importMenu.label")}
        <Icon d={open ? ICONS.chevronUp : ICONS.chevronDown} size={14} />
      </button>

      {open && (
        <Popover style={{ minWidth: 230, padding: 4 }}>
          {importItems.map((item, i) => <MenuRow key={`i${i}`} item={item} onClose={() => setOpen(false)} />)}
          {importItems.length > 0 && templateItems.length > 0 && (
            <div style={{ height: 1, background: "var(--border3)", margin: "4px" }} />
          )}
          {templateItems.map((item, i) => <MenuRow key={`t${i}`} item={item} onClose={() => setOpen(false)} />)}
        </Popover>
      )}
    </div>
  );
}
