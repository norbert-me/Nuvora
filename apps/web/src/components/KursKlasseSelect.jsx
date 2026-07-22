// Einheitliche Auswahl: erst Kurs, dann — nur wenn der Kurs mehrere Fach-Klassen
// hat — das Fach. Gibt weiterhin eine class_id nach außen (Backend unverändert),
// die Oberfläche denkt aber in Kursen. Bei 1 Klasse/Kurs nur ein Feld.
import { useEffect, useState } from "react";
import { selectStyle } from "./Icons.jsx";

// allowNone + noneLabel: erlaubt eine Leer-Option (z.B. „Freitext") — dann kann
// value "" sein und onChange("") gemeldet werden.
// autoFocus: erstes Feld beim Einblenden fokussieren (natives autoFocus, ohne
// showPicker — das warf je nach Browser/fehlender Nutzergeste und wirkte kaputt).
export default function KursKlasseSelect({ value, kursValue = null, onChange, onKurs, style, allowNone = false, noneLabel = "–", autoFocus = false }) {
  const [groups, setGroups] = useState([]); // [{ id, name, classes:[{id,name}] }]
  // Der gewählte Kurs wird EXPLIZIT gehalten, nicht aus value abgeleitet: eine
  // Klasse kann in mehreren Kursen liegen (many-to-many). Würde man den Kurs aus
  // value (class_id) raten, spränge die Auswahl beim Klick auf einen anderen
  // Kurs mit derselben ersten Klasse zurück.
  const [kursId, setKursId] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/kurse").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([kurse, classes]) => {
      const g = (Array.isArray(kurse) ? kurse : [])
        .map((k) => ({ id: k.id, name: k.name, classes: k.classes || [] }))
        .filter((x) => x.classes.length);
      // Klassen ohne Kurs unter „Ohne Kurs" ergänzen, damit jede wählbar bleibt.
      const drin = new Set(g.flatMap((x) => x.classes.map((c) => c.id)));
      const rest = (Array.isArray(classes) ? classes : []).filter((c) => !drin.has(c.id));
      if (rest.length) g.push({ id: "none", name: null, classes: rest.map((c) => ({ id: c.id, name: c.name })) });
      setGroups(g);
    });
  }, []);

  // Kurs-Auswahl mit value abgleichen: nur neu ableiten, wenn der aktuell
  // gewählte Kurs die value-Klasse NICHT (mehr) enthält (Erstladen oder value
  // wurde von außen auf eine fremde Klasse gesetzt). Sonst den Kurs stehen
  // lassen — sonst überschriebe das Ableiten die gerade getroffene Wahl.
  useEffect(() => {
    if (!groups.length) return;
    const cur = groups.find((g) => String(g.id) === String(kursId));
    if (cur && cur.classes.some((c) => c.id === value)) return; // Wahl gilt weiter
    // Gespeicherten Kurs bevorzugen (kursValue): eine Klasse kann in mehreren
    // Kursen liegen — ohne diesen Hinweis riete das Ableiten den ERSTEN Kurs und
    // ueberschriebe die gespeicherte Wahl (z.B. „mathe 7.5" zurueck auf „lz 7.5").
    const preferred = kursValue != null
      ? groups.find((x) => String(x.id) === String(kursValue) && x.classes.some((c) => c.id === value))
      : null;
    const g = preferred || groups.find((x) => x.classes.some((c) => c.id === value));
    // Ohne Treffer: nur beim Erstladen (kursId noch null) und nur wenn keine
    // Leer-Option erlaubt ist auf den ersten Kurs fallen; sonst Wahl belassen.
    setKursId(g ? String(g.id) : (kursId == null && groups.length && !allowNone ? String(groups[0].id) : kursId));
  }, [groups, value, kursValue]); // eslint-disable-line

  const cur = groups.find((g) => String(g.id) === String(kursId));
  const s = { ...selectStyle, ...style };

  const pickKurs = (kid) => {
    setKursId(kid);
    const g = groups.find((x) => String(x.id) === String(kid));
    // Beim Kurswechsel immer die erste Fach-Klasse des Kurses melden — außer die
    // aktuelle value gehört ohnehin schon zu diesem Kurs.
    const kursNum = kid === "none" ? null : Number(kid);
    if (g && !g.classes.some((c) => c.id === value)) onChange(g.classes[0].id, kursNum);
  };

  // Zweites Argument von onChange ist die Kurs-id (oder null bei „Ohne Kurs"):
  // Module, deren Inhalt am Kurs hängt (Sitzplan, …), speichern darüber.
  const curKurs = cur && cur.id !== "none" ? Number(cur.id) : null;
  // Auch ohne Klick den aktuellen Kurs melden (Erstladen), damit z.B. der
  // Sitzplan gleich den kursweiten Datensatz lädt, nicht den Klassen-Fallback.
  useEffect(() => { if (onKurs) onKurs(curKurs); }, [curKurs]); // eslint-disable-line

  if (!groups.length && !allowNone) return null;

  return (
    <>
      <select autoFocus={autoFocus} value={cur ? String(cur.id) : ""} onChange={(e) => (e.target.value === "" ? onChange(allowNone ? "" : value, null) : pickKurs(e.target.value))} style={s}>
        {allowNone ? <option value="">{noneLabel}</option> : (!cur && <option value="">–</option>)}
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name || "—"}</option>)}
      </select>
      {cur && cur.classes.length > 1 && (
        <select value={cur.classes.some((c) => c.id === value) ? String(value) : ""} onChange={(e) => onChange(Number(e.target.value), curKurs)} style={s}>
          {!cur.classes.some((c) => c.id === value) && <option value="">–</option>}
          {cur.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
    </>
  );
}
