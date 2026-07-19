import { useState, useRef, useEffect } from "react";
import { useLanguage } from "../i18n/index.jsx";

const UploadIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13V3M6 7l4-4 4 4" /><path d="M3 15v1a2 2 0 002 2h10a2 2 0 002-2v-1" />
  </svg>
);

const DownloadIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 3v10M6 9l4 4 4-4" /><path d="M3 15v1a2 2 0 002 2h10a2 2 0 002-2v-1" />
  </svg>
);

// item: { label, onClick } für Importieren, oder { label, href } für Vorlagen-Downloads
function MenuRow({ item, onClose }) {
  const isDownload = !!item.href;
  const Tag = isDownload ? "a" : "button";
  return (
    <Tag
      href={item.href}
      download={isDownload || undefined}
      onClick={(e) => { if (!isDownload) item.onClick?.(e); onClose(); }}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", boxSizing: "border-box",
        padding: "8px 12px", background: "none", border: "none", borderRadius: 8,
        color: "var(--text)", fontSize: 13, fontWeight: 500, textDecoration: "none",
        cursor: "pointer", textAlign: "left",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
    >
      {isDownload ? <DownloadIcon /> : <UploadIcon />}
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
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
          padding: "9px 18px", border: "1px solid var(--border2)", borderRadius: 980,
          background: "var(--card)", color: "var(--text)", fontSize: 14, fontWeight: 500, letterSpacing: "-0.1px",
        }}
      >
        <UploadIcon />
        {t("importMenu.label")}
        <svg width="1em" height="1em" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50,
          minWidth: 230, background: "var(--card)", border: "1px solid var(--border)",
          borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", padding: 6,
        }}>
          {importItems.map((item, i) => <MenuRow key={`i${i}`} item={item} onClose={() => setOpen(false)} />)}
          {importItems.length > 0 && templateItems.length > 0 && (
            <div style={{ height: 1, background: "var(--border3)", margin: "6px 4px" }} />
          )}
          {templateItems.map((item, i) => <MenuRow key={`t${i}`} item={item} onClose={() => setOpen(false)} />)}
        </div>
      )}
    </div>
  );
}
