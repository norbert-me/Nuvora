// Stoffverteilungsplan: welches Thema wann, und reicht die Zeit?
//
// Die Frage kommt aus dem Gebrauch: „Ich kann Arbeiten planen und sehe die
// Stunden bis dahin — dasselbe brauche ich für Themen." Eine Zeile je Thema,
// mit Soll-Stunden, den bisher wirklich gehaltenen Stunden und dem Zeitraum,
// in den es fällt.
//
// Der Zeitraum wird NICHT eingetragen, sondern gerechnet: aus der Reihenfolge,
// den Soll-Stunden und dem Stundenplan (freie Tage und Ausfälle abgezogen). Ein
// eingetragenes Datum wäre nach der ersten ausgefallenen Stunde falsch, und es
// nachzuziehen ist genau die Arbeit, die der Plan abnehmen soll. Wer ein Thema
// verschiebt oder ihm eine Stunde mehr gibt, sieht sofort, was das mit allem
// dahinter macht — bis hin zu „dafür reicht das Halbjahr nicht".
import { useCallback, useEffect, useState } from "react";

import {
  btnSecondary, btnSmall, cardStyle, chipStyle, COLORS as C, CONTROL_R, Empty,
  Icon, ICONS, inputStyle, panelStyle, sectionLabel, selectStyle, toolbarIconBtn,
} from "./Icons.jsx";
import Speicherleiste, { useEntwurf } from "./Speichern.jsx";
import Werkzeugleiste from "./Werkzeugleiste.jsx";
import { hol, alsJson } from "../core/melden.js";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/kalender";

// Der Balken ist reine Grafik: seine Rundung ist die halbe Höhe, damit die
// Kappen rund sind — deshalb hier eine Zahl statt CONTROL_R (wie beim
// Fortschrittsbalken in Themenstand.jsx).
const BALKEN_H = 10;

export default function Stoffplan() {
  const { t } = useLanguage();
  // Der Plan haengt am KURS (Fach), nicht an der Klasse: derselbe Jahrgang hat
  // in Mathe und in Deutsch verschiedene Plaene. Deshalb hier eine reine
  // Kursauswahl statt des gemeinsamen Kurs/Klasse-Felds.
  const [kurse, setKurse] = useState([]);
  const [kursId, setKursId] = useState(null);
  useEffect(() => {
    hol("/api/kurse").then((d) => {
      const liste = Array.isArray(d) ? d : [];
      setKurse(liste);
      setKursId((cur) => cur ?? (liste[0] ? liste[0].id : null));
    });
  }, []);
  const [term, setTerm] = useState("");
  const [daten, setDaten] = useState(null);
  const [laden, setLaden] = useState(false);

  const load = useCallback(() => {
    if (!kursId) { setDaten(null); return; }
    setLaden(true);
    hol(`${API}/stoffplan?kurs_id=${kursId}${term ? `&term=${term}` : ""}`)
      .then((d) => setDaten(d || null))
      .finally(() => setLaden(false));
  }, [kursId, term]);
  useEffect(() => { load(); }, [load]);

  // Ein Entwurf für den ganzen Plan: Reihenfolge und Stunden sind EINE
  // Entscheidung — wer ein Thema verschiebt, verschiebt alles dahinter. Nichts
  // geht zum Server, bevor jemand speichert.
  const basis = daten ? daten.zeilen.map((z) => ({ topic_id: z.topic_id, label: z.label, stunden: z.stunden, term: z.term, notiz: z.notiz })) : [];
  const ent = useEntwurf(basis, async (w) => {
    const res = await fetch(`${API}/stoffplan`, alsJson("PUT", {
      kurs_id: kursId,
      zeilen: w.map((z) => ({ topic_id: z.topic_id, stunden: Number(z.stunden) || 0, term: z.term || "", notiz: z.notiz || "" })),
    })).catch(() => null);
    if (!res || !res.ok) return false;
    load();
  });
  const zeilen = ent.wert;
  const setz = (fn) => ent.setz((v) => (typeof fn === "function" ? fn(v) : fn));

  const verschieben = (i, um) => setz((v) => {
    const j = i + um;
    if (j < 0 || j >= v.length) return v;
    const n = [...v];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const entfernen = (i) => setz((v) => v.filter((_, k) => k !== i));
  const dazu = (topic_id, label) => setz((v) => [...v, { topic_id, label, stunden: 4, term: "", notiz: "" }]);

  // Die errechneten Zeiträume kommen vom Server und gelten für den GESPEICHERTEN
  // Stand. Solange etwas offen ist, wäre die Anzeige daneben — deshalb steht
  // dann ein Hinweis statt einer Zahl, die nicht mehr stimmt.
  const berechnet = daten ? Object.fromEntries(daten.zeilen.map((z) => [z.topic_id, z])) : {};
  const offen = ent.geaendert;
  const sollGesamt = zeilen.reduce((n, z) => n + (Number(z.stunden) || 0), 0);

  return (
    <div>
      <Werkzeugleiste
        links={(
          <>
            <select value={kursId ?? ""} onChange={(e) => setKursId(e.target.value ? Number(e.target.value) : null)} style={selectStyle}>
              <option value="">{t("stoffplan.chooseKurs")}</option>
              {kurse.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}{k.fach ? ` · ${k.fach}` : ""}{k.jahrgang ? ` · ${k.jahrgang}` : ""}
                </option>
              ))}
            </select>
            <select value={term} onChange={(e) => setTerm(e.target.value)} style={selectStyle} title={t("stoffplan.termHint")}>
              <option value="">{t("stoffplan.termNow")}</option>
              <option value="1">{t("stoffplan.term1")}</option>
              <option value="2">{t("stoffplan.term2")}</option>
            </select>
          </>
        )}
      >
        <Speicherleiste entwurf={ent} klein />
      </Werkzeugleiste>

      {!kursId && <Empty title={t("stoffplan.chooseKurs")} hint={t("stoffplan.chooseKursHint")} />}
      {kursId && laden && !daten && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("common.loading")}</p>}

      {daten && (
        <>
          {/* Der Rahmen: wie viele Stunden hat der Zeitraum überhaupt, und wie
              viele sind verplant? Das ist die Frage, für die es den Plan gibt. */}
          <div style={{ ...panelStyle, padding: "10px 12px", marginBottom: 12, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--text2)" }}>
              {new Date(daten.von).toLocaleDateString()} – {new Date(daten.bis).toLocaleDateString()}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {t("stoffplan.verplant", { soll: sollGesamt, gesamt: daten.stunden_gesamt })}
            </span>
            {sollGesamt > daten.stunden_gesamt && (
              <span style={{ fontSize: 13, color: C.danger, fontWeight: 600 }}>
                {t("stoffplan.zuViel", { n: sollGesamt - daten.stunden_gesamt })}
              </span>
            )}
            {!daten.halbjahr_gesetzt && (
              <span style={{ fontSize: 12, color: C.warning }}>{t("stoffplan.keinHalbjahr")}</span>
            )}
          </div>

          {zeilen.length === 0 ? (
            <Empty title={t("stoffplan.leer")} hint={t("stoffplan.leerHint")} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              {zeilen.map((z, i) => {
                const b = berechnet[z.topic_id];
                const ist = b ? b.ist : 0;
                const soll = Number(z.stunden) || 0;
                // Farbe sagt, ob es aufgeht: mehr gehalten als geplant ist so
                // wenig ein Fehler wie weniger — es ist eine Beobachtung.
                const farbe = !soll ? "var(--text3)" : ist > soll ? C.warning : ist === soll ? C.success : "var(--accent)";
                return (
                  <div key={z.topic_id} style={{ ...cardStyle, padding: "8px 10px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ display: "inline-flex", flexDirection: "column" }}>
                      <button onClick={() => verschieben(i, -1)} disabled={i === 0} className="icon-btn"
                        style={{ ...toolbarIconBtn, height: 18, opacity: i === 0 ? 0.3 : 1 }}
                        title={t("stoffplan.up")} aria-label={t("stoffplan.up")}><Icon d={ICONS.chevronUp} size={13} /></button>
                      <button onClick={() => verschieben(i, 1)} disabled={i === zeilen.length - 1} className="icon-btn"
                        style={{ ...toolbarIconBtn, height: 18, opacity: i === zeilen.length - 1 ? 0.3 : 1 }}
                        title={t("stoffplan.down")} aria-label={t("stoffplan.down")}><Icon d={ICONS.chevronDown} size={13} /></button>
                    </span>
                    <span style={{ flex: 1, minWidth: 140, fontSize: 14, fontWeight: 600 }}>{z.label}</span>

                    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text3)" }}>
                      {t("stoffplan.soll")}
                      <input type="number" min="0" max="200" value={z.stunden}
                        onChange={(e) => setz((v) => v.map((x, k) => (k === i ? { ...x, stunden: e.target.value } : x)))}
                        style={{ ...inputStyle, width: 62, textAlign: "center" }} />
                    </label>
                    <span style={{ fontSize: 12, color: "var(--text3)", minWidth: 62 }}>
                      {t("stoffplan.ist", { n: ist })}
                    </span>

                    {/* Zeitraum: nur für den gespeicherten Stand — sonst zeigte
                        er Daten zu einer Reihenfolge, die es noch nicht gibt. */}
                    <span style={{ minWidth: 150, fontSize: 12, color: "var(--text3)" }}>
                      {offen ? t("stoffplan.offen")
                        : b && b.start ? `${new Date(b.start).toLocaleDateString()} – ${new Date(b.ende).toLocaleDateString()}`
                        : t("stoffplan.passtNicht")}
                    </span>
                    <span style={{ width: 90, height: BALKEN_H, borderRadius: BALKEN_H / 2, background: "var(--bg3)", overflow: "hidden", flexShrink: 0 }}>
                      <span style={{ display: "block", height: "100%", width: `${soll ? Math.min(100, (ist / soll) * 100) : 0}%`, background: farbe }} />
                    </span>

                    <button onClick={() => entfernen(i)} className="icon-btn" style={{ ...toolbarIconBtn, color: C.danger }}
                      title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} /></button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Klassenarbeiten als Marken: sie sagen, bis wann etwas sitzen muss. */}
          {daten.arbeiten.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}>{t("stoffplan.arbeiten")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {daten.arbeiten.map((a) => (
                  <div key={a.id} style={{ ...panelStyle, padding: "6px 10px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{new Date(a.date).toLocaleDateString()}</span>
                    <span style={{ fontSize: 13, flex: 1, minWidth: 100 }}>{a.title || t("kalender.examTitle")}</span>
                    {a.topics.map((x) => <span key={x} style={chipStyle}>{x}</span>)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vorschläge: Themen desselben Fachs und Jahrgangs, die noch nicht im
              Plan stehen. Fach und Jahrgang schlagen vor — der Plan entscheidet. */}
          <div style={sectionLabel}>{t("stoffplan.vorschlaege")}</div>
          {daten.vorschlaege.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 6 }}>
              {daten.fach || daten.jahrgang ? t("stoffplan.keineVorschlaege") : t("stoffplan.keinFach")}
            </p>
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {daten.vorschlaege
                .filter((v) => !zeilen.some((z) => z.topic_id === v.topic_id))
                .map((v) => (
                  <button key={v.topic_id} onClick={() => dazu(v.topic_id, v.label)}
                    style={{ ...btnSecondary, ...btnSmall, borderRadius: CONTROL_R }}>
                    + {v.label}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
