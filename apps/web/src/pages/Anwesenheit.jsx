// Modul Anwesenheit — Anwesenheit/Fehlzeiten je Klasse und Tag.
// Pro Schüler ein Status (da/fehlt/verspätet/entschuldigt). "da" ist Normalfall
// und wird nicht gespeichert. Übersicht zeigt Fehlzeiten und lässt nachtragen.
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { badge, btnSecondary, btnSmall, cardStyle, panelStyle, selectStyle, Segment, segmentBtn, Tabs, DatumNavigator, segmentInput, toolbarBtn, toolbarIconBtn, Icon, ICONS, COLORS as C } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import Speicherleiste, { useEntwurf } from "../components/Speichern.jsx";
import SpeicherBalken from "../components/SpeicherBalken.jsx";
import Portrait from "../components/Portrait.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useAktiv } from "../core/modules.js";
import { swr , lastClass } from "../core/cache.js";
import { useUrlClass } from "../core/klassenwahl.js";
import { wochentagMo0, ymd } from "../core/datum.js";
import { alsJson, hol } from "../core/melden.js";

const API = "/api/anwesenheit";
const STATI = ["da", "fehlt", "spaet", "entsch"];
const COL = { da: C.success, fehlt: C.danger, spaet: C.warning, entsch: C.info };

export default function Anwesenheit() {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const kalenderAktiv = aktiv("kalender");
  const [params] = useSearchParams();
  const [classes, setClasses] = useState([]);
  const [showLegend, setShowLegend] = useState(false); // Legende (Anwesend/Fehlt…) einklappbar
  // Vorauswahl per ?class= / ?date= (z. B. aus dem Kalender).
  const [classId, setClassId] = useState(() => Number(params.get("class")) || null);
  // Aus dem Kurs verlinkt (?class=&kurs=): dann diesen Inhalt zeigen.
  useUrlClass(setClassId);
  const [datum, setDatum] = useState(params.get("date") || ymd(new Date()));
  const [tag, setTag] = useState({});      // { student_id: {status,note} }
  const [summe, setSumme] = useState({});   // { student_id: {fehlt,spaet,entsch} }
  const [view, setView] = useState("tag");  // tag | uebersicht
  const [slots, setSlots] = useState([]);   // Stundenplan-Slots (falls Kalender aktiv)
  // Kam eine Klasse per Link (Kalender), nicht auf heutige Klassen filtern —
  // sonst könnte genau diese Klasse aus der Auswahl fallen.
  const nurHeute = !params.get("class");
  const [offen, setOffen] = useState(null); // aufgeklappter Schüler in der Übersicht
  const [verlauf, setVerlauf] = useState([]);
  const [stunde, setStunde] = useState(0); // 0 = ganzer Tag, sonst Stundenplan-Period

  useEffect(() => {
    const stop = swr("classes", "/api/classes", (d) => setClasses(Array.isArray(d) ? d : []));
    if (kalenderAktiv) {
      hol("/api/kalender/timetable", null).then((d) => setSlots(d?.slots || []));
      hol("/api/kalender/breaks").then((d) => setBreaks(Array.isArray(d) ? d : []));
    }
    return stop;
  }, [kalenderAktiv]);
  const [breaks, setBreaks] = useState([]);
  // Ist der gewählte Tag unterrichtsfrei (Ferien/Feiertag)?
  const istFrei = useMemo(() => breaks.find((b) => datum >= b.start_date.slice(0, 10) && datum <= b.end_date.slice(0, 10)), [breaks, datum]);

  // Klassen, die am gewählten Wochentag im Stundenplan stehen.
  const weekday = wochentagMo0(datum + "T00:00:00");
  const heutigeIds = useMemo(() => new Set(slots.filter((s) => s.weekday === weekday && s.class_id).map((s) => s.class_id)), [slots, weekday]);
  // Stunden dieser Klasse am gewählten Wochentag (für die optionale Stunden-Zuordnung).
  const tagStunden = useMemo(() => [...new Set(slots.filter((s) => s.weekday === weekday && s.class_id === classId).map((s) => s.period))].sort((a, b) => a - b), [slots, weekday, classId]);
  // Alle Stunden des Tages (Stunde → Klasse): in der Tag-Ansicht wählt man die
  // Stunde, das öffnet automatisch den zugehörigen Kurs/die Klasse.
  const tagSlots = useMemo(() => slots.filter((s) => s.weekday === weekday && s.class_id).sort((a, b) => a.period - b.period), [slots, weekday]);
  const stundenWahl = kalenderAktiv && view === "tag" && tagSlots.length > 0;
  // Tag-Ansicht: nur Klassen, die am gewählten Tag Unterricht haben (Stundenplan).
  // Übersicht: alle Klassen. Ohne Kalender/Stundenplan: alle.
  const filterAktiv = nurHeute && kalenderAktiv && view === "tag" && heutigeIds.size > 0;
  const sichtbareKlassen = filterAktiv ? classes.filter((c) => heutigeIds.has(c.id)) : classes;

  // Gültige Klasse sicherstellen, wenn Filter greift.
  useEffect(() => {
    if (!sichtbareKlassen.length) return;
    if (classId === null || !sichtbareKlassen.some((c) => c.id === classId)) { const w = lastClass(); setClassId(sichtbareKlassen.some((c) => c.id === w) ? w : sichtbareKlassen[0].id); }
  }, [sichtbareKlassen, classId]);

  // Stunde+Kurs auf die erste Stunde des Tages, wenn die aktuelle nicht passt.
  useEffect(() => {
    if (stundenWahl) {
      if (!tagSlots.some((s) => s.period === stunde && s.class_id === classId)) { setStunde(tagSlots[0].period); setClassId(tagSlots[0].class_id); }
    } else if (tagStunden.length && !tagStunden.includes(stunde)) setStunde(tagStunden[0]);
    else if (!tagStunden.length && stunde !== 0) setStunde(0);
  }, [tagSlots, tagStunden, stundenWahl]); // eslint-disable-line

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const students = cls?.students || [];

  const isoOf = (d) => new Date(d + "T00:00:00").toISOString();
  // Frische Serverdaten (anderer Tag, andere Klasse, andere Stunde) beenden den
  // Entwurf — sonst zeigte die Liste die Status des vorigen Tages weiter.
  const frisch = useRef(false);
  const loadTag = useCallback(() => {
    if (!classId) return;
    // Bei gewählter Stunde diese Stunde laden (Server belegt sie aus der
    // vorherigen vor); Stunde 0 = ganzer Tag (stärkster Status).
    const p = stunde ? `&period=${stunde}` : "";
    hol(`${API}/${classId}?date=${isoOf(datum)}${p}`, {}).then((d) => { frisch.current = true; setTag(d || {}); });
  }, [classId, datum, stunde]);
  const loadSumme = useCallback(() => {
    if (!classId) return;
    hol(`${API}/${classId}/summary`, {}).then((d) => setSumme(d || {}));
  }, [classId]);
  useEffect(() => { loadTag(); }, [loadTag]);
  useEffect(() => { if (view === "uebersicht") { loadSumme(); setOffen(null); } }, [view, loadSumme]);

  const mark = (sid, status, dateIso, period = null) => fetch(`${API}/${classId}`, alsJson("PUT", { student_id: sid, date: dateIso, status, note: "", period }));

  // ── Ein Entwurf für die ganze Tagesliste ──
  // Bisher schrieb jeder Klick sofort. Jetzt sammelt der Entwurf „Kind → Status"
  // (flach, damit ein Neuladen die Arbeitskopie wieder einholt), und die Leiste
  // unten schreibt alles auf einmal. Das kostet bei der Anwesenheit einen Klick
  // mehr am Ende der Runde — dafür ist danach sichtbar, dass es drin ist.
  const basis = useMemo(() => {
    const o = {};
    students.forEach((s) => { o[String(s.id)] = tag[String(s.id)]?.status || "da"; });
    return o;
  }, [students, tag]);
  const eTag = useEntwurf(basis, async (wert) => {
    for (const s of students) {
      const k = String(s.id);
      if (wert[k] === basis[k]) continue;
      await mark(s.id, wert[k], isoOf(datum), stunde || null).catch(() => {});
    }
    loadTag();
  });
  useEffect(() => { if (frisch.current) { frisch.current = false; eTag.verwerfen(); } });
  // Klassen-/Tageswechsel mit offenen Änderungen: nachfragen statt still verwerfen.
  const wechseln = (fn) => { if (eTag.geaendert && !window.confirm(t("speichern.verlassen"))) return; fn(); };

  const statusOf = (sid) => eTag.wert[String(sid)] || tag[String(sid)]?.status || "da";
  const setStatus = (sid, status) => eTag.setz({ [String(sid)]: status });
  const shift = (n) => { const d = new Date(datum + "T00:00:00"); d.setDate(d.getDate() + n); setDatum(ymd(d)); };

  // PDF-Report laden (Endpunkt ist auth-geschützt, daher fetch + Blob statt <a href>).
  const ladePdf = async (url, name) => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }).catch(() => null);
    if (!r || !r.ok) return;
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };

  const ladeVerlauf = (sid) => hol(`${API}/${classId}/student/${sid}`).then((d) => { frischV.current = true; setVerlauf(Array.isArray(d) ? d : []); });
  const oeffnen = (sid) => {
    if (offen === sid) { setOffen(null); return; }
    setOffen(sid); frischV.current = true; setVerlauf([]);
    ladeVerlauf(sid);
  };
  // Eigener Entwurf für den aufgeklappten Verlauf (eigene Maske, eigene Leiste
  // an Ort und Stelle): „Datum → Status", nachträglich geändert und erst mit
  // „Speichern" geschrieben.
  const frischV = useRef(false);
  const basisV = useMemo(() => Object.fromEntries(verlauf.map((v) => [v.date, v.status])), [verlauf]);
  const eV = useEntwurf(basisV, async (wert) => {
    for (const v of verlauf) {
      if (wert[v.date] === basisV[v.date]) continue;
      await mark(offen, wert[v.date], v.date).catch(() => {});
    }
    if (offen) await ladeVerlauf(offen);
    loadSumme();
  });
  useEffect(() => { if (frischV.current) { frischV.current = false; eV.verwerfen(); } });

  const legende = showLegend && (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--text3)", marginBottom: 12 }}>
      {STATI.map((st) => (
        <span key={st} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ ...badge(COL[st]), minWidth: 24, textAlign: "center" }}>{t(`anwesenheit.${st}Short`)}</span>
          {t(`anwesenheit.${st}`)}
        </span>
      ))}
    </div>
  );

  // Dieselbe Tastenreihe steht an zwei Stellen (Tagesliste und Verlauf). Sie war
  // zweimal gebaut — 34x30 mit Radius 8 hier, 30x26 mit Radius 7 dort. Eine Form,
  // und als Gruppe statt vier freistehender Kaesten: es ist EINE Entscheidung.
  const StatusWahl = ({ wert, onWahl }) => (
    <Segment>
      {STATI.map((st) => (
        <button key={st} onClick={() => onWahl(st)} title={t(`anwesenheit.${st}`)}
          style={{ ...segmentBtn, minWidth: 34, padding: "0 8px", fontWeight: 700,
            background: wert === st ? COL[st] + "22" : "transparent",
            color: wert === st ? COL[st] : "var(--text3)" }}>
          {t(`anwesenheit.${st}Short`)}
        </button>
      ))}
    </Segment>
  );

  return (
    <div style={{ maxWidth: "none" }}>
      <Werkzeugleiste
        links={stundenWahl ? (
          <select value={`${stunde}:${classId}`} onChange={(ev) => { const [p, c] = ev.target.value.split(":").map(Number); wechseln(() => { setStunde(p); setClassId(c); }); }}
            style={{ ...selectStyle, minWidth: 200 }} title={t("anwesenheit.periodHint")}>
            {tagSlots.map((s) => (
              <option key={`${s.period}:${s.class_id}`} value={`${s.period}:${s.class_id}`}>
                {s.period}. {t("kalender.period")} — {(classes.find((c) => c.id === s.class_id) || {}).name || ""}
              </option>
            ))}
          </select>
        ) : (
          <KursKlasseSelect value={classId} onChange={(id) => wechseln(() => setClassId(id))} />
        )}
        ansicht={<>
          <button onClick={() => setShowLegend((v) => !v)} className="icon-btn" title={t("anwesenheit.legend")} aria-label={t("anwesenheit.legend")}
            style={{ ...toolbarIconBtn, border: showLegend ? "1px solid var(--accent)" : toolbarIconBtn.border }}>
            <Icon d={ICONS.info} size={16} color={showLegend ? "var(--accent)" : "var(--text2)"} />
          </button>
          <Tabs value={view} onChange={setView}
            options={[["tag", t("anwesenheit.day")], ["uebersicht", t("anwesenheit.overview")]]} />
        </>} />

      {view === "tag" ? (
        <>
          {/* Tag frei wählbar (auch Vergangenheit/Ferien). Voreinstellung heute.
              Die Stunde ersetzt „ganzer Tag" — Abwesenheit wird je Stunde
              erfasst; nur wenn kein Stundenplan da ist, gilt der ganze Tag. */}
          <DatumNavigator style={{ marginBottom: 12 }}
            onZurueck={() => wechseln(() => shift(-1))} labelZurueck={t("kalender.prev")}
            onVor={() => wechseln(() => shift(1))} labelVor={t("kalender.next")}
            onHeute={() => wechseln(() => setDatum(ymd(new Date())))} labelHeute={t("anwesenheit.today")}
            mitte={<input type="date" value={datum} onChange={(ev) => { const v = ev.target.value; wechseln(() => setDatum(v)); }} style={segmentInput} />} />
          {legende}
          {istFrei ? (
            <div style={{ ...panelStyle, padding: "12px 16px", background: C.warning + "1a", border: "none", color: C.warning, fontSize: 14, fontWeight: 600 }}>
              <Icon d={ICONS.sun} size={14} color={C.warning} /> {t("anwesenheit.freeDay")}{istFrei.label ? `: ${istFrei.label}` : ""}
            </div>
          ) : students.length === 0 ? (
            <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("anwesenheit.noStudents")}</p>
          ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {students.map((s, i) => {
              const cur = statusOf(s.id);
              return (
                <div key={s.id} style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
                  <span style={{ color: "var(--text3)", fontSize: 12, width: 24, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
                  <Portrait student={s} size={26} />
                  <span style={{ flex: 1, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <StatusWahl wert={cur} onWahl={(st) => setStatus(s.id, st)} />
                </div>
              );
            })}
          </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px", flexWrap: "wrap" }}>
            <p style={{ fontSize: 13, color: "var(--text3)", margin: 0, flex: 1 }}>{t("anwesenheit.overviewHint")}</p>
            <button onClick={() => ladePdf(`${API}/${classId}/report.pdf`, `Fehlzeiten_${cls?.name || ""}.pdf`)} style={toolbarBtn}>{t("anwesenheit.classPdf")}</button>
          </div>
          {legende}
          {students.length === 0 && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("anwesenheit.noStudents")}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {students.map((s, i) => {
              const a = summe[String(s.id)] || { fehlt: 0, spaet: 0, entsch: 0 };
              const leer = !a.fehlt && !a.spaet && !a.entsch;
              const auf = offen === s.id;
              return (
                <div key={s.id} style={{ ...cardStyle, padding: 0 }}>
                  <button onClick={() => oeffnen(s.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
                    <span style={{ color: "var(--text3)", fontSize: 12, width: 24, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
                    <span style={{ flex: 1, fontWeight: 500 }}>{s.name}</span>
                    {leer ? <span style={{ fontSize: 13, color: "var(--text3)" }}>—</span> : (
                      <span style={{ display: "inline-flex", gap: 8, fontSize: 13, fontWeight: 600 }}>
                        {a.fehlt > 0 && <span style={{ color: COL.fehlt }}>{a.fehlt}× {t("anwesenheit.fehltShort")}</span>}
                        {a.spaet > 0 && <span style={{ color: COL.spaet }}>{a.spaet}× {t("anwesenheit.spaetShort")}</span>}
                        {a.entsch > 0 && <span style={{ color: COL.entsch }}>{a.entsch}× {t("anwesenheit.entschShort")}</span>}
                      </span>
                    )}
                    <span style={{ color: "var(--text3)", display: "inline-flex", transform: auf ? "rotate(90deg)" : "none" }}><Icon d={ICONS.open} size={12} /></span>
                  </button>
                  {auf && (
                    <div style={{ borderTop: "1px solid var(--border)", padding: "8px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        {/* Die Leiste steht IM aufgeklappten Verlauf: sie gehört
                            zu dieser Maske, nicht zur Tagesliste. */}
                        <Speicherleiste entwurf={eV} klein />
                        <button onClick={() => ladePdf(`${API}/${classId}/student/${s.id}/report.pdf`, `Fehlzeiten_${s.name}.pdf`)} style={{ ...btnSecondary, ...btnSmall }}>{t("anwesenheit.studentPdf")}</button>
                      </div>
                      {verlauf.length === 0 ? (
                        <p style={{ fontSize: 13, color: "var(--text3)", margin: "4px 0" }}>{t("anwesenheit.noEntries")}</p>
                      ) : verlauf.map((e) => (
                        <div key={e.date} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                          <span style={{ flex: 1, fontSize: 13 }}>{new Date(e.date).toLocaleDateString()}{e.period ? ` · ${e.period}. ${t("kalender.period")}` : ""}</span>
                          <StatusWahl wert={eV.wert[e.date] || e.status} onWahl={(st) => eV.setz({ [e.date]: st })} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      {/* Die Leiste schwebt unten: bei dreißig Kindern rollt die Werkzeugleiste
          längst aus dem Bild, und ein Speichern-Knopf, den man suchen muss,
          ist keiner. */}
      {view === "tag" && <SpeicherBalken entwurf={eTag} />}
    </div>
  );
}
