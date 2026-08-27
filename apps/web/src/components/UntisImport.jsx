// WebUntis-Import: den Stundenplan der Schule uebernehmen.
//
// Warum es das gibt: der Wochenplan steht schon in Untis. Ihn hier ein zweites
// Mal einzutragen ist die Arbeit, die dieses Modul abnehmen soll — und beim
// ersten Planwechsel stehen zwei Fassungen da.
//
// Warum es ZWEI Schritte sind: Untis liefert „M 7a", Nuvora kennt einen Kurs
// mit einem eigenen Namen. Dazwischen gehoert die Zuordnung — derselbe
// Gedanke wie bei jedem anderen Import (Verknuepfung.jsx): gefragt wird immer,
// nicht nur im Konfliktfall. Nichts wird geschrieben, bevor jemand bestaetigt.
//
// Warum es ZWEI Wege gibt: die API liefert echte Struktur (Klasse, Fach, Raum,
// Ausfall, Ferien) — aber viele Schulen haben den Zugang gar nicht
// freigeschaltet, und wo die Anmeldung ueber SSO oder mit zweitem Faktor
// laeuft, gibt es kein Passwort, das hier passt. Fuer genau diese Faelle
// steht der ICS-Abo-Link daneben. Er kann weniger, geht dafuer immer.
import { useEffect, useMemo, useState } from "react";

import {
  btnPrimary, btnSecondary, btnSmall, COLORS as C, CONTROL_R, inputStyle, Modal,
  panelStyle, sectionLabel, Segment, segmentBtn, selectStyle, td as tdCell, th,
} from "./Icons.jsx";
import { hol, alsJson } from "../core/melden.js";
import { useLanguage } from "../i18n/index.jsx";

// Die Gruende, die der Server nennen kann (app/untis.py, GRUENDE). Beide Seiten
// muessen dieselbe Liste kennen — ein Grund ohne Text waere eine leere Meldung.
const GRUENDE = ["zugangsdaten", "schule", "server", "gesperrt", "kein_zugriff", "sso", "unbekannt"];

export default function UntisImport({ onClose, onFertig, kurse = [], klassen = [], periods = 6 }) {
  const { t } = useLanguage();
  const [quelle, setQuelle] = useState("api");
  const [konto, setKonto] = useState({ server: "", schule: "", benutzer: "", ics_url: "" });
  const [passwort, setPasswort] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState(null);      // {grund, meldung}
  const [vorschau, setVorschau] = useState(null);
  // Zuordnung je Rasterfeld: "" = uebernehmen als Text, "k<id>" = Kurs,
  // "c<id>" = Klasse, "-" = diese Stunde auslassen.
  const [wahl, setWahl] = useState({});
  const [mitAusfaellen, setMitAusfaellen] = useState(true);
  const [mitFerien, setMitFerien] = useState(true);

  // Server, Schulkennung und Benutzername sind gemerkt; das Passwort nie —
  // ein WebUntis-Zugang ist das ganze Schulkonto der Lehrkraft.
  useEffect(() => { hol("/api/kalender/untis").then((d) => d && setKonto(d)); }, []);

  const wdays = [t("kalender.mon"), t("kalender.tue"), t("kalender.wed"), t("kalender.thu"), t("kalender.fri")];

  const abrufen = async () => {
    setLaeuft(true); setFehler(null); setVorschau(null);
    // Die Angaben merken, bevor abgerufen wird: schlaegt der Abruf fehl, ist
    // das Getippte trotzdem nicht weg.
    await fetch("/api/kalender/untis", alsJson("PUT", konto)).catch(() => null);
    const res = await fetch("/api/kalender/untis/vorschau", alsJson("POST", { ...konto, quelle, passwort }))
      .catch(() => null);
    setLaeuft(false);
    const d = res && res.ok ? await res.json().catch(() => null) : null;
    if (!d) { setFehler({ grund: "unbekannt", meldung: "" }); return; }
    if (!d.ok) { setFehler({ grund: GRUENDE.includes(d.grund) ? d.grund : "unbekannt", meldung: d.meldung || "" }); return; }
    setVorschau(d);
    // Vorbelegung: der Kurs, dessen Name im Untis-Titel steckt. Ein Treffer ist
    // ein VORSCHLAG, kein Ergebnis — er steht im Auswahlfeld und laesst sich
    // aendern, bevor irgendetwas geschrieben wird.
    const vor = {};
    for (const [k, v] of Object.entries(d.raster || {})) {
      const titel = (v.titel || "").toLowerCase();
      const treffer = kurse.find((x) => x.name && titel.includes(x.name.toLowerCase()));
      vor[k] = treffer ? `k${treffer.id}` : "";
    }
    setWahl(vor);
  };

  const felder = useMemo(() => {
    if (!vorschau) return [];
    return Object.entries(vorschau.raster || {})
      .map(([k, v]) => { const [wd, p] = k.split(",").map(Number); return { k, wd, p, ...v }; })
      .filter((x) => x.wd >= 0 && x.wd <= 4 && x.p >= 1 && x.p <= periods)
      .sort((a, b) => a.wd - b.wd || a.p - b.p);
  }, [vorschau, periods]);

  const uebernehmen = async () => {
    setLaeuft(true);
    const slots = felder.filter((f) => (wahl[f.k] || "") !== "-").map((f) => {
      const w = wahl[f.k] || "";
      return {
        weekday: f.wd, period: f.p,
        kurs_id: w.startsWith("k") ? Number(w.slice(1)) : null,
        class_id: w.startsWith("c") ? Number(w.slice(1)) : null,
        // Der Untis-Titel bleibt als Beschriftung stehen, auch wenn ein Kurs
        // zugeordnet ist: „M 7a" sagt im Raster mehr als der Kursname allein.
        title: f.titel || "",
      };
    });
    const res = await fetch("/api/kalender/untis/uebernehmen", alsJson("POST", {
      slots,
      ausfaelle: mitAusfaellen ? (vorschau.ausfaelle || []) : [],
      ferien: mitFerien ? (vorschau.ferien || []) : [],
    })).catch(() => null);
    setLaeuft(false);
    if (res && res.ok) { onFertig && onFertig(await res.json().catch(() => ({}))); onClose(); }
    else setFehler({ grund: "unbekannt", meldung: "" });
  };

  return (
    <Modal onClose={onClose} width={vorschau ? 760 : 520} title={t("untis.titel")}>
      {!vorschau && (
        <>
          <p style={{ fontSize: 13, color: "var(--text2)", marginTop: 0 }}>{t("untis.intro")}</p>

          <Segment style={{ marginBottom: 12 }}>
            {[["api", t("untis.wegApi")], ["ics", t("untis.wegIcs")]].map(([wert, label]) => (
              <button key={wert} onClick={() => setQuelle(wert)}
                style={{ ...segmentBtn, padding: "0 14px",
                  background: quelle === wert ? "var(--accent)" : "transparent",
                  color: quelle === wert ? C.aufAkzent : "var(--text2)" }}>
                {label}
              </button>
            ))}
          </Segment>

          {quelle === "api" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, color: "var(--text3)" }}>
                {t("untis.server")}
                <input value={konto.server} onChange={(e) => setKonto({ ...konto, server: e.target.value })}
                  placeholder="https://ajax.webuntis.com/WebUntis/?school=…"
                  name="untis-server" autoComplete="off" style={{ ...inputStyle, width: "100%" }} />
              </label>
              <p style={{ fontSize: 12, color: "var(--text3)", margin: 0 }}>{t("untis.serverHinweis")}</p>
              <label style={{ fontSize: 12, color: "var(--text3)" }}>
                {t("untis.schule")}
                <input value={konto.schule} onChange={(e) => setKonto({ ...konto, schule: e.target.value })}
                  name="untis-schule" autoComplete="off" style={{ ...inputStyle, width: "100%" }} />
              </label>
              <label style={{ fontSize: 12, color: "var(--text3)" }}>
                {t("untis.benutzer")}
                <input value={konto.benutzer} onChange={(e) => setKonto({ ...konto, benutzer: e.target.value })}
                  name="untis-benutzer" autoComplete="username" style={{ ...inputStyle, width: "100%" }} />
              </label>
              <label style={{ fontSize: 12, color: "var(--text3)" }}>
                {t("untis.passwort")}
                <input type="password" value={passwort} onChange={(e) => setPasswort(e.target.value)}
                  name="untis-passwort" autoComplete="current-password" style={{ ...inputStyle, width: "100%" }} />
              </label>
              {/* Warum das Passwort jedes Mal neu eingegeben wird. Ein Hinweis,
                  der nicht erklaert, warum etwas unbequem ist, wird als Fehler
                  gelesen. */}
              <p style={{ fontSize: 12, color: "var(--text3)", margin: 0, borderLeft: `3px solid ${C.warning}`, paddingLeft: 8 }}>
                {t("untis.passwortHinweis")}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, color: "var(--text3)" }}>
                {t("untis.icsUrl")}
                <input value={konto.ics_url} onChange={(e) => setKonto({ ...konto, ics_url: e.target.value })}
                  placeholder="https://…/WebUntis/api/public/calendar/…" name="untis-ics" autoComplete="off"
                  style={{ ...inputStyle, width: "100%" }} />
              </label>
              <p style={{ fontSize: 12, color: "var(--text3)", margin: 0 }}>{t("untis.icsHinweis")}</p>
              <p style={{ fontSize: 12, color: C.warning, margin: 0 }}>{t("untis.icsGrenze")}</p>
            </div>
          )}

          {fehler && (
            <div style={{ ...panelStyle, marginTop: 12, padding: 10, borderLeft: `3px solid ${C.danger}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{t(`untis.grund.${fehler.grund}`)}</div>
              <div style={{ fontSize: 12, color: "var(--text2)" }}>{t(`untis.rat.${fehler.grund}`)}</div>
              {/* Die Originalmeldung steht daneben: eine uebersetzte
                  Fehlermeldung ohne das Original ist nicht nachpruefbar. */}
              {fehler.meldung && (
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 6, fontFamily: "monospace" }}>{fehler.meldung}</div>
              )}
              {quelle === "api" && (
                <button onClick={() => { setQuelle("ics"); setFehler(null); }}
                  style={{ ...btnSecondary, ...btnSmall, marginTop: 8, borderRadius: CONTROL_R }}>
                  {t("untis.zuIcs")}
                </button>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={onClose} style={{ ...btnSecondary, borderRadius: CONTROL_R }}>{t("common.cancel")}</button>
            <button onClick={abrufen} disabled={laeuft} style={{ ...btnPrimary, borderRadius: CONTROL_R, opacity: laeuft ? 0.6 : 1 }}>
              {laeuft ? t("untis.laeuft") : t("untis.abrufen")}
            </button>
          </div>
        </>
      )}

      {vorschau && (
        <>
          <p style={{ fontSize: 13, color: "var(--text2)", marginTop: 0 }}>
            {t("untis.gefunden", { n: vorschau.stunden_gefunden, felder: felder.length,
              von: new Date(vorschau.von).toLocaleDateString(), bis: new Date(vorschau.bis).toLocaleDateString() })}
          </p>

          {felder.length === 0 ? (
            <p style={{ fontSize: 13, color: C.warning }}>{t("untis.nichtsPassendes")}</p>
          ) : (
            <div style={{ maxHeight: "48vh", overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>
                  <th style={th}>{t("untis.spalteStunde")}</th>
                  <th style={th}>{t("untis.spalteUntis")}</th>
                  <th style={th}>{t("untis.spalteZuordnung")}</th>
                </tr></thead>
                <tbody>
                  {felder.map((f) => {
                    const alt = (vorschau.belegt || {})[f.k];
                    return (
                      <tr key={f.k}>
                        <td style={{ ...tdCell, whiteSpace: "nowrap" }}>
                          {wdays[f.wd]} · {f.p}.
                        </td>
                        <td style={tdCell}>
                          <div style={{ fontWeight: 600 }}>{f.titel}</div>
                          <div style={{ fontSize: 11, color: "var(--text3)" }}>
                            {f.raum ? `${f.raum} · ` : ""}{t("untis.malGefunden", { n: f.anzahl })}
                            {/* Was hier heute steht, wird ueberschrieben — das
                                muss vorher sichtbar sein, nicht hinterher. */}
                            {alt && (alt.title || alt.kurs_id || alt.class_id)
                              ? ` · ${t("untis.ersetzt", { was: alt.title || t("untis.belegt") })}` : ""}
                          </div>
                        </td>
                        <td style={tdCell}>
                          <select value={wahl[f.k] ?? ""} onChange={(e) => setWahl({ ...wahl, [f.k]: e.target.value })}
                            style={{ ...selectStyle, minWidth: 200 }}>
                            <option value="">{t("untis.nurText")}</option>
                            <option value="-">{t("untis.auslassen")}</option>
                            {kurse.length > 0 && (
                              <optgroup label={t("untis.kurse")}>
                                {kurse.map((k) => <option key={k.id} value={`k${k.id}`}>{k.name}</option>)}
                              </optgroup>
                            )}
                            {klassen.length > 0 && (
                              <optgroup label={t("untis.klassen")}>
                                {klassen.map((k) => <option key={k.id} value={`c${k.id}`}>{k.name}</option>)}
                              </optgroup>
                            )}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={sectionLabel}>{t("untis.dazu")}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            <label style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6,
              opacity: (vorschau.ausfaelle || []).length ? 1 : 0.5 }}>
              <input type="checkbox" checked={mitAusfaellen && (vorschau.ausfaelle || []).length > 0}
                disabled={!(vorschau.ausfaelle || []).length}
                onChange={(e) => setMitAusfaellen(e.target.checked)} />
              {t("untis.ausfaelle", { n: (vorschau.ausfaelle || []).length })}
            </label>
            <label style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6,
              opacity: (vorschau.ferien || []).length ? 1 : 0.5 }}>
              <input type="checkbox" checked={mitFerien && (vorschau.ferien || []).length > 0}
                disabled={!(vorschau.ferien || []).length}
                onChange={(e) => setMitFerien(e.target.checked)} />
              {t("untis.ferien", { n: (vorschau.ferien || []).length })}
            </label>
            {vorschau.quelle === "ics" && (
              <p style={{ fontSize: 12, color: "var(--text3)", margin: 0 }}>{t("untis.icsOhneAusfall")}</p>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={() => setVorschau(null)} style={{ ...btnSecondary, borderRadius: CONTROL_R }}>{t("untis.zurueck")}</button>
            <button onClick={uebernehmen} disabled={laeuft} style={{ ...btnPrimary, borderRadius: CONTROL_R, opacity: laeuft ? 0.6 : 1 }}>
              {laeuft ? t("untis.laeuft") : t("untis.uebernehmen")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
