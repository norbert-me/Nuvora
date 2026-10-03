// Modul „Klassenarbeit auswerten": Aufgaben mit Thema + Maximalpunkten, dann ein
// Punkte-Raster (Zeilen = SuS, Spalten = Aufgaben, Zelle = erreichte Punkte).
// Daraus LIVE je SuS ein Fehlerprofil nach Thema, eine Note (Punkte/Max → Skala)
// und gezielte Wiederholung (Karten des schwachen Themas wieder fällig).
import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ANTWORT_COLORS, Boxplot, FOKUS_TON, FOKUS_TON_DECKEND, Segment, segmentBtn, COLORS as C, CONTROL_R, Empty, ICONS, Icon, Modal, StatCard, Tabs, btnPrimary, btnSecondary, cardStyle, chipStyle, iconBtn, inputStyle, klebtLinks, pageApp, panelStyle, td as tdBase, th as thBase, toolbarBtn, toolbarIconBtn } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { DialogFuss, nurGeaendertIn, useAutoSpeichern, useEntwurf } from "../components/Speichern.jsx";
import SpeicherBalken from "../components/SpeicherBalken.jsx";
import FruehwarnPanel from "../components/Fruehwarnung.jsx";
import MaterialPanel from "../components/MaterialPanel.jsx";
import Rueckmeldebogen, { BogenWahl } from "../components/Rueckmeldebogen.jsx";
import { mitNummer, themenFuerKurs, themenIndex, useThemen } from "../core/topics.js";
import { useKurs } from "../core/kurs.js";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import SuchSelect from "../components/SuchSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useAktiv } from "../core/modules.js";
import { askConfirm, showAlert } from "../core/dialog.jsx";
import { rememberClass } from "../core/cache.js";
import { gradeFromPct, gradeDetailed, quantile, stdev, DEFAULT_SCALE } from "../core/grades.js";
import { useKlassenListe, useUrlClass } from "../core/klassenwahl.js";
import { alsJson, hol } from "../core/melden.js";
import NotenUebernahme from "../components/NotenUebernahme.jsx";
import { konfidenzProzent, mittel, streuung, trennschaerfe } from "../core/aufgabenstatistik.js";
import { komma, kommaRund, rund } from "../core/zahl.js";
import { alleEinheiten, andereEinheiten, andereFassung, aufgabenPunkte, basis, eigeneEinheiten, einheitenFuer, gewechselt, punkte as punkteIn, wertung } from "../core/arbeitswertung.js";

const API = "/api/klassenarbeit";

// ─── Fehlerarten ───
// Wortgleich mit FEHLER_VALUES in klassenarbeit.py — der Server nimmt nichts
// anderes an. Reihenfolge = Klick-Kreislauf in der Zelle (leer → … → leer).
// Die Kuerzel stehen in der Zelle, der ganze Name im Titel: das Raster ist
// ohnehin breiter als der Bildschirm.
const FEHLER = [
  { key: "ansatz", ab: "A", color: C.danger },
  { key: "rechnen", ab: "R", color: C.warning },
  { key: "fluechtig", ab: "F", color: C.info },
  // Violett aus der vorhandenen Palette (ANTWORT_COLORS.B) statt eines
  // eigenen Hex-Werts — die vier COLORS-Toenungen sind schon vergeben.
  { key: "darstellung", ab: "D", color: ANTWORT_COLORS.B },
  { key: "leer", ab: "–", color: "var(--text3)" },
];
const FEHLER_CYCLE = ["", ...FEHLER.map((f) => f.key)];
// Das Kuerzel in der Zelle: abgeleitet aus chipStyle (dieselbe Pillenform wie
// ueberall), nur schmaler — es steht unter einem 42 px breiten Zahlenfeld.
const fehlerChip = { ...chipStyle, fontSize: 11, fontWeight: 700, padding: "1px 6px", minWidth: 20, textAlign: "center" };
const newId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Eine Zeile „je Aufgabe/Teilaufgabe": Label, Ø-Punkte, farbige %-Zahl, Balken
// auf eigener Zeile und (optional) Trennschärfe + 95%-KI darunter. Gemeinsam für
// „je Aufgabe" und „je Teilaufgabe", damit beide gleich aussehen.
// Was folgt aus den Zahlen? Die Reihenfolge ist die Reihenfolge der Dringlichkeit,
// und jeder Satz nennt den Wert, aus dem er stammt — eine Empfehlung ohne Beleg
// waere ein Orakel, und die Lehrkraft muss sie gegen ihre Klasse pruefen koennen.
//
// Der Kern der Sache: eine niedrige Trefferquote allein sagt nur „schwer". Erst
// zusammen mit der Trennschaerfe wird daraus eine Handlung — trennt die Aufgabe
// gut, kann die Klasse den Stoff nicht (also: wiederholen); trennt sie nicht,
// liegt es an der Aufgabe (also: Formulierung und Erwartungshorizont ansehen).
// Unter MINDEST_TS Kindern ist eine Trennschärfe Rauschen: eine Korrelation
// über sechs Werte kippt mit einem einzigen Kind. Dann gibt es aus ihr kein
// „Aufgabe prüfen" — sonst stünde es bei einem kleinen G-Kurs an jeder
// zweiten Aufgabe. Eine schwache Gruppe drückt dagegen nur die Quote, nicht
// die Trennschärfe: die misst, ob innerhalb DERER, die die Aufgabe schrieben,
// die Stärkeren besser abschneiden.
const MINDEST_TS = 8;
const tsBelastbar = (row) => row.disc != null && (row.n == null || row.n >= MINDEST_TS);
function schluss(row, t) {
  if (row.form) return null;                       // Darstellung: keine Sachaussage
  const d = tsBelastbar(row) ? row.disc : null, p = row.pct, n = row.nullAnteil;
  if (d != null && d < 0.1 && p < 75) return { art: "aufgabe", text: t("klassenarbeit.tipTask", { d: kommaRund(d, 2) }) };
  if (n != null && n >= 40 && p < 60) return { art: "aufgabe", text: t("klassenarbeit.tipEmpty", { n }) };
  if (p < 50 && (d == null || d >= 0.3)) return { art: "stoff", text: t("klassenarbeit.tipRepeat", { p }) };
  if (p >= 90 && row.vollAnteil != null && row.vollAnteil >= 70) return { art: "leicht", text: t("klassenarbeit.tipEasy", { v: row.vollAnteil }) };
  return null;
}

// EINE Zeile je Aufgabe: Name, Balken, Prozent, Ø-Punkte — und nur dann ein
// kurzes Etikett, wenn daraus etwas folgt („Aufgabe prüfen", „Wiederholen").
// Vorher standen je Aufgabe vier Kennzahlen und oft ein ganzer Absatz darunter;
// bei zwanzig Aufgaben (und unter „Alle" dreimal) war daraus nichts mehr zu
// lesen. Kennzahlen, Begruendung und Teilaufgaben klappen per Klick auf.
const RAT_FARBE = { aufgabe: C.danger, stoff: C.warning, leicht: "var(--text3)" };
function StatRow({ row, t, open, onToggle, small, kinder = null }) {
  const col = row.pct < 50 ? C.danger : row.pct < 75 ? C.warning : C.success;
  const dc = row.disc == null ? "var(--text3)" : row.disc >= 0.4 ? C.success : row.disc >= 0.2 ? C.warning : C.danger;
  const rat = small ? null : schluss(row, t);
  const details = row.disc != null || row.ciLow != null || row.nullAnteil != null || row.vollAnteil != null;
  const klickbar = !small && (details || rat || kinder);
  return (
    <div style={{ padding: small ? "4px 9px" : "6px 10px", borderRadius: panelStyle.borderRadius, background: small ? "var(--bg3)" : open ? "var(--bg2)" : "transparent", marginBottom: 2 }}>
      <div onClick={klickbar ? onToggle : undefined} style={{ display: "flex", alignItems: "center", gap: 10, cursor: klickbar ? "pointer" : "default", minHeight: 28 }}>
        {!small && <span style={{ display: "inline-flex", color: "var(--text3)", width: 12, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", visibility: klickbar ? "visible" : "hidden" }}><Icon d={ICONS.open} size={12} /></span>}
        <span style={{ width: small ? 70 : 90, flexShrink: 0, fontSize: small ? 12 : 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: small ? "var(--text2)" : "var(--text)" }}>{small ? `${t("klassenarbeit.part")} ${row.label}` : row.label}</span>
        {/* Balken: Radius = halbe Hoehe (Balken-Kappe), reine Grafik. */}
        <span style={{ flex: 1, minWidth: 40, height: 8, background: "var(--card)", borderRadius: 4, overflow: "hidden", border: "1px solid var(--border)" }}>
          <span style={{ display: "block", width: `${row.pct}%`, height: "100%", background: col }} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, color: col, minWidth: 40, textAlign: "right" }}>{row.pct}%</span>
        <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap", minWidth: 64, textAlign: "right" }}>⌀ {komma(row.avgP)}/{komma(row.max)}</span>
        {/* Trennschärfe gleich neben der Quote: eine niedrige Quote heißt bei
            einer schwächeren Gruppe wenig, die Trennschärfe sagt, ob die
            Aufgabe trotzdem sauber unterscheidet. Blass, wenn zu wenige
            Kinder sie geschrieben haben. */}
        <span title={tsBelastbar(row) ? t("klassenarbeit.discHint") : t("klassenarbeit.discWenig", { n: row.n ?? 0 })}
          style={{ fontSize: 12, whiteSpace: "nowrap", minWidth: 52, textAlign: "right", color: tsBelastbar(row) ? dc : "var(--text3)", fontWeight: tsBelastbar(row) ? 700 : 400 }}>
          {row.disc != null ? `${t("klassenarbeit.discKurz")} ${kommaRund(row.disc, 2)}` : ""}
        </span>
        {/* Das Etikett sagt, WAS zu tun ist; der ganze Satz steht im Titel und aufgeklappt. */}
        {!small && (
          <span title={rat ? rat.text : undefined} style={{ ...chipStyle, fontSize: 11, minWidth: 96, textAlign: "center", visibility: rat ? "visible" : "hidden",
            color: rat ? RAT_FARBE[rat.art] : undefined, background: rat ? `color-mix(in srgb, ${RAT_FARBE[rat.art]} 12%, transparent)` : undefined, fontWeight: 700 }}>
            {rat ? t(`klassenarbeit.ratKurz.${rat.art}`) : "–"}
          </span>
        )}
      </div>
      {open && !small && (
        <div style={{ margin: "6px 0 4px 22px" }}>
          {details && (
            <div style={{ display: "flex", gap: 14, fontSize: 12, color: "var(--text3)", flexWrap: "wrap" }}>
              {row.disc != null && <span title={t("klassenarbeit.discHint")}>{t("klassenarbeit.disc")}: <b style={{ color: dc }}>{kommaRund(row.disc, 2)}</b></span>}
              {row.ciLow != null && <span title={t("klassenarbeit.ciHint")}>{t("klassenarbeit.ci")}: <b style={{ color: "var(--text2)" }}>{row.ciLow}–{row.ciHigh}%</b></span>}
              {row.nullAnteil != null && <span title={t("klassenarbeit.cmpEmptyHint")}>{t("klassenarbeit.cmpEmpty")}: <b style={{ color: row.nullAnteil >= 40 ? C.danger : "var(--text2)" }}>{row.nullAnteil}%</b></span>}
              {row.vollAnteil != null && <span title={t("klassenarbeit.cmpFullHint")}>{t("klassenarbeit.cmpFull")}: <b style={{ color: "var(--text2)" }}>{row.vollAnteil}%</b></span>}
            </div>
          )}
          {rat && <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.45, color: "var(--text2)" }}>{rat.text}</div>}
          {kinder && <div style={{ marginTop: 6 }}>{kinder}</div>}
        </div>
      )}
    </div>
  );
}


// Wie stark ist jedes Thema in der Arbeit gewichtet? Punkte je Thema (aus den
// Einheiten, also bis auf die Teilaufgabe) und ihr Anteil an den Sachpunkten.
// Die Darstellung zaehlt nicht mit — sie prueft kein Thema. `abweichung` sagt,
// ob ein Thema deutlich vom gleichen Anteil abweicht (unter der Haelfte oder
// ueber dem Anderthalbfachen): die Faustregel „jedes Unterthema etwa gleich
// viele Punkte", sonst sagt eine Arbeit ueber das kleine Thema wenig.
//
// `mitDarstellung`: Anteil an der NOTE — dann steht die Darstellung als eigene
// Zeile (topic "form") dabei, und jeder Anteil bezieht sich auf alle
// Basispunkte. Die Faustregel (`abweichung`) vergleicht weiter nur die Themen
// untereinander.
export function themenGewichte(tasks, { mitDarstellung = false } = {}) {
  const je = new Map();
  let summe = 0;
  const formPunkte = (tasks || []).filter((tk) => tk.form).reduce((n, tk) => n + eigeneEinheiten(tk).reduce((m, u) => m + u.max, 0), 0);
  (tasks || []).filter((tk) => !tk.form).forEach((tk) => eigeneEinheiten(tk).forEach((u) => {
    const key = u.topic || null;
    je.set(key, (je.get(key) || 0) + u.max);
    summe += u.max;
  }));
  const mitThema = [...je.keys()].filter((k) => k != null).length;
  const gleich = mitThema ? 100 / mitThema : 0;
  const nenner = mitDarstellung ? summe + formPunkte : summe;
  const zeilen = [...je.entries()].map(([topic, punkte]) => {
    const sachAnteil = summe ? (punkte / summe) * 100 : 0;
    const abweichung = topic == null || !gleich || mitThema < 2 ? null
      : sachAnteil < gleich * 0.5 ? "wenig" : sachAnteil > gleich * 1.5 ? "viel" : null;
    return { topic, punkte, anteil: nenner ? (punkte / nenner) * 100 : 0, abweichung };
  }).sort((a, b) => (a.topic == null) - (b.topic == null) || b.punkte - a.punkte);
  if (mitDarstellung && formPunkte) zeilen.push({ topic: "form", punkte: formPunkte, anteil: nenner ? (formPunkte / nenner) * 100 : 0, abweichung: null });
  return zeilen;
}

// „Alle": die Auswertungen beider Blaetter zu EINER zusammenlegen — dieselbe
// Form, damit dieselbe Anzeige sie zeigt. Themen werden ueber die Punkte
// zusammengezaehlt (nicht die Prozente gemittelt), Aufgaben stehen getrennt
// mit „E ·"/„G ·" davor (es sind verschiedene Aufgaben), und die Noten-
// Kennzahlen entstehen neu aus den Noten und Prozenten aller Kinder.
export function vereineAnalysen(teile, topicLabel) {
  const da = teile.filter(([, a]) => a);
  const themen = new Map();
  da.forEach(([, a]) => a.topics.forEach((tp) => {
    const x = themen.get(tp.topic_id) || { topic_id: tp.topic_id, label: tp.label, e: 0, m: 0 };
    x.e += tp.e || 0; x.m += tp.m || 0; themen.set(tp.topic_id, x);
  }));
  const topics = [...themen.values()].map((x) => ({ ...x, pct: x.m ? Math.round((x.e / x.m) * 100) : 0 })).sort((a, b) => a.pct - b.pct);
  const gradedCount = da.reduce((n, [, a]) => n + a.gradedCount, 0);
  const schwach = new Map();
  da.forEach(([, a]) => a.weakGroups.forEach((g) => schwach.set(g.label, [...(schwach.get(g.label) || []), ...g.namen])));
  const weakGroups = [...schwach.entries()]
    .map(([label, namen]) => ({ label, namen, anteil: gradedCount ? Math.round(namen.length / gradedCount * 100) : 0 }))
    .sort((a, b) => b.namen.length - a.namen.length);
  const vor = (stufe, x) => `${stufe} · ${x}`;
  // „E · 3. (E)" waere doppelt: das Blatt steht schon vorn. Ein „(G)" am E-Blatt
  // (Wahlaufgabe, Fassung des anderen Blatts) bleibt dagegen stehen.
  const ohneEigene = (label, stufe) => (label.endsWith(` (${stufe})`) ? label.slice(0, -(stufe.length + 3)) : label);
  const perTask = da.flatMap(([stufe, a]) => a.perTask.map((tk) => ({ ...tk, id: vor(stufe, tk.id), label: vor(stufe, ohneEigene(tk.label, stufe)) })));
  const perUnit = da.flatMap(([stufe, a]) => a.perUnit.map((u) => ({ ...u, id: vor(stufe, u.id), taskId: vor(stufe, u.taskId) })));
  const notes = da.flatMap(([, a]) => a.noten.notes);
  const pctArr = da.flatMap(([, a]) => a.noten.pctArr);
  const total = da.reduce((n, [, a]) => n + a.noten.total, 0);
  return {
    topics, weakGroups, gradedCount, perTask, perUnit,
    students: da.flatMap(([, a]) => a.students),
    bogen: da.flatMap(([, a]) => a.bogen),
    fehlerRoh: da.flatMap(([, a]) => a.fehlerRoh),
    fehlerStat: fehlerStatAus(da.flatMap(([, a]) => a.fehlerRoh), topicLabel),
    noten: { ...notenStat(notes, pctArr, total), minPts: [], max: null },
  };
}

// Noten-Kennzahlen aus Noten und Prozenten — fuer ein Blatt wie fuer „Alle".
function notenStat(notes, pctArr, total) {
  const werte = notes.map((x) => x.wert).sort((a, b) => a - b);
  const dist = [1, 2, 3, 4, 5, 6].map((g) => notes.filter((x) => x.grade === g).length);
  // Teilnoten-Verteilung (Tendenz: 1+ 1 2+ 2 2- …) — feinere Alternative.
  // Kein "1+": im Einserband vergibt gradeDetailed keine Tendenz (siehe dort).
  const FINE = ["1", "2+", "2", "2-", "3+", "3", "3-", "4+", "4", "4-", "5+", "5", "5-", "6"];
  const distFine = FINE.map((lbl) => ({ label: lbl, grade: parseInt(lbl), count: notes.filter((x) => x.note === lbl).length }));
  const avg = werte.length ? Math.round((werte.reduce((a, b) => a + b, 0) / werte.length) * 100) / 100 : null;
  const r2 = (x) => rund(x, 2);
  const stats = werte.length ? { min: werte[0], q1: r2(quantile(werte, 0.25)), med: r2(quantile(werte, 0.5)), q3: r2(quantile(werte, 0.75)), max: werte[werte.length - 1], sd: r2(stdev(werte)) } : null;
  // Klassen-Kennzahlen wie CardVote: Ø-Prozent, Median-Prozent, 95%-KI, Anwesend.
  const avgPct = pctArr.length ? Math.round(mittel(pctArr)) : null;
  const medPct = pctArr.length ? Math.round(quantile([...pctArr].sort((a, b) => a - b), 0.5)) : null;
  const sdPct = pctArr.length ? Math.round(streuung(pctArr) * 10) / 10 : null;
  let ciLow = null, ciHigh = null;
  if (pctArr.length >= 2) { const half = 1.96 * (streuung(pctArr) / Math.sqrt(pctArr.length)); ciLow = Math.max(0, Math.round(mittel(pctArr) - half)); ciHigh = Math.min(100, Math.round(mittel(pctArr) + half)); }
  return { avg, dist, distFine, werte, n: notes.length, notes, pctArr, stats, avgPct, medPct, sdPct, ciLow, ciHigh, present: notes.length, total };
}

// Fehlerarten zusammenzaehlen — je Thema und je Kind.
function fehlerStatAus(fehlerRoh, topicLabel) {
  if (!fehlerRoh.length) return null;
  const zaehl = (arten) => arten.reduce((d, a2) => ({ ...d, [a2]: (d[a2] || 0) + 1 }), {});
  const proThema = new Map();
  fehlerRoh.forEach((f) => { if (f.topic) { if (!proThema.has(f.topic)) proThema.set(f.topic, []); proThema.get(f.topic).push(f.art); } });
  const proKind = new Map();
  fehlerRoh.forEach((f) => { if (!proKind.has(f.sid)) proKind.set(f.sid, { name: f.name, arten: [] }); proKind.get(f.sid).arten.push(f.art); });
  return {
    gesamt: zaehl(fehlerRoh.map((f) => f.art)),
    n: fehlerRoh.length,
    topics: [...proThema.entries()]
      .map(([tid, arten]) => ({ label: topicLabel(Number(tid)), typen: zaehl(arten), n: arten.length }))
      .sort((a2, b2) => b2.n - a2.n),
    students: [...proKind.entries()]
      .map(([sid, v]) => ({ student_id: sid, name: v.name, typen: zaehl(v.arten),
        haupt: Object.entries(zaehl(v.arten)).sort((a2, b2) => b2[1] - a2[1] || (a2[0] < b2[0] ? -1 : 1))[0][0] }))
      .sort((a2, b2) => (a2.name < b2.name ? -1 : 1)),
  };
}

// Die Auswertung EINES Blatts — aus dem Raster, ohne Server. Als Funktion
// ausserhalb der Seite, weil „Alle" sie je Blatt rechnet und zusammenlegt
// (`vereineAnalysen`); vorher stand sie im useMemo der Seite und liess sich
// nur fuer das gerade offene Blatt aufrufen.
export function rechneAnalyse({ work, wk, students, effScale, topicLabel, eigeneStufe, andereStufe }) {
  if (!work) return null;
  const tasks = work.tasks || [];
  const results = work.results || {};
  // Alle Einheiten BEIDER Fassungen; je Kind zaehlt nur die geschriebene
  // (core/arbeitswertung.js — dieselbe Regel wie _profile im Server). Themen
  // haengen an der Einheit: eine Teilaufgabe kann ein eigenes Thema tragen
  // und erbt sonst das der Fassung bzw. Aufgabe.
  const uMax = {}; tasks.forEach((tk) => alleEinheiten(wk, tk).forEach((u) => { uMax[u.id] = u.max; }));
  const pu = (sid, uid) => punkteIn(results[String(sid)], uid, uMax[uid] ?? 1);
  // Zeilen ohne jeden Eintrag zählen als 0 (leere/durchgefallene Arbeit) — nur
  // „krank" (abwesend) bleibt aussen vor. Damit die Auswertung aber nicht schon
  // vor der ersten Eingabe voller Nullen steht, erst wenn irgendein Wert da ist.
  const absent = new Set([...((work.absent) || []).map(String), ...Object.entries(results).filter(([, v]) => v === "abwesend").map(([k]) => k)]);
  // Gewertet wird, wer erfasst IST — nicht die ganze Klasse, sobald das erste
  // Kind korrigiert ist. Sonst zieht jede noch leere Zeile den Schnitt mit
  // einer 0 nach unten, und die Notenverteilung zeigt eine Wand aus Sechsen,
  // waehrend man noch am Korrigieren ist. Eine bewusst eingetragene 0 zaehlt,
  // ein leeres Feld nicht.
  const erfasstIst = (s) => {
    const r = results[String(s.id)];
    if (absent.has(String(s.id)) || !r || r === "abwesend") return false;
    if (Array.isArray(r)) return true;                 // Altformat
    return Object.values(r).some((v) => v != null && v !== "");
  };
  const graded = students.filter(erfasstIst);
  // Je Kind seine Wertung und sein Themenprofil — beides in der Fassung,
  // die es je Aufgabe geschrieben hat.
  const wert = new Map(graded.map((s) => [s.id, wertung(wk, s.id, effScale)]));
  const themenVon = (sid) => {
    const d = {};
    tasks.forEach((tk) => einheitenFuer(wk, sid, tk).forEach((u) => {
      if (!u.topic) return;
      const x = (d[u.topic] ||= [0, 0]); x[0] += pu(sid, u.id); x[1] += u.max;
    }));
    return d;
  };
  const profil = new Map(graded.map((s) => [s.id, themenVon(s.id)]));
  const themenIds = [...new Set([...profil.values()].flatMap((d) => Object.keys(d)))];
  const mean = mittel;   // aus core/aufgabenstatistik.js

  const topicsOut = themenIds.map((tid) => {
    let e = 0, m = 0; graded.forEach((s) => { const x = profil.get(s.id)[tid]; if (x) { e += x[0]; m += x[1]; } });
    return { topic_id: Number(tid), label: topicLabel(Number(tid)), pct: m ? Math.round((e / m) * 100) : 0, e, m };
  }).sort((a, b) => a.pct - b.pct);
  const schwachVon = (sid) => Object.entries(profil.get(sid)).filter(([, [e, m]]) => m && e / m < 0.5).map(([tid]) => topicLabel(Number(tid)));
  // Nach Thema gruppiert: {label, namen[], anteil}. Sortiert nach Anzahl —
  // das Thema, an dem die halbe Klasse haengt, gehoert nach oben, nicht das
  // erste im Alphabet.
  const weakGroups = (() => {
    const map = new Map();
    graded.forEach((s) => schwachVon(s.id).forEach((label) => {
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(s.name);
    }));
    return [...map.entries()]
      .map(([label, namen]) => ({ label, namen, anteil: graded.length ? Math.round(namen.length / graded.length * 100) : 0 }))
      .sort((a, b) => b.namen.length - a.namen.length);
  })();

  const studentsOut = graded.map((s) => {
    const weak = schwachVon(s.id);
    return weak.length ? { student_id: s.id, name: s.name, weak } : null;
  }).filter(Boolean);
  // je Aufgabe: Ø-Punkte (⌀/Max), Trefferquote, Trennschärfe (Item-Total-
  // Korrelation) und 95%-Konfidenzintervall der mittleren Trefferquote.
  // Eine Aufgabe mit E-Fassung steht ZWEIMAL da — je Fassung mit genau den
  // Kindern, die sie geschrieben haben: es sind zwei verschiedene Aufgaben,
  // und ein Mittel ueber beide sagte ueber keine etwas.
  // Die Darstellung steht nicht darin: sie prueft keine Aufgabe, sondern die
  // Form der ganzen Arbeit, und eine Trefferquote daneben laede zum
  // Vergleich mit den Sachaufgaben ein. In die Note zaehlt sie weiter.
  const sachSumme = (sid) => tasks.reduce((n, tk) => n + (tk.form ? 0 : aufgabenPunkte(wk, sid, tk)), 0);
  const perTask = [];
  const perUnit = [];
  tasks.forEach((tk, i) => {
    if (tk.form) return;
    const fassungen = [{ stufe: eigeneStufe, anders: false, us: eigeneEinheiten(tk) },
      ...(andereFassung(wk, tk) ? [{ stufe: andereStufe, anders: true, us: andereEinheiten(wk, tk) }] : [])];
    fassungen.forEach(({ stufe, anders, us }) => {
      const kinder = graded.filter((s) => gewechselt(wk, s.id, tk) === anders);
      if (fassungen.length > 1 && !kinder.length) return;
      const zid = anders ? `${tk.id}~` : tk.id;
      const xs = kinder.map((s) => us.reduce((n, u) => n + pu(s.id, u.id), 0));
      // Gesamtleistung OHNE Darstellung — sie bewertet die Form, nicht den
      // Stoff, und verschoebe sonst die Trennschaerfe jeder Sachaufgabe.
      const tot = kinder.map((s) => sachSumme(s.id));
      const mx = us.reduce((n, u) => n + u.max, 0);
      const e = xs.reduce((a, b) => a + b, 0);
      const m = kinder.length * mx;
      // Trennschärfe und 95%-KI rechnet core/aufgabenstatistik.js — dieselben
      // vierzehn Zeilen standen hier und gleich noch einmal bei den Teilaufgaben.
      const disc = trennschaerfe(xs, tot);
      const { ciLow, ciHigh } = konfidenzProzent(xs, mx);
      const nullAnteil = xs.length ? Math.round(xs.filter((x) => x === 0).length / xs.length * 100) : null;
      const vollAnteil = xs.length ? Math.round(xs.filter((x) => x >= mx).length / xs.length * 100) : null;
      perTask.push({ id: zid, n: kinder.length, label: `${tk.label || `${i + 1}.`}${fassungen.length > 1 ? ` (${stufe})` : ""}`, pct: m ? Math.round((e / m) * 100) : 0,
                     avgP: Math.round(mean(xs) * 10) / 10, max: mx, disc, ciLow, ciHigh,
                     nullAnteil, vollAnteil, form: !!tk.form });
      // Ø je Teilaufgabe (nur wo eine Fassung echte Teile hat).
      if (us.length < 2) return;
      us.forEach((u) => {
        const ux = kinder.map((s) => pu(s.id, u.id));
        const avgP = mean(ux);
        const d2 = trennschaerfe(ux, tot);
        const ki = konfidenzProzent(ux, u.max);
        perUnit.push({ id: u.id, n: kinder.length, taskId: zid, label: u.label || "", avgP: Math.round(avgP * 10) / 10, max: u.max, pct: u.max ? Math.round((avgP / u.max) * 100) : 0, disc: d2, ciLow: ki.ciLow, ciHigh: ki.ciHigh });
      });
    });
  });

  // Endnote je SuS: Wertung (Basis + E-Bonus) → Note mit Tendenz + Notenwert.
  const tm = basis(tasks);
  const notes = graded.map((s) => { const d = gradeDetailed(wert.get(s.id).pct, effScale); return { name: s.name, note: d.note, wert: d.wert, grade: d.grade }; });
  const minPts = [1, 2, 3, 4, 5].map((g) => ({ grade: g, pts: Math.ceil(((effScale[g] || 0) / 100) * tm) }));
  const pctArr = graded.map((s) => wert.get(s.id).pct);
  const noten = { ...notenStat(notes, pctArr, students.length), minPts, max: tm };
  // ── Fehlerarten ──
  // Dieselben zwei Regeln wie im Server (_fehler_gezaehlt in
  // klassenarbeit.py): nur gewertete Kinder, und nur Zellen, in denen
  // wirklich Punkte fehlen. Beide Seiten muessen hier dasselbe rechnen, sonst
  // zeigt die Seite andere Zahlen als die API.
  // Und nur in der Fassung, die das Kind geschrieben hat.
  const meineEinheiten = (sid) => new Map(tasks.flatMap((tk) => einheitenFuer(wk, sid, tk).map((u) => [u.id, u])));
  const fehlerRoh = [];
  graded.forEach((s) => {
    const zeile = (work.fehler || {})[String(s.id)] || {};
    const meine = meineEinheiten(s.id);
    Object.entries(zeile).forEach(([uid, art]) => {
      const u = meine.get(uid);
      if (!u || pu(s.id, uid) >= u.max) return;
      fehlerRoh.push({ sid: s.id, name: s.name, uid, art, topic: u.topic || null });
    });
  });
  const zaehl = (arten) => arten.reduce((d, a2) => ({ ...d, [a2]: (d[a2] || 0) + 1 }), {});
  const fehlerStat = fehlerStatAus(fehlerRoh, topicLabel);

  // ── Rueckmeldebogen: je Kind ALLES, was auf sein Blatt gehoert ──
  // Bewusst je Kind vollstaendig und ohne einen einzigen Vergleich mit der
  // Klasse: das Blatt wird ausgedruckt und ausgeteilt, und was ein anderes
  // Kind geschrieben hat, geht niemanden etwas an. Kein Rang, kein
  // Klassenschnitt, keine fremden Namen.
  // Wiederholungsaufgaben: jede Einheit (Teilaufgabe, sonst die Aufgabe) unter
  // der Haelfte — in der Fassung, die das Kind geschrieben hat. Die
  // Darstellung nicht: sie ist keine Aufgabe, die man wiederholt.
  const wdhVon = (sid) => {
    const liste = [];
    tasks.forEach((tk, i) => {
      if (tk.form) return;
      const anders = gewechselt(wk, sid, tk);
      const us = einheitenFuer(wk, sid, tk);
      const basisLabel = `${tk.label || `${i + 1}.`}`;
      us.forEach((u) => {
        const e = pu(sid, u.id);
        if (e >= u.max * 0.5) return;
        const label = us.length > 1 && u.label ? `${basisLabel.replace(/\.$/, "")}${u.label}` : basisLabel;
        liste.push({ id: u.id, label: anders ? `${label} (${andereStufe})` : label, topic: u.topic ? Number(u.topic) : null, thema: u.topic ? topicLabel(Number(u.topic)) : "", erreicht: rund(e, 2), max: u.max });
      });
    });
    return liste;
  };
  const bogen = graded.map((s) => {
    const w = wert.get(s.id);
    const themen = Object.entries(profil.get(s.id)).map(([tid, [e, m]]) => (
      { label: topicLabel(Number(tid)), erreicht: e, max: m, pct: m ? Math.round(e / m * 100) : 0 }
    )).sort((a2, b2) => a2.pct - b2.pct);
    const eigene = (work.fehler || {})[String(s.id)] || {};
    const meine = meineEinheiten(s.id);
    const arten = Object.entries(eigene)
      .filter(([uid]) => meine.has(uid) && pu(s.id, uid) < meine.get(uid).max)
      .map(([, art]) => art);
    const haeufigste = arten.length
      ? Object.entries(zaehl(arten)).sort((a2, b2) => b2[1] - a2[1] || (a2[0] < b2[0] ? -1 : 1))[0][0]
      : null;
    return {
      student_id: s.id, name: s.name, punkte: rund(w.erreicht, 2), max: tm, pct: Math.round(w.pct),
      note: tm ? gradeFromPct(w.pct, effScale) : null,
      // ≥ 75 % sass, < 50 % ist Baustelle. Dazwischen steht bewusst nichts:
      // ein Blatt, auf dem jedes Thema kommentiert ist, liest niemand.
      sass: themen.filter((x) => x.pct >= 75),
      offen: themen.filter((x) => x.pct < 50),
      haupt: haeufigste,
      wdh: wdhVon(s.id),
      // Anteil je Thema in Prozent — daraus folgt, wie viele Wiederholungs-
      // aufgaben das Thema bekommt (wdhAnzahl).
      themenPct: Object.fromEntries(Object.entries(profil.get(s.id)).map(([tid, [e, m]]) => [tid, m ? (e / m) * 100 : 0])),
    };
  });

  return { topics: topicsOut, students: studentsOut, weakGroups, fehlerStat, fehlerRoh, bogen, gradedCount: graded.length, perTask, perUnit, noten };
}

// Wiederholung aus dem Lernpfad: statt der Original-Aufgabe bekommt jedes Kind
// je schwachem Thema eine ANDERE Aufgabe zum selben Thema aus der eigenen
// Aufgabenliste des Lernpfads — so viele, wie Einheiten des Themas unter der
// Haelfte blieben — wie viele, sagt `wdhAnzahl`. Die Original-Aufgabe der Arbeit kommt
// NIE auf den Bogen (ausdruecklich nicht gewollt).
// Gesucht wird der Reihe nach, bis etwas da ist:
//   1. dasselbe Thema (id),
//   2. ein Thema gleichen Namens (der Lernpfad legt Themen beim Import nach
//      NAMEN an — dasselbe Unterthema kann zweimal existieren),
//   3. die Unterthemen, wenn die Arbeit nur das Oberthema nennt,
//   4. das Oberthema und seine anderen Unterthemen.
// Die Kinder bekommen verschiedene Aufgaben, soweit der Pool reicht (Versatz je
// Kind). Leere Aufgaben und Platzhalter des alten Knopfs zaehlen nicht.
// Themen ohne jeden Treffer stehen in `fehlend` — die Lehrkraft erfaehrt es
// vor dem Druck, statt einen Bogen mit Luecke zu verteilen.
// Je schlechter das Thema insgesamt, desto mehr Uebung — anteilig bis zu
// einer Obergrenze, die die Lehrkraft im Druck-Dialog waehlt: 0 % ergibt das
// Maximum, 50 % die Haelfte (gerundet), mindestens eine (das Thema steht nur
// hier, weil eine Teilaufgabe schwach war).
export function wdhAnzahl(pct, max = 3) {
  const m = Math.max(1, Math.min(5, Math.round(max) || 3));
  if (pct == null) return 1;
  return Math.max(1, Math.min(m, Math.round(m * (1 - pct / 100))));
}

export function wdhZuteilen(bogen, pool, byId, max = 3) {
  // Brauchbar ist, was das Kind finden kann: ein Aufgabentext, eine Formel
  // ODER ein Verweis („Schulbuch S.11 Nr.8") — viele Aufgabenlisten bestehen
  // nur aus Verweisen, und die fielen vorher alle heraus. Die leeren
  // Platzhalter des alten Knopfs („Wiederholung: …") zaehlen nicht.
  const brauchbar = (pool || []).filter((x) => ((x.aufgabentext || "").trim() || (x.latex || "").trim() || (x.quelle_detail || "").trim())
    && !/^Wiederholung: /.test(x.aufgabentext || ""));
  const jeThema = new Map();
  brauchbar.forEach((x) => { if (x.topic_id != null) jeThema.set(x.topic_id, [...(jeThema.get(x.topic_id) || []), x]); });
  const alle = byId ? [...byId.values()] : [];
  // Namen ohne fuehrende Nummer vergleichen: „1 Vervielfachen und Teilen"
  // (Nummer im Namen, aus einem Import) ist dasselbe Thema wie „Vervielfachen
  // und Teilen" mit Nummer im eigenen Feld.
  const ohneNummer = (n) => (n || "").trim().toLowerCase().replace(/^\d+(?:[.,]\d+)*\.?\s+/, "");
  const nameVon = (tid) => ((byId && byId.get(tid)) ? ohneNummer(byId.get(tid).name) : "");
  const aus = (ids) => ids.flatMap((i) => jeThema.get(i) || []);
  const kandidaten = (tid) => {
    if (jeThema.has(tid)) return jeThema.get(tid);
    const name = nameVon(tid);
    const gleichNamig = name ? aus(alle.filter((x) => x.id !== tid && ohneNummer(x.name) === name).map((x) => x.id)) : [];
    if (gleichNamig.length) return gleichNamig;
    const kinder = aus(alle.filter((x) => x.parent_id === tid).map((x) => x.id));
    if (kinder.length) return kinder;
    const tp = byId && byId.get(tid);
    if (tp && tp.parent_id) {
      const eltern = [...(jeThema.get(tp.parent_id) || []), ...aus(alle.filter((x) => x.parent_id === tp.parent_id && x.id !== tid).map((x) => x.id))];
      if (eltern.length) return eltern;
    }
    return [];
  };
  const fehlend = new Map();   // topic (oder Label) -> { topic, thema }
  const out = bogen.map((b, k) => {
    const themen = new Map();
    (b.wdh || []).forEach((x) => {
      const key = x.topic ?? `ohne-${x.id}`;
      if (!themen.has(key)) themen.set(key, { topic: x.topic, thema: x.thema, statt: [] });
      themen.get(key).statt.push(x);
    });
    const wdhAufgaben = [];
    [...themen.values()].forEach((g) => {
      const liste = g.topic != null ? kandidaten(g.topic) : [];
      const pct = g.topic != null && b.themenPct ? b.themenPct[g.topic] : null;
      const n = Math.min(wdhAnzahl(pct, max), liste.length);
      for (let i = 0; i < n; i++) {
        const ex = liste[(k * 3 + i) % liste.length];
        wdhAufgaben.push({ thema: g.thema, ex: {
          id: ex.id, code: ex.code, text: (ex.aufgabentext || "").trim() || (ex.latex || "").trim(),
          quelle: (ex.quelle_detail || "").trim() ? `${ex.quelle_typ === "schulbuch" ? "Schulbuch" : ex.quelle_typ === "klassenarbeit" ? "Klassenarbeit" : (ex.quelle_typ || "")} ${ex.quelle_detail}`.trim() : "",
          operator: ex.operator || "",
        } });
      }
      if (!n) fehlend.set(g.topic ?? g.thema, { topic: g.topic, thema: g.thema || "–" });
    });
    return { ...b, wdhAufgaben };
  });
  out.fehlend = [...fehlend.values()];
  return out;
}

// „Auswertung" einer E/G-Arbeit prueft die ARBEIT, nicht die Kurse: jede
// Aufgabe wird ueber alle Kinder ausgewertet, die genau diese Fassung
// geschrieben haben — die E-Aufgabe 3 also mit dem E-Kurs UND den G-Kindern,
// die sie gewaehlt haben (deren Punkte liegen im G-Blatt unter "~"). Die
// Trennschaerfe misst gegen den ANTEIL der Sachpunkte, weil die Kinder
// verschiedene Blaetter mit verschiedenen Hoechstpunkten schrieben.
// Reihenfolge nach Position: E · 1., G · 1., E · 2., … — so steht nebeneinander,
// was einander entspricht.
// „E-Kurs"/„G-Kurs" unter „Auswertung": die Aufgaben DIESER Arbeit (des
// E- bzw. G-Blatts) — weiter über alle, die sie geschrieben haben, aber ohne
// die Aufgaben des anderen Blatts.
export function aufgabenDerArbeit(aufgaben, stufe) {
  if (!aufgaben || stufe === "alle") return aufgaben;
  const vor = `${stufe} · `;
  return { perTask: aufgaben.perTask.filter((x) => x.id.startsWith(vor)), perUnit: aufgaben.perUnit.filter((u) => u.taskId.startsWith(vor)) };
}

export function aufgabenUeberAlle(blaetter, alleStudents) {
  const da = blaetter.filter(Boolean);
  const proKind = [];   // { b, wk, sid } je gewertetes Kind
  da.forEach((b) => {
    const anderes = da.find((x) => x !== b);
    const wk = { ...b, _alt: (anderes && anderes.tasks) || [] };
    const results = b.results || {};
    const absent = new Set([...(b.absent || []).map(String), ...Object.entries(results).filter(([, v]) => v === "abwesend").map(([k]) => k)]);
    alleStudents.filter((st) => (st.niveau || "") === (b.niveau || "")).forEach((st) => {
      const r = results[String(st.id)];
      if (absent.has(String(st.id)) || !r || r === "abwesend") return;
      if (!Array.isArray(r) && !Object.values(r).some((v) => v != null && v !== "")) return;
      proKind.push({ b, wk, sid: st.id });
    });
  });
  const pu = (k, u) => punkteIn((k.b.results || {})[String(k.sid)], u.id, u.max);
  const sachAnteil = (k) => {
    let e = 0, m = 0;
    (k.b.tasks || []).forEach((tk) => {
      if (tk.form) return;
      einheitenFuer(k.wk, k.sid, tk).forEach((u) => { e += pu(k, u); m += u.max; });
    });
    return m ? e / m : 0;
  };
  const anteil = new Map(proKind.map((k) => [k, sachAnteil(k)]));
  const zeilen = [];
  const perUnit = [];
  da.forEach((b) => {
    const sach = (b.tasks || []).filter((tk) => !tk.form);
    sach.forEach((tk, pos) => {
      const eigene = eigeneEinheiten(tk);
      // Wer schrieb diese Fassung? Kinder des Blatts ohne Wechsel und Kinder
      // des anderen Blatts, die an derselben Stelle gewechselt haben.
      const schreiber = proKind.flatMap((k) => {
        if (k.b === b) return gewechselt(k.wk, k.sid, tk) ? [] : [{ k, us: eigene }];
        const ihre = (k.b.tasks || []).filter((x) => !x.form)[pos];
        return ihre && gewechselt(k.wk, k.sid, ihre) ? [{ k, us: andereEinheiten(k.wk, ihre) }] : [];
      });
      if (!schreiber.length) return;
      const id = `${b.niveau} · ${tk.id}`;
      const mx = eigene.reduce((n, u) => n + u.max, 0);
      const xs = schreiber.map(({ k, us }) => us.reduce((n, u) => n + pu(k, u), 0));
      const tot = schreiber.map(({ k }) => anteil.get(k));
      const e = xs.reduce((a, c) => a + c, 0);
      const { ciLow, ciHigh } = konfidenzProzent(xs, mx);
      zeilen.push({ pos, stufe: b.niveau, row: {
        id, label: `${b.niveau} · ${tk.label || `${(b.tasks || []).indexOf(tk) + 1}.`}`, n: xs.length,
        pct: mx ? Math.round((e / (xs.length * mx)) * 100) : 0, avgP: Math.round(mittel(xs) * 10) / 10, max: mx,
        disc: trennschaerfe(xs, tot), ciLow, ciHigh,
        nullAnteil: Math.round(xs.filter((x) => x === 0).length / xs.length * 100),
        vollAnteil: Math.round(xs.filter((x) => x >= mx).length / xs.length * 100),
      } });
      if (eigene.length < 2) return;
      eigene.forEach((u, j) => {
        const ux = schreiber.map(({ k, us }) => pu(k, us[j]));
        const avgP = mittel(ux);
        const ki = konfidenzProzent(ux, u.max);
        perUnit.push({ id: `${id}·${u.id}`, n: ux.length, taskId: id, label: u.label || "", avgP: Math.round(avgP * 10) / 10, max: u.max,
          pct: u.max ? Math.round((avgP / u.max) * 100) : 0, disc: trennschaerfe(ux, tot), ciLow: ki.ciLow, ciHigh: ki.ciHigh });
      });
    });
  });
  zeilen.sort((a, c) => a.pos - c.pos || (a.stufe < c.stufe ? -1 : 1));
  return { perTask: zeilen.map((z) => z.row), perUnit };
}

// Gewichtung der Themen als Balkenliste — unter den Aufgaben (Anteil an den
// Sachpunkten) und in der Auswertung (Anteil an der Note, mit Darstellung).
// Gegliedert nach Oberthema: hängen Punkte an Unterthemen, steht das
// Oberthema mit der Summe darüber und die Unterthemen eingerückt darunter —
// beide Ebenen sind eine Frage der Gewichtung („wie viel Bruchrechnung?" und
// „wie viel davon Kürzen?").
export function gewichtGruppen(gw, byId) {
  const wurzel = (tid) => { const tp = byId.get(tid); return tp && tp.parent_id && byId.has(tp.parent_id) ? tp.parent_id : tid; };
  const gruppen = new Map();
  const rest = [];
  gw.forEach((x) => {
    if (x.topic == null || x.topic === "form") { rest.push({ ...x, ebene: 0 }); return; }
    const w = wurzel(x.topic);
    if (!gruppen.has(w)) gruppen.set(w, { eigen: null, kinder: [] });
    const g = gruppen.get(w);
    if (w === x.topic) g.eigen = x; else g.kinder.push(x);
  });
  const zeilen = [];
  [...gruppen.entries()].map(([w, g]) => {
    const alle = [g.eigen, ...g.kinder].filter(Boolean);
    return { w, g, punkte: alle.reduce((n, x) => n + x.punkte, 0), anteil: alle.reduce((n, x) => n + x.anteil, 0) };
  }).sort((a, b) => b.punkte - a.punkte).forEach(({ w, g, punkte, anteil }) => {
    if (!g.kinder.length) { zeilen.push({ ...g.eigen, ebene: 0 }); return; }
    zeilen.push({ topic: w, punkte, anteil, abweichung: null, ebene: 0, summe: true });
    // Punkte direkt am Oberthema (ohne Unterthema) stehen als eigene Zeile drunter.
    if (g.eigen) zeilen.push({ ...g.eigen, ebene: 1, direkt: true });
    g.kinder.sort((a, b) => b.punkte - a.punkte).forEach((x) => zeilen.push({ ...x, ebene: 1 }));
  });
  return [...zeilen, ...rest];
}

function ThemenGewichte({ gw, titel, hint, themen, t, rand = 16 }) {
  if (!gw.some((x) => x.topic != null && x.topic !== "form")) return null;
  const zeilen = gewichtGruppen(gw, themen.byId);
  const name = (x) => {
    if (x.topic == null) return t("klassenarbeit.topicNone");
    if (x.topic === "form") return t("klassenarbeit.form");
    const tp = themen.byId.get(x.topic);
    if (x.direkt) return t("klassenarbeit.gewichtDirekt");
    return x.ebene ? mitNummer(tp) : (tp ? themen.label(tp) : "?");
  };
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: panelStyle.borderRadius, padding: "10px 12px", marginBottom: rand, background: "var(--card)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text2)", marginBottom: 8 }} title={hint}>{titel}</div>
      {zeilen.map((x) => {
        return (
          <div key={`${x.topic ?? "ohne"}-${x.ebene}-${x.direkt ? "d" : ""}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: x.ebene ? 12 : 13, marginBottom: 4, paddingLeft: x.ebene ? 16 : 0 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: x.summe ? 700 : 400,
              color: x.topic == null || x.topic === "form" || x.direkt ? "var(--text3)" : x.ebene ? "var(--text2)" : "var(--text)" }}>
              {name(x)}
            </span>
            <span style={{ width: 92, textAlign: "right", whiteSpace: "nowrap", color: x.abweichung ? C.warning : "var(--text2)", fontWeight: x.abweichung || x.summe ? 700 : 400 }}
              title={x.abweichung ? t(`klassenarbeit.gewicht_${x.abweichung}`) : undefined}>
              {komma(rund(x.punkte, 1))} P. · {Math.round(x.anteil)} %
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function Klassenarbeit() {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const kartenAktiv = aktiv("karten");
  const lernpfadAktiv = aktiv("lernpfad");
  const notenAktiv = aktiv("auswertung");
  const cardvoteAktiv = aktiv("cardvote");
  const [notenModal, setNotenModal] = useState(false);
  // Notenspalten, die mit dieser Arbeit VERKNUEPFT sind (kein Abzug): jedes
  // Speichern schickt die Noten neu, die Spalte folgt. Eine E/G-Arbeit teilt
  // sich die Spalte ueber beide Blaetter — der Server sucht ueber partner_id.
  const [verknuepft, setVerknuepft] = useState([]);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  useEffect(() => { try { const u = JSON.parse(localStorage.getItem("user")); if (u?.grade_scale) setScale(u.grade_scale); } catch { /* Default */ } }, []);
  const [hideIndividual, setHideIndividual] = useState(false); // #55: SuS-Ansicht — einzelne Leistungen + Noten aus
  const [fehlerModus, setFehlerModus] = useState(false);      // Fehlerart je Zelle erfassen (aus)
  // Wo wird gerade getippt? Zeile (Kind) und Spalte (Einheit) des Feldes mit
  // dem Fokus werden hervorgehoben — beim Uebertragen vom Papier verrutscht
  // man sonst in die Nachbarzeile. Folgt dem Fokus, kein eigener Schalter.
  const [fokus, setFokus] = useState(null);   // { sid, uid }
  // Aufgaben-Editor auf/zu: offen, wenn die Arbeit ohne Aufgaben geoeffnet
  // wird, sonst zu (Effekt unten); null nur bis dahin.
  const [aufgabenOffen, setAufgabenOffen] = useState(null);
  const [scaleOpen, setScaleOpen] = useState(false); // Notenschlüssel-Editor auf/zu
  const [expandedTasks, setExpandedTasks] = useState(() => new Set()); // aufgeklappte Teilaufgaben-Auswertung
  const [infoOpen, setInfoOpen] = useState(false); // „Auswertung verstehen"
  const [distMode, setDistMode] = useState("bar");   // Notenverteilung: "bar" | "box"
  const [barMode, setBarMode] = useState("whole");   // Balken: "whole" (1..6) | "fine" (Teilnoten)
  const [boxMode, setBoxMode] = useState("pct");     // Boxplot: "pct" (%) | "note" (Noten)
  // Note-Anzeige NUR aus der Profil-Präferenz (eine Person, eine Präferenz —
  // kein Umschalter je Seite mehr). "note" = Symbol 2+, "wert" = Dezimal 2,3.
  const gradeMode = (() => { try { const u = JSON.parse(localStorage.getItem("user")); return u && u.grade_tendency === false ? "wert" : "note"; } catch { return "note"; } })();
  // Deep-Link aus dem Kalender: ?class=…&work=… öffnet direkt die verknüpfte
  // Auswertung. Klasse als Startwert, gewünschte Auswertung merken bis geladen.
  const [params] = useSearchParams();
  const wantWork = useRef(Number(params.get("work")) || null);
  const [classId, setClassId] = useState(Number(params.get("class")) || null);
  // Kurs aus dem Deep-Link: eine Klasse kann in mehreren Kursen liegen — ohne
  // diesen Hinweis riete die Auswahl den ersten Kurs (Bug: „7.5" gewählt, Arbeit
  // landet unter „7.5 LZ"). Als kursValue an KursKlasseSelect weitergereicht.
  const [kursId, setKursId] = useState(Number(params.get("kurs")) || null);
  // Aus dem Kurs verlinkt (?class=&kurs=): dann diesen Inhalt zeigen.
  useUrlClass(setClassId, setKursId);
  // Rohliste der Klasse; `students` weiter unten ist die Liste DIESER Arbeit.
  const [alleStudents, setAlleStudents] = useState([]);
  // Kern-Themen aus core/topics.js — dieselbe Zeile stand auf sechs Seiten.
  const topics = useThemen();
  const [works, setWorks] = useState([]);
  // Serverstand der Arbeit (Basis) — die Arbeitskopie liegt im Entwurf.
  const [savedWork, setSavedWork] = useState(null);
  // Eine andere Arbeit (oder ein Neuladen) beendet die Arbeitskopie: `useEntwurf`
  // haelt sonst an ihr fest und zeigte die Punkte der vorigen Arbeit weiter.
  const frisch = useRef(false);
  const zeigeArbeit = (w) => { frisch.current = true; setSavedWork(w); }; // { id, name, tasks:[{id,label,topic_id}], results:{sid:[taskId]} }
  const kq = kursId != null ? `?kurs_id=${kursId}` : "";

  // Beim ersten Besuch gleich eine Klasse wählen (zuletzt genutzte, sonst erste),
  // damit die Arbeitsauswahl nicht ausgeblendet bleibt, bis man von Hand klickt.
  // Dieselbe Vorwahl wie ueberall (core/klassenwahl.js). Sie lief hier als
  // einzige mit rohem `fetch` statt `swr` — ohne Cache und ohne Grund.
  useKlassenListe(null, setClassId);
  // Laufende Nummer je Ladevorgang. Der Effekt feuert zweimal kurz nacheinander:
  // erst mit kursId = null (Anfangszustand), dann mit dem Kurs aus der Adresse.
  // Ohne kurs_id liefert list_works nur die KURSLOSEN Arbeiten (klassenarbeit.py,
  // `kurs_id.is_(None)`) — also meist eine leere Liste. Kommt diese veraltete
  // Antwort als zweite an, loescht sie die eben geladene Auswahl, und mit ihr
  // verschwinden alle Knoepfe, die an einer gewaehlten Arbeit haengen. Das war
  // reines Glueck: in drei von fuenf Laeufen ging das Rennen falsch aus.
  const ladenr = useRef(0);
  useEffect(() => {
    if (classId) rememberClass(classId);
    if (!classId) { setAlleStudents([]); setWorks([]); zeigeArbeit(null); return; }
    const meine = ++ladenr.current;   // nur die jüngste Antwort darf schreiben
    hol(`${API}/classes/${classId}/students`).then((d) => {
      if (meine === ladenr.current) setAlleStudents(Array.isArray(d) ? d : []);
    });
    hol(`${API}/classes/${classId}/works${kq}`).then((d) => {
      if (meine !== ladenr.current) return;
      const l = Array.isArray(d) ? d : [];
      setWorks(l);
      // Deep-Link: gewünschte Auswertung wählen, sonst die neueste.
      const target = wantWork.current ? l.find((x) => x.id === wantWork.current) : null;
      if (target) wantWork.current = null;
      zeigeArbeit(target || l[0] || null);
    });
  }, [classId, kursId]);

  // Beschriftung UND Reihenfolge aus core/topics.js — die eine Quelle. Die
  // frueher hier nachgebaute Fassung konnte nur beschriften; die Auswahl stand
  // dann in der Reihenfolge des Servers (position, name), also alphabetisch
  // nach dem UNTERthema: „… / 1 Kreis" landete zwischen fremden Oberthemen.
  const themen = themenIndex(topics);
  const kursObj = useKurs(kursId);
  // Einmal je Render fuer alle Themen-Auswahlen (Aufgabe und Teilaufgabe).
  // Nur die Themen dieses Kurses (Fach und Stufe); bereits vergebene bleiben.
  const vergeben = (work?.tasks || []).flatMap((tk) => [tk.topic_id, ...((tk.parts || []).map((p) => p.topic_id))]).filter(Boolean);
  const themenOptionen = themenFuerKurs(themen, kursObj, vergeben).map((tp) => ({ wert: String(tp.id), label: themen.label(tp) }));
  const topicLabel = (id) => themen.labelFuerId(id);

  // ── Ein Entwurf für die ganze Arbeit ──
  // Vorher schrieb ein Zeitgeber 600 ms nach dem letzten Tastendruck — man sah
  // nie, ob etwas drin ist. Jetzt sammelt der Entwurf Aufgaben, Punkte,
  // Notenschlüssel und „krank"; geschrieben wird mit der Leiste unten.
  const entwurf = useEntwurf(savedWork, async (next) => {
    if (!next || !next.id) return false;
    // scale: echtes dict = Override, sonst {} (Server setzt zurueck auf Profil).
    const scaleOut = (next.scale && Object.keys(next.scale).length) ? next.scale : {};
    const r = await fetch(`${API}/works/${next.id}`, alsJson("PUT", { name: next.name, tasks: next.tasks, results: next.results, scale: scaleOut, absent: next.absent || [], fehler: next.fehler || {}, wechsel: next.wechsel || {} })).catch(() => null);
    if (!r || !r.ok) { showAlert(t("common.notWork")); return false; }
    setSavedWork(next);
    if (verknuepft.length) {
      const sc = (next.scale && Object.keys(next.scale).length) ? next.scale : scale;
      await fetch(`/api/noten/verknuepft/${next.id}`, alsJson("PUT", {
        student_ids: students.map((s) => s.id), grades: notenAusArbeit(students, partner ? { ...next, _alt: partner.tasks || [] } : next, sc), note: t("klassenarbeit.title"),
      })).catch(() => null);
    }
    // Die Liste der Arbeiten bekommt den GANZEN gespeicherten Stand, nicht nur
    // den Namen: beim Wechsel E -> G -> E kommt das Blatt aus dieser Liste
    // zurueck, und mit nur dem Namen stand dort wieder das alte Thema, obwohl
    // das neue gespeichert war. Der Name gilt beiden Blaettern (der Server
    // zieht das andere mit).
    const { _alt: _ohne, ...gespeichert } = next;
    setWorks((ws) => ws.map((x) => (x.id === next.id ? { ...x, ...gespeichert }
      : (next.partner_id && x.id === next.partner_id) ? { ...x, name: next.name } : x)));
    return true;
  });
  useEffect(() => { if (frisch.current) { frisch.current = false; entwurf.verwerfen(); } });
  // Eingaben im Raster (Punkte, abwesend, Fehlerart, Wechsel E/G) speichern sich
  // selbst (useAutoSpeichern); Aufgaben, Name und Notenschluessel bleiben bei
  // der Leiste.
  const autoSpeichern = useAutoSpeichern(entwurf, (w) => nurGeaendertIn(w, savedWork, (k) => ["results", "absent", "fehler", "wechsel"].includes(k)));
  const work = entwurf.wert;
  const aufgabenAuf = aufgabenOffen ?? !((work && work.tasks) || []).length;
  const offenFuer = work && work.id;
  // Beim Oeffnen einer Arbeit EINMAL entscheiden — nicht laufend: sonst klappte
  // der Bereich nach der ersten angelegten Aufgabe mitten im Tippen zu.
  useEffect(() => { setAufgabenOffen(!((work && work.tasks) || []).length); }, [offenFuer]);
  // Die SuS DIESER Arbeit: bei einer E- oder G-Arbeit nur die des Niveaus — sie
  // haben das Blatt geschrieben, die anderen ein anderes. Ohne Niveau alle.
  // Gerechnet wird ohnehin nur ueber die eingetragenen Ergebnisse (_profile),
  // die Liste bestimmt, wer ueberhaupt zum Eintragen dasteht.
  const students = useMemo(() => {
    const n = (work && work.niveau) || "";
    return n ? alleStudents.filter((s) => (s.niveau || "") === n) : alleStudents;
  }, [alleStudents, work]);
  // Der Name bleibt: jede Geste geht weiter denselben einen Weg — nur endet er
  // jetzt im Entwurf statt beim Server.
  const persist = (next) => entwurf.setz(next);
  const workId = work && work.id;
  useEffect(() => {
    if (!notenAktiv || !workId) { setVerknuepft([]); return; }
    let weg = false;
    hol(`/api/noten/verknuepft/${workId}`).then((d) => { if (!weg) setVerknuepft(Array.isArray(d) ? d : []); });
    return () => { weg = true; };
  }, [notenAktiv, workId, notenModal]);
  // Andere Arbeit / andere Klasse gewählt: nachfragen, sonst wäre die
  // Arbeitskopie still weg.
  const wechseln = (fn) => {
    // Wer den Wechsel bestaetigt, hat die Aenderungen aufgegeben — die
    // Arbeitskopie muss dann WEG. Ohne das blieb sie „beruehrt": der neue
    // Stand vom Server wurde nie uebernommen, und beim Zurueckwechseln
    // fragte die Seite erneut, obwohl niemand etwas getan hatte.
    if (entwurf.geaendert) {
      if (!window.confirm(t("speichern.verlassen"))) return;
      entwurf.verwerfen();
    }
    fn();
  };

  // Eine Arbeit anlegen. `niveau` "" (alle), "E" oder "G".
  // Datum mitgeben: der Server markiert daraus die Kinder, die heute fehlen,
  // gleich als abwesend (nur mit Modul Orga). Vergisst man das von Hand,
  // rutschen Nullen in die Wertung.
  const legeAn = async (name, niveau, partnerId = null) => {
    const res = await fetch(`${API}/works`, alsJson("POST", {
      class_id: classId, kurs_id: kursId, niveau, partner_id: partnerId,
      name: (name || t("klassenarbeit.newName")).trim() || t("klassenarbeit.newName"),
      datum: new Date().toISOString(),
    })).catch(() => null);
    if (!res || !res.ok) return null;
    return res.json();
  };
  const [neuOffen, setNeuOffen] = useState(false);
  const anlegen = async (name, art) => {
    if (!classId) return;
    if (art === "eg") {
      // ZWEI Blaetter, zwei Arbeiten: E und G schreiben verschiedene Aufgaben
      // und verschiedene Punkte. Nacheinander, damit die Reihenfolge in der
      // Liste steht (E oben) und ein Fehlschlag nicht die Haelfte verschluckt.
      // Das E-Blatt verbindet sich mit dem G-Blatt (partner_id): in der
      // Auswahl steht die Arbeit einmal, umgeschaltet wird mit E | G.
      const g = await legeAn(name, "G");
      const e = g ? await legeAn(name, "E", g.id) : null;
      const neu = [e, g && e ? { ...g, partner_id: e.id } : g].filter(Boolean);
      if (!neu.length) return;
      setWorks((p) => [...neu, ...p]);
      setNeuOffen(false);
      zeigeArbeit(neu[0]);
      return;
    }
    const w = await legeAn(name, "");
    if (!w) return;
    setWorks((p) => [w, ...p]);
    setNeuOffen(false);
    zeigeArbeit(w);
  };
  const [kopieOffen, setKopieOffen] = useState(false);
  // Kopie in eine andere Klasse: Aufgaben, Themen, Notenschluessel und die
  // Anhaenge kommen mit, die Punkte NICHT — sie gehoeren zu Kindern, die es in
  // der anderen Klasse nicht gibt.
  const kopieren = async (zielClassId, zielKursId, name) => {
    const r = await fetch(`${API}/works/${work.id}/copy`, alsJson("POST", { class_id: zielClassId, kurs_id: zielKursId ?? null, name })).catch(() => null);
    if (!r || !r.ok) return false;
    const neu = await r.json();
    setKopieOffen(false);
    // Direkt hinspringen: die Kopie ist das, womit weitergearbeitet wird.
    setClassId(zielClassId); setKursId(zielKursId ?? null);
    setWorks((ws) => [neu, ...ws]); zeigeArbeit(neu);
    return true;
  };

  // E|G: das andere Blatt derselben Arbeit (falls es in dieser Liste steht).
  const partnerVon = (w) => (w && w.partner_id ? works.find((x) => x.id === w.partner_id) || null : null);
  const partner = partnerVon(work);
  // Wahlaufgaben: das andere Blatt liefert je Aufgabe die andere Fassung
  // (gleiche Position). Zum Rechnen angehaengt, gespeichert wird es nie mit.
  const wk = useMemo(() => (work && partner ? { ...work, _alt: partner.tasks || [] } : work), [work, partner]);
  const eigeneStufe = (work && work.niveau) || "G";
  const andereStufe = eigeneStufe === "E" ? "G" : "E";
  // Zuletzt gewaehltes Blatt — beim Wechsel der Arbeit bleibt man bei E oder G.
  const [blatt, setBlatt] = useState("E");
  // „Alle": beide Blaetter einer E/G-Arbeit auf einen Blick — jedes Kind mit
  // Punkten und Note aus SEINEM Blatt, dazu Schnitt und Notenverteilung der
  // ganzen Lerngruppe. Nur Ansicht: eingetragen wird im E- bzw. G-Blatt,
  // deren Aufgaben verschieden sind.
  const [alleSicht, setAlleSicht] = useState(false);
  const [alleTeil, setAlleTeil] = useState("alle");   // welche Auswertung oben steht
  // In der Auswahl steht ein Paar EINMAL: das G-Blatt faellt heraus, wenn sein
  // E-Blatt daneben steht.
  const auswahl = works.filter((w) => !(w.niveau === "G" && partnerVon(w)));
  const auswahlLabel = (w) => (partnerVon(w) ? `${w.name} (E/G)` : w.niveau ? `${w.name} (${w.niveau})` : w.name);
  const auswahlWert = work && work.niveau === "G" && partner ? partner.id : work?.id;
  // Ein Blatt zeigen, aber im Stand des SERVERS: die Liste `works` ist der
  // Stand vom letzten Laden — wer am anderen Blatt (oder an einem anderen
  // Geraet) etwas geaendert hat, saehe sonst den alten Stand.
  const zeigeFrisch = async (ziel) => {
    const d = await hol(`${API}/classes/${classId}/works${kq}`);
    const liste = Array.isArray(d) ? d : null;
    if (liste) setWorks(liste);
    zeigeArbeit((liste && liste.find((x) => x.id === ziel.id)) || ziel);
  };
  const waehleAusListe = (w) => {
    const p = partnerVon(w);
    const ziel = p && p.niveau === blatt ? p : w;
    wechseln(() => { zeigeFrisch(ziel); });
  };
  // Umschalten auf das andere Blatt — fehlt es, wird es angelegt (gleicher
  // Name, gleicher Kurs; der Server verbindet beide).
  const blattWechseln = async (niveau) => {
    if (!work || !work.niveau || niveau === work.niveau) return;
    setBlatt(niveau);
    if (partner) { wechseln(() => { zeigeFrisch(partner); }); return; }
    if (entwurf.geaendert && !(await entwurf.speichern())) return;
    const neu = await legeAn(work.name, niveau, work.id);
    if (!neu) return;
    setWorks((ws) => [...ws.map((x) => (x.id === work.id ? { ...x, partner_id: neu.id } : x)), neu]);
    zeigeArbeit(neu);
  };

  const alleAn = alleSicht && !!(work && work.niveau && partner);
  // Vor der Gesamtsicht: Offenes speichern und den Stand BEIDER Blaetter neu
  // holen — das andere Blatt steht in `works` so, wie es beim letzten Laden war.
  const alleZeigen = async () => {
    if (entwurf.geaendert && !(await entwurf.speichern())) return;
    const d = await hol(`${API}/classes/${classId}/works${kq}`);
    if (Array.isArray(d)) setWorks(d);
    setAlleSicht(true);
  };

  // Eine Arbeit fuer alle nachtraeglich in E- und G-Blatt teilen (Server
  // kopiert die Aufgaben, die Punkte der G-Kinder wandern mit).
  const hatNiveaus = alleStudents.some((s) => s.niveau === "E" || s.niveau === "G");
  const teilen = async () => {
    if (!work || work.niveau) return;
    if (!(await askConfirm(t("klassenarbeit.teilenFrage", { name: work.name }), { ok: t("klassenarbeit.teilen") }))) return;
    if (entwurf.geaendert && !(await entwurf.speichern())) return;
    const r = await fetch(`${API}/works/${work.id}/teilen`, { method: "POST" }).catch(() => null);
    if (!r || !r.ok) { showAlert(t("common.notWork")); return; }
    const [e, g] = await r.json();
    setWorks((ws) => [...ws.map((x) => (x.id === e.id ? e : x)), g]);
    setBlatt("E");
    zeigeArbeit(e);
  };

  const loeschen = async () => {
    if (!work) return;
    // Ein Paar geht zusammen: ein einzelnes Blatt ohne sein Gegenstueck ist
    // nicht mehr die Arbeit, die man in der Auswahl gesehen hat.
    const frage = partner ? t("klassenarbeit.delPairConfirm", { name: work.name }) : t("klassenarbeit.delConfirm", { name: work.name });
    if (!(await askConfirm(frage, { danger: true, ok: t("common.delete") }))) return;
    const ids = [work.id, ...(partner ? [partner.id] : [])];
    for (const id of ids) await fetch(`${API}/works/${id}`, { method: "DELETE" }).catch(() => {});
    setWorks((p) => p.filter((x) => !ids.includes(x.id))); zeigeArbeit(null);
  };

  // Ein „Teil" (Teilaufgabe a/b/c…) ist die kleinste Wertungseinheit. Hat eine
  // Aufgabe keine Teile, gilt sie selbst als eine Einheit (id + max) — so bleibt
  // das alte Format (Aufgabe ohne Teile) unverändert gültig.
  const units = (task) => (task.parts && task.parts.length) ? task.parts : [{ id: task.id, label: "", max: Number(task.max) > 0 ? Number(task.max) : 1 }];
  const unitMax = (u) => (Number(u.max) > 0 ? Number(u.max) : 1);
  // Punkte kommen mit bis zu zwei Nachkommastellen; eine Summe aus
  // Gleitkommazahlen wird sonst zu 100.00999999999999. Gerundet wird an der
  // Quelle, damit Anzeige, Note und Auswertung dieselbe Zahl sehen.
  const taskMax = (task) => rund(units(task).reduce((n, u) => n + unitMax(u), 0), 2);
  const partLabel = (i) => String.fromCharCode(97 + i); // a, b, c …
  const cleanResults = (results, removeIds) => Object.fromEntries(
    Object.entries(results || {})
      .map(([s, m]) => (m === "abwesend" ? [s, m] : [s, Object.fromEntries(Object.entries(m || {}).filter(([k]) => !removeIds.has(String(k))))]))
      .filter(([, m]) => m === "abwesend" || Object.keys(m).length));

  // Dieselbe Saeuberung fuer die Fehlerarten: verschwindet eine Teilaufgabe,
  // darf ihre Fehlerangabe nicht als Waise stehenbleiben (der Server wirft sie
  // beim naechsten Speichern ohnehin weg — dann aber ohne dass die Seite es
  // zeigt, und die Auswertung waere bis zum Neuladen zu hoch).
  const cleanFehler = (fehler, removeIds) => Object.fromEntries(
    Object.entries(fehler || {})
      .map(([sid, m]) => [sid, Object.fromEntries(Object.entries(m || {}).filter(([k]) => !removeIds.has(String(k))))])
      .filter(([, m]) => Object.keys(m).length));

  const addTask = () => persist({ ...work, tasks: [...(work.tasks || []), { id: newId(), label: "", topic_id: null, max: 1, form: false, parts: [] }] });
  const addForm = () => persist({ tasks: [...(work.tasks || []), { id: newId(), label: t("klassenarbeit.form"), topic_id: null, max: 1, form: true, parts: [] }] });
  const setTask = (id, patch) => persist({ ...work, tasks: work.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  // Ohne die Aufgabe im Wechsel: ein Wechsel fuer eine Aufgabe ohne Gegenstueck
  // waere ein Geist (der Server wirft ihn ohnehin weg).
  const ohneWechsel = (wechsel, tid) => Object.fromEntries(
    Object.entries(wechsel || {})
      .map(([sid, l]) => [sid, (l || []).filter((x) => String(x) !== String(tid))])
      .filter(([, l]) => l.length));
  const delTask = (id) => {
    const tk = (work.tasks || []).find((x) => x.id === id);
    const ids = new Set(tk ? alleEinheiten(wk, tk).map((u) => u.id) : [String(id)]);
    persist({ ...work, tasks: work.tasks.filter((x) => x.id !== id), results: cleanResults(work.results, ids), fehler: cleanFehler(work.fehler, ids), wechsel: ohneWechsel(work.wechsel, id) });
  };
  // Teilaufgaben: eine erste Teilaufgabe erbt id+max der Aufgabe (Punkte bleiben).
  const addPart = (tid) => {
    const tk = work.tasks.find((x) => x.id === tid); if (!tk) return;
    const parts = (tk.parts && tk.parts.length) ? [...tk.parts] : [{ id: tk.id, label: "a", max: Number(tk.max) > 0 ? Number(tk.max) : 1 }];
    parts.push({ id: newId(), label: partLabel(parts.length), max: 1, topic_id: null });
    setTask(tid, { parts });
  };
  const setPart = (tid, pid, patch) => {
    const tk = work.tasks.find((x) => x.id === tid); if (!tk) return;
    setTask(tid, { parts: units(tk).map((u) => (u.id === pid ? { ...u, ...patch } : u)) });
  };
  const delPart = (tid, pid) => {
    const tk = work.tasks.find((x) => x.id === tid); if (!tk) return;
    const parts = units(tk).filter((u) => u.id !== pid);
    const weg = new Set([String(pid)]);
    const results = cleanResults(work.results, weg);
    const fehler = cleanFehler(work.fehler, weg);
    // Bleibt nur ein Teil übrig: zurück zur „ohne Teile"-Form (Max an der Aufgabe).
    if (parts.length <= 1) { const only = parts[0]; persist({ ...work, tasks: work.tasks.map((x) => (x.id === tid ? { ...x, parts: [], max: only ? unitMax(only) : 1 } : x)), results, fehler }); }
    else persist({ ...work, tasks: work.tasks.map((x) => (x.id === tid ? { ...x, parts } : x)), results, fehler });
  };
  // Hat das Kind bei dieser Aufgabe die Fassung des anderen Blatts geschrieben?
  const wechselMit = (sid, tid, an) => {
    const cur = new Set((((work.wechsel || {})[String(sid)]) || []).map(String));
    if (an) cur.add(String(tid)); else cur.delete(String(tid));
    const wechsel = { ...(work.wechsel || {}) };
    if (cur.size) wechsel[String(sid)] = [...cur]; else delete wechsel[String(sid)];
    return wechsel;
  };
  const setWechsel = (sid, tid, an) => persist({ wechsel: wechselMit(sid, tid, an) });
  // Fehlerart je Zelle: leer → ansatz → rechnen → … → leer. Ein Klick statt
  // eines Auswahlfelds, weil beim Korrigieren jede Zelle einmal angefasst wird
  // und ein Dropdown je Zelle drei Handgriffe braucht statt einem.
  const fehlerOf = (sid, uid) => ((work.fehler || {})[String(sid)] || {})[uid] || "";
  const cycleFehler = (sid, uid) => {
    const cur = fehlerOf(sid, uid);
    const naechste = FEHLER_CYCLE[(FEHLER_CYCLE.indexOf(cur) + 1) % FEHLER_CYCLE.length];
    const zeile = { ...((work.fehler || {})[String(sid)] || {}) };
    if (naechste) zeile[uid] = naechste; else delete zeile[uid];
    const fehler = { ...(work.fehler || {}) };
    if (Object.keys(zeile).length) fehler[String(sid)] = zeile; else delete fehler[String(sid)];
    persist({ ...work, fehler });
  };

  const pointsOf = (sid, uid) => { const v = ((work.results || {})[String(sid)] || {})[uid]; return v == null ? "" : v; };
  // `wechsel` = [taskId, an]: wer in die andere Fassung tippt, hat diese
  // geschrieben — Punkte und Wechsel gehen in EINEM Schritt in den Entwurf.
  const setPoints = (sid, uid, val, wechsel = null) => {
    const row = { ...((work.results || {})[String(sid)] || {}) };
    if (val === "" || val == null) delete row[uid]; else row[uid] = Math.max(0, Number(val));
    const results = { ...(work.results || {}) };
    if (Object.keys(row).length) results[String(sid)] = row; else delete results[String(sid)];
    persist(wechsel ? { results, wechsel: wechselMit(sid, wechsel[0], wechsel[1]) } : { results });
  };
  // Hoechstpunktzahl = Summe der eigenen Fassungen; Punkte der anderen darueber sind Bonus.
  const totalMax = () => rund(basis(work.tasks), 2);
  // Ist zu diesem Kind ueberhaupt etwas erfasst? Eine eingetragene 0 zaehlt,
  // ein leeres Feld nicht — genau darin unterscheiden sich „hat nichts
  // geloest" und „ist noch nicht korrigiert".
  const hatPunkte = (sid) => {
    const r = (work.results || {})[String(sid)];
    if (!r) return false;
    if (r === "abwesend") return true;
    if (Array.isArray(r)) return true;                       // Altformat
    return Object.values(r).some((v) => v != null && v !== "");
  };

  // Summe und Note je Kind aus core/arbeitswertung.js — dieselbe Rechnung wie
  // am Server (Wahlaufgaben: je Aufgabe die geschriebene Fassung, E-Bonus).
  const wertungOf = (sid) => wertung(wk, sid, effScale);
  // Abwesend ist ein eigenes Feld (work.absent) — die Punkte in results bleiben
  // erhalten, „abwesend" heisst nur „aus der Klassenstatistik raus". Alt-Marker
  // (results[sid] === "abwesend", ohne Punkte) wird weiter als abwesend erkannt.
  const isAbsent = (sid) => ((work.absent || []).map(String).includes(String(sid))) || (work.results || {})[String(sid)] === "abwesend";
  const toggleAbsent = (sid) => {
    const key = String(sid);
    const cur = new Set((work.absent || []).map(String));
    const results = { ...(work.results || {}) };
    const wasLegacy = results[key] === "abwesend";
    if (wasLegacy) delete results[key];                 // alten Marker aufloesen
    if (cur.has(key) || wasLegacy) cur.delete(key); else cur.add(key);
    persist({ ...work, results, absent: [...cur] });
  };

  // Gültiger Notenschlüssel: Override der Arbeit, sonst Profil-Voreinstellung.
  const effScale = (work && work.scale && Object.keys(work.scale).length) ? work.scale : scale;
  const setWorkScale = (next) => persist({ ...work, scale: next });

  // Auswertung LIVE aus dem Raster (kein Button, kein Server-Call): je Thema die
  // Trefferquote der Klasse + je SuS die schwachen Themen (≥ 50 % falsch).
  const analyse = useMemo(() => rechneAnalyse({ work, wk, students, effScale, topicLabel, eigeneStufe, andereStufe }),
    [work, wk, students, topics, scale, effScale, eigeneStufe, andereStufe]);
  // „Alle": je Blatt die eigene Auswertung (mit dem anderen Blatt fuer die
  // Wahlaufgaben, mit den Kindern seines Niveaus und seinem Notenschluessel)
  // und daraus die gemeinsame.
  const alleAnalysen = useMemo(() => {
    if (!alleAn) return null;
    const blaetter = [work, partner].filter(Boolean).sort((a, b) => (a.niveau < b.niveau ? -1 : 1));   // E vor G
    const teile = blaetter.map((b) => {
      const anderes = blaetter.find((x) => x !== b);
      const sc = b.scale && Object.keys(b.scale).length ? b.scale : scale;
      const stufe = b.niveau || "";
      return [stufe, rechneAnalyse({
        work: b, wk: { ...b, _alt: (anderes && anderes.tasks) || [] },
        students: alleStudents.filter((st) => (st.niveau || "") === stufe),
        effScale: sc, topicLabel, eigeneStufe: stufe, andereStufe: stufe === "E" ? "G" : "E",
      })];
    });
    return { gesamt: vereineAnalysen(teile, topicLabel), teile, aufgaben: aufgabenUeberAlle(blaetter, alleStudents) };
  }, [alleAn, work, partner, alleStudents, scale, topics]);
  // Rueckmeldebogen: erst fragen, was darauf soll (BogenWahl), dann drucken.
  // Wiederholungsaufgaben kommen aus dem Lernpfad-Pool — ohne das Modul gibt
  // es den Baustein nicht (Regel 3).
  const [bogenWahl, setBogenWahl] = useState(false);
  const [bogenTeile, setBogenTeile] = useState(undefined);
  const [wdhPool, setWdhPool] = useState(null);
  // Der Pool wird beim OEFFNEN des Dialogs geholt: dann steht dort schon,
  // zu welchen Themen der Lernpfad nichts hat — als Hinweis, nicht als
  // Rueckfrage beim Drucken (die hielt nur auf und aenderte nichts).
  const [poolVorab, setPoolVorab] = useState(null);
  const [wdhMax, setWdhMax] = useState(3);
  // Rueckmeldebogen: unter „Auswertung" fuer alle Kinder beider Blaetter.
  const druckBogenRoh = alleAn && alleAnalysen ? alleAnalysen.gesamt.bogen : analyse ? analyse.bogen : [];
  const bogenOeffnen = async () => {
    setBogenWahl(true);
    if (!lernpfadAktiv) return;
    const res = await fetch("/api/lernpfad/exercises").catch(() => null);
    setPoolVorab(res && res.ok ? await res.json() : []);
  };
  // Je fehlendem Thema: Klasse/Fach und der Pfad Ober- › Unterthema — als
  // Fliesstext liess sich „Kl. 6" nicht von „Kl. 7" unterscheiden.
  const wdhFehlt = useMemo(() => (poolVorab ? wdhZuteilen(druckBogenRoh, poolVorab, themen.byId).fehlend : []).map((f) => {
    const tp = f.topic != null ? themen.byId.get(f.topic) : null;
    const ober = tp && tp.parent_id ? themen.byId.get(tp.parent_id) : null;
    const kopf = tp ? [tp.fach || ober?.fach, (tp.jahrgang || ober?.jahrgang) ? `Kl. ${tp.jahrgang || ober?.jahrgang}` : ""].filter(Boolean).join(" · ") : "";
    return { kopf, pfad: tp ? (ober ? `${mitNummer(ober)} › ${mitNummer(tp)}` : mitNummer(tp)) : f.thema };
  }), [poolVorab, druckBogenRoh, topics]);
  const bogenDrucken = async (teile, max) => {
    setBogenWahl(false);
    setWdhMax(max);
    const pool = teile.includes("wdh") && lernpfadAktiv ? (poolVorab || []) : null;
    setWdhPool(pool);
    setBogenTeile(teile);
    // KaTeX zeichnet die Aufgabentexte nachgeladen — kurz warten, sonst steht
    // im Ausdruck der Quelltext.
    setTimeout(() => window.print(), pool ? 900 : 100);
  };
  const druckBogen = useMemo(() => (wdhPool ? wdhZuteilen(druckBogenRoh, wdhPool, themen.byId, wdhMax) : druckBogenRoh), [druckBogenRoh, wdhPool, topics, wdhMax]);

  // Aus den zentralen Tabellenstilen abgeleitet, nicht daneben neu gebaut: nur
  // die kraeftigere Kopf-Trennlinie und die polsterlose Zelle (die Eingabefelder
  // fuellen sie selbst) weichen ab.
  const th = { ...thBase, padding: "6px 8px", borderBottom: "2px solid var(--border)" };
  const td = { ...tdBase, padding: 0 };

  // Spalten einer Aufgabe im Raster. Ohne Gegenstueck im anderen Blatt wie
  // immer (Einheiten, bei echten Teilaufgaben dazu die Summe). Mit Gegenstueck:
  // der Umschalter je Kind, die eigenen Einheiten, die des anderen Blatts und
  // die Summe der geschriebenen Fassung.
  const spalten = (tk) => {
    const eigen = eigeneEinheiten(tk);
    const andere = andereEinheiten(wk, tk);
    const e = eigen.map((u) => ({ art: "einheit", anders: false, u, mitStufe: andere.length > 0 }));
    if (!andere.length) return eigen.length > 1 ? [...e, { art: "summe" }] : e;
    return [{ art: "wahl" }, ...e, ...andere.map((u) => ({ art: "einheit", anders: true, u, mitStufe: true })), { art: "summe" }];
  };

  // Der Auswertungsblock — fuer ein Blatt, und unter „Alle" dreimal: gesamt,
  // E und G. Dieselbe Anzeige fuer alle drei, damit sie sich nicht
  // auseinanderentwickeln (die erste „Alle"-Ansicht war ein eigener Nachbau
  // und sah deshalb anders aus).
  // `nurArbeit`: die Auswertung einer E/G-Arbeit prueft die Arbeit — ohne
  // Themen, schwache Gruppen und Fehlerarten (die gehoeren zum einzelnen
  // Kurs). `aufgaben` ersetzt die Aufgabenliste (ueber alle Kinder gepoolt).
  const zeigeAuswertung = (A, titel = null, schluessel = "blatt", { nurArbeit = false, aufgaben = null } = {}) => {
    const AT = aufgaben || { perTask: A ? A.perTask : [], perUnit: A ? A.perUnit : [] };
    return (
    <Fragment key={schluessel}>{
      (A && (A.topics.length > 0 || A.students.length > 0 || A.perUnit.length > 0 || A.noten.n > 0)) ? (
            <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: panelStyle.borderRadius, padding: 16, background: "var(--card)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>{titel || t("klassenarbeit.analysisTitle")}</span>
                <button onClick={() => setHideIndividual((v) => !v)} title={t("klassenarbeit.presentHint")}
                  style={{ ...toolbarBtn, background: hideIndividual ? "var(--accent)" : "transparent", color: hideIndividual ? C.aufAkzent : "var(--text2)" }}>
                  <Icon d={ICONS.eye} size={15} color={hideIndividual ? C.aufAkzent : "var(--text2)"} /> {t("klassenarbeit.presentMode")}
                </button>
              </div>
              {!nurArbeit && (<>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t("klassenarbeit.byTopic")}</div>
              {A.topics.length === 0 ? <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("klassenarbeit.noTopics")}</p> : A.topics.map((tp) => (
                <div key={tp.topic_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{tp.label}</span>
                  {/* Balken: Radius = halbe Hoehe (Balken-Kappe), reine Grafik. */}
                  <span style={{ width: 120, height: 8, background: "var(--bg2)", borderRadius: 4, overflow: "hidden" }}><span style={{ display: "block", width: `${tp.pct}%`, height: "100%", background: tp.pct < 50 ? C.danger : tp.pct < 75 ? C.warning : C.success }} /></span>
                  <span style={{ fontSize: 13, fontWeight: 700, minWidth: 38, textAlign: "right" }}>{tp.pct}%</span>
                </div>
              ))}
              {/* Frueher stand hier je Kind eine Zeile mit allen Themen als
                  Fliesstext — bei 28 Kindern und langen Themennamen eine Wand,
                  aus der niemand etwas ableitet. Jetzt andersherum: nach THEMA
                  gruppiert, das mit den meisten Betroffenen oben. So steht da,
                  was man am Montag tut — und wen man dazuholt. */}
              {!hideIndividual && A.weakGroups.length > 0 && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 4px" }}>{t("klassenarbeit.weakStudents")}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>{t("klassenarbeit.weakHint")}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {A.weakGroups.map((g) => (
                    <div key={g.label} style={{ border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: "8px 10px" }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0 }}>{g.label}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: g.anteil >= 50 ? C.danger : C.warning }}>
                          {t("klassenarbeit.weakCount", { n: g.namen.length, all: A.gradedCount })}
                        </span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {g.namen.map((n) => (
                          <span key={n} style={{ ...chipStyle, fontWeight: 500, background: "var(--bg2)" }}>{n}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>)}
              </>)}

              {/* Fehlerarten: die Themenquote sagt WO es klemmt, die Fehlerart
                  WORAN — und daraus folgt Verschiedenes. Nur da, wo jemand
                  wirklich etwas erfasst hat; sonst stuende hier eine Tabelle
                  aus lauter Nullen und behauptete, die Klasse mache keine
                  Fehler. */}
              {!nurArbeit && A.fehlerStat && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 4px" }}>{t("klassenarbeit.fehlerTitle")}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
                  {t("klassenarbeit.fehlerTitleHint", { n: A.fehlerStat.n })}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {FEHLER.filter((f) => A.fehlerStat.gesamt[f.key]).map((f) => (
                    <span key={f.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: "6px 10px" }}>
                      <span style={{ ...fehlerChip, background: f.color, color: C.aufAkzent }}>{f.ab}</span>
                      <span style={{ fontSize: 13 }}>{t(`klassenarbeit.fehler.${f.key}`)}</span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{A.fehlerStat.gesamt[f.key]}×</span>
                    </span>
                  ))}
                </div>
                {/* Je Thema: „an Bruchrechnung scheitert der Ansatz, an Termen
                    nur die Rechnung" — dieselbe Quote, zwei verschiedene
                    Konsequenzen. */}
                {A.fehlerStat.topics.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                    {A.fehlerStat.topics.map((r) => (
                      <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 10px", borderRadius: panelStyle.borderRadius, background: "var(--bg2)" }}>
                        <span style={{ flex: 1, minWidth: 120, fontSize: 13, fontWeight: 600 }}>{r.label}</span>
                        {FEHLER.filter((f) => r.typen[f.key]).map((f) => (
                          <span key={f.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--text2)" }}>
                            <span style={{ ...fehlerChip, background: f.color, color: C.aufAkzent }}>{f.ab}</span>
                            {r.typen[f.key]}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {!hideIndividual && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {A.fehlerStat.students.map((st) => {
                      const f = FEHLER.find((x) => x.key === st.haupt);
                      return (
                        <span key={st.student_id} style={{ ...chipStyle, fontWeight: 500, background: "var(--bg2)", display: "inline-flex", alignItems: "center", gap: 5 }}
                          title={FEHLER.filter((x) => st.typen[x.key]).map((x) => `${t(`klassenarbeit.fehler.${x.key}`)}: ${st.typen[x.key]}`).join("\n")}>
                          <span style={{ ...fehlerChip, background: f ? f.color : "var(--bg3)", color: C.aufAkzent }}>{f ? f.ab : "?"}</span>
                          {st.name}
                        </span>
                      );
                    })}
                  </div>
                )}
              </>)}

              {/* je Aufgabe: Ø, Trefferquote + Trennschärfe/95%-KI. Hat eine Aufgabe
                  Teilaufgaben, lässt sich deren Auswertung darunter ausklappen. */}
              {AT.perTask.length > 0 && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 8px" }}>{t(aufgaben ? "klassenarbeit.byTaskAlle" : "klassenarbeit.byTask")}</div>
                {AT.perTask.map((tk) => {
                  const parts = AT.perUnit.filter((u) => u.taskId === tk.id);
                  const open = expandedTasks.has(tk.id);
                  const toggle = () => setExpandedTasks((prev) => { const n = new Set(prev); n.has(tk.id) ? n.delete(tk.id) : n.add(tk.id); return n; });
                  return (
                    <StatRow key={tk.id} row={tk} t={t} open={open} onToggle={toggle}
                      kinder={parts.length > 0 ? parts.map((u) => <StatRow key={u.id} row={u} t={t} small />) : null} />
                  );
                })}
              </>)}

              {/* Noten-Auswertung im CardVote-Design: Kennzahl-Kacheln + Panel mit
                  Notenverteilung/Boxplot-Umschalter. */}
              {A.noten.n > 0 && (<>
                <div style={{ fontSize: 14, fontWeight: 700, margin: "16px 0 8px" }}>{t("klassenarbeit.gradeResult")}</div>
                {/* Statistik-Kacheln (Anwesend … 95%-KI) — wie CardVote. */}
                <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <StatCard label={t("klassenarbeit.attendance")} value={`${A.noten.present} / ${A.noten.total}`} />
                  <StatCard label={t("klassenarbeit.avgGrade")} value={komma(A.noten.avg)} />
                  {A.noten.avgPct != null && <StatCard label={t("klassenarbeit.avgPct")} value={`${A.noten.avgPct}%`} />}
                  {A.noten.medPct != null && <StatCard label={t("klassenarbeit.median")} value={`${A.noten.medPct}%`} />}
                  {A.noten.sdPct != null && <StatCard label={t("klassenarbeit.stdev")} value={`${komma(A.noten.sdPct)}%`} />}
                  {A.noten.ciLow != null && <StatCard label={t("klassenarbeit.ci")} value={`${A.noten.ciLow}–${A.noten.ciHigh}%`} />}
                </div>
                {/* „Auswertung verstehen": Kennzahlen erklärt + konkrete Handlungshinweise. */}
                <button onClick={() => setInfoOpen((v) => !v)} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 13, marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ display: "inline-flex", transform: infoOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}><Icon d={ICONS.open} size={12} /></span>
                  {t("klassenarbeit.explain")}
                </button>
                {infoOpen && (() => {
                  const sd = A.noten.sdPct;
                  const sdLevel = sd == null ? null : sd < 10 ? "low" : sd <= 25 ? "mid" : "high";
                  const weak = nurArbeit ? [] : A.topics.filter((tp) => tp.pct < 50).map((tp) => tp.label);
                  const lowDisc = AT.perTask.filter((tk) => tsBelastbar(tk) && tk.disc < 0.2);
                  const Item = ({ term, children }) => (
                    <li style={{ marginBottom: 8 }}><b style={{ color: "var(--text)" }}>{term}:</b> <span style={{ color: "var(--text2)" }}>{children}</span></li>
                  );
                  return (
                    <div style={{ padding: 16, background: "var(--bg3)", borderRadius: cardStyle.borderRadius, border: "1px solid var(--border)", marginBottom: 12, fontSize: 13, lineHeight: 1.55 }}>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        <Item term={t("klassenarbeit.avgGrade") + " / " + t("klassenarbeit.median")}>{t("klassenarbeit.explainAvg")}</Item>
                        {sd != null && (
                          <Item term={`${t("klassenarbeit.stdev")} (${komma(sd)}%)`}>
                            {t("klassenarbeit.explainSd")} {" "}
                            <b style={{ color: sdLevel === "low" ? C.warning : sdLevel === "mid" ? C.success : C.danger }}>
                              {t(`klassenarbeit.explainSd_${sdLevel}`)}
                            </b>
                          </Item>
                        )}
                        {A.noten.ciLow != null && <Item term={t("klassenarbeit.ci")}>{t("klassenarbeit.explainCi")}</Item>}
                        <Item term={t("klassenarbeit.disc")}>{t("klassenarbeit.explainDisc")}</Item>
                      </ul>
                      {(weak.length > 0 || lowDisc.length > 0) && (
                        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t("klassenarbeit.explainActions")}</div>
                          <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {weak.length > 0 && <li style={{ marginBottom: 4, color: "var(--text2)" }}>{t("klassenarbeit.explainWeak", { topics: weak.join(", ") })}</li>}
                            {lowDisc.length > 0 && <li style={{ color: "var(--text2)" }}>{t("klassenarbeit.explainLowDisc", { n: lowDisc.length })}</li>}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {/* Verteilung / Boxplot — Panel + Pillen-Umschalter wie CardVote. */}
                <div style={{ padding: 16, background: "var(--bg3)", borderRadius: cardStyle.borderRadius, border: "1px solid var(--border)" }}>
                  {/* Zweimal dieselbe Frage („welche Ansicht?"), also zweimal
                      dieselbe Form. Links standen vorher zwei Einzelpillen
                      (r980), rechts eine Gruppe mit r8 — nebeneinander sah das
                      aus wie zwei verschiedene Bedienarten. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    <Tabs value={distMode} onChange={setDistMode}
                      options={[["bar", t("klassenarbeit.distGrades")], ["box", t("klassenarbeit.distBox")]]} />
                    {/* Sekundär-Umschalter: Balken = Noten/Teilnoten, Boxplot = %/Noten. */}
                    <Tabs style={{ marginLeft: "auto" }}
                      value={distMode === "bar" ? barMode : boxMode}
                      onChange={distMode === "bar" ? setBarMode : setBoxMode}
                      options={distMode === "bar"
                        ? [["whole", t("klassenarbeit.distWhole")], ["fine", t("klassenarbeit.distFine")]]
                        : [["pct", "%"], ["note", t("klassenarbeit.grade")]]} />
                  </div>
                  {distMode === "bar" ? (() => {
                    const data = barMode === "fine"
                      ? A.noten.distFine.map((d) => ({ count: d.count, label: d.label, grade: d.grade }))
                      : A.noten.dist.map((c, i) => ({ count: c, label: String(i + 1), grade: i + 1 }));
                    const mxc = Math.max(...data.map((d) => d.count), 1);
                    return (
                      <div style={{ display: "flex", alignItems: "flex-end", gap: barMode === "fine" ? 3 : 6, height: 105 }}>
                        {data.map((d, i) => (
                          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                            {/* Saeule: Radius rundet nur die Kappe der Grafik. */}
                            <div style={{ width: barMode === "fine" ? "80%" : "60%", height: `${Math.max(3, (d.count / mxc) * 75)}px`, background: d.grade <= 2 ? C.success : d.grade <= 4 ? C.warning : C.danger, borderRadius: 3 }} title={`${d.count}`} />
                            <span style={{ fontSize: 11, color: "var(--text3)" }}>{d.count}</span>
                            <span style={{ fontSize: 11, fontWeight: 700 }}>{d.label}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })() : (
                    boxMode === "note"
                      ? <Boxplot values={A.noten.werte} max={6} />
                      : <Boxplot values={A.noten.pctArr} max={100} unit="%" umgekehrt />
                  )}
                </div>
                {/* Min-Punkte je Note entfernt — steht im Notenschlüssel. */}
              </>)}
            </div>
          ) : null
    }</Fragment>
    );
  };

  const hasRoster = classId != null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span data-tour="ka-class" style={{ display: "inline-flex" }}><KursKlasseSelect value={classId} kursValue={kursId} onChange={(id, kid) => wechseln(() => { setClassId(id); setKursId(kid); })} onKurs={setKursId} /></span>
      </div>

      {/* Frühwarnung: eine einzelne Arbeit zeigt den Stand, nicht die Richtung.
          Dieselbe Auswertung wie auf der Startseite — sie rechnet über alle
          Arbeiten dieser Klasse und, falls CardVote läuft, über die Quizze mit. */}
      {classId && <FruehwarnPanel classId={classId} />}

      {/* Auswahlzeile nur, wenn es schon Arbeiten gibt — sonst führt allein die
          Leerzustand-Karte zum Anlegen (kein doppeltes „keine Arbeit"). */}
      {hasRoster && works.length > 0 && (
        /* Eine Leiste, eine Hoehe: das Auswahlfeld (34), „Neu" und das Kopieren
           standen vorher als 34 / ~38 / ~30 nebeneinander, jedes mit eigenem
           Radius. Das Loeschen sass ungeschuetzt neben dem Kopieren — es gehoert
           ins Mehr-Menue, wo Gefaehrliches selbst nach unten sortiert. */
        <Werkzeugleiste style={{ marginBottom: 16 }}
          links={(
            <SuchSelect value={auswahlWert ? String(auswahlWert) : ""} style={{ minWidth: 0, maxWidth: 320 }}
              onChange={(v) => { const w = works.find((x) => String(x.id) === v) || null; if (w) waehleAusListe(w); else wechseln(() => zeigeArbeit(null)); }}
              optionen={auswahl.map((w) => ({ wert: String(w.id), label: auswahlLabel(w) }))} />
          )}
          mehr={work ? [{ key: "loeschen", label: t("common.delete"), icon: ICONS.trash, gefahr: true, onClick: loeschen }] : []}>
          {/* E | G: zwei Blaetter einer Arbeit. Fehlt eins, legt der Knopf es an. */}
          {work && work.niveau && (
            <Segment>
              {["E", "G"].map((n) => {
                const aktiv = !alleAn && work.niveau === n;
                const fehlt = work.niveau !== n && !partner;
                return (
                  <button key={n} onClick={() => { setAlleSicht(false); blattWechseln(n); }} aria-pressed={aktiv}
                    title={fehlt ? t("klassenarbeit.blattAnlegen", { n }) : t("klassenarbeit.blatt", { n })}
                    style={{ ...segmentBtn, fontWeight: aktiv ? 700 : 500, color: aktiv ? "var(--accent)" : "var(--text2)", ...(fehlt ? { fontStyle: "italic", opacity: 0.7 } : {}) }}>
                    {fehlt ? `+ ${n}` : n}
                  </button>
                );
              })}
              {partner && (
                <button onClick={alleZeigen} aria-pressed={alleAn} title={t("klassenarbeit.alleBlaetterHint")}
                  style={{ ...segmentBtn, fontWeight: alleAn ? 700 : 500, color: alleAn ? "var(--accent)" : "var(--text2)" }}>
                  {t("klassenarbeit.alleBlaetter")}
                </button>
              )}
            </Segment>
          )}
          {work && !work.niveau && (
            <button onClick={teilen} disabled={!hatNiveaus} style={{ ...toolbarBtn, ...(hatNiveaus ? {} : { opacity: 0.5, cursor: "default" }) }}
              title={hatNiveaus ? t("klassenarbeit.teilen") : t("klassenarbeit.teilenOhneNiveau")}>E/G</button>
          )}
          <button data-tour="ka-new" onClick={() => setNeuOffen(true)} style={toolbarBtn}>{t("klassenarbeit.new")}</button>
          {/* Parallelklassen schreiben dieselbe Arbeit — sie zweimal einzutippen
              ist dieselbe Arbeit zweimal. */}
          {work && <button onClick={() => setKopieOffen(true)} className="icon-btn" style={toolbarIconBtn} title={t("klassenarbeit.copyTo")} aria-label={t("klassenarbeit.copyTo")}><Icon d={ICONS.duplicate} /></button>}
        </Werkzeugleiste>
      )}

      {hasRoster && work && students.length > 0 && (
        <>
          {/* SuS-Ansicht (Präsentation): alles über der Auswertung ausblenden —
              Aufgaben-Editor, Punkte-Raster, Aktionen. Nur die Auswertung bleibt. */}
          {!hideIndividual && !alleAn && (<>
          {/* Name sofort auch im Auswahl-Dropdown zeigen (nicht erst nach Reload). */}
          {/* Der Name geht in den Entwurf; im Auswahlfeld oben steht er nach dem
              Speichern (vorher wäre dort ein Name, den es serverseitig nicht gibt). */}
          <input value={work.name} onChange={(e) => persist({ name: e.target.value })} placeholder={t("klassenarbeit.newName")}
            style={{ ...inputStyle, fontSize: 16, fontWeight: 600, marginBottom: 12, maxWidth: 360 }} />

          {/* Anhänge: die Arbeit selbst und ihr Erwartungshorizont. Zwei
              benannte Plätze statt einer namenlosen Liste — beim Nachkorrigieren
              im nächsten Jahr sucht niemand, welche der vier PDFs der
              Erwartungshorizont war. Mehrere Dateien je Platz bleiben möglich
              (A- und B-Gruppe). Die Ablage ist dieselbe wie bei Themen und
              Stunden (Kern), nur mit einem Bezug mehr. */}
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginBottom: 12 }}>
            <MaterialPanel workId={work.id} rolle="arbeit" titel={t("klassenarbeit.fileWork")} />
            <MaterialPanel workId={work.id} rolle="erwartung" titel={t("klassenarbeit.fileExpect")} />
          </div>

          {/* 1) Aufgaben definieren: Bezeichnung + Thema + Maximalpunkte. */}
          {/* Die Aufgaben stellt man einmal ein — danach stehen sie beim
              Eintragen nur im Weg. Zugeklappt, sobald es welche gibt; die
              Zeile sagt, was darin steckt. */}
          <button type="button" onClick={() => setAufgabenOffen(!aufgabenAuf)} aria-expanded={aufgabenAuf}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", border: "none", background: "none", padding: "4px 0", margin: "4px 0 8px", cursor: "pointer", textAlign: "left", color: "var(--text2)" }}>
            <span style={{ display: "inline-flex", transform: aufgabenAuf ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--text3)" }}><Icon d={ICONS.open} size={12} /></span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{t("klassenarbeit.tasksHeading")}</span>
            {!aufgabenAuf && (work.tasks || []).length > 0 && (
              <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("klassenarbeit.tasksSumme", { n: (work.tasks || []).length, p: komma(totalMax()) })}</span>
            )}
          </button>
          {aufgabenAuf && (<>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
            {(work.tasks || []).map((task, i) => {
              const hasParts = !!(task.parts && task.parts.length);
              return (
              <div key={task.id} style={{ border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: "8px 10px", background: "var(--card)" }}>
                {/* Eine Zeile, solange die Breite reicht: Name und Thema teilen
                    sich den Platz, alles Weitere behält seine Größe. Der
                    Themen-Select wuchs vorher mit dem längsten Optionstext
                    („Mathe 6.8 Daten darstellen und auswerten / 2 Kreisdiagramme
                    zeichnen") und schob den Mülleimer in die nächste Zeile —
                    `minWidth: 0` erlaubt dem Flex-Element, kleiner zu werden als
                    sein Inhalt. */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--text3)", width: 24, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
                  <input value={task.label} onChange={(e) => setTask(task.id, { label: e.target.value })} placeholder={t("klassenarbeit.taskOptional", { n: i + 1 })} title={t("klassenarbeit.taskOptionalHint")} style={{ ...inputStyle, fontSize: 13, padding: "7px 9px", flex: "1 1 150px", minWidth: 0 }} />
                  {/* Darstellung prueft kein Thema — statt der Themenwahl steht
                      dort, was sie ist. */}
                  {task.form ? (
                    <span style={{ ...chipStyle, fontSize: 12, color: "var(--accent)", flexShrink: 0 }} title={t("klassenarbeit.formHint")}>{t("klassenarbeit.form")}</span>
                  ) : (
                    <SuchSelect value={task.topic_id ? String(task.topic_id) : ""} onChange={(v) => setTask(task.id, { topic_id: v ? Number(v) : null })}
                      leerLabel={t("klassenarbeit.topicNone")} style={{ flex: "1 1 180px", minWidth: 0, maxWidth: 340 }}
                      optionen={themenOptionen} />
                  )}
                  {hasParts ? (
                    <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap", flexShrink: 0 }}>{t("klassenarbeit.maxPoints")}: <b>{komma(taskMax(task))}</b></span>
                  ) : (
                    <label style={{ fontSize: 12, color: "var(--text3)", display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {t("klassenarbeit.maxPoints")}
                      <input type="number" min="0.5" step="0.5" value={task.max ?? 1} onChange={(e) => setTask(task.id, { max: Math.max(0.5, Number(e.target.value) || 0.5) })} style={{ ...inputStyle, fontSize: 13, padding: "6px 6px", width: 56, textAlign: "center" }} />
                    </label>
                  )}
                  <button onClick={() => addPart(task.id)} className="icon-btn" style={{ ...iconBtn, padding: 4, minWidth: 32, minHeight: 32, flexShrink: 0 }}
                    title={t("klassenarbeit.addPartHint")} aria-label={t("klassenarbeit.addPart")}>
                    <Icon d={ICONS.plus} size={15} color="var(--accent)" />
                  </button>
                  <button onClick={() => delTask(task.id)} className="icon-btn" style={{ ...iconBtn, padding: 4, minWidth: 32, minHeight: 32, flexShrink: 0 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
                </div>
                {hasParts && (
                  /* Eine Zeile je Teilaufgabe statt Chips nebeneinander: jede
                     bekommt ein eigenes Thema, und dafür ist in einem Chip kein
                     Platz. „Aufgabe 1: Wiederholung" prüft in a) Kopfrechnen,
                     in b) Umwandeln, in c) Runden — hängt das Thema nur oben an
                     der Aufgabe, wird daraus ein Topf, und die Auswertung sagt
                     „Wiederholung schwach" statt „Runden schwach". */
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, paddingLeft: 26 }}>
                    {units(task).map((u) => (
                      <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", background: "var(--bg2)", borderRadius: CONTROL_R, padding: "4px 6px" }}>
                        <input value={u.label} onChange={(e) => setPart(task.id, u.id, { label: e.target.value })} title={t("klassenarbeit.partLabel")} style={{ ...inputStyle, fontSize: 12, padding: "4px 4px", width: 34, textAlign: "center" }} />
                        <SuchSelect value={u.topic_id ? String(u.topic_id) : ""} onChange={(v) => setPart(task.id, u.id, { topic_id: v ? Number(v) : null })}
                          title={t("klassenarbeit.partTopicHint")} leerLabel={t("klassenarbeit.partTopicInherit")}
                          style={{ flex: "1 1 120px", minWidth: 0 }} optionen={themenOptionen} />
                        <input type="number" min="0.5" step="0.5" value={u.max} onChange={(e) => setPart(task.id, u.id, { max: Math.max(0.5, Number(e.target.value) || 0.5) })} title={t("klassenarbeit.maxPoints")} style={{ ...inputStyle, fontSize: 12, padding: "4px 4px", width: 48, textAlign: "center" }} />
                        <button onClick={() => delPart(task.id, u.id)} className="icon-btn" style={{ ...iconBtn, padding: 3, minWidth: 32, minHeight: 32 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={14} color={C.danger} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              );
            })}
          </div>
          {/* Darstellungsleistung: zaehlt zur Note, aber nicht zur inhaltlichen
              Auswertung — sie misst keine Kompetenz in einem Thema. Es gibt sie
              einmal je Arbeit, deshalb verschwindet der Knopf, sobald sie da ist. */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <button onClick={addTask} style={btnSecondary}>+ {t("klassenarbeit.addTask")}</button>
            {!(work.tasks || []).some((x) => x.form) && (
              <button onClick={addForm} style={btnSecondary} title={t("klassenarbeit.formHint")}>+ {t("klassenarbeit.form")}</button>
            )}
          </div>
          {/* Gewichtung der Themen: wie viele Punkte entfallen auf jedes Thema?
              Beim Erstellen der Arbeit die Frage, ob ein Unterthema mit zwei
              Punkten ueberhaupt etwas aussagen kann. */}
          <ThemenGewichte gw={themenGewichte(work.tasks)} titel={t("klassenarbeit.gewichtTitel")} hint={t("klassenarbeit.gewichtHint")} themen={themen} t={t} />
          </>)}

          {/* 2) Punkte-Raster: Zeilen = Schüler, Spalten = Aufgaben (0..max). */}
          {(work.tasks || []).length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
              {/* Aus, bis jemand ihn anmacht: die Fehlerart ist eine freiwillige
                  Zusatzangabe. Wer sie nicht braucht, soll kein zweites Feld je
                  Zelle sehen — das Raster ist ohnehin breiter als der Schirm. */}
              <button onClick={() => setFehlerModus((v) => !v)}
                style={{ ...toolbarBtn, background: fehlerModus ? "var(--accent)" : "transparent", color: fehlerModus ? C.aufAkzent : "var(--text2)" }}
                title={t("klassenarbeit.fehlerHint")}>
                <Icon d={ICONS.tag || ICONS.bulb} size={15} color={fehlerModus ? C.aufAkzent : "var(--text2)"} /> {t("klassenarbeit.fehlerMode")}
              </button>
              {fehlerModus && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--text3)" }}>
                  {FEHLER.map((f) => (
                    <span key={f.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ ...fehlerChip, background: f.color, color: C.aufAkzent }}>{f.ab}</span>
                      {t(`klassenarbeit.fehler.${f.key}`)}
                    </span>
                  ))}
                  <span>· {t("klassenarbeit.fehlerCycle")}</span>
                </span>
              )}
            </div>
          )}
          {(work.tasks || []).length > 0 && (
            <div style={{ overflowX: "auto", overscrollBehaviorX: "contain", border: "1px solid var(--border)", borderRadius: panelStyle.borderRadius }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ ...th, ...klebtLinks, textAlign: "left", minWidth: 130, zIndex: 2 }}>{t("common.name")}</th>
                    {(work.tasks || []).map((tk, i) => <th key={tk.id} colSpan={spalten(tk).length} style={{ ...th, minWidth: 46, borderLeft: "1px solid var(--border)" }} title={tk.label}>{tk.label || (i + 1)}</th>)}
                    <th rowSpan={2} style={{ ...th, minWidth: 58, borderLeft: "1px solid var(--border)" }}>Σ / {komma(totalMax())}</th>
                    {/* Note: in der SuS-/Präsentationsansicht unsichtbar, weil das
                        ganze Raster oben schon hinter !hideIndividual haengt. */}
                    <th rowSpan={2} style={{ ...th, minWidth: 44 }}>{t("klassenarbeit.grade")}</th>
                  </tr>
                  <tr>
                    {(work.tasks || []).flatMap((tk) => spalten(tk).map((sp, j) => {
                      const rand = j === 0 ? "1px solid var(--border)" : undefined;
                      if (sp.art === "wahl") return <th key={tk.id + "-wahl"} style={{ ...th, minWidth: 34, fontWeight: 500, borderLeft: rand }} title={t("klassenarbeit.wahlHint", { n: andereStufe })}>{eigeneStufe}/{andereStufe}</th>;
                      if (sp.art === "summe") return <th key={tk.id + "-sum"} style={{ ...th, minWidth: 46, fontWeight: 700, background: "var(--bg2)" }}>Σ<div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 400 }}>/{komma(taskMax(tk))}</div></th>;
                      const u = sp.u;
                      const st = sp.anders ? andereStufe : eigeneStufe;
                      return <th key={u.id} style={{ ...th, minWidth: 44, fontWeight: 500, borderLeft: rand, ...(sp.anders ? { color: C.info } : {}), ...(fokus && fokus.uid === u.id ? { background: FOKUS_TON, color: "var(--accent)", fontWeight: 700 } : {}) }}>{sp.mitStufe ? `${st}${u.label ? " " + u.label : ""}` : (u.label || "")}<div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 400 }}>/{komma(unitMax(u))}</div></th>;
                    }))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const wt = wertungOf(s.id); const sum = wt.erreicht; const tm = totalMax(); const abw = isAbsent(s.id);
                    // Nichts eingetragen heisst NICHT „null Punkte". Vor dem
                    // Korrigieren stand in jeder Zeile 0/59 und eine 6 — eine
                    // Wand aus roten Sechsen fuer eine Arbeit, die noch niemand
                    // angesehen hat. Erst wenn zu diesem Kind ein Wert erfasst
                    // ist, gibt es Summe und Note; eine bewusst eingetragene 0
                    // zaehlt dabei als Wert.
                    const erfasst = hatPunkte(s.id);
                    // Note auch für Abwesende zeigen (Punkte bleiben ja erhalten) — nur
                    // die Klassenstatistik unten rechnet sie raus. Anzeige umschaltbar:
                    // Tendenznote (2+) oder Notenwert in 0,3-Schritten (2,3).
                    const gd = (erfasst && tm) ? gradeDetailed(wt.pct, effScale) : null;
                    const note = gd ? (gradeMode === "wert" ? komma(gd.wert) : gd.note) : "";
                    return (
                      <tr key={s.id} style={{ ...(abw ? { opacity: 0.5 } : {}), ...(fokus && fokus.sid === s.id ? { background: FOKUS_TON } : {}) }}>
                        <td style={{ ...td, ...klebtLinks, textAlign: "left", padding: "4px 8px", fontWeight: 500, whiteSpace: "nowrap",
                          ...(fokus && fokus.sid === s.id ? { background: FOKUS_TON_DECKEND, boxShadow: "inset 3px 0 0 var(--accent)" } : {}) }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            {/* Anwesenheit: Auge / durchgestrichenes Auge —
                                „zaehlt in der Auswertung mit" bzw. „bleibt
                                draussen". Der leere Kreis vorher sah nach
                                „auswaehlen" aus. */}
                            <button onClick={() => toggleAbsent(s.id)} title={abw ? t("klassenarbeit.present") : t("klassenarbeit.absent")}
                              aria-label={abw ? t("klassenarbeit.present") : t("klassenarbeit.absent")} aria-pressed={abw}
                              style={{ border: "none", background: "none", cursor: "pointer", color: abw ? C.warning : "var(--text3)", padding: 0, display: "inline-flex",
                                alignItems: "center", justifyContent: "center", minWidth: 32, minHeight: 32, margin: "-4px 0 -4px -8px" }}><Icon d={abw ? ICONS.eyeOff : ICONS.eye} size={15} /></button>
                            {s.name}
                          </span>
                        </td>
                        {(work.tasks || []).flatMap((tk) => {
                          const hatAndere = !!andereFassung(wk, tk);
                          const anders = gewechselt(wk, s.id, tk);
                          return spalten(tk).map((sp, j) => {
                            const rand = j === 0 ? "1px solid var(--border)" : undefined;
                            if (sp.art === "wahl") return (
                              <td key={tk.id + "-wahl"} style={{ ...td, borderLeft: rand, textAlign: "center" }}>
                                {/* Welche Fassung hat das Kind geschrieben? Ein Klick
                                    wechselt; wer in die andere Fassung tippt, wechselt
                                    ebenfalls. Die Punkte der anderen bleiben stehen,
                                    zaehlen aber nicht. */}
                                <button onClick={() => setWechsel(s.id, tk.id, !anders)} aria-pressed={anders}
                                  title={t("klassenarbeit.wahlHint", { n: andereStufe })}
                                  style={{ ...fehlerChip, cursor: "pointer", border: "none", minWidth: 24, minHeight: 24,
                                    background: anders ? C.info : "var(--bg3)", color: anders ? C.aufAkzent : "var(--text2)" }}>{anders ? andereStufe : eigeneStufe}</button>
                              </td>
                            );
                            if (sp.art === "summe") {
                              const ts = aufgabenPunkte(wk, s.id, tk);
                              return <td key={tk.id + "-sum"} style={{ ...td, fontWeight: 700, background: "var(--bg2)", color: "var(--text2)" }}>{kommaRund(ts, 2)}</td>;
                            }
                            const u = sp.u;
                            const an = !hatAndere || sp.anders === anders;
                            return (
                              <td key={u.id} style={{ ...td, borderLeft: rand, ...(an ? {} : { opacity: 0.35 }), ...(fokus && fokus.uid === u.id ? { background: FOKUS_TON } : {}) }}>
                                {/* Abwesende bleiben editierbar — Punkte werden nur nicht in die
                                    Klassenstatistik gerechnet, aber nicht gelöscht. */}
                                <input type="number" min="0" step="0.5" max={unitMax(u)} value={pointsOf(s.id, u.id)}
                                  onFocus={() => setFokus({ sid: s.id, uid: u.id })} onBlur={() => setFokus(null)}
                                  onChange={(e) => setPoints(s.id, u.id, e.target.value === "" ? "" : Math.min(unitMax(u), Math.max(0, Number(e.target.value))), an ? null : [tk.id, sp.anders])}
                                  style={{ width: 42, height: 32, border: "none", background: "transparent", textAlign: "center", fontSize: 13, color: "var(--text)" }} />
                                {/* Die Fehlerart steht nur da, wo Punkte fehlen —
                                    an einer Aufgabe mit voller Punktzahl gibt es
                                    keinen Fehler zu benennen, und an der nicht
                                    geschriebenen Fassung auch nicht. Genau
                                    dieselbe Regel rechnet der Server (_fehler_gezaehlt). */}
                                {fehlerModus && an && (() => {
                                  const p = pointsOf(s.id, u.id);
                                  if (p === "" || Number(p) >= unitMax(u)) return null;
                                  const f = FEHLER.find((x) => x.key === fehlerOf(s.id, u.id));
                                  return (
                                    <button onClick={() => cycleFehler(s.id, u.id)}
                                      title={f ? t(`klassenarbeit.fehler.${f.key}`) : t("klassenarbeit.fehlerSet")}
                                      style={{ ...fehlerChip, display: "block", margin: "0 auto 2px", cursor: "pointer",
                                        background: f ? f.color : "transparent", color: f ? C.aufAkzent : "var(--text3)",
                                        border: f ? "none" : "1px dashed var(--border2)" }}>
                                      {f ? f.ab : "+"}
                                    </button>
                                  );
                                })()}
                              </td>
                            );
                          });
                        })}
                        <td title={erfasst && wt.bonusPct > 0 ? t("klassenarbeit.eBonus", { p: kommaRund(wt.bonusPct, 1) }) : undefined}
                          style={{ ...td, fontWeight: 700, borderLeft: "1px solid var(--border)", color: !erfasst ? "var(--text3)" : abw ? "var(--text3)" : (tm && wt.pct < 50 ? C.danger : "var(--text)") }}>{erfasst ? `${kommaRund(sum, 2)}/${komma(tm)}` : `–/${komma(tm)}`}</td>
                        <td style={{ ...td, fontWeight: 700, color: abw ? "var(--text3)" : "var(--text)" }}>{note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
            {notenAktiv && (work.tasks || []).length > 0 && (verknuepft.length ? (
              <Link to={`/auswertung?tab=noten&class=${classId}${kursId ? `&kurs=${kursId}` : ""}`} title={t("klassenarbeit.verknuepftHint")}
                style={{ ...chipStyle, display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", color: "var(--text2)" }}>
                <Icon d={ICONS.link} size={14} /> {verknuepft.map((v) => v.section ? `${v.section} · ${v.name}` : v.name).join(", ")}
              </Link>
            ) : <button onClick={() => setNotenModal(true)} style={{ ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 6 }}><Icon d={ICONS.link} size={15} /> {t("klassenarbeit.toNoten")}</button>)}
            {/* Ein Blatt je Kind. Der Ausdruck laesst den Rahmen weg (Druck-CSS
                in index.html: `.nur-drucken` gewinnt), deshalb reicht hier
                window.print() ohne eigenes Fenster. */}
            {analyse && analyse.bogen.length > 0 && (
              <button onClick={bogenOeffnen} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }}
                title={t("bogen.printHint")}><Icon d={ICONS.print} size={15} /> {t("bogen.print")}</button>
            )}
            {(work.tasks || []).length > 0 && (
              <button onClick={() => setScaleOpen((v) => !v)} style={{ ...btnSecondary, marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}
                title={t("klassenarbeit.scaleHint")}>{t("klassenarbeit.scale")}{(work.scale && Object.keys(work.scale).length) ? " •" : ""}</button>
            )}
          </div>
          {scaleOpen && (work.tasks || []).length > 0 && (
            <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: panelStyle.borderRadius, padding: "12px 14px", background: "var(--card)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{t("klassenarbeit.scaleTitle")}</span>
                <span style={{ fontSize: 12, color: (work.scale && Object.keys(work.scale).length) ? C.warning : "var(--text3)" }}>
                  {(work.scale && Object.keys(work.scale).length) ? t("klassenarbeit.scaleOwn") : t("klassenarbeit.scaleProfile")}
                </span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                {[1, 2, 3, 4, 5].map((g) => (
                  <label key={g} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: "var(--text2)" }}>
                    <span>{t("klassenarbeit.gradeFrom", { g })}</span>
                    <input type="number" min="0" max="100" step="1" value={Math.round(effScale[g] ?? DEFAULT_SCALE[g])}
                      onChange={(e) => { const base = { ...DEFAULT_SCALE, ...effScale }; base[g] = Math.max(0, Math.min(100, Number(e.target.value) || 0)); base[6] = 0; setWorkScale(base); }}
                      style={{ ...inputStyle, width: 64, padding: "6px 8px", textAlign: "center" }} />
                  </label>
                ))}
                <span style={{ fontSize: 12, color: "var(--text3)" }}>% {t("klassenarbeit.scaleUnit")}</span>
                {(work.scale && Object.keys(work.scale).length) ? (
                  <button onClick={() => setWorkScale({})} style={{ ...btnSecondary, padding: "6px 12px", fontSize: 13 }}>{t("klassenarbeit.scaleReset")}</button>
                ) : null}
              </div>
            </div>
          )}
          {notenModal && (() => {
            const noten = notenAusArbeit(students, wk, effScale);
            return <NotenUebernahme titel={t("klassenarbeit.toNoten")}
              classId={classId} kursId={kursId} grades={noten}
              quelle="klassenarbeit" notiz={t("klassenarbeit.title")} spalte={work.name || t("klassenarbeit.newName")} workId={work.id}
              onClose={() => setNotenModal(false)} />;
          })()}
          </>)}

          {alleAn ? (<>
            {/* EINE Auswertung oben, umschaltbar Alle | E | G — drei
                untereinander waren zu viel. Darunter die Noten aller Kinder. */}
            {alleAnalysen && (() => {
              const teil = alleAnalysen.teile.find(([st]) => st === alleTeil);
              const A = alleTeil !== "alle" && teil ? teil[1] : alleAnalysen.gesamt;
              return (<>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                  <Segment>
                    {["alle", "E", "G"].map((x) => (
                      <button key={x} onClick={() => setAlleTeil(x)} aria-pressed={alleTeil === x}
                        style={{ ...segmentBtn, fontWeight: alleTeil === x ? 700 : 500, color: alleTeil === x ? "var(--accent)" : "var(--text2)" }}>
                        {x === "alle" ? t("klassenarbeit.alleKurse") : t("klassenarbeit.kursNiveau", { n: x })}
                      </button>
                    ))}
                  </Segment>
                </div>
                {/* Anteil jedes Themas an der Note — je Blatt, denn E- und
                    G-Arbeit gewichten verschieden. Unter „Alle" beide. */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 16 }}>
                  {[work, partner].filter((b) => b && (alleTeil === "alle" || b.niveau === alleTeil))
                    .sort((x, y) => (x.niveau < y.niveau ? -1 : 1))
                    .map((b) => (
                      <ThemenGewichte key={b.id} rand={0} gw={themenGewichte(b.tasks, { mitDarstellung: true })}
                        titel={t("klassenarbeit.gewichtNote", { n: b.niveau })} hint={t("klassenarbeit.gewichtNoteHint")} themen={themen} t={t} />
                    ))}
                </div>
                {zeigeAuswertung(A, alleTeil === "alle" ? t("klassenarbeit.auswertungGesamt") : t("klassenarbeit.auswertungBlatt", { n: alleTeil }), alleTeil,
                  { nurArbeit: true, aufgaben: aufgabenDerArbeit(alleAnalysen.aufgaben, alleTeil) })}
                <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                  {druckBogen.length > 0 && (
                    <button onClick={bogenOeffnen} style={{ ...btnSecondary, display: "inline-flex", alignItems: "center", gap: 6 }}
                      title={t("bogen.printHint")}><Icon d={ICONS.print} size={15} /> {t("bogen.print")}</button>
                  )}
                </div>
              </>);
            })()}
            {/* SuS-Ansicht (am Beamer): keine Namen mit Noten. */}
            {!hideIndividual && (<>
              <div style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 8px" }}>{t("klassenarbeit.notenAller")}</div>
              <AlleBlaetter blaetter={[work, partner]} alleStudents={alleStudents} scale={scale} t={t} />
            </>)}
          </>) : zeigeAuswertung(analyse)}
        </>
      )}
      {neuOffen && <NeueArbeitModal t={t} onClose={() => setNeuOffen(false)} onAnlegen={anlegen}
        vorschlag={t("klassenarbeit.newName")} />}
      {hasRoster && works.length === 0 && <Empty title={t("klassenarbeit.empty")} hint={t("klassenarbeit.emptyHint")} action={t("klassenarbeit.new")} onAction={() => setNeuOffen(true)} actionTour="ka-new" />}
      {/* Der Themenstand stand hier einmal als ganzes Panel (mit eigener
          SuS-Auswahl) — die falsche Stelle: eine Klassenarbeit zeigt EINEN Tag,
          „wackelt das Thema dauerhaft?" gehoert zum Kind. Geblieben ist der
          Hinweis; mit CardVote fuehrt er auch hin (Regel 3: ohne das Modul gibt
          es die Seite nicht, dann bleibt der Satz stehen). */}
      {hasRoster && !hideIndividual && classId && (
        <div style={{ ...cardStyle, marginTop: 16, padding: "10px 14px", fontSize: 13, color: "var(--text2)" }}>
          {t("klassenarbeit.lernstandHint")}{" "}
          {cardvoteAktiv && (
            <Link to={`/cardvote/class-evaluation/${classId}`} style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
              {t("klassenarbeit.lernstandLink")} ↗
            </Link>
          )}
        </div>
      )}

      {/* Am Bildschirm unsichtbar, auf dem Papier das Einzige. Die Komponente
          haengt sich per Portal an den <body> — der Rahmen hier gaebe ihr sonst
          seinen Platz im Fluss, und der Drucker zaehlte danach die Seiten. */}
      {work && druckBogen.length > 0 && (
        <Rueckmeldebogen titel={work.name} bogen={druckBogen} teile={bogenTeile}
          fehlerLabel={(k) => t(`klassenarbeit.fehler.${k}`)} />
      )}
      {bogenWahl && <BogenWahl mitWdh={lernpfadAktiv} wdhFehlt={wdhFehlt} onClose={() => setBogenWahl(false)} onDrucken={bogenDrucken} />}

      {hasRoster && work && students.length === 0 && <Empty title={t("klassenarbeit.noStudents")} />}

      {kopieOffen && work && (
        <KopieModal work={work} onClose={() => setKopieOffen(false)} onCopy={kopieren} t={t} />
      )}
      {/* Unten schwebend: das Punkte-Raster ist länger als der Bildschirm, oben
          wäre der Knopf nach der dritten Zeile weg. */}
      <SpeicherBalken entwurf={entwurf} zeigen={autoSpeichern.zeigen} />
    </div>
  );
}

// Brücke Klassenarbeit → Notenbuch. Der Dialog ist derselbe wie bei den
// Karteikarten (components/NotenUebernahme.jsx); hier steht nur, WIE aus
// Punkten eine Note wird — das ist die Fachlichkeit dieser Seite.
//
// Nur wer erfasst ist: eine noch nicht korrigierte Zeile darf keine 6 ins
// Notenbuch tragen. Eine bewusst eingetragene 0 zaehlt, ein leeres Feld nicht.
// Krank/abwesend bekommt ohnehin keine Note.
function notenAusArbeit(students, work, scale) {
  const absentU = new Set((work.absent || []).map(String));
  if (!basis(work.tasks)) return [];
  return students
    .filter((s) => {
      if (absentU.has(String(s.id))) return false;
      const r = (work.results || {})[String(s.id)];
      if (!r || r === "abwesend") return false;
      if (Array.isArray(r)) return true;                  // Altformat
      return Object.values(r).some((v) => v != null && v !== "");
    })
    // Notenwert mit Tendenz (±0,3) — wie in der Excel-Auswertung; Prozent aus
    // core/arbeitswertung.js (Wahlaufgaben: geschriebene Fassung, E-Bonus).
    .map((s) => ({ student_id: s.id, value: gradeDetailed(wertung(work, s.id, scale).pct, scale).wert }))
    .filter((g) => g.value >= 1 && g.value <= 6);
}

// ── Vergleich ────────────────────────────────────────────────────────────────
// Je Arbeit die erreichten Prozent je bewertetem (nicht abwesendem) SuS.
// Altformat (results[sid] = [falsche Aufgaben-IDs]) wird mitgerechnet.
function pctList(work) {
  if (!basis(work.tasks)) return [];
  const scale = work.scale && Object.keys(work.scale).length ? work.scale : profilSkala();
  const absent = new Set((work.absent || []).map(String));
  const out = [];
  for (const [sid, r] of Object.entries(work.results || {})) {
    if (!r || r === "abwesend" || absent.has(String(sid))) continue;
    out.push(Math.round(wertung(work, sid, scale).pct));
  }
  return out;
}

// Notenschluessel aus dem Profil — der E-Bonus ist auf eine Notenstufe gedeckelt
// und braucht deshalb die Stufengrenzen.
function profilSkala() {
  try { return JSON.parse(localStorage.getItem("user"))?.grade_scale || DEFAULT_SCALE; } catch { return DEFAULT_SCALE; }
}

function quartiles(arr) {
  const a = [...arr].sort((x, y) => x - y); const n = a.length;
  if (!n) return null;
  const q = (p) => { const idx = (n - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx); return a[lo] + (a[hi] - a[lo]) * (idx - lo); };
  return { n, min: a[0], q1: q(0.25), med: q(0.5), q3: q(0.75), max: a[n - 1], avg: a.reduce((s, x) => s + x, 0) / n };
}

const boxColor = (med) => (med < 50 ? C.danger : med < 75 ? C.warning : C.success);
// Boxplot kommt zentral aus Icons.jsx (eine Quelle). Der Vergleich nutzt die
// kompakte Variante (compact) je Zeile.

export function KlassenarbeitVergleich() {
  const { t } = useLanguage();
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null);
  const [works, setWorks] = useState([]);
  const [workId, setWorkId] = useState(null);     // gewählte Arbeit (Klassenvergleich)
  const [daten, setDaten] = useState(null);       // Antwort von /vergleich
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [sicht, setSicht] = useState("klassen"); // klassen | aufgaben | verlauf
  useEffect(() => { try { const u = JSON.parse(localStorage.getItem("user")); if (u?.grade_scale) setScale(u.grade_scale); } catch { /* Default */ } }, []);

  const kq = kursId != null ? `?kurs_id=${kursId}` : "";
  useEffect(() => {
    if (!classId) { setWorks([]); setWorkId(null); return; }
    fetch(`${API}/classes/${classId}/works${kq}`).then((r) => (r.ok ? r.json() : [])).then((d) => {
      const liste = Array.isArray(d) ? d : [];
      setWorks(liste);
      setWorkId((alt) => (liste.some((w) => w.id === alt) ? alt : (liste[0]?.id ?? null)));
    }).catch(() => setWorks([]));
  }, [classId, kursId]);

  // Der Klassenvergleich kommt vom Server: er kennt die Gruppe („dieselbe
  // Arbeit") über die Herkunft der Kopien und rechnet je Aufgabe mit derselben
  // Punktelogik wie die Auswertung. Zwei Fassungen derselben Rechnung liefen
  // sonst auseinander.
  useEffect(() => {
    if (!workId) { setDaten(null); return; }
    fetch(`${API}/works/${workId}/vergleich`).then((r) => (r.ok ? r.json() : null)).then(setDaten).catch(() => setDaten(null));
  }, [workId]);

  // Verlauf: alle Arbeiten dieser Klasse nacheinander (die frühere Ansicht).
  const verlauf = useMemo(() => works.map((w) => {
    // Wahlaufgaben rechnen mit dem anderen Blatt derselben Arbeit.
    const p = w.partner_id ? works.find((x) => x.id === w.partner_id) : null;
    const pl = pctList(p ? { ...w, _alt: p.tasks || [] } : w); const q = quartiles(pl);
    const noten = pl.map((p) => gradeFromPct(p, scale));
    const avgNote = noten.length ? noten.reduce((s, x) => s + x, 0) / noten.length : null;
    return { id: w.id, name: w.name, q, pl, avgNote };
  }).filter((r) => r.q), [works, scale]);

  const klassen = (daten?.arbeiten || []).filter((a) => a.n > 0);
  const fmt = (x) => (x == null ? "–" : Math.round(x) + "%");
  // Eine Nachkommastelle, deutsch, „–" wenn es nichts gibt — aus core/zahl.js.
  const nt = (x) => kommaRund(x, 1, "–");
  const noteVon = (pl) => { const n = pl.map((p) => gradeFromPct(p, scale)); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null; };
  const einheitLabel = (e, i) => [e.label || `${i + 1}`, e.teil].filter(Boolean).join(" ");

  // Aufgaben-Statistik über die Klassen: Zeilen = Aufgabe, Spalten = Klasse.
  // Verglichen wird über die Position, nicht über die unit_id — Kopien haben
  // eigene IDs, es ist aber dieselbe Aufgabe an derselben Stelle.
  const aufgaben = useMemo(() => {
    if (!klassen.length) return [];
    const gesamt = daten?.gesamt || [];
    const laenge = Math.max(...klassen.map((a) => a.einheiten.length));
    return Array.from({ length: laenge }, (_, i) => {
      const erste = klassen.find((a) => a.einheiten[i])?.einheiten[i];
      const werte = klassen.map((a) => a.einheiten[i]?.pct ?? null);
      const da = werte.filter((v) => v != null);
      return {
        i, erste, g: gesamt[i] || null,
        label: erste ? einheitLabel(erste, i) : String(i + 1),
        max: erste?.max, form: !!erste?.form,
        werte, spanne: da.length > 1 ? Math.max(...da) - Math.min(...da) : null,
        // Je Klasse die Kennzahlen, fuer die aufgeklappte Zeile.
        detail: klassen.map((a) => a.einheiten[i] || null),
      };
    });
  }, [daten]);

  // Darstellung („Form") zaehlt zur Note, aber nicht zum Aufgabenvergleich:
  // sie misst keine Kompetenz in einem Thema. Sichtbar bleibt sie als Fussnote,
  // damit niemand sie fuer vergessen haelt.
  const inhaltlich = aufgaben.filter((r) => !r.form);
  const formAufgaben = aufgaben.filter((r) => r.form);
  const [offen, setOffen] = useState(null);        // aufgeklappte Aufgabenzeile

  // Woran man eine misslungene Aufgabe erkennt — bewusst nur zwei Regeln, beide
  // mit dem Wert daneben, damit die Lehrkraft sie nachpruefen kann.
  const auffaellig = (g) => {
    if (!g) return null;
    if (g.trenn != null && g.trenn < 0.1) return t("klassenarbeit.flagTrenn", { v: komma(g.trenn) });
    if (g.null != null && g.null >= 40 && (g.pct ?? 100) < 60) return t("klassenarbeit.flagNull", { v: g.null });
    return null;
  };

  // Dritte Tabellenform in derselben Datei — jetzt aus derselben Quelle wie die
  // beiden anderen abgeleitet. Rechtsbuendig, weil hier nur Zahlen stehen; die
  // Trennlinie sitzt oben statt unten (Vergleichsliste ohne Kopf-Abschluss).
  const kopf = { ...thBase, fontSize: 11, padding: "8px 10px", textAlign: "right", borderBottom: "none" };
  const zelle = { ...tdBase, fontSize: 13, padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", borderBottom: "none", borderTop: "1px solid var(--border)" };

  return (
    <div style={{ ...pageApp, padding: "0 16px 40px" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <KursKlasseSelect value={classId} kursValue={kursId} onChange={(id, kid) => { setClassId(id); setKursId(kid); }} onKurs={setKursId} />
        {works.length > 0 && (
          <SuchSelect value={workId ? String(workId) : ""} onChange={(v) => setWorkId(Number(v))} style={{ minWidth: 0, maxWidth: 320 }}
            optionen={works.map((w) => ({ wert: String(w.id), label: w.niveau ? `${w.name} (${w.niveau})` : w.name }))} />
        )}
      </div>

      {/* Die Arbeit selbst gehoert in den Vergleich: wer eine Zeile „26 %" liest,
          will nachsehen, was da gefragt war. Nur ansehen — hochgeladen und
          geloescht wird bei der Arbeit, nicht hier. */}
      {workId && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginTop: 16 }}>
          <MaterialPanel workId={workId} rolle="arbeit" titel={t("klassenarbeit.fileWork")} nurLesen />
          <MaterialPanel workId={workId} rolle="erwartung" titel={t("klassenarbeit.fileExpect")} nurLesen />
        </div>
      )}

      {classId && (
        <div style={{ marginTop: 16 }}>
          <Tabs value={sicht} onChange={setSicht} options={[
            ["klassen", t("klassenarbeit.cmpClasses")],
            ["aufgaben", t("klassenarbeit.cmpTasks")],
            ["verlauf", t("klassenarbeit.cmpHistory")],
          ]} />
        </div>
      )}

      {/* 1) Dieselbe Arbeit über die Klassen: eine Zeile je Klasse. */}
      {sicht === "klassen" && (
        klassen.length === 0 ? (
          <div style={{ marginTop: 24 }}><Empty title={t("klassenarbeit.compareEmpty")} /></div>
        ) : (
          <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: cardStyle.borderRadius, background: "var(--card)", overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={{ ...kopf, textAlign: "left" }}>{t("klassenarbeit.cmpClass")}</th>
                  <th style={{ ...kopf, textAlign: "left", width: "45%" }}>100 % – 0 %</th>
                  <th style={kopf}>n</th>
                  <th style={kopf}>⌀ %</th>
                  <th style={kopf}>⌀ {t("klassenarbeit.grade")}</th>
                </tr>
              </thead>
              <tbody>
                {klassen.map((a) => {
                  const q = quartiles(a.pct_liste);
                  return (
                    <tr key={a.id} style={a.eigene ? { background: "var(--bg2)" } : undefined}>
                      <td style={{ ...zelle, textAlign: "left", fontWeight: 600 }} title={a.name}>{a.class_name || a.name}</td>
                      <td style={{ ...zelle, textAlign: "left" }}><Boxplot values={a.pct_liste} max={100} compact umgekehrt /></td>
                      <td style={{ ...zelle, color: "var(--text3)" }}>{a.n}</td>
                      <td style={{ ...zelle, fontWeight: 600 }}>{fmt(a.schnitt)}</td>
                      <td style={{ ...zelle, fontWeight: 700, color: q ? boxColor(q.med) : "var(--text)" }}>{nt(noteVon(a.pct_liste))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text3)" }}>
              {t("klassenarbeit.boxplotLegend")} {klassen.length === 1 && `· ${t("klassenarbeit.cmpOnlyOne")}`}
            </div>
          </div>
        )
      )}

      {/* 2) Je Aufgabe: Klassen nebeneinander, Gesamtzahlen daneben, Details
             auf Klick. Die Trefferquote allein sagt nur, wie schwer eine Aufgabe
             war — ob sie MISSLUNGEN ist, zeigen Trennschärfe und der Anteil
             leerer Abgaben. */}
      {sicht === "aufgaben" && (
        inhaltlich.length === 0 ? (
          <div style={{ marginTop: 24 }}><Empty title={t("klassenarbeit.compareEmpty")} /></div>
        ) : (
          <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: cardStyle.borderRadius, background: "var(--card)", overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={{ ...kopf, textAlign: "left" }}>{t("klassenarbeit.cmpTask")}</th>
                  {klassen.map((a) => <th key={a.id} style={kopf} title={a.name}>{a.class_name || "?"}</th>)}
                  {klassen.length > 1 && <th style={kopf}>{t("klassenarbeit.cmpSpread")}</th>}
                  <th style={{ ...kopf, borderLeft: "1px solid var(--border)" }}>{t("klassenarbeit.cmpAll")}</th>
                  <th style={kopf} title={t("klassenarbeit.cmpEmptyHint")}>{t("klassenarbeit.cmpEmpty")}</th>
                  <th style={kopf} title={t("klassenarbeit.cmpDiscrHint")}>{t("klassenarbeit.cmpDiscr")}</th>
                </tr>
              </thead>
              <tbody>
                {inhaltlich.map((r) => {
                  const g = r.g;
                  const hinweis = auffaellig(g);
                  const auf = offen === r.i;
                  return (
                    <Fragment key={r.i}>
                      <tr onClick={() => setOffen(auf ? null : r.i)} style={{ cursor: "pointer" }}>
                        <td style={{ ...zelle, textAlign: "left", fontWeight: 600 }}>
                          {r.label}
                          {r.max ? <span style={{ color: "var(--text3)", fontWeight: 400 }}> /{komma(r.max)}</span> : null}
                          {hinweis && <span title={hinweis} style={{ marginLeft: 8, color: C.warning, fontWeight: 700 }}>!</span>}
                        </td>
                        {r.werte.map((v, k) => (
                          <td key={k} style={{ ...zelle, fontWeight: 600, color: v == null ? "var(--text3)" : v < 50 ? C.danger : v < 75 ? C.warning : C.success }}>
                            {v == null ? "–" : `${v}%`}
                          </td>
                        ))}
                        {klassen.length > 1 && <td style={{ ...zelle, color: "var(--text3)" }}>{r.spanne == null ? "–" : `${r.spanne} Pp`}</td>}
                        <td style={{ ...zelle, fontWeight: 700, borderLeft: "1px solid var(--border)" }}>
                          {g?.pct == null ? "–" : `${g.pct}%`}
                          <span style={{ fontWeight: 400, color: "var(--text3)", fontSize: 11 }}> ({g?.n ?? 0})</span>
                        </td>
                        <td style={{ ...zelle, color: (g?.null ?? 0) >= 40 ? C.danger : "var(--text3)" }}>{g?.null == null ? "–" : `${g.null}%`}</td>
                        <td style={{ ...zelle, fontWeight: 600, color: g?.trenn == null ? "var(--text3)" : g.trenn < 0.1 ? C.danger : g.trenn < 0.2 ? C.warning : "var(--text2)" }}>
                          {g?.trenn == null ? "–" : komma(g.trenn)}
                        </td>
                      </tr>
                      {auf && (
                        <tr>
                          <td colSpan={klassen.length + (klassen.length > 1 ? 4 : 3)} style={{ padding: "0 10px 12px", borderTop: "none", background: "var(--bg2)" }}>
                            {hinweis && <div style={{ fontSize: 13, color: C.warning, padding: "8px 0 4px", fontWeight: 600 }}>{hinweis}</div>}
                            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th style={{ ...kopf, textAlign: "left", padding: "6px 8px" }}>{t("klassenarbeit.cmpClass")}</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }}>n</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }}>⌀ {t("klassenarbeit.points")}</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }}>%</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }} title={t("klassenarbeit.cmpEmptyHint")}>{t("klassenarbeit.cmpEmpty")}</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }} title={t("klassenarbeit.cmpFullHint")}>{t("klassenarbeit.cmpFull")}</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }}>SD</th>
                                  <th style={{ ...kopf, padding: "6px 8px" }} title={t("klassenarbeit.cmpDiscrHint")}>{t("klassenarbeit.cmpDiscr")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.detail.map((d, k) => (
                                  <tr key={k}>
                                    <td style={{ ...zelle, textAlign: "left", padding: "6px 8px" }}>{klassen[k]?.class_name || "?"}</td>
                                    <td style={{ ...zelle, padding: "6px 8px", color: "var(--text3)" }}>{d?.n ?? "–"}</td>
                                    <td style={{ ...zelle, padding: "6px 8px" }}>{komma(d?.schnitt, "–")}</td>
                                    <td style={{ ...zelle, padding: "6px 8px", fontWeight: 600 }}>{d?.pct == null ? "–" : `${d.pct}%`}</td>
                                    <td style={{ ...zelle, padding: "6px 8px" }}>{d?.null == null ? "–" : `${d.null}%`}</td>
                                    <td style={{ ...zelle, padding: "6px 8px" }}>{d?.voll == null ? "–" : `${d.voll}%`}</td>
                                    <td style={{ ...zelle, padding: "6px 8px", color: "var(--text3)" }}>{komma(d?.sd, "–")}</td>
                                    <td style={{ ...zelle, padding: "6px 8px" }}>{komma(d?.trenn, "–")}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
              {t("klassenarbeit.cmpTasksLegend")}
              {formAufgaben.length > 0 && ` · ${t("klassenarbeit.cmpFormOut", { n: formAufgaben.length })}`}
            </div>
          </div>
        )
      )}

      {/* 3) Verlauf: alle Arbeiten dieser Klasse nacheinander (die frühere Sicht). */}
      {sicht === "verlauf" && (
        verlauf.length === 0 ? (
          <div style={{ marginTop: 24 }}><Empty title={t("klassenarbeit.compareEmpty")} /></div>
        ) : (
          <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: cardStyle.borderRadius, background: "var(--card)", overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={{ ...kopf, textAlign: "left" }}>{t("klassenarbeit.compareWork")}</th>
                  <th style={{ ...kopf, textAlign: "left", width: "45%" }}>100 % – 0 %</th>
                  <th style={kopf}>n</th>
                  <th style={kopf}>⌀ %</th>
                  <th style={kopf}>⌀ {t("klassenarbeit.grade")}</th>
                </tr>
              </thead>
              <tbody>
                {verlauf.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...zelle, textAlign: "left", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={r.name}>{r.name}</td>
                    <td style={{ ...zelle, textAlign: "left" }}><Boxplot values={r.pl} max={100} compact umgekehrt /></td>
                    <td style={{ ...zelle, color: "var(--text3)" }}>{r.q.n}</td>
                    <td style={{ ...zelle, fontWeight: 600 }}>{fmt(r.q.avg)}</td>
                    <td style={{ ...zelle, fontWeight: 700, color: boxColor(r.q.med) }}>{nt(r.avgNote)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text3)" }}>{t("klassenarbeit.boxplotLegend")}</div>
          </div>
        )
      )}
    </div>
  );
}

// Ziel einer Kopie waehlen. Bewusst dieselbe Auswahl wie oben in der Leiste
// (KursKlasseSelect) — eine Klasse kann in mehreren Kursen liegen, und die
// Arbeit haengt am Kurs, wenn es einen gibt.
// Gesamtsicht einer E/G-Arbeit: die Liste aller Kinder, jedes aus seinem Blatt.
// Gerechnet mit core/arbeitswertung.js (Wahlaufgaben ueber das jeweils andere
// Blatt eingeschlossen) — dieselbe Note wie im Blatt selbst.
function AlleBlaetter({ blaetter, alleStudents, scale, t }) {
  const zeilen = [];
  blaetter.forEach((b, i) => {
    if (!b) return;
    const anderes = blaetter[1 - i];
    const wk = { ...b, _alt: (anderes && anderes.tasks) || [] };
    const sc = b.scale && Object.keys(b.scale).length ? b.scale : scale;
    const absent = new Set((b.absent || []).map(String));
    alleStudents.filter((s) => (s.niveau || "") === b.niveau).forEach((s) => {
      const r = (b.results || {})[String(s.id)];
      const abw = absent.has(String(s.id)) || r === "abwesend";
      const erfasst = !abw && r && (Array.isArray(r) || Object.values(r).some((v) => v != null && v !== ""));
      if (!erfasst) { zeilen.push({ id: s.id, name: s.name, stufe: b.niveau, abw }); return; }
      const w = wertung(wk, s.id, sc);
      const d = gradeDetailed(w.pct, sc);
      zeilen.push({ id: s.id, name: s.name, stufe: b.niveau, erreicht: w.erreicht, basis: w.basis, pct: w.pct, note: d.note, wert: d.wert, grade: d.grade });
    });
  });
  zeilen.sort((a, b) => a.name.localeCompare(b.name));
  // Kennzahlen und Notenverteilung stehen darunter in der Auswertung „Gesamt"
  // (derselbe Block wie im einzelnen Blatt) — hier nur die Liste der Kinder.
  return (
    <div>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: panelStyle.borderRadius }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...thBase, textAlign: "left" }}>{t("common.name")}</th>
              <th style={thBase}>{t("klassenarbeit.blattSpalte")}</th>
              <th style={thBase}>{t("klassenarbeit.points")}</th>
              <th style={thBase}>{t("klassenarbeit.grade")}</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={`${z.stufe}-${z.id}`} style={z.pct == null ? { opacity: 0.5 } : undefined}>
                <td style={{ ...tdBase, textAlign: "left", fontWeight: 500 }}>{z.name}</td>
                <td style={{ ...tdBase, textAlign: "center" }}><span style={chipStyle}>{t("klassenarbeit.kursNiveau", { n: z.stufe })}</span></td>
                <td style={{ ...tdBase, textAlign: "center" }}>{z.pct == null ? (z.abw ? t("klassenarbeit.abwesendKurz") : "–") : `${kommaRund(z.erreicht, 2)} / ${komma(z.basis)}`}</td>
                <td style={{ ...tdBase, textAlign: "center", fontWeight: 700 }}>{z.note || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KopieModal({ work, onClose, onCopy, t }) {
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null);
  const [name, setName] = useState(work.name || "");
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState("");

  const los = async () => {
    if (!classId) return;
    setBusy(true); setFehler("");
    const ok = await onCopy(classId, kursId, name.trim() || work.name);
    setBusy(false);
    if (!ok) setFehler(t("common.notWork"));
  };

  return (
    <Modal onClose={onClose} width={420} label={t("klassenarbeit.copyTo")}>
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>{t("klassenarbeit.copyTo")}</h3>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 12px", lineHeight: 1.5 }}>{t("klassenarbeit.copyHint")}</p>

      <div style={{ fontSize: 13, color: "var(--text2)", margin: "0 0 5px" }}>{t("klassenarbeit.copyTarget")}</div>
      <KursKlasseSelect value={classId} kursValue={kursId} onChange={(id, kid) => { setClassId(id); setKursId(kid); }} onKurs={setKursId} />

      <div style={{ fontSize: 13, color: "var(--text2)", margin: "12px 0 5px" }}>{t("klassenarbeit.copyName")}</div>
      <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, width: "100%" }} />

      {fehler && <p style={{ color: C.danger, fontSize: 13, margin: "10px 0 0" }}>{fehler}</p>}
      <DialogFuss onSpeichern={los} onAbbrechen={onClose} aus={!classId || busy} speichern={t("klassenarbeit.copyGo")} />
    </Modal>
  );
}

/**
 * Neue Arbeit anlegen — Name und Art in einem Popup.
 *
 * Der Plus-Knopf legte vorher sofort eine „Klassenarbeit" an; benannt wurde
 * hinterher. Bei E/G braucht es aber ZWEI Arbeiten mit demselben Namen, und die
 * Entscheidung faellt vor dem Anlegen, nicht danach: E und G schreiben
 * verschiedene Blaetter mit verschiedenen Punkten, also zwei Auswertungen. Die
 * Kinder sind im Kurs bereits eingeteilt (`students.niveau`) — die jeweilige
 * Arbeit zeigt nur die ihren.
 */
function NeueArbeitModal({ t, onClose, onAnlegen, vorschlag }) {
  const [name, setName] = useState(vorschlag || "");
  const [art, setArt] = useState("eine");
  const [busy, setBusy] = useState(false);
  const los = async () => { setBusy(true); await onAnlegen(name, art); setBusy(false); };
  return (
    <Modal onClose={onClose} width={420} label={t("klassenarbeit.new")}>
      <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px" }}>{t("klassenarbeit.new")}</h3>
      <div style={{ fontSize: 12, color: "var(--text3)", margin: "12px 0 4px" }}>{t("klassenarbeit.newNameLabel")}</div>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !busy) los(); }}
        style={{ ...inputStyle, width: "100%" }} />
      <div style={{ fontSize: 12, color: "var(--text3)", margin: "12px 0 4px" }}>{t("klassenarbeit.newArt")}</div>
      <Tabs value={art} onChange={setArt}
        options={[["eine", t("klassenarbeit.newArtEine")], ["eg", t("klassenarbeit.newArtEG")]]} />
      {/* Nur die E/G-Variante braucht einen Satz: dass daraus ZWEI Arbeiten
          entstehen, sieht man dem Reiter nicht an. */}
      {art === "eg" && (
        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8, lineHeight: 1.5 }}>{t("klassenarbeit.newArtEGHint")}</div>
      )}
      <DialogFuss onSpeichern={los} onAbbrechen={onClose} aus={busy} speichern={t("klassenarbeit.new")} />
    </Modal>
  );
}
