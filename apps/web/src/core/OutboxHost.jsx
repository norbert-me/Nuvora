// Kleine, unaufdringliche Anzeige der Offline-Outbox: „N Änderungen warten auf
// Sync". Sichtbar nur, wenn etwas gepuffert ist. Verschwindet, sobald alles
// nachgespielt wurde (kurzer „synchronisiert"-Hinweis).
import { useState, useEffect, useRef } from "react";
import { subscribe } from "./outbox.js";
import { COLORS, Icon, ICONS, chipStyle, SHADOW } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

export function OutboxHost() {
  const { t } = useLanguage();
  const [n, setN] = useState(0);
  const [justDone, setJustDone] = useState(false);
  const prev = useRef(0);

  useEffect(() => subscribe((count) => {
    setN(count);
    if (prev.current > 0 && count === 0) {
      setJustDone(true);
      setTimeout(() => setJustDone(false), 2500);
    }
    prev.current = count;
  }), []);

  if (n === 0 && !justDone) return null;

  const done = n === 0 && justDone;
  return (
    <div style={{
      position: "fixed", bottom: 16, left: 16, zIndex: 9998,
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 12px", borderRadius: chipStyle.borderRadius, fontSize: 13, fontWeight: 600,
      background: done ? COLORS.success : "var(--card)", color: done ? COLORS.aufAkzent : "var(--text)",
      border: done ? "none" : "1px solid var(--border)", boxShadow: SHADOW.schwebend,
    }}>
      <Icon d={done ? ICONS.check : ICONS.hourglass} size={14} color="currentColor" />
      {done ? t("outbox.synced") : t("outbox.pending", { n })}
    </div>
  );
}
