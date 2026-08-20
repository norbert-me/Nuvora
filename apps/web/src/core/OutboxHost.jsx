// Kleine, unaufdringliche Anzeige der Offline-Outbox: „N Änderungen warten auf
// Sync". Sichtbar nur, wenn etwas gepuffert ist. Verschwindet, sobald alles
// nachgespielt wurde (kurzer „synchronisiert"-Hinweis).
import { useState, useEffect, useRef } from "react";
import { fehler, fehlerLeeren, subscribe } from "./outbox.js";
import { COLORS, Icon, ICONS, btnSecondary, btnSmall, cardStyle, chipStyle, SHADOW } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

export function OutboxHost() {
  const { t } = useLanguage();
  const [n, setN] = useState(0);
  const [abgelehnt, setAbgelehnt] = useState(0);
  const [offen, setOffen] = useState(false);
  const [justDone, setJustDone] = useState(false);
  const prev = useRef(0);

  useEffect(() => subscribe((count, fehlerzahl) => {
    setN(count);
    setAbgelehnt(fehlerzahl || 0);
    if (prev.current > 0 && count === 0) {
      setJustDone(true);
      setTimeout(() => setJustDone(false), 2500);
    }
    prev.current = count;
  }), []);

  // Abgelehnte Aenderungen bleiben stehen, bis jemand sie gesehen hat. Ohne das
  // waere „offline weiterarbeiten" ein Versprechen mit stillem Kleingedruckten:
  // was der Server beim Nachspielen zurueckweist (die Klasse ist inzwischen
  // geloescht, jemand anders war schneller), verschwaende sonst spurlos.
  if (abgelehnt > 0) {
    const liste = fehler();
    return (
      <div style={{ position: "fixed", bottom: 16, left: 16, zIndex: 9998, maxWidth: 380,
        ...cardStyle, padding: 12, boxShadow: SHADOW.schwebend, fontSize: 13 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: COLORS.danger }}>
          <Icon d={ICONS.bulb} size={15} color={COLORS.danger} />
          {t("outbox.rejected", { n: abgelehnt })}
        </div>
        <div style={{ color: "var(--text3)", margin: "6px 0 8px" }}>{t("outbox.rejectedHint")}</div>
        {offen && (
          <ul style={{ margin: "0 0 8px", paddingLeft: 18, color: "var(--text2)", maxHeight: 160, overflowY: "auto" }}>
            {liste.map((f, i) => (
              <li key={i} style={{ marginBottom: 4, wordBreak: "break-all" }}>
                <code style={{ fontSize: 12 }}>{f.method} {f.url}</code> — {f.grund}
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setOffen((v) => !v)} style={{ ...btnSecondary, ...btnSmall }}>
            {offen ? t("outbox.hideList") : t("outbox.showList")}
          </button>
          <button onClick={() => { fehlerLeeren(); setAbgelehnt(0); }} style={{ ...btnSecondary, ...btnSmall }}>
            {t("common.ok")}
          </button>
        </div>
      </div>
    );
  }

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
