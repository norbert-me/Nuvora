// Kleine, unaufdringliche Anzeige der Offline-Outbox: „N Änderungen warten auf
// Sync". Sichtbar nur, wenn etwas gepuffert ist. Verschwindet, sobald alles
// nachgespielt wurde (kurzer „synchronisiert"-Hinweis).
import { useState, useEffect, useRef } from "react";
import { subscribe } from "./outbox.js";
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
      padding: "8px 14px", borderRadius: 980, fontSize: 13, fontWeight: 600,
      background: done ? "#0a7d3e" : "var(--card)", color: done ? "#fff" : "var(--text)",
      border: done ? "none" : "1px solid var(--border)", boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
    }}>
      {done ? <>✓ {t("outbox.synced")}</> : <>⏳ {t("outbox.pending", { n })}</>}
    </div>
  );
}
