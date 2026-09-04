// Angehefteter Knopf unten rechts: einen Fehler melden.
//
// Der Weg dahin war vorher das Kontaktformular unter /contact — also: die
// kaputte Seite verlassen, das Menü suchen, den Fehler aus dem Gedächtnis
// beschreiben. Genau dabei geht verloren, was man gebraucht hätte. Deshalb
// hier: ein Knopf, der immer da ist, und eine Meldung, der das Protokoll der
// letzten Minuten schon beiliegt (core/protokoll.js).
//
// Was mitgeht, steht VOR dem Absenden im Dialog — aufklappbar, im Klartext.
// Eine Fehlermeldung, die heimlich etwas mitschickt, wäre in einem Werkzeug
// mit Art-9-Daten das Letzte, was jemand gebrauchen kann; das Protokoll ist
// deshalb inhaltsfrei (siehe dort) und trotzdem sichtbar.
import { useEffect, useRef, useState } from "react";

import {
  btnPrimary, btnSecondary, cardStyle, COLORS as C, CONTROL_R, dateiWaehlen, DialogKopf, Icon, iconBtn, ICONS,
  inputStyle, Modal, SHADOW,
} from "./Icons.jsx";
import { alsText, beobachte, leeren, protokoll, umgebung } from "../core/protokoll.js";
import { alsJson } from "../core/melden.js";
import { useLanguage } from "../i18n/index.jsx";

export default function Fehlermelder() {
  const { t } = useLanguage();
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState("");
  const [mitLog, setMitLog] = useState(true);
  const [mitUmg, setMitUmg] = useState(true);
  const [logOffen, setLogOffen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fertig, setFertig] = useState(false);
  const [fehler, setFehler] = useState("");
  const [anzahl, setAnzahl] = useState(0);
  // „Grosser Bildschirm" statt „Desktop": entscheidend ist der Platz, nicht das
  // Geraet. Ein Tablet im Querformat bekommt denselben Knopf wie der Rechner.
  const [gross, setGross] = useState(() => {
    try { return window.matchMedia("(min-width: 900px)").matches; } catch { return false; }
  });
  useEffect(() => {
    let mq;
    try { mq = window.matchMedia("(min-width: 900px)"); } catch { return; }
    const h = (e) => setGross(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  // Ein Anhang, den die Lehrkraft SELBST aussucht (Screenshot, Export, PDF).
  // Er darf Inhalte tragen — anders als Protokoll und Umgebung, die
  // inhaltsfrei bleiben: hier hat jemand hingesehen und sich entschieden.
  // Die Grenze richtet sich nach dem, was eine Mail traegt (der Server nimmt
  // 3 MB Rohdaten); zu gross wird hier abgefangen, damit niemand erst
  // hochlaedt und dann eine Absage bekommt.
  const ANHANG_MAX = 3 * 1024 * 1024;
  const [datei, setDatei] = useState(null); // { name, typ, groesse, daten(base64) }
  // Der Knopf soll auf sich aufmerksam machen, wenn wirklich etwas schiefging —
  // aber nur dann. Ein Dauerpunkt wäre nach zwei Tagen unsichtbar.
  const [problem, setProblem] = useState(false);
  const zuletzt = useRef(0);

  useEffect(() => beobachte((n) => {
    setAnzahl(n);
    const jetzt = protokoll().filter((e) => e.art === "fehler").length;
    if (jetzt > zuletzt.current) setProblem(true);
    zuletzt.current = jetzt;
  }), []);

  const senden = async () => {
    if (!text.trim()) return;
    setBusy(true); setFehler("");
    const res = await fetch("/api/bugreport", alsJson("POST", {
      message: text.trim(),
      log: mitLog ? alsText() : "",
      umgebung: mitUmg ? umgebung() : "",
      seite: window.location.pathname + window.location.search,
      ...(datei ? { anhang_name: datei.name, anhang_typ: datei.typ, anhang_daten: datei.daten } : {}),
    })).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      const d = res ? await res.json().catch(() => ({})) : {};
      setFehler(d.detail || t("melder.fehler"));
      return;
    }
    setFertig(true);
    leeren();
    setProblem(false);
  };

  const schliessen = () => {
    setOffen(false);
    setText(""); setFertig(false); setFehler(""); setLogOffen(false); setDatei(null);
  };

  return (
    <>
      <button onClick={() => { setOffen(true); setProblem(false); }}
        title={t("melder.titel")} aria-label={t("melder.titel")}
        style={{
          position: "fixed", right: 16, bottom: 16, zIndex: 300,
          // Am Rechner ein Viertel groesser: dort ist der Knopf eine kleine
          // Marke am Bildrand und wurde uebersehen. Auf dem Handy bleibt er,
          // wie er war — 40 px sind dort schon eine Daumenflaeche, und der
          // Platz ist knapper.
          width: gross ? 50 : 40, height: gross ? 50 : 40, borderRadius: CONTROL_R,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--card)", border: "1px solid var(--border2)",
          color: problem ? C.danger : "var(--text3)", cursor: "pointer",
          boxShadow: SHADOW.schwebend,
        }}>
        <Icon d={ICONS.bug} size={gross ? 22 : 18} color="currentColor" />
        {/* Punkt statt Zahl: wie viele Fehler es waren, hilft niemandem —
            dass überhaupt einer war, schon. Radius = halbe Kante (Grafik). */}
        {problem && (
          <span aria-hidden style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: 3.5, background: C.danger }} />
        )}
      </button>

      {offen && (
        <Modal onClose={schliessen} width={520} label={t("melder.titel")}>
          <DialogKopf titel={t("melder.titel")} onClose={schliessen} schliessenLabel={t("common.close")} />
          {fertig ? (
            <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
              <div style={{ color: C.success, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{t("melder.danke")}</div>
              <p style={{ color: "var(--text2)", fontSize: 14 }}>{t("melder.dankeText")}</p>
              <button onClick={schliessen} style={{ ...btnSecondary, marginTop: 12 }}>{t("common.close")}</button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 14, color: "var(--text2)", margin: "0 0 12px" }}>{t("melder.intro")}</p>
              <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 3000))} rows={5}
                placeholder={t("melder.platzhalter")} autoFocus
                style={{ ...inputStyle, width: "100%", lineHeight: 1.5, resize: "vertical" }} />

              <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0 0", fontSize: 14, color: "var(--text2)" }}>
                <input type="checkbox" checked={mitLog} onChange={(e) => setMitLog(e.target.checked)} />
                {t("melder.mitLog", { n: anzahl })}
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 4px", fontSize: 14, color: "var(--text2)" }}>
                <input type="checkbox" checked={mitUmg} onChange={(e) => setMitUmg(e.target.checked)} />
                {t("melder.mitUmgebung")}
              </label>
              {/* Kein Hinweistext mehr: der Knopf darunter zeigt im Klartext,
                  was mitgeht, und beide Häkchen lassen sich abwählen —
                  nachlesbar schlägt beschrieben. */}
              <button onClick={() => setLogOffen((v) => !v)}
                style={{ ...btnSecondary, padding: "4px 10px", fontSize: 13, marginBottom: 8 }}>
                {logOffen ? t("melder.logZu") : t("melder.wasGeht")}
              </button>
              {logOffen && (
                <pre style={{ ...cardStyle, padding: 10, maxHeight: 240, overflow: "auto", fontSize: 11,
                  lineHeight: 1.5, color: "var(--text2)", whiteSpace: "pre-wrap", margin: "0 0 12px" }}>
                  {[mitUmg ? `--- ${t("melder.umgebungTitel")} ---\n${umgebung()}` : "",
                    mitLog ? `--- ${t("melder.protokollTitel")} ---\n${alsText() || t("melder.logLeer")}` : ""]
                    .filter(Boolean).join("\n\n") || t("melder.logLeer")}
                </pre>
              )}

              {/* Anhang: bewusst KEIN automatisches Einsammeln — die Datei
                  waehlt die Lehrkraft. */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 12px", flexWrap: "wrap" }}>
                <button onClick={() => dateiWaehlen(async (f) => {
                  if (!f) return;
                  if (f.size > ANHANG_MAX) { setFehler(t("melder.anhangZuGross", { n: Math.round(ANHANG_MAX / 1024 / 1024) })); return; }
                  const daten = await new Promise((res) => {
                    const r = new FileReader();
                    r.onload = () => res(String(r.result || "").split(",")[1] || "");
                    r.onerror = () => res("");
                    r.readAsDataURL(f);
                  });
                  if (!daten) { setFehler(t("melder.anhangFehler")); return; }
                  setFehler("");
                  setDatei({ name: f.name, typ: f.type || "application/octet-stream", groesse: f.size, daten });
                }, "*/*")} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 13 }}>
                  {t("melder.anhang")}
                </button>
                {datei && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text2)" }}>
                    {datei.name} ({Math.max(1, Math.round(datei.groesse / 1024))} KB)
                    <button onClick={() => setDatei(null)} className="icon-btn" style={{ ...iconBtn, padding: 2 }}
                      title={t("common.delete")} aria-label={t("common.delete")}>
                      <Icon d={ICONS.close} size={14} />
                    </button>
                  </span>
                )}
              </div>

              {fehler && <div style={{ color: C.danger, fontSize: 13, marginBottom: 8 }}>{fehler}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={schliessen} style={btnSecondary}>{t("common.abort")}</button>
                <button onClick={senden} disabled={busy || !text.trim()}
                  style={{ ...btnPrimary, opacity: busy || !text.trim() ? 0.5 : 1 }}>
                  {busy ? t("melder.sendet") : t("melder.senden")}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
