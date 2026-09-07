// Hinweis in der Desktop-App (und in jeder kuenftigen Huelle): es gibt eine
// neuere Fassung zum Laden.
//
// Warum ueberhaupt: die App zeigt auf einen laufenden Server und bekommt jede
// Aenderung der Weboberflaeche sofort — die HUELLE selbst aber nicht. Wer sie
// im September installiert hat, laeuft im Mai noch mit derselben; dass es eine
// neue gibt, sieht man nur, wenn man von sich aus im Profil nachsieht.
//
// Drei Entscheidungen:
//
// (a) Nur in einer Huelle. Im Browser gibt es nichts zu laden — dort ist die
//     Seite immer aktuell, und ein Hinweis waere Werbung.
// (b) Die Fassung der Huelle kommt aus `window.nuvora.appVersion`
//     (apps/desktop/preload.js). Fehlt sie (aeltere App), bleibt der Hinweis
//     aus: „unbekannt" ist kein Grund, jemanden zum Herunterladen zu schicken.
// (c) Weggeklickt wird je FASSUNG (localStorage). Wer 4.4.0 wegklickt, sieht
//     bei 4.5.0 wieder etwas — sonst waere ein einziger Klick das Ende aller
//     kuenftigen Hinweise.
import { useEffect, useState } from "react";
import { COLORS as C, Icon, ICONS, btnSmall, btnPrimary, iconBtn } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { hol } from "../core/melden.js";

const KEY = "nuvora_app_update_weg";

// "4.10.0" ist neuer als "4.9.0" — ein Zeichenkettenvergleich saehe es anders.
export function neuerAls(a, b) {
  const teile = (v) => String(v || "").split(".").map((x) => parseInt(x, 10) || 0);
  const [a1, a2, a3] = teile(a);
  const [b1, b2, b3] = teile(b);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

// Welche Datei passt zu dieser Huelle? Nur grob nach Plattform — mehr weiss die
// Seite nicht, und die Profilseite listet ohnehin alle.
function passendeDatei(dateien, plattform) {
  if (!dateien) return null;
  if (plattform === "darwin") return dateien.mac_arm || dateien.mac_intel || null;
  if (plattform === "win32") return dateien.windows || null;
  if (plattform === "linux") return dateien.linux || null;
  return null;
}

export default function AppUpdate() {
  const { t } = useLanguage();
  const huelle = typeof window !== "undefined" ? window.nuvora : null;
  const eigene = huelle?.appVersion || "";
  const [neu, setNeu] = useState(null);   // { version, datei }
  const [weg, setWeg] = useState(false);

  useEffect(() => {
    if (!eigene) return;
    hol("/api/apps", null).then((d) => {
      if (!d || !d.version || !neuerAls(d.version, eigene)) return;
      let schon = "";
      try { schon = localStorage.getItem(KEY) || ""; } catch { /* egal */ }
      if (schon === d.version) return;
      setNeu({ version: d.version, datei: passendeDatei(d.dateien, huelle?.platform), seite: d.seite || "" });
    }).catch(() => { /* offline: dann eben beim naechsten Start */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eigene]);

  if (!neu || weg) return null;
  const schliessen = () => {
    setWeg(true);
    try { localStorage.setItem(KEY, neu.version); } catch { /* egal */ }
  };
  const ziel = neu.datei?.url || neu.seite || "";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      padding: "8px 16px", background: C.info + "1f", borderBottom: `1px solid ${C.info}55` }}>
      <Icon d={ICONS.download} size={16} color={C.info} />
      <span style={{ fontSize: 14, flex: 1, minWidth: 160 }}>
        {t("appupdate.text", { version: neu.version })}
      </span>
      {ziel && (
        <a href={ziel} target="_blank" rel="noreferrer"
          style={{ ...btnPrimary, ...btnSmall, textDecoration: "none" }}>
          {t("appupdate.laden")}
        </a>
      )}
      {/* Ausdrücklich wegklicken — und zwar je Fassung, nicht für immer. */}
      <button onClick={schliessen} className="icon-btn" style={iconBtn}
        title={t("common.close")} aria-label={t("common.close")}>
        <Icon d={ICONS.close} size={16} />
      </button>
    </div>
  );
}
