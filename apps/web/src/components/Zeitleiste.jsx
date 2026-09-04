// Der Kurs als senkrechte Leiste: was wann ansteht, von oben nach unten.
//
// Vier Dinge, die sonst an vier Orten stehen — Stundenplan, Klassenarbeiten,
// geplante Freischaltungen, Stoffverteilungsplan — auf EINER Achse. Die Frage
// dahinter ist eine einzige („wie sieht mein Halbjahr aus?"), und sie lässt
// sich nur beantworten, wenn alles nebeneinander liegt: an dieser Stunde wird
// das Deck freigeschaltet, drei Wochen später steht die Arbeit.
//
// Gerechnet wird nichts hier: `GET /api/kalender/zeitleiste` liefert die
// fertigen Punkte (dieselbe Stundenrechnung wie überall, dieselbe
// Kurs-Zuordnung). Die Seite ordnet nur nach Tagen und malt.
import { useEffect, useState } from "react";
import { COLORS as C, CONTROL_R, cardStyle, chipStyle, Empty, Icon, ICONS, pageApp, panelStyle } from "./Icons.jsx";
import KursKlasseSelect from "./KursKlasseSelect.jsx";
import Werkzeugleiste from "./Werkzeugleiste.jsx";
import { hol } from "../core/melden.js";
import { heuteYmd } from "../core/datum.js";
import { useLanguage } from "../i18n/index.jsx";

// Eine Farbe je Art — dieselbe Bedeutung wie im Kalender: Arbeiten sind das,
// worauf hingearbeitet wird (rot), Freischaltungen sind Material (blau),
// Themen die Struktur (grün), Stunden der Takt (grau).
const ARTEN = {
  arbeit: { farbe: C.danger, icon: ICONS.chart },
  freischaltung: { farbe: C.info, icon: ICONS.open },
  thema: { farbe: C.success, icon: ICONS.note },
  stunde: { farbe: "var(--border2)", icon: null },
};

export default function Zeitleiste() {
  const { t } = useLanguage();
  // Die Kurswahl gehoert der Leiste selbst: sie ist eine eigene Ansicht mit
  // eigener Frage („welcher Kurs?") und haengt nicht am Datum, das die
  // Kalenderansichten daneben fuehren.
  const [classId, setClassId] = useState("");
  const [kursId, setKursId] = useState(null);
  const [daten, setDaten] = useState(null);
  const [term, setTerm] = useState("");

  useEffect(() => {
    if (!kursId) { setDaten(null); return; }
    hol(`/api/kalender/zeitleiste?kurs_id=${kursId}${term ? `&term=${term}` : ""}`, null).then(setDaten);
  }, [kursId, term]);

  // Nach Tagen bündeln: ein Tag ist eine Zeile, darin die Punkte in der
  // Reihenfolge, die der Server schon gesetzt hat (Stunde vor Stunde).
  const tage = [];
  for (const p of daten?.punkte || []) {
    const letzter = tage[tage.length - 1];
    if (letzter && letzter.datum === p.date) letzter.punkte.push(p);
    else tage.push({ datum: p.date, punkte: [p] });
  }
  const heute = heuteYmd();
  const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString(undefined,
    { weekday: "short", day: "2-digit", month: "2-digit" });

  return (
    <div style={{ ...pageApp }}>
      <Werkzeugleiste
        links={<KursKlasseSelect value={classId === "" ? "" : Number(classId)} kursValue={kursId}
          onChange={(id, kid) => { setClassId(id ?? ""); setKursId(kid ?? null); }} onKurs={setKursId} />}>
        <select value={term} onChange={(e) => setTerm(e.target.value)} style={{ ...chipStyle, cursor: "pointer", padding: "6px 10px" }}>
          <option value="">{t("kalender.termNow")}</option>
          <option value="1">{t("kalender.term1")}</option>
          <option value="2">{t("kalender.term2")}</option>
        </select>
      </Werkzeugleiste>

      {!kursId ? (
        <Empty title={t("zeitleiste.kurs")} />
      ) : !daten ? null : tage.length === 0 ? (
        <Empty title={t("zeitleiste.leer")} />
      ) : (
        <div style={{ ...panelStyle, padding: "12px 8px" }}>
          {tage.map((tag) => (
            <div key={tag.datum} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "2px 4px" }}>
              {/* Datumsspalte links, Achse in der Mitte, Inhalt rechts. Der
                  heutige Tag ist hervorgehoben — auf einer Leiste über ein
                  halbes Jahr sucht man ihn sonst. */}
              <div style={{ width: 92, flexShrink: 0, fontSize: 12, textAlign: "right", paddingTop: 6,
                color: tag.datum === heute ? "var(--accent)" : "var(--text3)",
                fontWeight: tag.datum === heute ? 700 : 500 }}>
                {fmt(tag.datum)}
              </div>
              <div style={{ position: "relative", width: 10, alignSelf: "stretch", flexShrink: 0 }}>
                <span aria-hidden style={{ position: "absolute", left: 4, top: 0, bottom: 0, width: 2, background: "var(--border)" }} />
                {/* Radius = halbe Kante: der Punkt auf der Achse ist Grafik,
                    kein Bedienelement (siehe Icons.jsx zu den Leitern). */}
                <span aria-hidden style={{ position: "absolute", left: 1, top: 10, width: 8, height: 8, borderRadius: "50%",
                  background: tag.datum === heute ? "var(--accent)" : "var(--border2)" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: "4px 0 8px" }}>
                {tag.punkte.map((p, i) => {
                  const art = ARTEN[p.art] || ARTEN.stunde;
                  if (p.art === "stunde") {
                    // Stunden sind der Takt, nicht der Inhalt: eine schmale
                    // Marke mit der Stundennummer, mehrere nebeneinander.
                    return (
                      <span key={`s${i}`} title={t("zeitleiste.stunde")}
                        style={{ ...chipStyle, display: "inline-flex", padding: "1px 8px", marginRight: 4, marginBottom: 4,
                          fontSize: 11, color: "var(--text3)", background: "var(--bg2)" }}>
                        {p.period ? `${p.period}.` : "—"}
                      </span>
                    );
                  }
                  return (
                    <div key={`p${i}`} style={{ ...cardStyle, padding: "6px 10px", marginBottom: 6,
                      borderLeft: `3px solid ${art.farbe}`, borderRadius: CONTROL_R,
                      display: "flex", alignItems: "center", gap: 8 }}>
                      {art.icon && <Icon d={art.icon} size={14} color={art.farbe} />}
                      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.titel}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text3)", marginLeft: "auto", whiteSpace: "nowrap" }}>
                        {p.art === "arbeit" ? t("zeitleiste.arbeit")
                          : p.art === "freischaltung" ? `${p.sub} ${t("zeitleiste.frei")}`
                          : p.bis && p.bis !== p.date ? `${t("zeitleiste.thema")} · ${p.sub}` : p.sub}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
