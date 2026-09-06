import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import {
  pageApp, cardStyle, panelStyle, btnPrimary, btnSecondary, btnSmall,
  toolbarBtn, toolbarInput, inputStyle, Icon, ICONS, COLORS as C, CONTROL_R, badge, sectionLabel,
} from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import PapEditor, { leeresDiagramm } from "../components/PapEditor.jsx";
import { useLanguage } from "../i18n";
import { alsJson } from "../core/melden";
import { askConfirm } from "../core/dialog.jsx";
import { oeffentlicheBasis } from "../core/basis.js";

const API = "/api/pap";

// Modul PAP. Zwei Reiter, und sie sind die zwei Wege aus der Modulbeschreibung:
//
//   „Zeichnen" — der Editor pur, ohne Konto-Bezug. Was hier entsteht, liegt im
//   Browser (localStorage); es ist der Weg für den Beamer und fürs schnelle
//   Vormachen. Ein Server-Speicher wäre eine dritte Ablage neben Aufgabe und
//   Abgabe, ohne dass jemand danach gefragt hätte.
//
//   „Aufgaben" — der überwachte Weg: anlegen, austeilen (über den QR-Zugang,
//   den es im Kern schon gibt), Abgaben ansehen.
const ENTWURF_KEY = "nuvora_pap_entwurf";

export default function Pap() {
  // Die Reiter stehen in der Navbar (?tab=zeichnen|aufgaben) — wie bei jedem
  // anderen Modul. Als eigene Tab-Leiste auf der Seite standen sie unter einer
  // Navigation, die dieselbe Aufgabe hat, und die Seite begann mit zwei Zeilen
  // Bedienelementen, bevor irgendetwas zu sehen war.
  const [params] = useSearchParams();
  const tab = params.get("tab") === "aufgaben" ? "aufgaben" : "zeichnen";
  return (
    <div style={pageApp}>
      {tab === "zeichnen" ? <FreiesBlatt /> : <Aufgaben />}
    </div>
  );
}

// ── Reiter „Zeichnen" ──
function FreiesBlatt() {
  const { t } = useLanguage();
  const [d, setD] = useState(() => {
    try { return JSON.parse(localStorage.getItem(ENTWURF_KEY)) || leeresDiagramm(); } catch { return leeresDiagramm(); }
  });
  const [drucken, setDrucken] = useState(false);
  const setzen = (next) => {
    setD(next);
    try { localStorage.setItem(ENTWURF_KEY, JSON.stringify(next)); } catch { /* voll oder gesperrt */ }
  };
  return (
    <div style={{ ...cardStyle, padding: 16 }}>
      <Werkzeugleiste modul="pap" style={{ marginBottom: 12 }}>
        <button onClick={() => setDrucken(true)} style={toolbarBtn}>{t("pap.drucken")}</button>
        {/* „Neues Blatt" hiess es zuerst — und beschrieb, was danach da ist,
            statt dessen, was passiert: das Gezeichnete ist weg. */}
        <button onClick={async () => { if (await askConfirm(t("pap.leerenFrage"))) setzen(leeresDiagramm()); }}
          style={{ ...toolbarBtn, color: C.danger }}>{t("pap.leeren")}</button>
      </Werkzeugleiste>
      <PapEditor wert={d} onChange={setzen} />
      {drucken && <Druck diagramm={d} titel={t("pap.titel")} onFertig={() => setDrucken(false)} />}
      <Austeilen />
    </div>
  );
}

// Die zwei Wege ins Kinderhandy — beide an EINER Stelle, weil sie sich nur
// dort unterscheiden, wo man sie vergleicht: der freie Link geht an alle und
// ordnet nichts zu, der überwachte Weg läuft über den QR-Zugang, den es im
// Kern längst gibt.
function Austeilen() {
  const { t } = useLanguage();
  const [basis, setBasis] = useState(window.location.origin);
  const [kopiert, setKopiert] = useState(false);
  useEffect(() => { oeffentlicheBasis().then(setBasis); }, []);
  const link = `${basis}/pap-frei`;
  return (
    <div style={{ ...panelStyle, padding: 12, marginTop: 16 }}>
      <div style={{ ...sectionLabel, margin: "0 0 8px" }}>{t("pap.austeilen")}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--text2)" }}>{t("pap.linkFrei")}</span>
        <code style={{ fontSize: 12, background: "var(--bg)", padding: "4px 8px", borderRadius: CONTROL_R, overflowWrap: "anywhere" }}>{link}</code>
        <button onClick={() => { navigator.clipboard?.writeText(link); setKopiert(true); setTimeout(() => setKopiert(false), 2000); }}
          style={{ ...btnSecondary, ...btnSmall }}>{kopiert ? t("pap.linkKopiert") : t("pap.kopieren")}</button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text3)", margin: "10px 0 0" }}>{t("pap.linkUeberwacht")}</p>
    </div>
  );
}

// Drucken über dieselben zwei Klassen wie der Rückmeldebogen: die Seite hängt
// am <body> statt in der Anwendung, das Druck-CSS blendet #root aus. Kein
// zweites Fenster — das blockt jeder zweite Browser weg.
function Druck({ diagramm, titel, onFertig }) {
  useEffect(() => {
    const timer = setTimeout(() => { window.print(); onFertig(); }, 60);
    return () => clearTimeout(timer);
  }, [onFertig]);
  return createPortal(
    <div className="druck-huelle">
      <div className="druck-seite" style={{ padding: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>{titel}</h2>
        <PapEditor wert={diagramm} lesen hoehe={300} />
      </div>
    </div>,
    document.body,
  );
}

// ── Reiter „Aufgaben" ──
function Aufgaben() {
  const { t } = useLanguage();
  const [liste, setListe] = useState([]);
  const [wahl, setWahl] = useState({ classId: null, kursId: null });
  const [titel, setTitel] = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [offen, setOffen] = useState(null);   // Aufgabe, deren Abgaben offen sind

  const laden = () => fetch(`${API}/aufgaben`).then((r) => (r.ok ? r.json() : [])).then(setListe).catch(() => {});
  useEffect(() => { laden(); }, []);

  const anlegen = async () => {
    if (!titel.trim() || !(wahl.classId || wahl.kursId)) return;
    const r = await fetch(`${API}/aufgaben`, alsJson("POST", {
      title: titel.trim(), beschreibung, class_id: wahl.classId, kurs_id: wahl.kursId,
    })).catch(() => null);
    if (r && r.ok) { setTitel(""); setBeschreibung(""); laden(); }
  };

  const loeschen = async (id) => {
    await fetch(`${API}/aufgaben/${id}`, { method: "DELETE" }).catch(() => {});
    if (offen && offen.id === id) setOffen(null);
    laden();
  };

  return (
    <>
      <div style={{ ...cardStyle, padding: 16, marginBottom: 16 }}>
        <Werkzeugleiste>
          <KursKlasseSelect value={wahl.classId} kursValue={wahl.kursId}
            onChange={(classId, kursId) => setWahl({ classId, kursId })} />
          <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder={t("pap.aufgabeTitel")}
            style={{ ...toolbarInput, flex: 1, minWidth: 160 }} />
          <button onClick={anlegen} style={btnPrimary}>{t("common.add")}</button>
        </Werkzeugleiste>
        <textarea value={beschreibung} onChange={(e) => setBeschreibung(e.target.value.slice(0, 4000))}
          rows={2} placeholder={t("pap.aufgabeText")}
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginTop: 8, resize: "vertical" }} />
      </div>

      {liste.length === 0 && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("pap.keineAufgaben")}</p>}

      {liste.map((a) => (
        <div key={a.id} style={{ ...cardStyle, padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, flex: 1 }}>{a.title}</span>
            <span style={badge(a.abgaben ? C.success : "var(--text3)")}>{t("pap.abgabenZahl", { n: a.abgaben })}</span>
            <button onClick={() => setOffen(offen && offen.id === a.id ? null : a)} style={{ ...btnSecondary, ...btnSmall }}>
              {t("pap.abgabenZeigen")}
            </button>
            <button onClick={() => loeschen(a.id)} className="icon-btn" style={{ padding: 4 }}
              title={t("common.delete")} aria-label={t("common.delete")}>
              <Icon d={ICONS.trash} size={15} color={C.danger} />
            </button>
          </div>
          {a.beschreibung && <p style={{ fontSize: 13, color: "var(--text2)", margin: "6px 0 0" }}>{a.beschreibung}</p>}
          {offen && offen.id === a.id && <Abgaben aufgabe={a} />}
        </div>
      ))}
    </>
  );
}

function Abgaben({ aufgabe }) {
  const { t } = useLanguage();
  const [zeilen, setZeilen] = useState(null);
  const [gezeigt, setGezeigt] = useState(null);

  useEffect(() => {
    fetch(`${API}/aufgaben/${aufgabe.id}/abgaben`).then((r) => (r.ok ? r.json() : []))
      .then(setZeilen).catch(() => setZeilen([]));
  }, [aufgabe.id]);

  const offene = useMemo(() => (zeilen || []).filter((z) => z.leer).length, [zeilen]);
  if (!zeilen) return null;

  return (
    <div style={{ ...panelStyle, padding: 12, marginTop: 12 }}>
      {/* „Wer hat noch nichts?" ist die Frage — deshalb steht sie oben und
          nicht als Rest unter einer Liste der Fertigen. */}
      <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
        {t("pap.offeneZahl", { n: offene, gesamt: zeilen.length })}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {zeilen.map((z) => (
          <div key={z.student_id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <span style={{ color: "var(--text3)", width: 28 }}>{z.card_id}</span>
            <span style={{ flex: 1 }}>{z.name}</span>
            {z.leer ? <span style={{ color: "var(--text3)" }}>{t("pap.nochNichts")}</span> : (
              <>
                {z.abgegeben && <span style={badge(C.success)}>{t("pap.abgegeben")}</span>}
                <button onClick={() => setGezeigt(gezeigt === z.student_id ? null : z.student_id)}
                  style={{ ...btnSecondary, ...btnSmall }}>{t("pap.ansehen")}</button>
              </>
            )}
          </div>
        ))}
      </div>
      {gezeigt != null && (() => {
        const z = zeilen.find((x) => x.student_id === gezeigt);
        if (!z || !z.daten) return null;
        return (
          <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{z.name}</div>
            <PapEditor wert={z.daten} lesen hoehe={320} />
          </div>
        );
      })()}
    </div>
  );
}
