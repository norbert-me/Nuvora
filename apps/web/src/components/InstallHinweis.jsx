// Der eine Satz, der aus der Seite eine App macht — und sonst nie erscheint.
//
// Auf dem iPhone gibt es keinen Installations-Knopf: Safari zeigt keinen
// Dialog wie Chrome („App installieren?"), der Weg fuehrt ausschliesslich ueber
// Teilen → „Zum Home-Bildschirm". Wer ihn nicht kennt, benutzt Nuvora im
// Browser weiter — und damit ohne das, wofuer der ganze Offline-Unterbau da
// ist (eigenes Fenster, eigener Speicher, Start ohne Netz).
//
// Deshalb genau ein Hinweis, mit drei harten Bedingungen:
//   (a) nur auf iOS und nur in SAFARI. Chrome und Firefox auf dem iPhone
//       koennen gar nicht auf den Home-Bildschirm legen; dort waere der Satz
//       eine Anleitung ins Leere.
//   (b) nur, wenn die App noch NICHT installiert ist (navigator.standalone).
//   (c) genau einmal: weggeklickt heisst weg, gemerkt im localStorage.
// Auf jeder anderen Plattform gibt dieses Bauteil null zurueck.
import { useState } from "react";
import { lies, schreib } from "../core/speicher.js";
import { btnSecondary, btnSmall, cardStyle, SHADOW, Icon, ICONS } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const SCHLUESSEL = "nuvora_install_weg";

/** Ist das ein iPhone/iPad in Safari, auf dem die App noch nicht installiert ist? */
export function zeigenNoetig(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return false;
  if (nav.standalone === true) return false;            // schon installiert
  const ua = nav.userAgent || "";
  // iPadOS meldet sich seit 13 als „Macintosh"; erst der Touch-Zaehler
  // unterscheidet es vom MacBook.
  const ios = /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
  if (!ios) return false;
  // Auf iOS ist jede Engine WebKit, aber nur Safari darf auf den Home-Bildschirm
  // legen. Die anderen verraten sich in der Kennung.
  if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua)) return false;
  return true;
}

export default function InstallHinweis() {
  const { t } = useLanguage();
  const [weg, setWeg] = useState(() => lies(SCHLUESSEL) === "1");
  if (weg || !zeigenNoetig()) return null;

  return (
    <div role="status" style={{
      position: "fixed", left: 16, right: 16, bottom: "max(16px, env(safe-area-inset-bottom))", zIndex: 240,
      maxWidth: 520, margin: "0 auto",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      ...cardStyle, padding: 12, boxShadow: SHADOW.schwebend,
      fontSize: 13, color: "var(--text2)", lineHeight: 1.5,
    }}>
      <Icon d={ICONS.share} size={16} color="currentColor" style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 200 }}>{t("install.ios")}</span>
      <button onClick={() => { setWeg(true); schreib(SCHLUESSEL, "1"); }} style={{ ...btnSecondary, ...btnSmall }}>
        {t("common.ok")}
      </button>
    </div>
  );
}
