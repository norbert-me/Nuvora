import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  pageApp, cardStyle, panelStyle, btnSecondary, btnSmall, iconBtn, toolbarBtnPrimary, toolbarInput, inputStyle,
  Icon, ICONS, COLORS as C, CONTROL_R, badge, sectionLabel,
} from "../components/Icons.jsx";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import WaageUeben, { GleichungEingabe } from "../components/WaageUeben.jsx";
import { Protokoll, protokollZeilen } from "../components/WaageEditor.jsx";
import { useLanguage } from "../i18n";
import { alsJson } from "../core/melden";
import { showAlert } from "../core/dialog.jsx";
import { oeffentlicheBasis } from "../core/basis.js";
import { gleichungText, pruefeGleichung, stand, zufall } from "../core/waage.js";

const API = "/api/waage";

// Modul Waage. Zwei Reiter, dieselben zwei Wege wie beim PAP-Editor:
//   „Üben"     — die Waage pur, mit zufälligen oder eigenen Gleichungen, dazu
//                der Link für die Kinder (/waage-frei, ohne Konto);
//   „Aufgaben" — ein Blatt mit Gleichungen für einen Kurs, gelöst über den
//                QR-Zugang; je Kind „wie viele gelöst" und jeder Weg.
export default function Waage() {
  const [params] = useSearchParams();
  const tab = params.get("tab") === "aufgaben" ? "aufgaben" : "ueben";
  return <div style={pageApp}>{tab === "ueben" ? <><WaageUeben speicher="nuvora_waage_lehrkraft" /><Austeilen /></> : <Aufgaben />}</div>;
}

function Austeilen() {
  const { t } = useLanguage();
  const [basis, setBasis] = useState(window.location.origin);
  const [kopiert, setKopiert] = useState(false);
  useEffect(() => { oeffentlicheBasis().then(setBasis); }, []);
  const link = `${basis}/waage-frei`;
  return (
    <div style={{ ...panelStyle, padding: 12, marginTop: 16 }}>
      <div style={{ ...sectionLabel, margin: "0 0 8px" }}>{t("waage.austeilen")}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--text2)" }}>{t("waage.linkFrei")}</span>
        <code style={{ fontSize: 12, background: "var(--bg)", padding: "4px 8px", borderRadius: CONTROL_R, overflowWrap: "anywhere" }}>{link}</code>
        <button onClick={() => { navigator.clipboard?.writeText(link); setKopiert(true); setTimeout(() => setKopiert(false), 2000); }}
          style={{ ...btnSecondary, ...btnSmall }}>{kopiert ? t("pap.linkKopiert") : t("pap.kopieren")}</button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text3)", margin: "10px 0 0" }}>{t("waage.linkUeberwacht")}</p>
    </div>
  );
}

const alsEingabe = (s) => ({ a: s.l.x, b: s.l.e, c: s.r.x, d: s.r.e });
const ausEingabe = (g) => stand(...["a", "b", "c", "d"].map((k) => Math.round(Number(g[k]) || 0)));

function Aufgaben() {
  const { t } = useLanguage();
  const [liste, setListe] = useState([]);
  const [wahl, setWahl] = useState({ classId: null, kursId: null });
  const [titel, setTitel] = useState("");
  const [beschreibung, setBeschreibung] = useState("");
  const [gleichungen, setGleichungen] = useState(() => [alsEingabe(zufall(3))]);
  const [stufe, setStufe] = useState(3);
  const [offen, setOffen] = useState(null);

  const laden = () => fetch(`${API}/aufgaben`).then((r) => (r.ok ? r.json() : [])).then(setListe).catch(() => {});
  useEffect(() => { laden(); }, []);

  const fehlerJe = gleichungen.map((g) => pruefeGleichung(ausEingabe(g)));
  const fehlt = !(wahl.classId || wahl.kursId) ? t("pap.fehltKurs")
    : !titel.trim() ? t("pap.fehltTitel")
    : !gleichungen.length ? t("waage.fehltGleichung")
    : fehlerJe.some(Boolean) ? t("waage.fehltGueltig") : "";

  const anlegen = async () => {
    if (fehlt) { showAlert(fehlt); return; }
    const r = await fetch(`${API}/aufgaben`, alsJson("POST", {
      title: titel.trim(), beschreibung, class_id: wahl.classId, kurs_id: wahl.kursId,
      gleichungen: gleichungen.map(ausEingabe),
    })).catch(() => null);
    if (r && r.ok) { setTitel(""); setBeschreibung(""); setGleichungen([alsEingabe(zufall(stufe))]); laden(); return; }
    let grund = "";
    try { const b = r ? await r.json() : null; grund = typeof b?.detail === "string" ? b.detail : ""; } catch { /* egal */ }
    showAlert(grund || t("common.notWork"));
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
          <KursKlasseSelect value={wahl.classId} kursValue={wahl.kursId} onChange={(classId, kursId) => setWahl({ classId, kursId })} />
          <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder={t("pap.aufgabeTitel")}
            style={{ ...toolbarInput, flex: 1, minWidth: 160 }} />
          <button onClick={anlegen} style={{ ...toolbarBtnPrimary, opacity: fehlt ? 0.5 : 1 }} title={fehlt || undefined}>{t("common.add")}</button>
        </Werkzeugleiste>
        <textarea value={beschreibung} onChange={(e) => setBeschreibung(e.target.value.slice(0, 4000))} rows={2}
          placeholder={t("pap.aufgabeText")} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginTop: 8, resize: "vertical" }} />
        <div style={{ ...sectionLabel, margin: "12px 0 8px" }}>{t("waage.gleichungen")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {gleichungen.map((g, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 16 }}>
              <span style={{ width: 24, color: "var(--text3)", fontSize: 13 }}>{i + 1}.</span>
              <GleichungEingabe wert={g} onChange={(v) => setGleichungen((l) => l.map((x, j) => (j === i ? v : x)))} />
              {fehlerJe[i] && <span style={{ fontSize: 12, color: C.danger }}>{t(`waage.gl.${fehlerJe[i]}`)}</span>}
              <button onClick={() => setGleichungen((l) => l.filter((_, j) => j !== i))} className="icon-btn"
                style={{ ...iconBtn, minWidth: 32, minHeight: 32 }} title={t("common.delete")} aria-label={t("common.delete")}>
                <Icon d={ICONS.trash} size={14} color={C.danger} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={() => setGleichungen((l) => [...l, { a: 1, b: 0, c: 0, d: 1 }])} disabled={gleichungen.length >= 20}
            style={{ ...btnSecondary, ...btnSmall }}>+ {t("waage.gleichung")}</button>
          <button onClick={() => setGleichungen((l) => [...l, alsEingabe(zufall(stufe))])} disabled={gleichungen.length >= 20}
            style={{ ...btnSecondary, ...btnSmall }}>+ {t("waage.zufaellig")}</button>
          <select value={stufe} onChange={(e) => setStufe(Number(e.target.value))} aria-label={t("waage.stufeWahl")}
            style={{ ...inputStyle, padding: "4px 8px", width: "auto" }}>
            {[1, 2, 3, 4].map((s) => <option key={s} value={s}>{t(`waage.stufe${s}`)}</option>)}
          </select>
        </div>
      </div>

      {liste.length === 0 && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("pap.keineAufgaben")}</p>}
      {liste.map((a) => (
        <div key={a.id} style={{ ...cardStyle, padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{a.title}</span>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("waage.gleichungenZahl", { n: (a.gleichungen || []).length })}</span>
            <span style={badge(a.abgaben ? C.success : "var(--text3)")}>{t("pap.abgabenZahl", { n: a.abgaben })}</span>
            <button onClick={() => setOffen(offen && offen.id === a.id ? null : a)} style={{ ...btnSecondary, ...btnSmall }}>{t("pap.abgabenZeigen")}</button>
            <button onClick={() => loeschen(a.id)} className="icon-btn" style={{ ...iconBtn, minWidth: 32, minHeight: 32 }}
              title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
          </div>
          <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
            {(a.gleichungen || []).map((g, i) => <span key={i} style={{ marginRight: 16, whiteSpace: "nowrap" }}>{i + 1}. {gleichungText(g)}</span>)}
          </div>
          {a.beschreibung && <p style={{ fontSize: 13, color: "var(--text2)", margin: "6px 0 0" }}>{a.beschreibung}</p>}
          {offen && offen.id === a.id && <Abgaben aufgabe={a} />}
        </div>
      ))}
    </>
  );
}

// Ein Lösungsweg als Text — so, wie er im Heft stünde.
function Weg({ start, weg }) {
  const { t } = useLanguage();
  return <Protokoll zeilen={protokollZeilen(start, (weg && weg.schritte) || [])} t={t} klein />;
}

function Abgaben({ aufgabe }) {
  const { t } = useLanguage();
  const [zeilen, setZeilen] = useState(null);
  const [gezeigt, setGezeigt] = useState(null);
  useEffect(() => {
    fetch(`${API}/aufgaben/${aufgabe.id}/abgaben`).then((r) => (r.ok ? r.json() : [])).then(setZeilen).catch(() => setZeilen([]));
  }, [aufgabe.id]);
  const offene = useMemo(() => (zeilen || []).filter((z) => z.leer).length, [zeilen]);
  if (!zeilen) return null;
  return (
    <div style={{ ...panelStyle, padding: 12, marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>{t("pap.offeneZahl", { n: offene, gesamt: zeilen.length })}</div>
      <div style={{ display: "grid", gap: 4 }}>
        {zeilen.map((z) => (
          <div key={z.student_id}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <span style={{ color: "var(--text3)", width: 28 }}>{z.card_id}</span>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{z.name}</span>
              {z.leer ? <span style={{ color: "var(--text3)" }}>{t("pap.nochNichts")}</span> : (
                <>
                  <span style={{ fontWeight: 700, color: z.geloest === z.gesamt ? C.success : "var(--text2)" }}>{t("waage.geloestZahl", { n: z.geloest, gesamt: z.gesamt })}</span>
                  {z.abgegeben && <span style={badge(C.success)}>{t("pap.abgegeben")}</span>}
                  <button onClick={() => setGezeigt(gezeigt === z.student_id ? null : z.student_id)} style={{ ...btnSecondary, ...btnSmall }}>{t("pap.ansehen")}</button>
                </>
              )}
            </div>
            {gezeigt === z.student_id && z.daten && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, margin: "8px 0 8px 36px" }}>
                {(aufgabe.gleichungen || []).map((g, i) => {
                  const d = z.daten[String(i)];
                  return (
                    <div key={i} style={{ border: "1px solid var(--border)", borderRadius: CONTROL_R, padding: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: d && d.geloest ? C.success : "var(--text3)" }}>
                        {i + 1}. {d && d.geloest ? "✓" : d ? t("waage.offen") : t("pap.nochNichts")}
                      </div>
                      <Weg start={g} weg={d} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
