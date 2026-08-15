// Modul Orga — Sammel-Checklisten je Klasse. Punkte (z.B. „Unterschrift KA1")
// als Spalten, Schüler als Zeilen, je Zelle ein Häkchen. Nur die Häkchen liegen
// im Modul, die Schüler im Kern.
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { undoDelete } from "../core/undo.jsx";
import { AddButton, COLORS as C, CONTROL_R, ICONS, Icon, Toggle, cardStyle, iconBtn, klebtLinks, pageApp, td, th as thBase, toolbarInput } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import { useEntwurf } from "../components/Speichern.jsx";
import SpeicherBalken from "../components/SpeicherBalken.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { useKlasseMerken, useKlassenListe } from "../core/klassenwahl.js";
import Anwesenheit from "./Anwesenheit.jsx";
import Ausleihe from "./Ausleihe.jsx";
import Sitzplan from "./Sitzplan.jsx";
import { alsJson, hol } from "../core/melden.js";

const API = "/api/orga";

export default function Orga() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [kursId, setKursId] = useState(null); // Checkliste hängt am Kurs (Fach)
  const [items, setItems] = useState([]);
  const [neu, setNeu] = useState("");
  const [params] = useSearchParams();
  // Zwei Werkzeuge unter einem Dach: Checklisten und Anwesenheit. Kalender kann
  // per ?tab=anwesenheit direkt in die Anwesenheit springen.
  const [tab, setTab] = useState(["anwesenheit", "ausleihe", "sitzplan"].includes(params.get("tab")) ? params.get("tab") : "checklisten");
  // Auf ?tab-Wechsel aus der Navbar reagieren (nicht nur beim ersten Laden).
  useEffect(() => { setTab(["anwesenheit", "ausleihe", "sitzplan", "optionen"].includes(params.get("tab")) ? params.get("tab") : "checklisten"); }, [params]);

  // Modul-Zahnrad: welche Orga-Reiter in der Navbar erscheinen. Ausgeblendete
  // stehen in localStorage; die Navbar (main.jsx) liest das und re-rendert auf
  // das 'nuvora:settings'-Event.
  const ORGA_TABS = ["checklisten", "anwesenheit", "ausleihe", "sitzplan"];
  const tabLabel = { checklisten: t("orga.tabChecklists"), anwesenheit: t("anwesenheit.title"), ausleihe: t("ausleihe.title"), sitzplan: t("sitzplan.title") };
  const [hidden, setHidden] = useState(() => { try { return JSON.parse(localStorage.getItem("orga_hidden_tabs") || "[]"); } catch { return []; } });
  const toggleTab = (key, show) => {
    const next = show ? hidden.filter((k) => k !== key) : [...new Set([...hidden, key])];
    setHidden(next);
    try { localStorage.setItem("orga_hidden_tabs", JSON.stringify(next)); } catch { /* egal */ }
    window.dispatchEvent(new Event("nuvora:settings")); // Navbar neu berechnen
  };

  // Klassenliste, Vorwahl und „zuletzt gewaehlt" — dieselben sechs Zeilen
  // standen auf fuenf Seiten; sie liegen jetzt in core/klassenwahl.js.
  useKlassenListe(setClasses, setClassId);
  useKlasseMerken(classId);

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const students = cls?.students || [];

  const kursQ = kursId != null ? `?kurs_id=${kursId}` : "";
  // Laufende Nummer je Ladevorgang: KursKlasseSelect meldet den Kurs bewusst
  // erst NACH dem Laden der Kursgruppen, der Effekt feuert also immer zweimal —
  // erst ohne Kurs, dann mit. Kommt die erste (klassenweite) Antwort als zweite
  // an, steht der falsche Stand da. Nur die juengste Antwort darf schreiben.
  const ladenr = useRef(0);
  // Frische Serverdaten beenden den Entwurf: `useEntwurf` haelt an einer offenen
  // Arbeitskopie fest und wuerde sonst die Haken der vorigen Klasse weiterzeigen.
  const frisch = useRef(false);
  const load = useCallback((id) => {
    if (!id) return;
    const meine = ++ladenr.current;
    hol(`${API}/${id}${kursId != null ? `?kurs_id=${kursId}` : ""}`).then((d) => {
      if (meine === ladenr.current) { frisch.current = true; setItems(Array.isArray(d) ? d : []); }
    });
  }, [kursId]);
  useEffect(() => { load(classId); }, [classId, kursId, load]);

  // ── Ein Entwurf für alle Häkchen der Tabelle ──
  // Eine Leiste für die ganze Maske, nicht je Zelle: flacher Plan
  // „<Punkt>:<Kind> → an/aus", damit der Vergleich mit dem Serverstand einfach
  // bleibt und ein Neuladen die Arbeitskopie wieder einholt.
  const basis = useMemo(() => {
    const o = {};
    items.forEach((it) => students.forEach((s) => { o[`${it.id}:${s.id}`] = it.done.includes(s.id); }));
    return o;
  }, [items, students]);
  const e = useEntwurf(basis, async (wert) => {
    for (const it of items) {
      for (const s of students) {
        const k = `${it.id}:${s.id}`;
        if (!!wert[k] === !!basis[k]) continue;
        await fetch(`${API}/item/${it.id}/toggle`, alsJson("PUT", { student_id: s.id })).catch(() => {});
      }
    }
    load(classId);
  });
  useEffect(() => { if (frisch.current) { frisch.current = false; e.verwerfen(); } });
  // Kurs-/Klassenwechsel mit offenen Häkchen: nachfragen statt still verwerfen.
  const wechseln = (fn) => { if (e.geaendert && !window.confirm(t("speichern.verlassen"))) return; fn(); };

  const anlegen = async () => {
    const name = neu.trim();
    if (!name || !classId) return;
    const r = await fetch(`${API}/${classId}${kursQ}`, alsJson("POST", { name })).catch(() => null);
    if (r && r.ok) { setNeu(""); load(classId); }
  };
  const loeschen = (id) => {
    const it = items.find((x) => x.id === id);
    frisch.current = true;
    setItems((prev) => prev.filter((x) => x.id !== id)); // sofort weg
    undoDelete({
      message: t("undo.deleted", { name: it?.name || "" }),
      undo: () => load(classId),
      commit: async () => { await fetch(`${API}/item/${id}`, { method: "DELETE" }).catch(() => {}); },
    });
  };
  // Das Häkchen sammelt nur — zum Server geht es mit „Speichern".
  const toggle = (item, sid) => e.setz({ [`${item.id}:${sid}`]: !e.wert[`${item.id}:${sid}`] });

  const th = { ...thBase, verticalAlign: "bottom" };

  return (
    <div style={{ ...pageApp }}>
      {/* Zwischen den Werkzeugen wird über die Navbar gewechselt (?tab=…). Der
          Reiter „Optionen" blendet Reiter ein/aus (Modul-Zahnrad als Seite). */}
      {tab === "optionen" ? (
        <div style={{ maxWidth: 560 }}>
          <p style={{ color: "var(--text2)", fontSize: 14, marginBottom: 16 }}>{t("orga.optionsIntro")}</p>
          <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 4 }}>
            {ORGA_TABS.map((k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", padding: "12px 4px", borderBottom: "1px solid var(--border)" }}>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{tabLabel[k]}</span>
                <Toggle checked={!hidden.includes(k)} onChange={(v) => toggleTab(k, v)} />
              </div>
            ))}
          </div>
        </div>
      ) : tab === "anwesenheit" ? <Anwesenheit /> : tab === "ausleihe" ? <Ausleihe /> : tab === "sitzplan" ? <Sitzplan /> : (<>
      {/* Eine Leiste statt zweier Zeilen: links die Auswahl, daneben der eine
          Handgriff (neuer Punkt). Das Feld hatte `inputStyle` Zeile fuer Zeile
          nachgebaut und stand dadurch hoeher als der Plus-Knopf daneben. */}
      <Werkzeugleiste style={{ marginBottom: 16 }}
        links={<KursKlasseSelect value={classId} onChange={(id, kid) => wechseln(() => { setClassId(id); setKursId(kid); })} onKurs={setKursId} />}>
        <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anlegen()}
          placeholder={t("orga.newPlaceholder")} style={{ ...toolbarInput, flex: 1, minWidth: 200 }} />
        <AddButton onClick={anlegen} title={t("orga.add")} />
      </Werkzeugleiste>

      {students.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("orga.noStudents")}</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("orga.noItems")}</p>
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ ...th, ...klebtLinks, textAlign: "left", minWidth: 140 }}>{cls?.name}</th>
                {items.map((it) => (
                  <th key={it.id} style={{ ...th, minWidth: 90 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                      {/* Zähler zählt den ENTWURF mit — sonst widerspräche er
                          den Häkchen, die man gerade gesetzt hat. */}
                      {(() => { const n = students.filter((s) => e.wert[`${it.id}:${s.id}`]).length; return (
                        <span style={{ fontSize: 11, fontWeight: 700, color: n === students.length ? C.success : "var(--text3)" }}>{n}/{students.length}</span>
                      ); })()}
                      <button onClick={() => loeschen(it.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={13} color={C.danger} /></button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => (
                <tr key={s.id}>
                  <td style={{ ...td, ...klebtLinks, textAlign: "left", fontWeight: 500 }}>
                    <span style={{ display: "inline-block", width: 26, textAlign: "right", color: "var(--text3)", fontWeight: 400, marginRight: 8, fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>{s.name}
                  </td>
                  {items.map((it) => {
                    const on = !!e.wert[`${it.id}:${s.id}`];
                    return (
                      <td key={it.id} style={td}>
                        <button onClick={() => toggle(it, s.id)} title={on ? t("orga.done") : t("orga.open")}
                          style={{ width: 24, height: 24, borderRadius: CONTROL_R, cursor: "pointer", fontSize: 14, fontWeight: 700,
                            border: on ? "none" : "1px solid var(--border2)", background: on ? C.success : "transparent", color: on ? C.aufAkzent : "transparent" }}>
                          ✓
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SpeicherBalken entwurf={e} />
      </>)}
    </div>
  );
}
