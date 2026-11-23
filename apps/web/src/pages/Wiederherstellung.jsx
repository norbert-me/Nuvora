// Aus einer Sicherung zurückholen — je Modul, nur die eigenen Daten, mit Vergleich.
// Serverseite: apps/api/app/routers/wiederherstellung.py (Rechnung: app/wiederherstellung.py).
//
// Drei Zustände je Zeile: „fehlt heute" (vorangehakt — das ist der Normalfall), „anders" (nicht
// vorangehakt: Überschreiben ist eine Entscheidung) und „neu seit der Sicherung" (wird nur gezählt, nie
// angefasst). Gelöscht wird hier nichts.
import { useEffect, useMemo, useState } from "react";

import { useLanguage } from "../i18n/index.jsx";
import { askConfirm } from "../core/dialog.jsx";
import { alsJson, hol, pruefeAntwort } from "../core/melden.js";
import Werkzeugleiste from "../components/Werkzeugleiste.jsx";
import {
  COLORS as C, Empty, Icon, ICONS, btnPrimary, cardStyle, chipStyle, linkBtn, pageApp, pageIntro, pageTitle,
  sectionLabel, selectStyle, toolbarBtn,
} from "../components/Icons.jsx";

const zeitText = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

export default function Wiederherstellung() {
  const { t } = useLanguage();
  const [sicherungen, setSicherungen] = useState(null);
  const [module, setModule] = useState([]);
  const [sicherung, setSicherung] = useState("");
  const [modul, setModul] = useState("");
  const [lauf, setLauf] = useState(false);
  const [ergebnis, setErgebnis] = useState(null);       // Antwort von /vergleich
  const [wahl, setWahl] = useState({});                 // "tabelle:id" -> "einfuegen" | "ueberschreiben"
  const [offen, setOffen] = useState({});               // "tabelle:id" -> Feldvergleich aufgeklappt
  const [fertig, setFertig] = useState(null);           // Antwort von /wiederherstellen

  useEffect(() => {
    hol("/api/wiederherstellung/sicherungen", []).then((l) => { setSicherungen(l); if (l[0]) setSicherung(l[0].name); });
    hol("/api/wiederherstellung/module", []).then((l) => { setModule(l); if (l[0]) setModul(l[0].key); });
  }, []);

  const tabName = (n) => { const k = `wh.t.${n}`; const r = t(k); return r === k ? n : r; };

  const vergleichen = async () => {
    setLauf(true); setErgebnis(null); setFertig(null); setWahl({}); setOffen({});
    const res = await fetch("/api/wiederherstellung/vergleich", alsJson("POST", { sicherung, modul })).catch(() => null);
    if (await pruefeAntwort(res, t("wh.vergleichen"))) {
      const d = await res.json();
      setErgebnis(d);
      // Fehlendes ist vorangehakt, Abweichendes nicht.
      const vor = {};
      d.tabellen.forEach((tb) => tb.fehlt.forEach((z) => { vor[`${tb.tabelle}:${z.id}`] = "einfuegen"; }));
      setWahl(vor);
    }
    setLauf(false);
  };

  const zaehl = useMemo(() => {
    const v = Object.values(wahl);
    return { ein: v.filter((x) => x === "einfuegen").length, ueber: v.filter((x) => x === "ueberschreiben").length };
  }, [wahl]);

  const umschalten = (tab, id, aktion) => setWahl((w) => {
    const k = `${tab}:${id}`; const n = { ...w };
    if (n[k]) delete n[k]; else n[k] = aktion;
    return n;
  });
  const alle = (tb, art, aktion, an) => setWahl((w) => {
    const n = { ...w };
    tb[art].forEach((z) => { const k = `${tb.tabelle}:${z.id}`; if (an) n[k] = aktion; else delete n[k]; });
    return n;
  });

  const einspielen = async () => {
    if (!zaehl.ein && !zaehl.ueber) return;
    if (!await askConfirm(t("wh.bestaetigen", { ein: zaehl.ein, ueber: zaehl.ueber }))) return;
    setLauf(true);
    const auswahl = Object.entries(wahl).map(([k, aktion]) => {
      const i = k.lastIndexOf(":");
      return { t: k.slice(0, i), id: Number(k.slice(i + 1)), aktion };
    });
    const res = await fetch("/api/wiederherstellung/wiederherstellen", alsJson("POST", { sicherung, modul, auswahl })).catch(() => null);
    if (await pruefeAntwort(res, t("wh.zurueckholen"))) {
      setFertig(await res.json());
      setWahl({});
      await vergleichenStill();
    }
    setLauf(false);
  };
  // Nach dem Einspielen den Stand neu vergleichen, ohne die Abschlussmeldung zu verlieren.
  const vergleichenStill = async () => {
    const res = await fetch("/api/wiederherstellung/vergleich", alsJson("POST", { sicherung, modul })).catch(() => null);
    if (res && res.ok) setErgebnis(await res.json());
  };

  const keineSicherung = sicherungen !== null && sicherungen.length === 0;

  return (
    <div style={pageApp}>
      <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("wh.title")}</h1>
      <p style={pageIntro}>{t("wh.intro")}</p>

      {keineSicherung ? <Empty title={t("wh.keine")} hint={t("wh.keineHint")} /> : (
        <Werkzeugleiste
          links={<>
            <select value={sicherung} onChange={(e) => setSicherung(e.target.value)} aria-label={t("wh.sicherung")} title={t("wh.sicherung")}
              style={{ ...selectStyle, minWidth: 0 }}>
              {(sicherungen || []).map((s) => <option key={s.name} value={s.name}>{zeitText(s.zeit)}</option>)}
            </select>
            <select value={modul} onChange={(e) => { setModul(e.target.value); setErgebnis(null); setFertig(null); }}
              aria-label={t("wh.modul")} title={t("wh.modul")} style={{ ...selectStyle, minWidth: 0 }}>
              {module.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
            </select>
            <button onClick={vergleichen} disabled={lauf || !sicherung || !modul} style={toolbarBtn}>
              <Icon d={ICONS.search || ICONS.chart} size={15} /> {t("wh.vergleichen")}
            </button>
          </>}
        />
      )}

      {lauf && !ergebnis && <p style={{ color: "var(--text3)", fontSize: 13 }}>{t("wh.laeuft")}</p>}

      {fertig && (
        <div style={{ ...cardStyle, marginBottom: 12 }}>
          <strong>{t("wh.fertig", { ein: fertig.eingefuegt, ueber: fertig.ueberschrieben })}</strong>
          {fertig.uebersprungen.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 13, color: "var(--text2)" }}>
              {t("wh.uebersprungen", { n: fertig.uebersprungen.length })}
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {fertig.uebersprungen.slice(0, 10).map((u, i) => <li key={i}>{tabName(u.t)} #{u.id}: {u.grund}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {ergebnis && ergebnis.tabellen.length === 0 && <Empty title={t("wh.nichts")} hint={t("wh.nichtsHint")} />}

      {ergebnis && ergebnis.tabellen.map((tb) => (
        <div key={tb.tabelle} style={{ ...cardStyle, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{tabName(tb.tabelle)}</span>
            <span style={{ ...chipStyle, fontSize: 12 }}>{t("wh.gleich", { n: tb.gleich })}</span>
            {tb.neu_seitdem > 0 && <span style={{ ...chipStyle, fontSize: 12 }} title={t("wh.neuHint")}>{t("wh.neu", { n: tb.neu_seitdem })}</span>}
          </div>

          {tb.fehlt_gesamt > 0 && (
            <Abschnitt titel={t("wh.fehlt", { n: tb.fehlt_gesamt })} farbe={C.warning}
              aktionen={<>
                <button style={linkBtn} onClick={() => alle(tb, "fehlt", "einfuegen", true)}>{t("wh.alle")}</button>
                <button style={linkBtn} onClick={() => alle(tb, "fehlt", "einfuegen", false)}>{t("wh.keine2")}</button>
              </>}>
              {tb.fehlt.map((z) => (
                <label key={z.id} style={zeile}>
                  <input type="checkbox" checked={wahl[`${tb.tabelle}:${z.id}`] === "einfuegen"} onChange={() => umschalten(tb.tabelle, z.id, "einfuegen")} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{z.bezeichnung}</span>
                </label>
              ))}
              {tb.fehlt_gesamt > tb.fehlt.length && <div style={rest}>{t("wh.mehr", { n: tb.fehlt_gesamt - tb.fehlt.length })}</div>}
            </Abschnitt>
          )}

          {tb.anders_gesamt > 0 && (
            <Abschnitt titel={t("wh.anders", { n: tb.anders_gesamt })} farbe={C.danger}
              aktionen={<button style={linkBtn} onClick={() => alle(tb, "anders", "ueberschreiben", false)}>{t("wh.keine2")}</button>}>
              {tb.anders.map((z) => {
                const k = `${tb.tabelle}:${z.id}`;
                return (
                  <div key={z.id}>
                    <div style={zeile}>
                      <input type="checkbox" checked={wahl[k] === "ueberschreiben"} onChange={() => umschalten(tb.tabelle, z.id, "ueberschreiben")} />
                      <button onClick={() => setOffen((o) => ({ ...o, [k]: !o[k] }))}
                        style={{ ...linkBtn, flex: 1, minWidth: 0, textAlign: "left", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <Icon d={offen[k] ? ICONS.chevronDown : ICONS.chevronRight} size={12} color="var(--text3)" /> {z.bezeichnung}
                      </button>
                      <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("wh.felder", { n: z.felder.length })}</span>
                    </div>
                    {offen[k] && (
                      <div style={{ margin: "0 0 8px 26px", fontSize: 13, display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: "2px 12px" }}>
                        <span style={sectionLabel}>{t("wh.feld")}</span><span style={sectionLabel}>{t("wh.heute")}</span><span style={sectionLabel}>{t("wh.damals")}</span>
                        {z.felder.map((f) => (
                          <FeldZeile key={f.spalte} f={f} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {tb.anders_gesamt > tb.anders.length && <div style={rest}>{t("wh.mehr", { n: tb.anders_gesamt - tb.anders.length })}</div>}
            </Abschnitt>
          )}
        </div>
      ))}

      {ergebnis && (zaehl.ein > 0 || zaehl.ueber > 0) && (
        <div style={{ position: "sticky", bottom: 12, display: "flex", justifyContent: "center", marginTop: 12 }}>
          <button onClick={einspielen} disabled={lauf} style={{ ...btnPrimary, boxShadow: "var(--shadow-float, 0 4px 14px rgba(0,0,0,.25))" }}>
            {t("wh.zurueckholenAnz", { ein: zaehl.ein, ueber: zaehl.ueber })}
          </button>
        </div>
      )}
    </div>
  );
}

const zeile = { display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 14, cursor: "pointer" };
const rest = { fontSize: 12, color: "var(--text3)", padding: "6px 0" };
const wert = { overflowWrap: "anywhere", color: "var(--text2)" };

function FeldZeile({ f }) {
  return (<>
    <span style={{ color: "var(--text3)" }}>{f.spalte}</span>
    <span style={wert}>{f.jetzt}</span>
    <span style={{ ...wert, color: "var(--text)", fontWeight: 600 }}>{f.sicherung}</span>
  </>);
}

function Abschnitt({ titel, farbe, aktionen, children }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: farbe }}>{titel}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 10 }}>{aktionen}</span>
      </div>
      {children}
    </div>
  );
}
