// Zweiter Weg durch Nuvora: nicht über die Module, sondern über den Kurs.
// „Was habe ich in Mathe 7.5?" — Notenbuch, Klassenarbeit, Karten, Sitzplan …
// an einer Stelle. Der erste Weg (Modul wählen, dann Klasse) bleibt unberührt.
//
// Bewusst am KURS und nicht an der Klasse: die Klasse sind die Schüler, der
// Kurs ist das Fach — und fachlich ist alles, was hier verlinkt wird. Die
// Klassenseite bleibt reine Schülerverwaltung.
//
// Regel 3: es erscheint nur, was die Lehrkraft aktiviert hat — der Kern wirbt
// nicht für Module.
//
// Technik: die Modulseiten hängen heute noch an der Fach-Klasse und merken
// sich die zuletzt gewählte (core/cache.js). Der Sprung setzt sie vorher,
// statt jede Seite um einen eigenen Parameter zu erweitern. Hat ein Kurs
// mehrere Fach-Klassen, wählt man oben, für welche der Sprung gilt.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon, ICONS, COLORS as C } from "./Icons.jsx";
import { rememberClass } from "../core/cache.js";
import { useModules } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";

export default function KursLinks({ kurs }) {
  const { t } = useLanguage();
  const { modules } = useModules();
  const klassen = kurs?.classes || [];
  const [classId, setClassId] = useState(klassen[0]?.id ?? null);
  const an = (key) => modules.find((m) => m.key === key)?.active ?? false;
  // Orga bündelt mehrere Reiter; was im Modul-Zahnrad ausgeblendet ist, gehört
  // auch hier nicht hin — sonst führt der Kurs in etwas, das die Lehrkraft
  // abgeschaltet hat (z.B. Ausleihe).
  const lesen = () => { try { return JSON.parse(localStorage.getItem("orga_hidden_tabs") || "[]"); } catch { return []; } };
  const [versteckt, setVersteckt] = useState(lesen);
  useEffect(() => {
    // Das Modul-Zahnrad meldet Änderungen — sonst stimmte die Leiste erst nach
    // einem Neuladen wieder.
    const h = () => setVersteckt(lesen());
    window.addEventListener("nuvora:settings", h);
    return () => window.removeEventListener("nuvora:settings", h);
  }, []);
  const orgaAn = (tab) => an("orga") && !versteckt.includes(tab);
  if (!classId) return null;

  // Klasse und Kurs stehen an JEDEM Link: die Zielseite soll den Inhalt dieses
  // Kurses zeigen, nicht die zuletzt irgendwo gewählte Klasse.
  const q = `class=${classId}${kurs?.id ? `&kurs=${kurs.id}` : ""}`;
  const ziele = [
    an("auswertung") && { to: `/auswertung?tab=noten&${q}`, icon: ICONS.chart, label: t("kursLinks.noten") },
    an("auswertung") && { to: `/auswertung?tab=klassenarbeit&${q}`, icon: ICONS.chart, label: t("kursLinks.klassenarbeit") },
    an("karten") && { to: `/karten?tab=cards&${q}`, icon: ICONS.duplicate, label: t("kursLinks.karten") },
    an("cardvote") && { to: `/cardvote/class-evaluation/${classId}`, icon: ICONS.chart, label: t("kursLinks.cardvote") },
    an("lernpfad") && { to: `/lernpfad?${q}`, icon: ICONS.open, label: t("kursLinks.lernpfad") },
    orgaAn("sitzplan") && { to: `/orga?tab=sitzplan&${q}`, icon: ICONS.grip, label: t("sitzplan.title") },
    orgaAn("anwesenheit") && { to: `/orga?tab=anwesenheit&${q}`, icon: ICONS.circle, label: t("anwesenheit.title") },
    orgaAn("ausleihe") && { to: `/orga?tab=ausleihe&${q}`, icon: ICONS.archive, label: t("ausleihe.title") },
    an("klassenleitung") && { to: `/klassenleitung?${q}`, icon: ICONS.note, label: t("kursLinks.klassenleitung") },
    an("zufall") && { to: `/zufall?${q}`, icon: ICONS.shuffle, label: t("kursLinks.zufall") },
  ].filter(Boolean);

  if (ziele.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 7 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text3)" }}>
          {t("kursLinks.title")}
        </span>
        {/* Mehrere Fach-Klassen im Kurs: für welche gilt der Sprung? */}
        {klassen.length > 1 && klassen.map((c) => (
          <button key={c.id} onClick={() => setClassId(c.id)}
            style={{
              padding: "2px 10px", borderRadius: 980, fontSize: 12, cursor: "pointer",
              border: classId === c.id ? "1px solid var(--accent)" : "1px solid var(--border2)",
              background: classId === c.id ? "var(--accent-bg)" : "var(--bg)",
              color: classId === c.id ? "var(--accent)" : "var(--text2)",
            }}>
            {c.name}
          </button>
        ))}
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
