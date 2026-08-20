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
import { createPortal } from "react-dom";

import { COLORS as C, CONTROL_R, Icon, ICONS } from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

// Feste Papierfarben statt Theme-Variablen: das Blatt geht auf Papier, und im
// dunklen Design wäre es am Bildschirm richtig und im Drucker unlesbar.
// Dieselbe Überlegung wie beim Kartendruck in Karten.jsx.
const PAPIER = { background: "#fff", color: "#111" };

export default function Rueckmeldebogen({ work, bogen, fehlerLabel, kartenAktiv, lernpfadAktiv }) {
  const { t } = useLanguage();
  if (!bogen || !bogen.length) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="druck-huelle" style={PAPIER}>
      {bogen.map((b) => (
        <div key={b.student_id} className="druck-seite" style={{ ...PAPIER, padding: "24px 28px", maxWidth: 720 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, borderBottom: "2px solid #111", paddingBottom: 8, marginBottom: 16 }}>
            <span style={{ fontSize: 22, fontWeight: 800 }}>{b.name}</span>
            <span style={{ fontSize: 13, color: "#444" }}>{work.name || t("klassenarbeit.title")}</span>
          </div>

          {/* Die Zahl steht oben und klein: sie ist das, was ohnehin jeder
              zuerst sucht — und das Unwichtigste auf diesem Blatt. */}
          <div style={{ fontSize: 14, marginBottom: 20 }}>
            {t("bogen.punkte", { p: b.punkte, max: b.max })}
            {b.note ? <> · <strong>{t("bogen.note", { n: b.note })}</strong></> : null}
          </div>

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

          {/* Die häufigste Fehlerart als SATZ, nicht als Etikett: aus „Ansatz"
              folgt etwas anderes als aus „Flüchtigkeit", und genau dieser
              Unterschied ist der Grund, warum sie überhaupt erfasst wird. */}
          {b.haupt && (
            <p style={{ fontSize: 14, background: "#f2f2f2", borderRadius: CONTROL_R, padding: "10px 12px", marginBottom: 20 }}>
              <strong>{fehlerLabel(b.haupt)}:</strong> {t(`bogen.rat.${b.haupt}`)}
            </p>
          )}

          {b.offen.length > 0 && (kartenAktiv || lernpfadAktiv) && (
            <p style={{ fontSize: 14, marginBottom: 20 }}>
              {kartenAktiv ? t("bogen.naechstesKarten") : t("bogen.naechstesLernpfad")}
            </p>
          )}

          {/* Zwei Zeilen für die Hand: eine Rückmeldung ohne Platz für den
              einen Satz, den nur diese Lehrkraft schreiben kann, ist ein
              Serienbrief. */}
          <div style={{ marginTop: 24 }}>
            <div style={{ fontSize: 12, color: "#444", marginBottom: 10 }}>{t("bogen.notiz")}</div>
            <div style={{ borderBottom: "1px solid #999", height: 22 }} />
            <div style={{ borderBottom: "1px solid #999", height: 22 }} />
          </div>
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
