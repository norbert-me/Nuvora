const iconSvg = { width: 16, height: 16, fill: "none", stroke: "var(--text3)", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" };

export function Icon({ d, color, size, ...props }) {
  const s = size || 16;
  return (
    <svg style={{ ...iconSvg, width: s, height: s, stroke: color || iconSvg.stroke }} viewBox="0 0 20 20" {...props}>
      {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
    </svg>
  );
}

export const ICONS = {
  trash: ["M5 6h10M8 6V4.5A1.5 1.5 0 019.5 3h1A1.5 1.5 0 0112 4.5V6", "M6.5 6l.5 10.5a1 1 0 001 .5h4a1 1 0 001-.5L13.5 6"],
  duplicate: ["M7 3h8a2 2 0 012 2v8", "M3 7h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"],
  download: ["M10 3v10M6 9l4 4 4-4", "M3 15v1a2 2 0 002 2h10a2 2 0 002-2v-1"],
  edit: ["M13.5 3.5l3 3L7 16H4v-3L13.5 3.5z"],
  move: ["M5 10h10M12 6l4 4-4 4", "M3 4v12"],
  shuffle: ["M3 6h2l4 8h2l4-8h2M3 14h2l2-3M13 6h2l-2 3"],
  open: ["M10 3L17 10L10 17", "M17 10H3"],
  pdf: ["M5 2h7l4 4v11a2 2 0 01-2 2H5a2 2 0 01-2-2V4a2 2 0 012-2z", "M12 2v4h4"],
  export: ["M12 3h5v5", "M17 3L9 11", "M15 11v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"],
  chart: ["M3 17h14", "M5 13v4M9 9v8M13 11v6M17 7v10"],
  archive: ["M3 5a2 2 0 012-2h10a2 2 0 012 2v1H3V5z", "M4 6h12v11a2 2 0 01-2 2H6a2 2 0 01-2-2V6z", "M8 10h4"],
  restore: ["M10 3L3 10L10 17", "M3 10H17"],
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

export const COLORS = {
  danger: "#d1350f",
  success: "#0a7d3e",
  correctBg: "#d4edda",
  incorrectBg: "#fde2d9",
};
