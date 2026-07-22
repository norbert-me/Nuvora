import { useEffect } from "react";

const iconSvg = { fill: "none", stroke: "var(--text3)", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };

// Icon skaliert standardmäßig mit der Schriftgröße (1em) und sitzt auf der
// Textlinie — so bleibt jedes Symbol im Verhältnis zum umgebenden Text. Eine
// feste Größe (px als Zahl oder z.B. "1.2em") bleibt möglich, wo gewollt.
export function Icon({ d, color, size, ...props }) {
  // Default 18px statt 1em: die feinen Strich-Icons wirkten bei 1em (~14px)
  // durchgehend zu klein. Explizite size-Angaben bleiben unberuehrt.
  const s = size || 18;
  return (
    <svg style={{ ...iconSvg, width: s, height: s, stroke: color || iconSvg.stroke, verticalAlign: "-0.125em", flexShrink: 0 }} viewBox="0 0 20 20" {...props}>
      {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
    </svg>
  );
}

export const ICONS = {
  trash: ["M4 6h12", "M8 6V4.6a1.4 1.4 0 011.4-1.4h1.2A1.4 1.4 0 0112 4.6V6", "M6 6l.7 9.6a1.6 1.6 0 001.6 1.5h3.4a1.6 1.6 0 001.6-1.5L14 6", "M8.6 9v4.4M11.4 9v4.4"],
  fit: ["M4 7V4h3", "M13 4h3v3", "M16 13v3h-3", "M7 16H4v-3"],
  duplicate: ["M7 3h8a2 2 0 012 2v8", "M3 7h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"],
  download: ["M10 3v10M6 9l4 4 4-4", "M3 15v1a2 2 0 002 2h10a2 2 0 002-2v-1"],
  edit: ["M13.5 3.5l3 3L7 16H4v-3L13.5 3.5z"],
  move: ["M5 10h10M12 6l4 4-4 4", "M3 4v12"],
  shuffle: ["M3 6h2l4 8h2l4-8h2M3 14h2l2-3M13 6h2l-2 3"],
  open: ["M10 3L17 10L10 17", "M17 10H3"],
  pdf: ["M5 2h7l4 4v11a2 2 0 01-2 2H5a2 2 0 01-2-2V4a2 2 0 012-2z", "M12 2v4h4"],
  // Matched Paar Export/Import: gleiche Box + gleicher Schaft, nur die Pfeilspitze
  // wechselt die Seite (raus = export, rein = import). IMMER dieses Paar für
  // Datei-Export/-Import verwenden — modulübergreifend einheitlich.
  export: ["M12 3h5v5", "M17 3L9 11", "M15 11v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"],
  import: ["M9 6v5h5", "M17 3L9 11", "M15 11v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"],
  // Pfeil nach oben auf eine Grundlinie — reines Hochladen (Datei o.ä.).
  // Fürs „Teilen/Veröffentlichen zum Marktplatz" gilt jetzt `share` (einheitlich).
  upload: ["M12 16V4M12 4L7 9M12 4l5 5", "M4 20h16"],
  chart: ["M3 17h14", "M5 13v4M9 9v8M13 11v6M17 7v10"],
  archive: ["M3 5a2 2 0 012-2h10a2 2 0 012 2v1H3V5z", "M4 6h12v11a2 2 0 01-2 2H6a2 2 0 01-2-2V6z", "M8 10h4"],
  restore: ["M10 3L3 10L10 17", "M3 10H17"],
  grip: ["M7 5.5h.01M7 10h.01M7 14.5h.01M13 5.5h.01M13 10h.01M13 14.5h.01"],
  close: ["M5 5l10 10M15 5L5 15"],
  plus: ["M10 4v12M4 10h12"],
  minus: ["M4 10h12"],
  more: ["M5 10h.01M10 10h.01M15 10h.01"],
  // Teilen: drei verbundene Knoten. EINHEITLICH fuer „Teilen/Veroeffentlichen".
  share: ["M14.5 3a2 2 0 100 4 2 2 0 100-4z", "M5.5 8a2 2 0 100 4 2 2 0 100-4z", "M14.5 13a2 2 0 100 4 2 2 0 100-4z", "M7.3 9.1l5.9 3.3M13.2 6.6L7.3 9.9"],
  calendar: ["M4 5h12v11H4z", "M4 8h12M7 3v4M13 3v4"],
  // Zahnrad: Mittelkreis + 8 Speichen (Ansicht-/Einstellungen-Menü).
  settings: ["M10 7.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8z",
    "M10 2v2.2M10 15.8V18M2 10h2.2M15.8 10H18M4.4 4.4l1.6 1.6M14 14l1.6 1.6M15.6 4.4L14 6M6 14l-1.6 1.6"],
};

export const iconBtn = { cursor: "pointer", padding: "6px", border: "none", background: "transparent", borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" };

// Einheitliche Erkennbarkeit für alles, was eine Datei herunterlädt: Icon + Label,
// immer gleiche Pille — ersetzt uneinheitliche reine Textlinks / "↓"-Zeichen.
export const downloadBtn = {
  display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
  padding: "6px 14px", border: "1px solid var(--border2)", borderRadius: 980,
  background: "var(--card)", color: "var(--text2)", fontSize: 13, fontWeight: 500,
  textDecoration: "none", transition: "all 0.15s",
};

export function DownloadLink({ children, style, ...props }) {
  const Tag = props.href ? "a" : "button";
  return (
    <Tag {...props} style={{ ...downloadBtn, ...style }}>
      <Icon d={ICONS.download} size={14} />
      {children}
    </Tag>
  );
}

// ─── Buttons ───
// Lagen frueher in jeder Seite einzeln und sind auseinandergelaufen: vier
// Varianten von btnPrimary, fuenf von btnSecondary — mal 14px, mal 13.5px,
// mal mit, mal ohne letterSpacing. Verbindlich ist ab hier diese eine Quelle.
export const btnPrimary = {
  padding: "9px 18px", cursor: "pointer", fontSize: 14, border: "none",
  borderRadius: 980, background: "var(--text)", color: "var(--bg)",
  fontWeight: 600, letterSpacing: "-0.1px",
};

export const btnSecondary = {
  padding: "9px 18px", cursor: "pointer", fontSize: 14,
  border: "1px solid var(--border2)", borderRadius: 980,
  background: "var(--card)", color: "var(--text)",
  fontWeight: 500, letterSpacing: "-0.1px",
};

// Kleinere Variante fuer Knoepfe in Zeilen und Tabellen.
export const btnSmall = { padding: "5px 12px", fontSize: 13 };

// Einheitliche Export-/Import-Knoepfe (Icon + Label) — moduluebergreifend
// dasselbe Aussehen und Verhalten. Nie je Seite nachbauen.
export function ExportButton({ label, onClick, style, ...props }) {
  return (
    <button onClick={onClick} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6, ...style }} {...props}>
      <Icon d={ICONS.export} size={15} /> {label}
    </button>
  );
}
export function ImportButton({ label, onFile, accept = ".json,application/json", style, ...props }) {
  return (
    <label style={{ ...btnSecondary, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, ...style }} {...props}>
      <Icon d={ICONS.import} size={15} /> {label}
      <input type="file" accept={accept} style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); e.target.value = ""; }} />
    </label>
  );
}

// Bewusst NICHT vereinheitlicht, weil kontextgebunden und je Gruppe stimmig:
//   Formularseiten (Login, Contact, ResetPassword) — volle Breite, 15px
//   Bestaetigungsseiten (VerifyEmail, ConfirmEmailChange) — inline, 12px 24px
//   Session — 15px in Akzentfarbe, weil vom Beamer aus lesbar
// Wer eine dieser Seiten anfasst, bleibt bei der Gruppe statt hierher zu greifen.

// ─── Seitenkopf ───
// 22px, wie in CardVote seit jeher. Neuere Seiten hatten 24 und 26.
// Einheitlicher Select-Look: eigener Chevron statt des eckigen OS-Selects.
// caretSvg ist ein grauer Chevron als Hintergrundbild (currentColor geht in
// background-image nicht, Grau liest sich in Hell wie Dunkel).
const caretSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8a8a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E";
export const selectStyle = {
  appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
  padding: "7px 30px 7px 11px", borderRadius: 10, border: "1px solid var(--border2)",
  background: `var(--bg) url("${caretSvg}") no-repeat right 9px center`,
  color: "var(--text)", fontSize: 13.5, cursor: "pointer", lineHeight: 1.3, boxSizing: "border-box",
};

export const pageTitle = { fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 8 };
export const pageIntro = { color: "var(--text2)", fontSize: 14, marginBottom: 22, lineHeight: 1.6 };
// Kleine Abschnitts-Überschrift in Versalien (z.B. „Ganztägig", „Zusatz").
// Einheitlich aus dem Kern statt je Seite neu inlinen.
export const sectionLabel = { fontSize: 11, fontWeight: 700, color: "var(--text3)", textTransform: "uppercase", letterSpacing: 0.5 };

export const COLORS = {
  danger: "#d1350f",
  success: "#0a7d3e",
  warning: "#b8860b",
  correctBg: "#d4edda",
  incorrectBg: "#fde2d9",
};

// ─── Gemeinsame Bausteine (EINE Quelle fürs Modul-Design) ───
// Vorher definierte jede Seite fld/inputStyle/th/td/card selbst, mit leicht
// abweichenden Werten. Ab hier zentral — nicht mehr je Seite neu erfinden.

// Texteingabe. Zeilen-Variante (Standard) und volle Breite via { ...inputStyle, width:"100%" }.
export const inputStyle = {
  padding: "9px 12px", border: "1px solid var(--border2)", borderRadius: 10,
  fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box",
};

// Container-Karte (Listeneintrag, Modulblock).
export const cardStyle = {
  border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 16,
};

// Zurückhaltendes Panel (Papierkorb, Hinweisblock).
export const panelStyle = {
  border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg3)", padding: 14,
};

// Tabellenkopf / -zelle (Noten, Orga …).
export const th = { padding: "8px 6px", fontSize: 12, fontWeight: 600, color: "var(--text2)", borderBottom: "1px solid var(--border)", textAlign: "center", whiteSpace: "nowrap" };
export const td = { padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "center", color: "var(--text)" };

// Kleiner Chip/Tag.
export const chipStyle = {
  display: "inline-block", fontSize: 12, fontWeight: 600, padding: "2px 9px",
  borderRadius: 980, background: "var(--bg3)", color: "var(--text2)",
};

// Gefärbtes Badge (z.B. Zähler): badge("#d1350f") -> roter Hinweis.
export const badge = (color) => ({
  fontSize: 12, fontWeight: 700, padding: "2px 9px", borderRadius: 980,
  background: color + "22", color,
});

// Einheitliches Popup/Modal. EINE Quelle für alle Dialoge — vorher baute jede
// Seite Overlay + Panel selbst (leicht andere z-index/Radius/Schatten).
// Klick auf den Hintergrund schließt; Inhalt fängt den Klick ab.
export const modalOverlay = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex",
  alignItems: "center", justifyContent: "center", padding: 16, zIndex: 1000, overflowY: "auto",
};
export const modalPanel = {
  background: "var(--card)", color: "var(--text)", borderRadius: 16, width: "100%",
  padding: 22, border: "1px solid var(--border)", boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
  maxHeight: "88vh", overflow: "auto", boxSizing: "border-box",
};
export function Modal({ children, onClose, width = 480, style }) {
  // Esc schließt — durchgängig für alle Modals, die diese Komponente nutzen.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={modalOverlay}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...modalPanel, maxWidth: width, ...style }}>
        {children}
      </div>
    </div>
  );
}

// Pillen-Umschalter (Tabs/Ansichten). options: [[value, label], …].
export function Tabs({ value, onChange, options, style }) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border2)", borderRadius: 980, overflow: "hidden", ...style }}>
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} style={{
          padding: "6px 14px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
          background: value === v ? "var(--accent)" : "transparent",
          color: value === v ? "#fff" : "var(--text2)",
        }}>{label}</button>
      ))}
    </div>
  );
}

// Reifegrad-Badge (alpha/beta) fuer Module. beta = blau, alpha = orange-Warnung.
// Leerer Zustand: statt „keine Daten" ein Satz + optional ein erster-Schritt-
// Knopf. Macht Listen selbsterklaerend.
export function Empty({ title, hint, action, onAction }) {
  return (
    <div style={{ textAlign: "center", padding: "36px 20px", border: "1px dashed var(--border2)", borderRadius: 14, background: "var(--bg2)" }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: hint ? 6 : 0 }}>{title}</div>
      {hint && <div style={{ fontSize: 13.5, color: "var(--text2)", marginBottom: action ? 16 : 0, maxWidth: 420, marginLeft: "auto", marginRight: "auto", lineHeight: 1.5 }}>{hint}</div>}
      {action && onAction && <button onClick={onAction} style={btnPrimary}>{action}</button>}
    </div>
  );
}

// Ladefehler: statt stiller Leere ein Hinweis + „Erneut versuchen".
export function LoadError({ message, onRetry, retryLabel = "Erneut versuchen" }) {
  return (
    <div style={{ textAlign: "center", padding: "28px 20px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)" }}>
      <div style={{ fontSize: 14, color: "#d1350f", fontWeight: 600, marginBottom: onRetry ? 14 : 0 }}>{message || "Konnte nicht geladen werden."}</div>
      {onRetry && <button onClick={onRetry} style={btnSecondary}>{retryLabel}</button>}
    </div>
  );
}

// Skeleton-Platzhalter: graue, pulsierende Balken in Inhaltsform statt „lädt…".
export function Skeleton({ rows = 3, height = 44, gap = 10 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap }} aria-hidden="true">
      <style>{"@keyframes nuvora-pulse{0%,100%{opacity:.55}50%{opacity:1}}"}</style>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ height, borderRadius: 10, background: "var(--bg3)", border: "1px solid var(--border)", animation: "nuvora-pulse 1.2s ease-in-out infinite", animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

export function StageBadge({ stage, title }) {
  if (!stage || stage === "stable") return null;
  const beta = stage === "beta";
  return (
    <span title={title} style={{
      display: "inline-block", fontSize: 10, fontWeight: 700, letterSpacing: "0.5px",
      textTransform: "uppercase", padding: "2px 6px", borderRadius: 6, verticalAlign: "middle",
      background: beta ? "rgba(10,132,255,0.15)" : "rgba(184,134,11,0.18)",
      color: beta ? "var(--accent)" : "#b8860b",
    }}>{beta ? "Beta" : "Frühphase"}</span>
  );
}

// Ein-/Aus-Schalter statt Checkbox. Fuer Optionen, die sichtbar an/aus sein
// sollen (z.B. Mischen).
export function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: "var(--text)" }}>
      <span
        onClick={() => onChange(!checked)}
        role="switch" aria-checked={checked}
        style={{
          width: 38, height: 22, borderRadius: 11, flexShrink: 0, position: "relative",
          background: checked ? "var(--accent)" : "var(--border2)", transition: "background 0.15s",
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: checked ? 18 : 2, width: 18, height: 18, borderRadius: 9,
          background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
        }} />
      </span>
      {label}
    </label>
  );
}
