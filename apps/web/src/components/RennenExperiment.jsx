// KI-Rennen, Modus „Experiment": mehrere Einstellungen gleich lange lernen
// lassen und die Kurven uebereinanderlegen — damit die Klasse vergleicht,
// statt mitzuschreiben. Gerechnet wird ohne Bild (core/rennen.js:
// experimentLauf), eine Generation je Haeppchen, damit die Seite bedienbar
// bleibt und der Fortschritt sichtbar ist.
//
// Jeder Lauf beginnt bei null (eigener Startwert, nichts Gelerntes), und jede
// Einstellung kann mehrmals laufen: derselbe Versuch zweimal ergibt zwei
// verschiedene Verlaeufe — auch das ist eine Lernfrage.
import { useEffect, useRef, useState } from "react";
import { CONTROL_R, Segment, segmentBtn, cardStyle, toolbarBtn, toolbarBtnPrimary, COLORS as C, th, td } from "./Icons.jsx";
import { experimentLauf, laufBilanz, zeitText } from "../core/rennen.js";

const FARBEN = ["#1e88e5", "#e53935", "#43a047", "#fb8c00"];
const VORGABE = [
  { rate: 0.02, anzahl: 30, grenze: 30 },
  { rate: 0.15, anzahl: 30, grenze: 30 },
  { rate: 0.5, anzahl: 30, grenze: 30 },
];

export default function RennenExperiment({ strecke, t }) {
  const [einst, setEinst] = useState(VORGABE);
  const [generationen, setGenerationen] = useState(20);
  const [wdh, setWdh] = useState(1);
  const [ergebnis, setErgebnis] = useState(null);   // [[reihe je Wiederholung] je Einstellung]
  const [laeuft, setLaeuft] = useState(false);
  const [fort, setFort] = useState(0);
  const abbruch = useRef(false);

  // Eine andere Strecke macht die alten Kurven ungueltig.
  useEffect(() => { setErgebnis(null); }, [strecke]);
  useEffect(() => () => { abbruch.current = true; }, []);

  const starten = () => {
    abbruch.current = false;
    const laeufe = einst.flatMap((e, ei) => Array.from({ length: wdh }, (_, w) => ({ ei, w,
      lauf: experimentLauf({ ...e, seed: 1000 + ei * 97 + w * 7919, strecke }) })));
    const reihen = einst.map(() => Array.from({ length: wdh }, () => []));
    const gesamt = laeufe.length * generationen;
    let erledigt = 0;
    setErgebnis(reihen.map((r) => r.map((x) => [...x])));
    setLaeuft(true); setFort(0);
    // Reihum: jede Einstellung eine Generation weiter — so wachsen alle Kurven
    // gleichzeitig, und ein Abbruch hinterlaesst einen fairen Vergleich.
    const schritt = () => {
      if (abbruch.current) { setLaeuft(false); return; }
      const t0 = performance.now();
      while (performance.now() - t0 < 40 && erledigt < gesamt) {
        const l = laeufe[erledigt % laeufe.length];
        reihen[l.ei][l.w].push(l.lauf.weiter());
        erledigt += 1;
      }
      setErgebnis(reihen.map((r) => r.map((x) => [...x])));
      setFort(erledigt / gesamt);
      if (erledigt < gesamt) setTimeout(schritt, 0); else setLaeuft(false);
    };
    setTimeout(schritt, 0);
  };

  const setze = (i, feld, wert) => setEinst((l) => l.map((e, j) => (j === i ? { ...e, [feld]: wert } : e)));

  // Kurve: beste Rundenzeit je Generation, oben = schneller.
  const alle = (ergebnis || []).flat(2).map((g) => g.beste).filter((z) => z != null);
  const zmin = alle.length ? Math.min(...alle) : 0, zmax = alle.length ? Math.max(...alle) : 1;
  const W = 600, H = 220, R = 30;
  const px = (i) => R + (generationen > 1 ? (i / (generationen - 1)) * (W - R - 10) : 0);
  const py = (z) => 12 + ((z - zmin) / Math.max(0.01, zmax - zmin)) * (H - 40);
  const linie = (reihe) => {
    const teile = []; let akt = [];
    reihe.forEach((g, i) => { if (g.beste == null) { if (akt.length) teile.push(akt); akt = []; } else akt.push(`${px(i)},${py(g.beste)}`); });
    if (akt.length) teile.push(akt);
    return teile;
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ ...cardStyle, padding: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text2)", margin: "0 0 10px", lineHeight: 1.5 }}>{t("rennen.exp.erklaer")}</p>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t("rennen.exp.einstellungen")}</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th} />
                <th style={th}>{t("rennen.mutation")}</th>
                <th style={th}>{t("rennen.anzahl")}</th>
                <th style={th}>{t("rennen.grenze")}</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {einst.map((e, i) => (
                <tr key={i}>
                  <td style={td}><span style={{ display: "inline-block", width: 14, height: 14, borderRadius: CONTROL_R, background: FARBEN[i] }} /></td>
                  <td style={td}><Zahl wert={Math.round(e.rate * 100)} stufen={[1, 2, 5, 10, 15, 20, 30, 50, 80]} einheit="%" onChange={(v) => setze(i, "rate", v / 100)} aus={laeuft} /></td>
                  <td style={td}><Zahl wert={e.anzahl} stufen={[5, 10, 20, 30, 45, 60]} onChange={(v) => setze(i, "anzahl", v)} aus={laeuft} /></td>
                  <td style={td}><Zahl wert={e.grenze} stufen={[5, 10, 15, 20, 30, 45, 60, 90]} einheit="s" onChange={(v) => setze(i, "grenze", v)} aus={laeuft} /></td>
                  <td style={td}>
                    {einst.length > 1 && !laeuft && (
                      <button onClick={() => setEinst((l) => l.filter((_, j) => j !== i))} style={{ ...toolbarBtn, color: C.danger }} aria-label={t("common.delete")}>×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
          {einst.length < 4 && !laeuft && (
            <button onClick={() => setEinst((l) => [...l, { ...l[l.length - 1] }])} style={toolbarBtn}>+ {t("rennen.exp.einstellung")}</button>
          )}
          <span style={{ fontSize: 13, color: "var(--text2)" }}>{t("rennen.exp.generationen")}</span>
          <Segment>
            {[10, 20, 30, 50].map((g) => (
              <button key={g} disabled={laeuft} onClick={() => setGenerationen(g)} aria-pressed={generationen === g}
                style={{ ...segmentBtn, fontWeight: generationen === g ? 700 : 500, color: generationen === g ? "var(--accent)" : "var(--text2)" }}>{g}</button>
            ))}
          </Segment>
          <span style={{ fontSize: 13, color: "var(--text2)" }}>{t("rennen.exp.wdh")}</span>
          <Segment>
            {[1, 2, 3].map((g) => (
              <button key={g} disabled={laeuft} onClick={() => setWdh(g)} aria-pressed={wdh === g}
                style={{ ...segmentBtn, fontWeight: wdh === g ? 700 : 500, color: wdh === g ? "var(--accent)" : "var(--text2)" }}>{g}×</button>
            ))}
          </Segment>
          {laeuft
            ? <button onClick={() => { abbruch.current = true; }} style={toolbarBtn}>{t("rennen.exp.abbrechen")}</button>
            : <button onClick={starten} style={toolbarBtnPrimary}>{t("rennen.exp.starten")}</button>}
        </div>
        {laeuft && (
          <div style={{ marginTop: 10, height: 8, background: "var(--bg2)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${Math.round(fort * 100)}%`, height: "100%", background: "var(--accent)" }} />
          </div>
        )}
      </div>

      {ergebnis && (
        <div style={{ ...cardStyle, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{t("rennen.zeitVerlauf")}</div>
          {!alle.length ? <div style={{ fontSize: 13, color: "var(--text3)" }}>{t("rennen.nochKeineRunde")}</div> : (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", background: "var(--bg3)", borderRadius: CONTROL_R }}>
              <text x={4} y={16} fontSize={11} fill="var(--text3)">{zeitText(zmin)}</text>
              <text x={4} y={H - 26} fontSize={11} fill="var(--text3)">{zeitText(zmax)}</text>
              {[0, generationen - 1].map((g) => (
                <text key={g} x={px(g)} y={H - 6} fontSize={11} textAnchor={g ? "end" : "start"} fill="var(--text3)">{t("rennen.exp.gen", { n: g + 1 })}</text>
              ))}
              {ergebnis.map((laeufe, ei) => laeufe.map((reihe, w) => linie(reihe).map((pkt, k) => (
                <polyline key={`${ei}-${w}-${k}`} points={pkt.join(" ")} fill="none" stroke={FARBEN[ei]}
                  strokeWidth={w === 0 ? 2.4 : 1.4} strokeOpacity={w === 0 ? 1 : 0.55} strokeDasharray={w === 0 ? undefined : "5 4"} />
              ))))}
            </svg>
          )}
          {/* Die Zahlen dazu — fuer den Vergleich an der Tafel. */}
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13, marginTop: 10 }}>
            <thead>
              <tr>
                <th style={th} />
                <th style={th}>{t("rennen.exp.einstellung")}</th>
                <th style={th}>{t("rennen.exp.ersteRunde")}</th>
                <th style={th}>{t("rennen.exp.bestzeit")}</th>
                <th style={th}>{t("rennen.exp.anteilEnde")}</th>
              </tr>
            </thead>
            <tbody>
              {ergebnis.map((laeufe, ei) => {
                const b = laeufe.map(laufBilanz);
                const ersteListe = b.map((x) => (x.ersteRunde == null ? "–" : x.ersteRunde)).join(" / ");
                const zeitListe = b.map((x) => zeitText(x.bestzeit)).join(" / ");
                const anteil = b.map((x) => `${Math.round(x.anteilEnde * 100)} %`).join(" / ");
                const e = einst[ei] || {};
                return (
                  <tr key={ei}>
                    <td style={td}><span style={{ display: "inline-block", width: 14, height: 14, borderRadius: CONTROL_R, background: FARBEN[ei] }} /></td>
                    <td style={td}>{Math.round((e.rate || 0) * 100)} % · {e.anzahl} · {e.grenze} s</td>
                    <td style={td}>{ersteListe}</td>
                    <td style={td}>{zeitListe}</td>
                    <td style={td}>{anteil}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {wdh > 1 && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>{t("rennen.exp.wdhHinweis")}</div>}
        </div>
      )}
    </div>
  );
}

// Eine Zahl mit − und + daneben: schneller als ein Feld zum Tippen, und am
// Beamer gut zu treffen. Gesprungen wird ueber feste Stufen — 2 % und 50 %
// Mutation sollen zwei Klicks auseinander liegen, nicht achtundvierzig.
function Zahl({ wert, stufen, einheit = "", onChange, aus }) {
  const i = stufen.reduce((b, v, k) => (Math.abs(v - wert) < Math.abs(stufen[b] - wert) ? k : b), 0);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button disabled={aus || i <= 0} onClick={() => onChange(stufen[i - 1])} style={{ ...toolbarBtn, padding: "0 8px" }}>−</button>
      <span style={{ minWidth: 44, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{wert}{einheit ? ` ${einheit}` : ""}</span>
      <button disabled={aus || i >= stufen.length - 1} onClick={() => onChange(stufen[i + 1])} style={{ ...toolbarBtn, padding: "0 8px" }}>+</button>
    </span>
  );
}
