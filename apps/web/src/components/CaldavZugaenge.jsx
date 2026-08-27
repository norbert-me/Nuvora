// CalDAV: den Kalender aus Apple und Outlook BESCHREIBEN.
//
// Der Unterschied zum Abo darüber ist keine Feinheit, sondern die ganze Sache:
// ein Abo wird geholt — der Client liest eine Datei und bietet gar keinen
// „Termin hinzufügen"-Knopf an. CalDAV ist dasselbe Protokoll, das iCloud und
// Nextcloud sprechen; damit legt das Handy Termine an, ändert und löscht sie.
//
// Warum ein eigenes Passwort je Gerät: Apple speichert die Zugangsdaten
// dauerhaft und schickt sie bei jedem Abgleich mit — alle paar Minuten,
// jahrelang, auf einem Gerät, das verloren gehen kann. Wer dort sein
// Nuvora-Passwort hinterlegt, hat es an einer Stelle liegen, die er nicht mehr
// überblickt. Ein Passwort je Gerät lässt sich einzeln zurücknehmen.
import { useEffect, useState } from "react";

import {
  btnPrimary, btnSecondary, btnSmall, COLORS as C, CONTROL_R, Icon, ICONS,
  inputStyle, panelStyle, toolbarIconBtn,
} from "./Icons.jsx";
import { hol, alsJson } from "../core/melden.js";
import { useLanguage } from "../i18n/index.jsx";

export default function CaldavZugaenge() {
  const { t } = useLanguage();
  const [daten, setDaten] = useState(null);
  const [name, setName] = useState("");
  const [frisch, setFrisch] = useState(null);   // {id, name, passwort} — genau einmal
  const [laeuft, setLaeuft] = useState(false);

  const laden = () => hol("/api/caldav-zugaenge").then((d) => d && setDaten(d));
  useEffect(() => { laden(); }, []);

  const anlegen = async () => {
    setLaeuft(true);
    const res = await fetch("/api/caldav-zugaenge", alsJson("POST", { name })).catch(() => null);
    setLaeuft(false);
    if (!res || !res.ok) return;
    setFrisch(await res.json().catch(() => null));
    setName("");
    laden();
  };

  const zuruecknehmen = async (id) => {
    await fetch(`/api/caldav-zugaenge/${id}`, { method: "DELETE" }).catch(() => null);
    laden();
  };

  if (!daten) return null;

  return (
    <div style={{ borderTop: "1px solid var(--border)", marginTop: 24, paddingTop: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t("caldav.titel")}</div>
      <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 12, lineHeight: 1.5 }}>
        {t("caldav.text")}
      </div>

      {/* Die drei Angaben, die ins Gerät gehören. Sie selbst zusammensetzen zu
          lassen ist die Stelle, an der die Einrichtung scheitert — Apple sagt
          dazu nur „Server nicht gefunden". */}
      <div style={{ ...panelStyle, padding: 10, marginBottom: 12 }}>
        <Zeile label={t("caldav.server")} wert={daten.server} t={t} />
        <Zeile label={t("caldav.benutzer")} wert={daten.benutzer} t={t} />
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>{t("caldav.passwortZeile")}</div>
      </div>

      {frisch && (
        // Genau einmal. Ein Passwort, das sich nachträglich auslesen lässt,
        // ist keins — deshalb steht hier auch, dass es jetzt notiert werden muss.
        <div style={{ ...panelStyle, padding: 10, marginBottom: 12, borderLeft: `3px solid ${C.success}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{t("caldav.neuTitel", { name: frisch.name })}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ ...inputStyle, flex: 1, fontFamily: "monospace", fontSize: 14, letterSpacing: 0.5 }}>{frisch.passwort}</code>
            <button onClick={() => navigator.clipboard?.writeText(frisch.passwort)} style={{ ...btnSecondary, ...btnSmall, borderRadius: CONTROL_R }}>
              {t("common.copy")}
            </button>
          </div>
          <div style={{ fontSize: 12, color: C.warning, marginTop: 6 }}>{t("caldav.nurEinmal")}</div>
          <button onClick={() => setFrisch(null)} style={{ ...btnSecondary, ...btnSmall, borderRadius: CONTROL_R, marginTop: 8 }}>
            {t("caldav.notiert")}
          </button>
        </div>
      )}

      {daten.zugaenge.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
          {daten.zugaenge.map((z) => (
            <div key={z.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <Icon d={ICONS.link} size={14} color="var(--text3)" />
              <span style={{ flex: 1, minWidth: 80 }}>{z.name}</span>
              {/* Erst hieran sieht man, welcher Eintrag das alte iPad war,
                  bevor man es löscht. */}
              <span style={{ fontSize: 11, color: "var(--text3)" }}>
                {z.zuletzt ? t("caldav.zuletzt", { wann: new Date(z.zuletzt).toLocaleDateString() })
                  : t("caldav.nieBenutzt")}
              </span>
              <button onClick={() => zuruecknehmen(z.id)} className="icon-btn"
                style={{ ...toolbarIconBtn, color: C.danger }}
                title={t("caldav.zuruecknehmen")} aria-label={t("caldav.zuruecknehmen")}>
                <Icon d={ICONS.trash} size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
          placeholder={t("caldav.namePlatzhalter")} name="caldav-name" autoComplete="off"
          style={{ ...inputStyle, flex: 1 }} />
        <button onClick={anlegen} disabled={laeuft} style={{ ...btnPrimary, borderRadius: CONTROL_R, opacity: laeuft ? 0.6 : 1 }}>
          {t("caldav.anlegen")}
        </button>
      </div>

      <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 10, lineHeight: 1.5 }}>
        {t("caldav.grenzen")}
      </div>
    </div>
  );
}

function Zeile({ label, wert, t }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
      <span style={{ width: 96, flexShrink: 0, fontSize: 12, color: "var(--text3)" }}>{label}</span>
      <input readOnly value={wert || ""} onFocus={(e) => e.target.select()}
        style={{ ...inputStyle, flex: 1, fontSize: 12 }} />
      <button onClick={() => navigator.clipboard?.writeText(wert || "")}
        style={{ ...btnSecondary, ...btnSmall, borderRadius: CONTROL_R }}>{t("common.copy")}</button>
    </div>
  );
}
