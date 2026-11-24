// Info zu einem Kurs: wer sitzt drin, was steht an, wie läuft es, was muss wiederholt werden.
//
// Jede Quelle nur, wenn ihr Modul läuft (Regel 3): ohne Kalender keine nächste Arbeit, ohne Auswertung kein
// Schnitt — aber der Wiederholungsbedarf kommt aus dem Kern (Themenprofil) und rechnet mit dem, was da ist.
// Geladen wird erst beim Aufklappen: eine Kursliste soll nicht für jeden Kurs vier Abfragen auslösen.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useLanguage } from "../i18n/index.jsx";
import { useAktiv } from "../core/modules.js";
import { hol } from "../core/melden.js";
import { kursSchnitt, wiederholungsbedarf } from "../core/kursinfo.js";
import { COLORS as C, chipStyle, sectionLabel } from "./Icons.jsx";

const de = (n, st = 1) => Number(n).toFixed(st).replace(".", ",");

export default function KursInfo({ kurs }) {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const [d, setD] = useState(null);

  useEffect(() => {
    let weg = false;
    (async () => {
      const klassen = (kurs.classes || []).slice(0, 4);
      const [kinder, arbeiten, schnitte, profile] = await Promise.all([
        hol(`/api/kurse/${kurs.id}/kinder`, []),
        aktiv("kalender") ? hol("/api/kalender/klassenarbeiten/uebersicht", []) : Promise.resolve(null),
        aktiv("auswertung") && klassen[0]
          ? Promise.all(["1", "2"].map((tm) => hol(`/api/noten/classes/${klassen[0].id}/summary?term=${tm}&kurs_id=${kurs.id}`, [])))
          : Promise.resolve(null),
        // Das Themenprofil sitzt im Kern und prüft je Quelle selbst, ob das Modul läuft.
        Promise.all(klassen.map((c) => hol(`/api/classes/${c.id}/themenprofil?kurs_id=${kurs.id}`, null))),
      ]);
      if (weg) return;
      setD({
        kinder: Array.isArray(kinder) ? kinder.length : null,
        arbeit: Array.isArray(arbeiten) ? (arbeiten.find((a) => a.kurs_id === kurs.id) || false) : null,
        schnitt: schnitte ? schnitte.map(kursSchnitt) : null,
        bedarf: wiederholungsbedarf(profile.filter(Boolean)),
      });
    })();
    return () => { weg = true; };
  }, [kurs.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!d) return <div style={{ fontSize: 13, color: "var(--text3)", padding: "8px 0" }}>{t("kurse.info.laedt")}</div>;
  const zeile = { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 14 };
  const kopf = { ...sectionLabel, width: 120, flexShrink: 0 };
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ ...zeile, borderTop: "none" }}>
        <span style={kopf}>{t("kurse.info.kinder")}</span>
        <span>{d.kinder ?? "—"}</span>
      </div>

      {d.arbeit !== null && (
        <div style={zeile}>
          <span style={kopf}>{t("kurse.info.arbeit")}</span>
          {d.arbeit ? (
            <>
              <Link to="/kalender?view=klassenarbeit" style={{ color: "inherit" }}>
                {new Date(d.arbeit.date).toLocaleDateString()}{d.arbeit.title ? ` · ${d.arbeit.title}` : ""}
              </Link>
              <span style={{ ...chipStyle, fontWeight: 700, color: d.arbeit.stunden <= 2 ? C.danger : "var(--text2)" }}>{t("widget.arbeitStunden", { n: d.arbeit.stunden })}</span>
            </>
          ) : <span style={{ color: "var(--text3)" }}>{t("kurse.info.keineArbeit")}</span>}
        </div>
      )}

      {d.schnitt && (
        <div style={zeile}>
          <span style={kopf}>{t("kurse.info.schnitt")}</span>
          {d.schnitt.some(Boolean)
            ? d.schnitt.map((s, i) => s && <span key={i}>{t(i === 0 ? "noten.term1Short" : "noten.term2Short")} Ø {de(s.schnitt)} <span style={{ color: "var(--text3)", fontSize: 12 }}>({s.n})</span></span>)
            : <span style={{ color: "var(--text3)" }}>{t("kurse.info.keinSchnitt")}</span>}
        </div>
      )}

      <div style={{ ...zeile, alignItems: "flex-start" }}>
        <span style={kopf}>{t("kurse.info.wdh")}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          {!d.bedarf.datenDa
            ? <span style={{ color: "var(--text3)" }}>{t("kurse.info.wdhZuWenig")}</span>
            : d.bedarf.themen.length === 0
              ? <span style={{ color: C.success }}>{t("kurse.info.wdhKeiner")}</span>
              : d.bedarf.themen.map((th) => (
                <div key={th.topic_id} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{th.name || `#${th.topic_id}`}</span>
                  <span style={{ fontWeight: 700, color: th.pct < 50 ? C.danger : C.warning }}>{th.pct} %</span>
                  <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>{t("kurse.info.darunter", { n: th.darunter, von: th.n })}</span>
                </div>
              ))}
        </span>
      </div>
    </div>
  );
}
