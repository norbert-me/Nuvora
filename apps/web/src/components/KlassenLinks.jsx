// Zweiter Weg durch Nuvora: nicht über die Module, sondern über die Klasse.
// „Was habe ich zu dieser Klasse?" — Noten, Sitzplan, Anwesenheit, Karten … an
// einer Stelle. Der erste Weg (Modul wählen, dann Klasse) bleibt unberührt.
//
// Regel 3: es erscheint nur, was die Lehrkraft aktiviert hat. Ohne Modul kein
// Kachel — der Kern wirbt nicht für Module.
//
// Die Zielseiten merken sich die zuletzt gewählte Klasse (core/cache.js). Statt
// jede Seite um einen eigenen Parameter zu erweitern, wird die Klasse vor dem
// Sprung gemerkt; wo eine Seite zusätzlich ?class= liest (Karten), steht es dran.
import { Link } from "react-router-dom";
import { Icon, ICONS, COLORS as C } from "./Icons.jsx";
import { rememberClass } from "../core/cache.js";
import { useModules } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";

export default function KlassenLinks({ classId, kursId = null, title }) {
  const { t } = useLanguage();
  const { modules } = useModules();
  const an = (key) => modules.find((m) => m.key === key)?.active ?? false;
  if (!classId) return null;

  const kq = kursId ? `&kurs=${kursId}` : "";
  const ziele = [
    an("auswertung") && { to: "/auswertung?tab=noten", icon: ICONS.chart, label: t("klassenLinks.noten") },
    an("auswertung") && { to: "/auswertung?tab=klassenarbeit", icon: ICONS.chart, label: t("klassenLinks.klassenarbeit") },
    an("orga") && { to: "/orga?tab=anwesenheit", icon: ICONS.circle, label: t("anwesenheit.title") },
    an("orga") && { to: "/orga?tab=sitzplan", icon: ICONS.grip, label: t("sitzplan.title") },
    an("orga") && { to: "/orga?tab=ausleihe", icon: ICONS.archive, label: t("ausleihe.title") },
    an("karten") && { to: `/karten?tab=cards&class=${classId}${kq}`, icon: ICONS.duplicate, label: t("klassenLinks.karten") },
    an("cardvote") && { to: `/cardvote/class-evaluation/${classId}`, icon: ICONS.chart, label: t("klassenLinks.cardvote") },
    an("klassenleitung") && { to: "/klassenleitung", icon: ICONS.note, label: t("klassenLinks.klassenleitung") },
    an("lernpfad") && { to: "/lernpfad", icon: ICONS.open, label: t("klassenLinks.lernpfad") },
    an("zufall") && { to: "/zufall", icon: ICONS.shuffle, label: t("klassenLinks.zufall") },
  ].filter(Boolean);

  if (ziele.length === 0) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text3)", marginBottom: 7 }}>
        {title || t("klassenLinks.title")}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
        {ziele.map((z) => (
          <Link
            key={z.to}
            to={z.to}
            onClick={() => rememberClass(classId)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px",
              borderRadius: 980, border: "1px solid var(--border2)", background: "var(--bg)",
              color: "var(--text2)", textDecoration: "none", fontSize: 13, fontWeight: 500,
            }}
          >
            <Icon d={z.icon || ICONS.open} size={14} color={C.info} />
            {z.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
