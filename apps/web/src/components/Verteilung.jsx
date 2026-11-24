// Das eine Feld „Verteilung": Notenverteilung (Balken) oder Boxplot, mit den zwei
// Umschaltern, die es dazu gibt — links WAS (Balken/Boxplot), rechts WIE
// (Noten/Teilnoten bzw. %/Note). Vorher gab es das viermal nachgebaut (Notenbuch,
// Klassenarbeit, CardVote-Test, CardVote-Klasse), jedes mit anderer Hoehe, anderen
// Farben und anderer Richtung der Achse — beim Umschalten sprang die Seite.
//
// Gespeist wird es mit Daten, nicht mit Rechenwegen:
//   noten  Notenwerte je Kind (auch mit Tendenz, 2,3) — fehlt es, gibt es nur den Boxplot in %
//   pct    Prozentwerte je Kind — fehlt es, gibt es den Boxplot nur in Noten
// Beim Boxplot steht die gute Seite immer LINKS (Noten klein = gut, Prozent umgekehrt).
import { useState } from "react";
import { Boxplot, COLORS as C, Tabs } from "./Icons.jsx";
import { verteilung } from "../core/notenstufen.js";
import { komma } from "../core/zahl.js";
import { useLanguage } from "../i18n/index.jsx";

// Hoehe der Flaeche unter den Umschaltern: Balken und Boxplot sind gleich hoch,
// sonst rutscht alles darunter bei jedem Umschalten.
const FLAECHE = 130;

const farbe = (g) => {
  const n = Math.min(6, Math.max(1, Math.round(parseFloat(String(g).replace("−", "-")))));
  return n <= 2 ? C.success : n <= 4 ? C.warning : C.danger;
};

export default function Verteilung({ noten, pct, stufung = "ganz", fein: feinAussen, onFein }) {
  const { t } = useLanguage();
  const zahlen = (a) => (a || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  const nw = noten ? zahlen(noten) : null;
  const pw = pct ? zahlen(pct) : null;
  const [sicht, setSicht] = useState(nw ? "bar" : "box");
  const [feinInnen, setFeinInnen] = useState(stufung === "teil");
  const fein = feinAussen != null ? feinAussen : feinInnen;
  const setzeFein = (v) => { setFeinInnen(v); if (onFein) onFein(v); };
  const [einheit, setEinheit] = useState(pw ? "pct" : "note");
  const ansicht = nw ? sicht : "box";
  const eh = pw && nw ? einheit : (pw ? "pct" : "note");

  const modus = fein ? "teil" : (stufung === "halb" ? "halb" : "ganz");
  const dist = nw ? verteilung(nw, modus) : [];
  const maxD = Math.max(...dist.map((d) => d.n), 1);

  const links = nw ? [["bar", t("klassenarbeit.distGrades")], ["box", t("klassenarbeit.distBox")]] : null;
  const rechts = ansicht === "bar"
    ? [["ganz", t("klassenarbeit.distWhole")], ["fein", t("klassenarbeit.distFine")]]
    : (pw && nw ? [["pct", "%"], ["note", t("klassenarbeit.grade")]] : null);

  const box = eh === "pct" ? pw : nw;
  return (
    <div>
      {(links || rechts) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {links && <Tabs value={ansicht} onChange={setSicht} options={links} />}
          {rechts && (
            <Tabs style={{ marginLeft: "auto" }}
              value={ansicht === "bar" ? (fein ? "fein" : "ganz") : eh}
              onChange={(v) => (ansicht === "bar" ? setzeFein(v === "fein") : setEinheit(v))}
              options={rechts} />
          )}
        </div>
      )}
      <div style={{ minHeight: FLAECHE }}>
        {ansicht === "bar" ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: modus === "teil" ? 3 : modus === "halb" ? 4 : 8, height: FLAECHE }}>
            {dist.map(({ g, n }) => (
              <div key={String(g)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 0 }}>
                <span style={{ fontSize: 11, color: "var(--text3)" }}>{n || ""}</span>
                <div title={String(n)} style={{ width: "100%", maxWidth: modus === "ganz" ? 44 : 26, height: Math.max(n ? 3 : 0, (n / maxD) * (FLAECHE - 40)),
                  background: n ? farbe(g) : "var(--border3)", opacity: n ? 0.85 : 0.3, borderRadius: "5px 5px 0 0" }} />
                <span style={{ fontSize: modus === "teil" ? 11 : 12, fontWeight: 700, color: "var(--text2)", whiteSpace: "nowrap" }}>{typeof g === "number" ? komma(g) : g}</span>
              </div>
            ))}
          </div>
        ) : (box && box.length >= 3
          ? <Boxplot values={box} max={eh === "pct" ? 100 : 6} unit={eh === "pct" ? "%" : ""} umgekehrt={eh === "pct"} />
          : <p style={{ fontSize: 13, color: "var(--text3)" }}>{t("noten.distZuWenig")}</p>)}
      </div>
    </div>
  );
}
