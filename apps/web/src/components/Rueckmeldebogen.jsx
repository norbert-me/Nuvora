// Rückmeldebogen zu einer Klassenarbeit — ein Blatt je Kind.
//
// Die Auswertung sagt der Lehrkraft, wo es klemmt. Dem Kind sagt sie bisher
// gar nichts: es bekommt eine Note und eine Arbeit mit roten Strichen zurück,
// und die Frage „was üb ich jetzt eigentlich?" beantwortet niemand. Genau das
// steht hier — aus Daten, die längst erfasst sind, ohne eine einzige zusätzliche
// Eingabe.
//
// Drei Regeln, die nicht aufweichen dürfen:
//
//   • KEIN Vergleich mit der Klasse. Kein Rang, kein Schnitt, kein fremder
//     Name. Das Blatt wird ausgeteilt und liegt danach auf einem Küchentisch.
//   • Nur was sass und was fehlt — nicht jedes Thema. Ein Blatt, auf dem alle
//     zwölf Themen kommentiert sind, liest niemand zu Ende.
//   • Kein Urteil über das Kind. „Ansatz" heisst „nochmal erklären lassen",
//     nicht „hat es nicht verstanden".
//
// Gedruckt wird ohne zweites Fenster (das blockt jeder zweite Browser weg):
// die Bogen hängen per Portal direkt am <body>, NEBEN der Anwendung statt in
// ihr. Am Bildschirm sind sie aus, beim Drucken verschwindet dafür #root
// (siehe Druck-CSS in index.html). Lägen sie im Seitenbaum, müsste der Rest
// per visibility versteckt werden — und versteckte Elemente belegen ihren
// Platz weiter, weshalb der Drucker leere Seiten zählte und Blätter mitten
// im Kind umbrach.
import { useState } from "react";
import { createPortal } from "react-dom";

import { COLORS as C, CONTROL_R, Icon, ICONS, Modal, Segment, Toggle, btnPrimary, btnSecondary, segmentBtn } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import Latex from "./Latex.jsx";

// Feste Papierfarben statt Theme-Variablen: das Blatt geht auf Papier, und im
// dunklen Design wäre es am Bildschirm richtig und im Drucker unlesbar.
// Dieselbe Überlegung wie beim Kartendruck in Karten.jsx.
const PAPIER = { background: "#fff", color: "#111" };

// Was auf das Blatt kommt, ist je Anlass verschieden: nach der Arbeit die
// Rückmeldung mit Note und Unterschrift, für die Wiederholung nur die
// Aufgaben. Bausteine statt fester Fassungen — die Vorlagen setzen nur
// Häkchen, jedes lässt sich danach einzeln umlegen.
export const BOGEN_TEILE = ["note", "themen", "rat", "wdh", "notiz", "unterschrift"];
export const BOGEN_VORLAGEN = {
  wdh: ["wdh"],
  rueckmeldung: ["note", "themen", "rat", "notiz", "unterschrift"],
  alles: BOGEN_TEILE,
};
const ALTE_TEILE = BOGEN_VORLAGEN.rueckmeldung;
const SPEICHER = "nuvora_bogen_teile";

// Die zuletzt gewählten Bausteine — eine Bequemlichkeit dieses Geräts.
export function gemerkteTeile() {
  try {
    const x = JSON.parse(localStorage.getItem(SPEICHER) || "null");
    if (Array.isArray(x)) return x.filter((k) => BOGEN_TEILE.includes(k));
  } catch { /* leer oder gesperrt */ }
  return BOGEN_VORLAGEN.alles;
}

export function BogenWahl({ onDrucken, onClose, mitWdh = true }) {
  const { t } = useLanguage();
  const verfuegbar = BOGEN_TEILE.filter((k) => mitWdh || k !== "wdh");
  const [teile, setTeile] = useState(() => gemerkteTeile().filter((k) => verfuegbar.includes(k)));
  const vorlage = Object.keys(BOGEN_VORLAGEN).find((v) => {
    const a = BOGEN_VORLAGEN[v].filter((k) => verfuegbar.includes(k));
    return a.length === teile.length && a.every((k) => teile.includes(k));
  });
  const drucken = () => {
    try { localStorage.setItem(SPEICHER, JSON.stringify(teile)); } catch { /* egal */ }
    onDrucken(teile);
  };
  return (
    <Modal onClose={onClose} title={t("bogen.wahlTitel")} width={420}>
      {mitWdh && (
        <Segment style={{ marginBottom: 16 }}>
          {Object.keys(BOGEN_VORLAGEN).map((v) => (
            <button key={v} onClick={() => setTeile(BOGEN_VORLAGEN[v].filter((k) => verfuegbar.includes(k)))} aria-pressed={vorlage === v}
              style={{ ...segmentBtn, fontWeight: vorlage === v ? 700 : 500, color: vorlage === v ? "var(--accent)" : "var(--text2)" }}>
              {t(`bogen.vorlage.${v}`)}
            </button>
          ))}
        </Segment>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {verfuegbar.map((k) => (
          <Toggle key={k} checked={teile.includes(k)} label={t(`bogen.teil.${k}`)}
            onChange={(an) => setTeile((l) => (an ? BOGEN_TEILE.filter((x) => x === k || l.includes(x)) : l.filter((x) => x !== k)))} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
        <button onClick={onClose} style={btnSecondary}>{t("common.cancel")}</button>
        <button onClick={drucken} disabled={!teile.length} style={{ ...btnPrimary, opacity: teile.length ? 1 : 0.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon d={ICONS.print} size={15} /> {t("bogen.drucken")}
        </button>
      </div>
    </Modal>
  );
}

export default function Rueckmeldebogen({ titel, bogen, fehlerLabel, kartenAktiv, lernpfadAktiv, teile = ALTE_TEILE }) {
  const an = (k) => teile.includes(k);
  const { t } = useLanguage();
  if (!bogen || !bogen.length) return null;
  // fehlerLabel gibt es nur bei der Klassenarbeit (dort werden Fehlerarten
  // erfasst). Beim Quiz fehlt es — dann bleibt der Satz dazu einfach weg.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="druck-huelle" style={PAPIER}>
      {bogen.map((b) => (
        <div key={b.student_id} className="druck-seite" style={{ ...PAPIER, padding: "24px 28px", maxWidth: 720 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, borderBottom: "2px solid #111", paddingBottom: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 22, fontWeight: 800 }}>{b.name}</span>
            <span style={{ fontSize: 13, color: "#444" }}>{titel || t("klassenarbeit.title")}</span>
          </div>

          {/* Die Zahl steht oben und klein: sie ist das, was ohnehin jeder
              zuerst sucht — und das Unwichtigste auf diesem Blatt. */}
          {an("note") && (
          <div style={{ fontSize: 14, marginBottom: 20 }}>
            {t("bogen.punkte", { p: b.punkte, max: b.max })}
            {b.note ? <> · <strong>{t("bogen.note", { n: b.note })}</strong></> : null}
          </div>
          )}

          {an("themen") && (<>
          {b.sass.length > 0 && (
            <Abschnitt titel={t("bogen.sass")} farbe={C.success} icon={ICONS.check}>
              {b.sass.map((x) => (
                <li key={x.label} style={zeile}>{x.label} <span style={klein}>({x.erreicht} / {x.max})</span></li>
              ))}
            </Abschnitt>
          )}

          {b.offen.length > 0 ? (
            <Abschnitt titel={t("bogen.offen")} farbe={C.danger} icon={ICONS.bulb}>
              {b.offen.map((x) => (
                <li key={x.label} style={zeile}>{x.label} <span style={klein}>({x.erreicht} / {x.max})</span></li>
              ))}
            </Abschnitt>
          ) : (
            <p style={{ fontSize: 14, marginBottom: 20 }}>{t("bogen.nichtsOffen")}</p>
          )}
          </>)}

          {/* Die häufigste Fehlerart als SATZ, nicht als Etikett: aus „Ansatz"
              folgt etwas anderes als aus „Flüchtigkeit", und genau dieser
              Unterschied ist der Grund, warum sie überhaupt erfasst wird. */}
          {an("rat") && b.haupt && fehlerLabel && (
            <p style={{ fontSize: 14, background: "#f2f2f2", borderRadius: CONTROL_R, padding: "10px 12px", marginBottom: 20 }}>
              <strong>{fehlerLabel(b.haupt)}:</strong> {t(`bogen.rat.${b.haupt}`)}
            </p>
          )}

          {an("rat") && b.offen.length > 0 && (kartenAktiv || lernpfadAktiv) && (
            <p style={{ fontSize: 14, marginBottom: 20 }}>
              {kartenAktiv ? t("bogen.naechstesKarten") : t("bogen.naechstesLernpfad")}
            </p>
          )}

          {/* Wiederholung: je schwachem Thema eine andere Aufgabe zum selben
              Thema aus dem Lernpfad (siehe wdhZuteilen in Klassenarbeit.jsx).
              Ohne passende Aufgabe steht die Original-Aufgabe als Verweis da.
              Die Nummer (#…) ist für die Lehrkraft: sie findet damit die
              Lösung im Lernpfad. Abgabetermin per Hand. */}
          {an("wdh") && b.wdhAufgaben && (
            b.wdhAufgaben.length ? (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                  <Icon d={ICONS.restore} size={15} color={C.warning} /> {t("bogen.wdh")}
                </div>
                <ol style={{ margin: 0, paddingLeft: 22 }}>
                  {b.wdhAufgaben.map((x, i) => (
                    <li key={i} style={{ fontSize: 14, marginBottom: 12, breakInside: "avoid" }}>
                      <div style={{ ...klein, marginBottom: 2 }}>
                        {x.thema}{x.ex && x.ex.code ? ` · ${x.ex.code}` : ""}
                      </div>
                      {x.ex
                        ? <div style={{ whiteSpace: "pre-wrap" }}><Latex>{x.ex.text}</Latex></div>
                        : <div>{t("bogen.aufgabe", { n: x.statt.label })} <span style={klein}>{t("bogen.wdhOriginal")}</span></div>}
                    </li>
                  ))}
                </ol>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 14, fontSize: 13 }}>
                  {t("bogen.wdhBis")} <span style={{ borderBottom: "1px solid #999", width: 140, height: 18 }} />
                </div>
              </div>
            ) : <p style={{ fontSize: 14, marginBottom: 20 }}>{t("bogen.wdhKeine")}</p>
          )}

          {/* Zwei Zeilen für die Hand: eine Rückmeldung ohne Platz für den
              einen Satz, den nur diese Lehrkraft schreiben kann, ist ein
              Serienbrief. */}
          {an("notiz") && <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, color: "#444", marginBottom: 10 }}>{t("bogen.notiz")}</div>
            <div style={{ borderBottom: "1px solid #999", height: 22 }} />
            <div style={{ borderBottom: "1px solid #999", height: 22 }} />
          </div>}

          {/* Kenntnisnahme: das Blatt geht nach Hause und kommt zurueck. Ohne
              Linie schreibt die Unterschrift jemand quer ueber die Notiz — und
              die Lehrkraft sieht spaeter nicht, ob es je jemand gelesen hat.
              Datum daneben, weil „unterschrieben" ohne Tag nichts belegt. */}
          {an("unterschrift") && <div style={{ marginTop: 28, display: "flex", gap: 24, alignItems: "flex-end" }}>
            <div style={{ width: 120 }}>
              <div style={{ borderBottom: "1px solid #999", height: 22 }} />
              <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>{t("bogen.datum")}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ borderBottom: "1px solid #999", height: 22 }} />
              <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>{t("bogen.unterschrift")}</div>
            </div>
          </div>}
        </div>
      ))}
    </div>,
    document.body,
  );
}

function Abschnitt({ titel, farbe, icon, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
        <Icon d={icon} size={15} color={farbe} /> {titel}
      </div>
      <ul style={{ margin: 0, paddingLeft: 22 }}>{children}</ul>
    </div>
  );
}

const zeile = { fontSize: 14, marginBottom: 4 };
const klein = { fontSize: 12, color: "#555" };
