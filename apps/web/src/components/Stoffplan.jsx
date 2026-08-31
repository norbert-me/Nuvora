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
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  btnSecondary, btnSmall, cardStyle, chipStyle, COLORS as C, CONTROL_R, Empty,
  Icon, ICONS, inputStyle, panelStyle, sectionLabel, Segment, segmentBtn, selectStyle,
  toolbarIconBtn,
} from "./Icons.jsx";
import Speicherleiste, { useEntwurf } from "./Speichern.jsx";
import Werkzeugleiste from "./Werkzeugleiste.jsx";
import { askConfirm } from "../core/dialog.jsx";
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
  //
  // ZWEI Dinge, die hier zwingend sind und beim ersten Anlauf beide fehlten:
  //
  //  1. Die Grundlage muss über Rendergrenzen DIESELBE bleiben. `useEntwurf`
  //     übernimmt sie in einem Effekt, der an ihrer Identität hängt; ein bei
  //     jedem Render neu gebautes Array übernimmt sich also endlos selbst —
  //     eine Endlosschleife, die die ganze Seite samt Navigation einfriert.
  //     Deshalb der Schlüssel aus den Daten und `useMemo` (dieselbe Lösung wie
  //     auf der Startseite).
  //  2. Der Entwurf ist ein OBJEKT, keine Liste. `setz` mischt mit `{...v}` —
  //     eine Liste würde dabei zu einem Objekt mit den Zahlen als Schlüsseln,
  //     und danach ist der Plan keine Liste mehr.
  const schluessel = daten ? JSON.stringify(daten.zeilen.map((z) => [
    z.topic_id, z.stunden, z.term, z.notiz, z.start_date, z.end_date, z.exam_id, z.niveau, z.label,
  ])) : "";
  const basis = useMemo(() => ({
    zeilen: (schluessel ? JSON.parse(schluessel) : []).map(
      ([topic_id, stunden, term, notiz, start_date, end_date, exam_id, niveau, label]) => ({
        topic_id, stunden, term: term || "", notiz: notiz || "",
        start_date: start_date || "", end_date: end_date || "",
        exam_id: exam_id || null, niveau: niveau || "", label,
      })),
  }), [schluessel]);
  const ent = useEntwurf(basis, async (w) => {
    const res = await fetch(`${API}/stoffplan`, alsJson("PUT", {
      kurs_id: kursId,
      zeilen: w.zeilen.map((z) => ({
        topic_id: z.topic_id, stunden: Number(z.stunden) || 0, term: z.term || "", notiz: z.notiz || "",
        start_date: z.start_date || "", end_date: z.end_date || "",
        exam_id: z.exam_id || null, niveau: z.niveau || "",
      })),
    })).catch(() => null);
    if (!res || !res.ok) return false;
    load();
  });
  const zeilen = ent.wert.zeilen;
  const setz = (fn) => ent.setz((v) => ({ zeilen: typeof fn === "function" ? fn(v.zeilen) : fn }));

  const verschieben = (i, um) => setz((v) => {
    const j = i + um;
    if (j < 0 || j >= v.length) return v;
    const n = [...v];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const entfernen = (i) => setz((v) => v.filter((_, k) => k !== i));
  const dazu = (topic_id, label) => setz((v) => [...v, { topic_id, label, stunden: 4, term: "", notiz: "", start_date: "", end_date: "", exam_id: null, niveau: "" }]);
  const aendern = (i, patch) => setz((v) => v.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  // Den ganzen Plan verwerfen. Zeile fuer Zeile zu loeschen ist bei zwanzig
  // Themen zwanzig Klicks — und wer im neuen Schuljahr neu plant, will genau
  // das. Wie jede Aenderung am Plan geht es erst mit „Speichern" zum Server:
  // ein Fehlgriff ist bis dahin ein „Abbrechen" entfernt.
  const planLoeschen = async () => {
    if (!(await askConfirm(t("stoffplan.planLoeschenFrage", { n: zeilen.length }), { danger: true, ok: t("common.delete") }))) return;
    setz(() => []);
  };

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
        mehr={daten && zeilen.length ? [{
          key: "plan-leeren", label: t("stoffplan.planLoeschen"), icon: ICONS.trash, gefahr: true,
          onClick: planLoeschen,
        }] : []}
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
                    <span style={{ minWidth: 150, fontSize: 12, color: b && b.fest ? "var(--text2)" : "var(--text3)" }}
                      title={b && b.fest ? t("stoffplan.festHint") : t("stoffplan.gerechnetHint")}>
                      {/* Eingetragen (kraeftiger) oder gerechnet (blass) — ohne
                          den Unterschied wuesste niemand, warum sich ein Datum
                          beim Umsortieren verschiebt und ein anderes nicht. */}
                      {offen ? t("stoffplan.offen")
                        : b && b.start ? `${new Date(b.start).toLocaleDateString()} – ${new Date(b.ende).toLocaleDateString()}`
                        : t("stoffplan.passtNicht")}
                    </span>
                    <span style={{ width: 90, height: BALKEN_H, borderRadius: BALKEN_H / 2, background: "var(--bg3)", overflow: "hidden", flexShrink: 0 }}>
                      <span style={{ display: "block", height: "100%", width: `${soll ? Math.min(100, (ist / soll) * 100) : 0}%`, background: farbe }} />
                    </span>

                    <button onClick={() => entfernen(i)} className="icon-btn" style={{ ...toolbarIconBtn, color: C.danger }}
                      title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} /></button>

                    {/* Zweite Reihe: was nicht jede Zeile braucht. Fester
                        Zeitraum (sonst rechnet der Server), Anspruch und die
                        Klassenarbeit, mit der das Thema abschliesst. */}
                    <div style={{ flexBasis: "100%", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
                      borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 2 }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text3)" }}>
                        {t("stoffplan.von")}
                        <input type="date" value={z.start_date || ""} onChange={(e) => aendern(i, { start_date: e.target.value })}
                          title={t("stoffplan.datumHint")} style={{ ...inputStyle, width: 150 }} />
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text3)" }}>
                        {t("stoffplan.bis")}
                        <input type="date" value={z.end_date || ""} onChange={(e) => aendern(i, { end_date: e.target.value })}
                          title={t("stoffplan.datumHint")} style={{ ...inputStyle, width: 150 }} />
                      </label>

                      {/* E/G: am PLAN, nicht am Thema — dasselbe Thema dauert
                          im E-Kurs anders lang als im G-Kurs. */}
                      <Segment>
                        {[["", t("stoffplan.niveauAlle")], ["G", "G"], ["E", "E"]].map(([wert, label]) => (
                          <button key={wert || "alle"} onClick={() => aendern(i, { niveau: wert })}
                            style={{ ...segmentBtn, padding: "0 10px",
                              background: (z.niveau || "") === wert ? "var(--accent)" : "transparent",
                              color: (z.niveau || "") === wert ? C.aufAkzent : "var(--text2)" }}>
                            {label}
                          </button>
                        ))}
                      </Segment>

                      {/* Klassenarbeit ja/nein — und bei ja der Termin. Die
                          Termine sind schon eingetragen; hier wird nur gesagt,
                          welcher zu diesem Thema gehoert. */}
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text2)" }}>
                        <input type="checkbox" checked={!!z.exam_id}
                          onChange={(e) => aendern(i, { exam_id: e.target.checked ? (daten.arbeiten[0]?.id ?? null) : null })} />
                        {t("stoffplan.mitArbeit")}
                      </label>
                      {z.exam_id != null && (
                        daten.arbeiten.length === 0 ? (
                          <span style={{ fontSize: 12, color: C.warning }}>{t("stoffplan.keineArbeit")}</span>
                        ) : (
                          <select value={z.exam_id ?? ""} onChange={(e) => aendern(i, { exam_id: e.target.value ? Number(e.target.value) : null })}
                            style={{ ...selectStyle, minWidth: 200 }}>
                            {daten.arbeiten.map((a2) => (
                              <option key={a2.id} value={a2.id}>
                                {new Date(a2.date).toLocaleDateString()} · {a2.title || t("kalender.examTitle")}
                              </option>
                            ))}
                          </select>
                        )
                      )}
                    </div>

                    {/* Die verknuepfte Arbeit steht DIREKT an ihrem Thema —
                        sie ist der Schlusspunkt dieses Abschnitts, nicht ein
                        Eintrag irgendwo weiter unten. */}
                    {(() => {
                      const a2 = daten.arbeiten.find((x) => x.id === z.exam_id);
                      if (!a2) return null;
                      return (
                        <div style={{ flexBasis: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                          background: "var(--bg2)", borderRadius: CONTROL_R, padding: "6px 10px", fontSize: 13 }}>
                          <Icon d={ICONS.edit} size={13} color="var(--text3)" />
                          <span style={{ fontWeight: 700 }}>{new Date(a2.date).toLocaleDateString()}</span>
                          <span>{a2.title || t("kalender.examTitle")}</span>
                          {a2.topics.map((x) => <span key={x} style={chipStyle}>{x}</span>)}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}

          {/* Was noch an keinem Thema haengt. Verknuepfte Arbeiten stehen oben
              bei ihrem Thema — hier bleibt, wofuer die Zuordnung noch fehlt. */}
          {daten.arbeiten.filter((a2) => !zeilen.some((z) => z.exam_id === a2.id)).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabel}>{t("stoffplan.arbeitenOffen")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {daten.arbeiten.filter((a2) => !zeilen.some((z) => z.exam_id === a2.id)).map((a) => (
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
