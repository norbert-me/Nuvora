// Modul Reihen — Unterrichtsreihen als Vorlage, Jahr für Jahr wieder einsetzbar.
//
// Eine Reihe ist eine Folge von Stunden: Titel, Thema, Ablauf, Notizen, Verweise
// auf Quiz/Karten/Lernleiter/Einstieg, Dateien — und Notizen fürs nächste Mal
// (je Stunde und für die ganze Reihe). Gepflegt wird sie wie alles andere mit
// EINEM Entwurf und einer Speicherleiste; Dateien laden sofort hoch (wie überall
// in Nuvora). Mit dem Kalender zwei Wege: gehaltene Stunden eines Kurses als
// Reihe speichern, und eine Reihe der Reihe nach auf die Unterrichtsstunden eines
// Kurses legen — beides nur, wenn das Modul Kalender läuft (Regel 3).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AddButton, COLORS as C, CONTROL_R, Icon, ICONS, Modal, badge, btnPrimary, btnSecondary, btnSmall, cardStyle, iconBtn,
  inputStyle, pageApp, panelStyle, sectionLabel, selectStyle,
} from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import AutoTextarea from "../components/AutoTextarea.jsx";
import SuchSelect from "../components/SuchSelect.jsx";
import ThemenWahl from "../components/ThemenWahl.jsx";
import MaterialPanel from "../components/MaterialPanel.jsx";
import SpeicherBalken from "../components/SpeicherBalken.jsx";
import { DialogFuss, useEntwurf } from "../components/Speichern.jsx";
import { alsJson, hol } from "../core/melden.js";
import { askConfirm } from "../core/dialog.jsx";
import { themenIndex, useThemen } from "../core/topics.js";
import { useAktiv } from "../core/modules.js";
import InKurs from "../components/ReiheEinfuegen.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/reihen";
const FAECHER = ["Mathematik", "Deutsch", "Englisch", "Informatik", "Geschichte", "Geografie", "Biologie", "Physik", "Chemie", "Politik", "Religion", "Kunst", "Musik", "Sport"];

const ymd = (d) => d.toISOString().slice(0, 10);

export default function Reihen() {
  const [params] = useSearchParams();
  const id = Number(params.get("reihe"));
  return <div style={pageApp}>{id > 0 ? <Editor key={id} id={id} /> : <Liste />}</div>;
}

// ─── Liste ───────────────────────────────────────────────────────────────

function Liste() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const aktiv = useAktiv();
  const [liste, setListe] = useState(null);
  const [aus, setAus] = useState(false);
  const laden = () => hol(API, []).then((d) => setListe(Array.isArray(d) ? d : []));
  useEffect(() => { laden(); }, []);

  const neu = async () => {
    const r = await fetch(API, alsJson("POST", { name: t("reihen.neuName") })).catch(() => null);
    if (r && r.ok) { const d = await r.json(); navigate(`/reihen?reihe=${d.id}`); }
  };
  const kopieren = async (r) => {
    const res = await fetch(`${API}/${r.id}/kopie`, { method: "POST" }).catch(() => null);
    if (res && res.ok) laden();
  };
  const loeschen = async (r) => {
    if (!await askConfirm(t("reihen.loeschenFrage", { name: r.name }), { danger: true, ok: t("common.delete") })) return;
    await fetch(`${API}/${r.id}`, { method: "DELETE" }).catch(() => {});
    laden();
  };

  // Einordnen: erst nach Fach, darin nach Stufe, darin nach Name der Reihe. Ohne Fach/Stufe ans Ende.
  const gruppen = useMemo(() => {
    const vgl = (a, b) => (a && !b ? -1 : !a && b ? 1 : String(a).localeCompare(String(b), undefined, { numeric: true }));
    const nachFach = new Map();
    for (const r of liste || []) {
      const f = (r.fach || "").trim(), j = (r.jahrgang || "").trim();
      if (!nachFach.has(f)) nachFach.set(f, new Map());
      const m = nachFach.get(f);
      if (!m.has(j)) m.set(j, []);
      m.get(j).push(r);
    }
    return [...nachFach.keys()].sort(vgl).map((f) => ({
      fach: f,
      stufen: [...nachFach.get(f).keys()].sort(vgl).map((j) => ({
        stufe: j, reihen: nachFach.get(f).get(j).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      })),
    }));
  }, [liste]);

  return (
    <div>
      <Werkzeugleiste
        mehr={aktiv("kalender") ? [{ key: "aus", label: t("reihen.ausKalender"), icon: ICONS.calendar || ICONS.plus, onClick: () => setAus(true) }] : []}>
        <AddButton onClick={neu} title={t("reihen.neu")} />
      </Werkzeugleiste>

      {liste === null && <p style={{ color: "var(--text3)" }}>{t("common.loading")}</p>}
      {liste && liste.length === 0 && (
        <div style={{ ...panelStyle, padding: 24, textAlign: "center" }}>
          <p style={{ margin: "0 0 12px", fontSize: 14 }}>{t("reihen.leer")}</p>
          <button onClick={neu} style={btnPrimary}>{t("reihen.neu")}</button>
        </div>
      )}
      {gruppen.map((fg) => (
        <div key={fg.fach} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, margin: "8px 0" }}>{fg.fach || t("reihen.ohneFach")}</div>
          {fg.stufen.map((sg) => (
            <div key={sg.stufe} style={{ marginBottom: 8 }}>
              <div style={{ ...sectionLabel, margin: "4px 0 6px" }}>{sg.stufe ? t("reihen.stufeN", { n: sg.stufe }) : t("reihen.ohneStufe")}</div>
              {sg.reihen.map((r) => (
        <div key={r.id} style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <Link to={`/reihen?reihe=${r.id}`} style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "var(--text)" }}>
            <div style={{ fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--text3)" }}>{t("reihen.zahlen", { n: r.stunden_anzahl, m: r.unterrichtsstunden })}</span>
              {r.quelle && <span style={{ fontSize: 12, color: "var(--text3)" }}>· {t("reihen.ausKurs", { name: r.quelle })}</span>}
              {r.naechstes_mal && <span style={badge(C.warning)} title={r.naechstes_mal}>{t("reihen.notizDa")}</span>}
            </div>
          </Link>
          <button onClick={() => kopieren(r)} className="icon-btn" style={iconBtn} title={t("reihen.kopie")} aria-label={t("reihen.kopie")}><Icon d={ICONS.duplicate} size={18} /></button>
          <button onClick={() => loeschen(r)} className="icon-btn" style={iconBtn} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={18} color={C.danger} /></button>
        </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {aus && <AusKalender onClose={() => setAus(false)} onFertig={(id) => navigate(`/reihen?reihe=${id}`)} />}
    </div>
  );
}

// Vorhandene Stunden eines Kurses als Reihe uebernehmen: Kurs waehlen, die Stunden stehen mit
// Haken da (alle angehakt), abwaehlen was nicht dazugehoert, uebernehmen. Mit `reiheId` werden
// sie an diese Reihe gehaengt, sonst entsteht eine neue.
function AusKalender({ onClose, onFertig, reiheId = null }) {
  const { t } = useLanguage();
  const [kurse, setKurse] = useState([]);
  const [kursId, setKursId] = useState("");
  const [name, setName] = useState("");
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const [liste, setListe] = useState(null);
  const [gewaehlt, setGewaehlt] = useState([]);
  const [fehler, setFehler] = useState("");
  useEffect(() => { hol("/api/kurse").then((d) => setKurse(Array.isArray(d) ? d : [])); }, []);
  useEffect(() => {
    setListe(null);
    if (!kursId) return;
    let weg = false;
    hol(`${API}/kalender-stunden?kurs_id=${kursId}${von ? `&von=${von}` : ""}${bis ? `&bis=${bis}` : ""}`, null)
      .then((d) => { if (weg) return; const l = Array.isArray(d) ? d : []; setListe(l); setGewaehlt(l.map((x) => x.id)); });
    return () => { weg = true; };
  }, [kursId, von, bis]);
  const tag = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "2-digit" });
  const umschalten = (id) => setGewaehlt((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  const speichern = async () => {
    setFehler("");
    const rumpf = { kurs_id: Number(kursId), name, von: von || null, bis: bis || null, eintrag_ids: gewaehlt };
    const res = await fetch(reiheId ? `${API}/${reiheId}/aus-kalender` : `${API}/aus-kalender`, alsJson("POST", rumpf)).catch(() => null);
    if (res && res.ok) { const d = await res.json(); onFertig(d.id); return; }
    const b = res ? await res.json().catch(() => ({})) : {};
    setFehler(typeof b.detail === "string" ? b.detail : t("common.notWork"));
  };
  return (
    <Modal onClose={onClose} width={480} title={reiheId ? t("reihen.stundenAnhaengen") : t("reihen.ausKalender")}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <select value={kursId} onChange={(e) => setKursId(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
          <option value="">{t("reihen.kursWaehlen")}</option>
          {kurse.map((k) => <option key={k.id} value={k.id}>{k.fach ? `${k.fach} · ` : ""}{k.name}</option>)}
        </select>
        {!reiheId && <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("reihen.nameOptional")} style={{ ...inputStyle, width: "100%" }} />}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--text2)" }}>{t("reihen.zeitraum")}</span>
          <input type="date" value={von} onChange={(e) => setVon(e.target.value)} style={inputStyle} />
          <span>–</span>
          <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} style={inputStyle} />
        </div>
        {liste && liste.length > 0 && (
          <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: 8, fontSize: 13 }}>
            {liste.map((x) => (
              <label key={x.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={gewaehlt.includes(x.id)} onChange={() => umschalten(x.id)} />
                <span style={{ color: "var(--text3)", whiteSpace: "nowrap" }}>{tag(x.date)} {x.period}.</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.title || t("reihen.stundeOhneTitel")}</span>
              </label>
            ))}
          </div>
        )}
        {liste && liste.length === 0 && <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("reihen.keineStunden")}</p>}
        {fehler && <div style={{ color: C.danger, fontSize: 13 }}>{fehler}</div>}
      </div>
      <DialogFuss onAbbrechen={onClose} onSpeichern={speichern} aus={!kursId || gewaehlt.length === 0}
        speichern={reiheId ? t("reihen.anhaengen") : t("reihen.speichernAls")} />
    </Modal>
  );
}

// ─── Editor ──────────────────────────────────────────────────────────────

const leereStunde = (id) => ({
  id, titel: "", dauer: 1, topic_id: null, topic_ids: [], notizen: "", naechstes_mal: "", verlaufsplan: [],
  cardvote_set_id: null, karten_deck_ids: [], lernpfad_ladder_id: null, method_id: null, dateien: 0,
});

const alsBasis = (d) => ({
  name: d.name || "", fach: d.fach || "", jahrgang: d.jahrgang || "", beschreibung: d.beschreibung || "",
  naechstes_mal: d.naechstes_mal || "", topic_id: d.topic_id ?? null,
  stunden: (d.stunden || []).map((s) => ({ ...leereStunde(s.id), ...s, topic_ids: s.topic_ids || [], karten_deck_ids: s.karten_deck_ids || [], verlaufsplan: s.verlaufsplan || [] })),
});

function Editor({ id }) {
  const { t } = useLanguage();
  const aktiv = useAktiv();
  const [detail, setDetail] = useState(null);
  const [fehler, setFehler] = useState("");
  const [spielen, setSpielen] = useState(false);
  const [anhaengen, setAnhaengen] = useState(false);
  const topics = useThemen();
  const themen = useMemo(() => themenIndex(topics), [topics]);
  const neueId = useRef(-1);

  const laden = () => hol(`${API}/${id}`, null).then((d) => { if (d) setDetail(d); else setFehler(t("reihen.nichtDa")); });
  useEffect(() => { laden(); }, [id]);
  const basis = useMemo(() => (detail ? alsBasis(detail) : { name: "", fach: "", jahrgang: "", beschreibung: "", naechstes_mal: "", topic_id: null, stunden: [] }), [detail]);

  const e = useEntwurf(basis, async (w) => {
    const r = await fetch(`${API}/${id}`, alsJson("PUT", {
      name: w.name, fach: w.fach, jahrgang: w.jahrgang, beschreibung: w.beschreibung,
      naechstes_mal: w.naechstes_mal, topic_id: w.topic_id,
    })).catch(() => null);
    if (!r || !r.ok) return false;
    const alt = new Map(basis.stunden.map((s) => [s.id, s]));
    const reihenfolge = [];
    for (const s of w.stunden) {
      const koerper = {
        titel: s.titel, dauer: s.dauer, topic_id: s.topic_id, topic_ids: s.topic_ids, notizen: s.notizen,
        naechstes_mal: s.naechstes_mal, verlaufsplan: s.verlaufsplan, cardvote_set_id: s.cardvote_set_id,
        karten_deck_ids: s.karten_deck_ids, lernpfad_ladder_id: s.lernpfad_ladder_id, method_id: s.method_id,
      };
      if (s.id > 0) {
        if (JSON.stringify(alt.get(s.id) && { ...alt.get(s.id), dateien: 0 }) !== JSON.stringify({ ...s, dateien: 0 })) {
          const x = await fetch(`${API}/stunden/${s.id}`, alsJson("PUT", koerper)).catch(() => null);
          if (!x || !x.ok) return false;
        }
        reihenfolge.push(s.id);
      } else {
        const x = await fetch(`${API}/${id}/stunden`, alsJson("POST", koerper)).catch(() => null);
        if (!x || !x.ok) return false;
        reihenfolge.push((await x.json()).id);
      }
    }
    for (const s of basis.stunden) {
      if (!w.stunden.some((x) => x.id === s.id)) await fetch(`${API}/stunden/${s.id}`, { method: "DELETE" }).catch(() => {});
    }
    await fetch(`${API}/${id}/reihenfolge`, alsJson("PUT", { ids: reihenfolge })).catch(() => {});
    await laden();
    return true;
  });
  const w = e.wert;
  const setStunde = (sid, teil) => e.setz({ stunden: w.stunden.map((s) => (s.id === sid ? { ...s, ...teil } : s)) });
  const neueStunde = () => e.setz({ stunden: [...w.stunden, leereStunde(neueId.current--)] });
  const weg = (sid) => e.setz({ stunden: w.stunden.filter((s) => s.id !== sid) });
  const schieben = (sid, d) => {
    const i = w.stunden.findIndex((s) => s.id === sid);
    const j = i + d;
    if (i < 0 || j < 0 || j >= w.stunden.length) return;
    const neu = [...w.stunden];
    [neu[i], neu[j]] = [neu[j], neu[i]];
    e.setz({ stunden: neu });
  };

  // Verweise: nur laden, was das jeweilige Modul hergibt (Regel 3).
  const [quizze, setQuizze] = useState([]);
  const [decks, setDecks] = useState([]);
  const [ladders, setLadders] = useState([]);
  const [methoden, setMethoden] = useState([]);
  useEffect(() => {
    if (aktiv("cardvote")) hol("/api/folders").then((tree) => {
      const flat = [];
      const walk = (f) => { (f.question_sets || []).forEach((q) => flat.push({ id: q.id, name: q.name, folder: f.name })); (f.children || []).forEach(walk); };
      (Array.isArray(tree) ? tree : []).forEach(walk);
      setQuizze(flat);
    });
    if (aktiv("karten")) hol("/api/karten/decks").then((d) => setDecks(Array.isArray(d) ? d : []));
    if (aktiv("lernpfad")) hol("/api/lernpfad/paths").then((paths) => {
      const flat = [];
      (Array.isArray(paths) ? paths : []).forEach((p) => (p.ladders || []).forEach((l) => flat.push({ id: l.id, topic_id: l.topic_id, path: p.name })));
      setLadders(flat);
    });
    if (aktiv("unterrichtsplanung")) hol("/api/methoden/list").then((d) => setMethoden(Array.isArray(d) ? d : []));
  }, [aktiv]);

  if (fehler) return <p style={{ color: C.danger }}>{fehler} <Link to="/reihen">{t("reihen.zurueck")}</Link></p>;
  if (!detail) return <p style={{ color: "var(--text3)" }}>{t("common.loading")}</p>;

  const feld = { ...inputStyle, width: "100%" };
  const lbl = { ...sectionLabel, margin: "12px 0 4px" };
  return (
    <div>
      <Werkzeugleiste
        links={<Link to="/reihen" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 14 }}>← {t("reihen.title")}</Link>}
        mehr={aktiv("kalender") ? [
          { key: "spielen", label: t("reihen.inKurs"), icon: ICONS.calendar || ICONS.plus, onClick: () => setSpielen(true), disabled: e.geaendert, title: e.geaendert ? t("reihen.erstSpeichern") : undefined },
          { key: "anhaengen", label: t("reihen.stundenAnhaengen"), icon: ICONS.import || ICONS.plus, onClick: () => setAnhaengen(true), disabled: e.geaendert, title: e.geaendert ? t("reihen.erstSpeichern") : undefined },
        ] : []}>
      </Werkzeugleiste>

      <div style={{ ...panelStyle, padding: 16, marginBottom: 16 }}>
        <input value={w.name} onChange={(ev) => e.setz({ name: ev.target.value })} maxLength={200} placeholder={t("reihen.name")}
          style={{ ...feld, fontSize: 22, fontWeight: 700 }} />
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input list="reihen-faecher" value={w.fach} onChange={(ev) => e.setz({ fach: ev.target.value })} maxLength={60} placeholder={t("reihen.fach")} style={{ ...inputStyle, flex: "1 1 160px" }} />
          <datalist id="reihen-faecher">{FAECHER.map((f) => <option key={f} value={f} />)}</datalist>
          <input value={w.jahrgang} onChange={(ev) => e.setz({ jahrgang: ev.target.value })} maxLength={20} placeholder={t("reihen.jahrgang")} style={{ ...inputStyle, flex: "0 1 120px" }} />
        </div>
        <div style={lbl}>{t("reihen.beschreibung")}</div>
        <AutoTextarea value={w.beschreibung} onChange={(ev) => e.setz({ beschreibung: ev.target.value })} rows={2} style={feld} />
        <div style={{ ...lbl, color: C.warning }}>{t("reihen.naechstesMal")}</div>
        <AutoTextarea value={w.naechstes_mal} onChange={(ev) => e.setz({ naechstes_mal: ev.target.value })} rows={2}
          placeholder={t("reihen.naechstesMalHint")} style={{ ...feld, borderColor: w.naechstes_mal ? C.warning : undefined }} />
      </div>

      {w.stunden.map((s, i) => (
        <StundeKarte key={s.id} s={s} i={i} n={w.stunden.length} t={t}
          set={(teil) => setStunde(s.id, teil)} weg={() => weg(s.id)} schieben={(d) => schieben(s.id, d)}
          themen={themen} topics={topics} quizze={quizze} decks={decks} ladders={ladders} methoden={methoden} />
      ))}
      <button onClick={neueStunde} style={{ ...btnSecondary, width: "100%", marginBottom: 80 }}>+ {t("reihen.stundeNeu")}</button>

      <SpeicherBalken entwurf={e} />
      {spielen && <InKurs reihe={detail} onClose={() => setSpielen(false)} />}
      {anhaengen && <AusKalender reiheId={id} onClose={() => setAnhaengen(false)} onFertig={() => { setAnhaengen(false); laden(); }} />}
    </div>
  );
}

function StundeKarte({ s, i, n, t, set, weg, schieben, themen, topics, quizze, decks, ladders, methoden }) {
  const [offen, setOffen] = useState(!s.titel && s.id < 0);
  const feld = { ...inputStyle, width: "100%" };
  const lbl = { ...sectionLabel, margin: "12px 0 4px" };
  const plan = s.verlaufsplan || [];
  const setPhase = (k, teil) => set({ verlaufsplan: plan.map((p, j) => (j === k ? { ...p, ...teil } : p)) });
  return (
    <div style={{ ...cardStyle, marginBottom: 8, padding: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
        <span style={{ color: "var(--text3)", width: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{i + 1}.</span>
        <button onClick={() => setOffen(!offen)} style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "none", cursor: "pointer", color: "var(--text)", fontSize: 14, fontWeight: 600, padding: "6px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {s.titel || t("reihen.stundeOhneTitel")}
          {s.dauer > 1 && <span style={{ ...badge(C.info), marginLeft: 8 }}>{t("reihen.doppel", { n: s.dauer })}</span>}
          {s.naechstes_mal && <span style={{ ...badge(C.warning), marginLeft: 8 }}>{t("reihen.notizDa")}</span>}
          {s.dateien > 0 && <span style={{ ...badge(C.success), marginLeft: 8 }}>{s.dateien} 📎</span>}
        </button>
        <button onClick={() => schieben(-1)} disabled={i === 0} className="icon-btn" style={iconBtn} title={t("reihen.hoch")} aria-label={t("reihen.hoch")}>↑</button>
        <button onClick={() => schieben(1)} disabled={i === n - 1} className="icon-btn" style={iconBtn} title={t("reihen.runter")} aria-label={t("reihen.runter")}>↓</button>
        <button onClick={weg} className="icon-btn" style={iconBtn} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={17} color={C.danger} /></button>
      </div>
      {offen && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <input value={s.titel} onChange={(ev) => set({ titel: ev.target.value })} maxLength={200} placeholder={t("reihen.stundeTitel")} style={{ ...inputStyle, flex: "1 1 240px" }} />
            <select value={s.dauer} onChange={(ev) => set({ dauer: Number(ev.target.value) })} style={{ ...selectStyle, flex: "0 0 auto" }} title={t("reihen.dauerHint")}>
              {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{t("reihen.dauer", { n: d })}</option>)}
            </select>
          </div>

          <div style={lbl}>{t("reihen.thema")}</div>
          <SuchSelect value={s.topic_id || ""} onChange={(v) => set({ topic_id: v ? Number(v) : null })} style={{ width: "100%" }}
            leerLabel={`– ${t("kalender.noTopic")} –`}
            optionen={themen.liste.map((tp) => ({ wert: tp.id, label: themen.auswahlLabel(tp) }))} />
          {s.topic_id && (
            <>
              <div style={lbl}>{t("kalender.moreTopics")}</div>
              <ThemenWahl topics={topics} value={s.topic_ids || []} onChange={(v) => set({ topic_ids: v.filter((x) => x !== s.topic_id) })} />
            </>
          )}

          <div style={lbl}>{t("reihen.notizen")}</div>
          <AutoTextarea value={s.notizen} onChange={(ev) => set({ notizen: ev.target.value })} rows={3} style={feld} />

          <div style={lbl}>{t("reihen.ablauf")}</div>
          {plan.map((p, k) => (
            <div key={k} style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              <input value={p.phase} onChange={(ev) => setPhase(k, { phase: ev.target.value })} placeholder={t("reihen.phase")} style={{ ...inputStyle, flex: "1 1 120px" }} />
              <input value={p.dauer} onChange={(ev) => setPhase(k, { dauer: ev.target.value })} placeholder={t("reihen.min")} style={{ ...inputStyle, flex: "0 1 70px" }} />
              <input value={p.text} onChange={(ev) => setPhase(k, { text: ev.target.value })} placeholder={t("reihen.phaseText")} style={{ ...inputStyle, flex: "3 1 220px" }} />
              <button onClick={() => set({ verlaufsplan: plan.filter((_, j) => j !== k) })} className="icon-btn" style={iconBtn} aria-label={t("common.delete")}><Icon d={ICONS.close} size={14} /></button>
            </div>
          ))}
          <button onClick={() => set({ verlaufsplan: [...plan, { phase: "", dauer: "", text: "" }] })} style={{ ...btnSecondary, ...btnSmall }}>+ {t("reihen.phaseNeu")}</button>

          {(methoden.length > 0 || quizze.length > 0 || decks.length > 0 || ladders.length > 0) && <div style={lbl}>{t("reihen.verweise")}</div>}
          {methoden.length > 0 && (
            <SuchSelect value={s.method_id || ""} onChange={(v) => set({ method_id: v ? Number(v) : null })} style={{ width: "100%", marginBottom: 6 }}
              leerLabel={`– ${t("reihen.einstieg")} –`} optionen={methoden.map((m) => ({ wert: m.id, label: m.title }))} />
          )}
          {quizze.length > 0 && (
            <SuchSelect value={s.cardvote_set_id || ""} onChange={(v) => set({ cardvote_set_id: v ? Number(v) : null })} style={{ width: "100%", marginBottom: 6 }}
              leerLabel={`– ${t("reihen.quiz")} –`} optionen={quizze.map((q) => ({ wert: q.id, label: q.folder ? `${q.folder} / ${q.name}` : q.name }))} />
          )}
          {ladders.length > 0 && (
            <SuchSelect value={s.lernpfad_ladder_id || ""} onChange={(v) => set({ lernpfad_ladder_id: v ? Number(v) : null })} style={{ width: "100%", marginBottom: 6 }}
              leerLabel={`– ${t("reihen.lernleiter")} –`} optionen={ladders.map((l) => ({ wert: l.id, label: `${l.path}${l.topic_id && themen.byId.get(l.topic_id) ? ` · ${themen.label(themen.byId.get(l.topic_id))}` : ""}` }))} />
          )}
          {decks.length > 0 && (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                {(s.karten_deck_ids || []).map((did) => {
                  const d = decks.find((x) => x.id === did);
                  return d ? (
                    <span key={did} style={{ ...badge(C.info), display: "inline-flex", alignItems: "center" }}>{d.name}
                      <button onClick={() => set({ karten_deck_ids: s.karten_deck_ids.filter((x) => x !== did) })} aria-label={t("common.delete")}
                        style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", padding: "0 0 0 6px" }}>×</button></span>
                  ) : null;
                })}
              </div>
              <SuchSelect value="" onChange={(v) => { const x = Number(v); if (x && !(s.karten_deck_ids || []).includes(x)) set({ karten_deck_ids: [...(s.karten_deck_ids || []), x] }); }}
                style={{ width: "100%" }} leerLabel={`+ ${t("reihen.stapel")}`}
                optionen={decks.filter((d) => !(s.karten_deck_ids || []).includes(d.id)).map((d) => ({ wert: d.id, label: d.name }))} />
            </>
          )}

          <div style={lbl}>{t("reihen.dateien")}</div>
          {s.id > 0
            ? <MaterialPanel reiheStundeId={s.id} />
            : <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("reihen.dateienErstSpeichern")}</p>}

          <div style={{ ...lbl, color: C.warning }}>{t("reihen.naechstesMal")}</div>
          <AutoTextarea value={s.naechstes_mal} onChange={(ev) => set({ naechstes_mal: ev.target.value })} rows={2}
            placeholder={t("reihen.naechstesMalStunde")} style={{ ...feld, borderColor: s.naechstes_mal ? C.warning : undefined }} />
        </div>
      )}
    </div>
  );
}
