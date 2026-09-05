// Modul To-do — einfache Aufgabenliste. Ein Eintrag kann Datum + Uhrzeit tragen;
// datierte Einträge erscheinen zusätzlich im Kalender (Regel 3: reine Zusatz-
// Brücke, die Liste läuft eigenständig).
import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { pageTitle, cardStyle, chipStyle, sectionLabel, toolbarBtn, toolbarBtnPrimary, toolbarInput, CONTROL_R, Icon, ICONS, iconBtn, toolbarIconBtn, COLORS as C, Empty } from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { useEntwurf } from "../components/Speichern.jsx";
import SpeicherBalken from "../components/SpeicherBalken.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { alsJson, hol, sende } from "../core/melden.js";
import { useAktiv } from "../core/modules.js";
import { heuteYmd, ymd } from "../core/datum.js";
import { useZiehVorschau } from "../core/ziehsortieren.js";

const API = "/api/todo";

// Eine Höhe, eine Form für die Eingabeleiste — vorher standen Textfeld (38),
// Icon-Knöpfe (30) und Datumsfeld (~36) mit drei Radien nebeneinander. Beides
// kommt aus der gemeinsamen Quelle: `dateNavInput` war hier Zeile für Zeile
// nachgebaut, und der Rahmen steckt schon in `toolbarIconBtn`.

export default function Todo({ embedded } = {}) {
  const { t } = useLanguage();
  // Aus dem Kalender kommt man mit ?todo=<id> hierher: der Klick auf eine
  // datierte Aufgabe im Kalender soll bei DIESER Aufgabe landen, nicht nur
  // irgendwo in der Liste. Sie wird hervorgehoben und ins Bild gerollt; die
  // Markierung verschwindet nach ein paar Sekunden von selbst — sie ist ein
  // Wegweiser, kein Zustand.
  const [params] = useSearchParams();
  const zielId = Number(params.get("todo")) || null;
  const [markiert, setMarkiert] = useState(zielId);
  const zielRef = useRef(null);
  // Regel 3: die Kalender-Brücke ist Zusatz — ohne das Modul gibt es sie nicht,
  // also darf der Hinweis darauf auch nicht erscheinen.
  const aktiv = useAktiv();
  const kalenderAktiv = aktiv("kalender");
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [editId, setEditId] = useState(null);
  const [eText, setEText] = useState("");
  const [eDate, setEDate] = useState("");
  const [eTime, setETime] = useState("");
  // Laengerer Text zur Aufgabe. Die Zeile bleibt die Zeile — was mehr ist als
  // eine Zeile, steht in der Notiz und klappt bei Bedarf auf.
  const [eNotiz, setENotiz] = useState("");
  const [notizAuf, setNotizAuf] = useState(null);   // id der aufgeklappten Notiz

  // Der Datumswaehler soll aufgehen, sobald das Feld ueberhaupt erscheint —
  // `showPicker()` geht nur nach einer echten Geste, also im selben Zug wie
  // der Klick. Browser ohne die Methode zeigen einfach das Feld (Safari <16).
  const datumRef = useRef(null);
  const [datumAuf, setDatumAuf] = useState(false);
  useEffect(() => {
    if (!datumAuf) return;
    setDatumAuf(false);
    try { datumRef.current?.showPicker?.(); } catch { /* Browser ohne showPicker */ }
  }, [datumAuf]);

  // Aufklappen macht eine Zeile hoeher — steht sie unten am Rand, waechst sie
  // aus dem Bild heraus, und man tippt in ein Feld, das man nicht sieht. Die
  // Seite scrollt deshalb nach, sobald eine Zeile in die Bearbeitung geht oder
  // ihre Notiz zeigt. `block: "nearest"` schiebt nur so weit wie noetig — eine
  // Zeile, die ohnehin sichtbar ist, bleibt, wo sie ist.
  const zeilenRefs = useRef({});
  useEffect(() => {
    const id = editId ?? notizAuf;
    if (id == null) return;
    const el = zeilenRefs.current[id];
    if (!el) return;
    // Erst nach dem Zeichnen: vorher hat die Zeile noch ihre alte Hoehe.
    const timer = setTimeout(() => {
      try { el.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch { /* egal */ }
    }, 0);
    return () => clearTimeout(timer);
  }, [editId, notizAuf]);

  const naechsteStunde = () => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return `${String(d.getHours()).padStart(2, "0")}:00`; };
  const load = () => hol(API).then((d) => setItems(Array.isArray(d) ? d : []));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!markiert || !zielRef.current) return;
    try { zielRef.current.scrollIntoView({ behavior: "smooth", block: "center" }); } catch { /* egal */ }
    const timer = setTimeout(() => setMarkiert(null), 4000);
    return () => clearTimeout(timer);
  }, [markiert, items.length]);

  // ── Ein Entwurf für Haken und Reihenfolge ──
  // Nichts geht zum Server, bevor jemand speichert — auch das Häkchen nicht.
  // Der Entwurf hält nur IDs (flach, vergleichbar): welche Aufgaben erledigt
  // sind und in welcher Reihenfolge die offenen stehen. Ein Eintrag, den der
  // Entwurf noch nicht kennt (gerade angelegt), behält seinen Serverstand und
  // rutscht ans Ende — so verschluckt ein offener Entwurf keine Neuzugänge.
  const basis = useMemo(() => ({
    erledigt: items.filter((i) => i.done).map((i) => i.id),
    reihenfolge: items.filter((i) => !i.done).map((i) => i.id),
  }), [items]);
  const nachSpeichern = useRef(false);
  const e = useEntwurf(basis, async (wert) => {
    for (const it of items) {
      const soll = wert.erledigt.includes(it.id);
      if (soll !== !!it.done) await fetch(`${API}/${it.id}`, alsJson("PUT", { done: soll })).catch(() => {});
    }
    const ids = wert.reihenfolge.filter((id) => items.some((x) => x.id === id));
    if (ids.join() !== basis.reihenfolge.join())
      await fetch(`${API}/reorder`, alsJson("PUT", { ids })).catch(() => {});
    nachSpeichern.current = true;
    await load();
  });
  // Nach dem Speichern gilt der Serverstand: `useEntwurf` haelt sonst an der
  // Arbeitskopie fest (es weiss nicht, dass sie eben geschrieben wurde) und
  // meldete „nicht gespeichert" weiter.
  useEffect(() => { if (nachSpeichern.current) { nachSpeichern.current = false; e.verwerfen(); } });

  const istErledigt = (it) => (e.wert.erledigt.includes(it.id) ? true
    : e.wert.reihenfolge.includes(it.id) ? false : !!it.done);
  // Was der Entwurf noch nicht kennt, ist gerade erst entstanden — und eine
  // frisch angelegte Aufgabe gehoert nach OBEN, nicht ans Ende einer langen
  // Liste (der Server legt sie ebenfalls oben an, position = kleinste - 1).
  // Vorher landete sie unten und sah aus wie verschluckt.
  const platz = (it) => { const i = e.wert.reihenfolge.indexOf(it.id); return i < 0 ? -1 : i; };

  const add = async () => {
    const v = text.trim();
    if (!v) return;
    // Erst leeren, wenn der Server die Aufgabe hat — sonst war der getippte
    // Text weg UND die Aufgabe nicht angelegt.
    if (!(await sende(API, alsJson("POST", { text: v, due_date: date || null, due_time: date ? (time || "") : "" }), t("common.add")))) return;
    setText(""); setDate(""); setTime(""); load();
  };
  // Der Haken sammelt nur — geschrieben wird er mit „Speichern".
  const toggle = (it) => {
    const an = !istErledigt(it);
    e.setz((v) => {
      const erl = new Set(v.erledigt);
      if (an) erl.add(it.id); else erl.delete(it.id);
      return {
        // Reihenfolge der Erledigten aus der Serverliste ableiten, nicht
        // anhängen: sonst meldet ein Haken hin und wieder zurück „geändert".
        erledigt: items.filter((x) => erl.has(x.id)).map((x) => x.id),
        reihenfolge: an ? v.reihenfolge.filter((x) => x !== it.id)
          : (v.reihenfolge.includes(it.id) ? v.reihenfolge : [...v.reihenfolge, it.id]),
      };
    });
  };
  const del = async (id) => { await sende(`${API}/${id}`, { method: "DELETE" }, t("common.delete")); load(); };
  const startEdit = (it) => { setEditId(it.id); setEText(it.text); setENotiz(it.notiz || ""); setEDate(it.due_date || ""); setETime(it.due_time || ""); };
  const saveEdit = async () => {
    if (!eText.trim()) return;
    // Bei Ablehnung bleibt die Bearbeitung offen: die getippte Fassung steht
    // noch da, statt beim naechsten load() durch die alte ersetzt zu werden.
    if (!(await sende(`${API}/${editId}`, alsJson("PUT", { text: eText.trim(), notiz: eNotiz, due_date: eDate || "", due_time: eDate ? (eTime || "") : "" }), t("common.save")))) return;
    setEditId(null); load();
  };

  // Im laufenden Jahr reicht „14. Jan"; alles andere traegt die Jahreszahl —
  // sonst sieht ein Termin im naechsten Januar aus wie einer in vier Wochen.
  const fmtDate = (iso) => {
    try {
      const opt = { day: "2-digit", month: "short" };
      if (fremdesJahr(iso)) opt.year = "numeric";
      return new Date(iso + "T00:00:00").toLocaleDateString(undefined, opt);
    } catch { return iso; }
  };
  // Die Farbe des Datums-Etiketts sagt, wie dringend es ist: HEUTE und alles
  // Vergangene = rot, die naechsten sieben Tage = gelb, alles Weitere = blau.
  // Heute stand vorher auf gelb — das ist die Farbe fuer „demnaechst", und
  // genau so wurde sie gelesen: was heute faellig ist, ging unter. Sieben
  // Tage, weil eine Schulwoche der Takt ist, in dem geplant wird.
  const heuteVergleich = heuteYmd();
  const faelligFarbe = (iso) => {
    const heute = heuteVergleich;
    if (!iso) return null;
    if (iso <= heute) return C.danger;
    const grenze = new Date();
    grenze.setDate(grenze.getDate() + 7);
    return iso <= ymd(grenze) ? C.warning : null;   // null = die blaue Vorgabe
  };
  // Faellt eine Aufgabe in ein anderes Jahr, steht die Jahreszahl AM DATUM.
  // Der erste Anlauf war ein Farbpunkt je Jahr samt Legende — er beantwortete
  // die Frage nur ueber einen Umweg („welche Farbe war noch 2027?"), waehrend
  // die Zahl sie direkt beantwortet. Die Ampel (rot = vorbei, gelb = diese
  // Woche) bleibt davon unberuehrt: sie sagt, wie dringend es ist.
  const diesesJahr = String(new Date().getFullYear());
  const fremdesJahr = (iso) => !!iso && iso.slice(0, 4) !== diesesJahr;
  // Angezeigt wird der ENTWURF, nicht der Serverstand.
  const offen = items.filter((i) => !istErledigt(i)).sort((a, b) => platz(a) - platz(b));
  const erledigt = items.filter((i) => istErledigt(i));

  // Ziehen mit Live-Vorschau — dieselbe Mechanik wie bei den Fragen im Quiz
  // (Dashboard) und den Notizzetteln; sie steht seit dem Zusammenfuehren nur
  // noch in core/ziehsortieren.js. Die neue Reihenfolge geht in den Entwurf,
  // nicht zum Server.
  const zieh = useZiehVorschau(offen, (arr) => e.setz({ reihenfolge: arr.map((x) => x.id) }), editId == null);

  const Row = (it, dnd) => {
    if (editId === it.id) {
      return (
        <div key={it.id} ref={(el) => { zeilenRefs.current[it.id] = el; }}
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 12px", border: "1px solid var(--accent)", borderRadius: CONTROL_R, marginBottom: 8 }}>
          <input value={eText} onChange={(e) => setEText(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditId(null); }} style={{ ...toolbarInput, flex: 1, minWidth: 140 }} />
          <input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} style={toolbarInput} />
          {eDate && <input type="time" value={eTime} onChange={(e) => setETime(e.target.value)} style={toolbarInput} />}
          <button onClick={saveEdit} style={toolbarBtnPrimary}>{t("common.save")}</button>
          <button onClick={() => setEditId(null)} style={toolbarBtn}>{t("common.abort")}</button>
          <textarea value={eNotiz} onChange={(e) => setENotiz(e.target.value.slice(0, 5000))}
            rows={3} placeholder={t("todo.notePlaceholder")}
            style={{ ...toolbarInput, width: "100%", flexBasis: "100%", resize: "vertical", lineHeight: 1.5,
              overflowX: "hidden", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }} />
        </div>
      );
    }
    return (
      <div key={it.id} {...(dnd || {})}
        ref={(el) => { zeilenRefs.current[it.id] = el; if (markiert === it.id) zielRef.current = el; }}
        style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", marginBottom: 8, cursor: dnd ? "grab" : "default",
          ...(markiert === it.id ? { border: "1px solid var(--accent)", boxShadow: "inset 3px 0 0 var(--accent)" } : {}) }}>
        {dnd && <span className="drag-handle" title={t("todo.reorderHint")} style={{ color: "var(--text3)", flexShrink: 0, display: "inline-flex", cursor: "grab" }}><Icon d={ICONS.grip} size={15} /></span>}
        <input type="checkbox" checked={istErledigt(it)} onChange={() => toggle(it)} style={{ width: 18, height: 18, cursor: "pointer", flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, textDecoration: istErledigt(it) ? "line-through" : "none", color: istErledigt(it) ? "var(--text3)" : "var(--text)" }}>{it.text}</span>
        {it.due_date && (() => {
          // Erledigtes bleibt neutral: eine abgehakte Aufgabe ist nicht mehr
          // ueberfaellig, ein rotes Etikett daneben waere nur Laerm.
          const f = istErledigt(it) ? null : faelligFarbe(it.due_date);

          return (
            <span style={{ ...chipStyle, flexShrink: 0, whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6,
              background: f ? f + "1f" : "var(--accent-bg, rgba(10,132,255,0.12))",
              color: f || "var(--accent)" }}>
              {fmtDate(it.due_date)}{it.due_time ? ` · ${it.due_time}` : ""}
            </span>
          );
        })()}
        {/* Der Knopf erscheint NUR, wenn es eine Notiz gibt: ein leeres
            Zeichen an jeder Zeile waere Rauschen. Geschrieben wird sie beim
            Bearbeiten. */}
        {it.notiz && (
          <button onClick={() => setNotizAuf((v) => (v === it.id ? null : it.id))}
            className="icon-btn" style={{ ...iconBtn, padding: 4, color: notizAuf === it.id ? "var(--accent)" : undefined }}
            title={t("todo.noteShow")} aria-label={t("todo.noteShow")} aria-expanded={notizAuf === it.id}>
            <Icon d={ICONS.note} size={15} />
          </button>
        )}
        <button onClick={() => startEdit(it)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.edit")} aria-label={t("common.edit")}><Icon d={ICONS.edit} size={15} /></button>
        <button onClick={() => del(it.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
        {notizAuf === it.id && (
          <div style={{ flexBasis: "100%", fontSize: 13, color: "var(--text2)", lineHeight: 1.55,
            whiteSpace: "pre-wrap", overflowWrap: "anywhere", borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 2 }}>
            {it.notiz}
          </div>
        )}
      </div>
    );
  };

  return (
    // Auch eingebettet mittig: im Notizbrett sass die Liste in einer 960 px
    // breiten Seite und klebte am linken Rand — die Umgebung ist zentriert,
    // die Liste war es nicht.
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      {!embedded && <h1 style={pageTitle}>{t("todo.title")}</h1>}

      {/* Auch die Eingabezeile ist eine Werkzeugleiste — dieselbe Komponente,
          damit Abstand, Umbruch und Ausrichtung nicht je Seite neu erfunden
          werden. `flex: 20` am Textfeld, weil die Leiste rechts einen eigenen
          Dehnraum hat: sonst teilte sich das Feld den Platz mit ihm. */}
      <Werkzeugleiste style={{ marginBottom: 16 }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder={t("todo.placeholder")} style={{ ...toolbarInput, flex: 20, minWidth: 160 }} />
        {/* Datum/Uhrzeit erst per Icon dazuschalten (Default heute bzw. nächste
            volle Stunde) — kein leeres Feld, das nach nichts aussieht. */}
        {!date ? (
          // Ein Klick, zwei Schritte: das Feld traegt sofort HEUTE (der
          // haeufigste Fall) und der Waehler geht auf, falls jemand einen
          // anderen Tag meint. Vorher erschien nur ein leeres Feld, das man
          // noch einmal antippen musste.
          <button onClick={() => { setDate(heuteYmd()); setDatumAuf(true); }} className="icon-btn" title={t("todo.addDate")} aria-label={t("todo.addDate")} style={toolbarIconBtn}>
            <Icon d={ICONS.calendar} size={18} color="var(--text2)" />
          </button>
        ) : (<>
          <input type="date" ref={datumRef} value={date} onChange={(e) => setDate(e.target.value)} title={t("todo.dateHint")} style={toolbarInput} />
          {!time ? (
            <button onClick={() => setTime(naechsteStunde())} className="icon-btn" title={t("todo.addTime")} aria-label={t("todo.addTime")} style={toolbarIconBtn}>
              <Icon d={ICONS.clock} size={18} color="var(--text2)" />
            </button>
          ) : (
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} title={t("todo.timeHint")} style={toolbarInput} />
          )}
          <button onClick={() => { setDate(""); setTime(""); }} className="icon-btn" title={t("common.remove") || t("common.delete")} aria-label={t("common.remove") || t("common.delete")} style={toolbarIconBtn}>
            <Icon d={ICONS.close} size={15} color="var(--text3)" />
          </button>
        </>)}
        <button onClick={add} disabled={!text.trim()} style={{ ...toolbarBtnPrimary, opacity: text.trim() ? 1 : 0.5 }}>{t("common.add")}</button>
      </Werkzeugleiste>
      {kalenderAktiv && <p style={{ fontSize: 13, color: "var(--text3)", marginTop: -8, marginBottom: 16 }}>{t("todo.calHint")}</p>}

      {/* Legende — nur wenn wirklich mehrere Jahre in der Liste stehen. Sie
          sagt, wofuer der Punkt am Datum steht; ohne sie waeren es bunte
          Punkte ohne Bedeutung. */}
      {items.length === 0 ? (
        <Empty title={t("todo.empty")} hint={t("todo.emptyHint")} />
      ) : (
        <>
          {zieh.sichtbar.map((it, idx) => Row(it, zieh.props(idx)))}
          {erledigt.length > 0 && (
            <>
              <div style={{ ...sectionLabel, margin: "16px 0 8px" }}>{t("todo.done")} ({erledigt.length})</div>
              {erledigt.map((it) => Row(it, null))}
            </>
          )}
        </>
      )}
      <SpeicherBalken entwurf={e} />
    </div>
  );
}
