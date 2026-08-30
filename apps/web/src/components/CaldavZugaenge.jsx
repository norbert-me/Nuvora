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

  // Der Kontotyp „Erweitert" ist bei Apple oft nicht die Notlösung, sondern
  // der einzige Weg — siehe unten am Aufklapper.
  const [erweitert, setErweitert] = useState(false);

  // ── Protokoll: was wirklich ankam ──
  //
  // Hier stand ein Knopf „Verbindung prüfen", der aus dem Browser eine
  // CalDAV-Anfrage nachstellte. Der beantwortet die falsche Frage: er prüft,
  // was der BROWSER erlebt — dessen Adresse, dessen Anmeldung, dessen Proxy.
  // Das Gerät, um das es geht, kommt darin nicht vor; ein grüner Haken hieß
  // nicht, dass das iPhone durchkommt. Das Protokoll zeigt stattdessen, was
  // der Server tatsächlich gesehen hat — und wenn es leer ist, ist genau das
  // die Antwort.
  const [protokoll, setProtokoll] = useState(null);
  const [offen, setOffen] = useState(false);
  const protokollLaden = () => hol("/api/caldav-zugaenge/protokoll")
    .then((d) => setProtokoll((d && d.eintraege) || []));

  const zuruecknehmen = async (id) => {
    await fetch(`/api/caldav-zugaenge/${id}`, { method: "DELETE" }).catch(() => null);
    laden();
  };

  if (!daten) return null;

  return (
    <div style={{ borderTop: "1px solid var(--border)", marginTop: 24, paddingTop: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t("caldav.titel")}</div>

      {/* Die drei Angaben, die ins Gerät gehören. Sie selbst zusammensetzen zu
          lassen ist die Stelle, an der die Einrichtung scheitert — Apple sagt
          dazu nur „Server nicht gefunden". */}
      <div style={{ ...panelStyle, padding: 10, marginBottom: 12 }}>
        <Zeile label={t("caldav.server")} wert={daten.server} t={t} />
        <Zeile label={t("caldav.benutzer")} wert={daten.benutzer} t={t} />
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{t("caldav.passwortZeile")}</div>

        {/* Der Kontotyp „Erweitert" ist bei Apple oft nicht die Notlösung,
            sondern der einzige Weg: unter „Manuell" benutzt macOS den
            eingetippten Pfad teils gar nicht, sondern sucht selbst unter
            /.well-known/caldav — und den Pfad fangen viele vorgeschaltete
            Proxys für Let's Encrypt selbst ab. Mit ausdrücklichem Serverpfad
            sucht Apple nicht. */}
        <button onClick={() => setErweitert((v) => !v)}
          style={{ background: "none", border: "none", padding: 0, marginTop: 8, cursor: "pointer",
            color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>
          {t("caldav.erweitert")}
        </button>
        {erweitert && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>{t("caldav.erweitertHinweis")}</div>
            <Zeile label={t("caldav.host")} wert={daten.host} t={t} />
            <Zeile label={t("caldav.pfad")} wert={daten.pfad} t={t} />
            <div style={{ fontSize: 12, color: "var(--text3)" }}>
              {t("caldav.portZeile", { port: daten.port })}
              {daten.ssl ? "" : ` · ${t("caldav.ohneSsl")}`}
            </div>
          </div>
        )}
      </div>

      {frisch && (
        // Genau einmal. Ein Passwort, das sich nachträglich auslesen lässt,
        // ist keins — deshalb steht hier auch, dass es jetzt notiert werden muss.
        <div style={{ ...panelStyle, padding: 10, marginBottom: 12, borderLeft: `3px solid ${C.success}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{t("caldav.neuTitel", { name: frisch.name })}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ ...inputStyle, flex: 1, minWidth: 0, overflowX: "auto", fontFamily: "monospace", fontSize: 14, letterSpacing: 0.5 }}>{frisch.passwort}</code>
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
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{z.name}</span>
              {/* Erst hieran sieht man, welcher Eintrag das alte iPad war,
                  bevor man es löscht. */}
              <span style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
          placeholder={t("caldav.namePlatzhalter")} name="caldav-name" autoComplete="off" size={1}
          style={{ ...inputStyle, flex: "1 1 160px", minWidth: 0 }} />
        <button onClick={anlegen} disabled={laeuft} style={{ ...btnPrimary, borderRadius: CONTROL_R, opacity: laeuft ? 0.6 : 1 }}>
          {t("caldav.anlegen")}
        </button>
      </div>

      {/* Wenn das Handy nicht will, sagt hier der Server, woran es liegt. */}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 10, paddingTop: 10 }}>
        <button onClick={() => { setOffen((v) => !v); if (!offen) protokollLaden(); }}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
            color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>
          {t("caldav.protokoll")}
        </button>
        {offen && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <button onClick={protokollLaden} style={{ ...btnSecondary, ...btnSmall, borderRadius: CONTROL_R }}>
                {t("caldav.protokollNeu")}
              </button>
            </div>
            {protokoll === null ? null : protokoll.length === 0 ? (
              // Leer ist ein Befund, keine Leere: dann kam die Anfrage nie an.
              <div style={{ fontSize: 12, color: C.warning, lineHeight: 1.4 }}>{t("caldav.protokollLeer")}</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {protokoll.map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "baseline" }}>
                    <span style={{ color: "var(--text3)", flexShrink: 0 }}>{new Date(e.zeit).toLocaleTimeString()}</span>
                    <span style={{ fontFamily: "monospace", flexShrink: 0 }}>{e.methode}</span>
                    <span style={{ flex: 1, minWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text3)" }} title={e.geraet}>{e.pfad}</span>
                    <span style={{ flexShrink: 0, color: e.status >= 400 ? C.danger : "var(--text2)" }}>{e.grund}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Zeile({ label, wert, t }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
      <span style={{ width: 74, flexShrink: 0, fontSize: 12, color: "var(--text3)" }}>{label}</span>
      {/* minWidth: 0 ist Pflicht: ein Flex-Kind ist sonst mindestens so breit
          wie sein Inhalt, und ein Eingabefeld rechnet das aus seiner size —
          auf dem Handy schob das die ganze Zeile aus dem Dialog. */}
      <input readOnly value={wert || ""} onFocus={(e) => e.target.select()} size={1}
        style={{ ...inputStyle, flex: 1, minWidth: 0, fontSize: 12 }} />
      <button onClick={() => navigator.clipboard?.writeText(wert || "")} className="icon-btn"
        style={toolbarIconBtn} title={t("common.copy")} aria-label={t("common.copy")}>
        <Icon d={ICONS.duplicate} size={15} />
      </button>
    </div>
  );
}
