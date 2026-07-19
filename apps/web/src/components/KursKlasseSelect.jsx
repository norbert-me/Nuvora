// Einheitliche Auswahl: erst Kurs, dann — nur wenn der Kurs mehrere Fach-Klassen
// hat — das Fach. Gibt weiterhin eine class_id nach außen (Backend unverändert),
// die Oberfläche denkt aber in Kursen. Bei 1 Klasse/Kurs nur ein Feld.
import { useEffect, useState } from "react";
import { selectStyle } from "./Icons.jsx";

// allowNone + noneLabel: erlaubt eine Leer-Option (z.B. „Freitext") — dann kann
// value "" sein und onChange("") gemeldet werden.
export default function KursKlasseSelect({ value, onChange, style, allowNone = false, noneLabel = "–" }) {
  const [groups, setGroups] = useState([]); // [{ id, name, classes:[{id,name}] }]

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

  const cur = groups.find((g) => g.classes.some((c) => c.id === value));
  const s = { ...selectStyle, ...style };

  const pickKurs = (kid) => {
    const g = groups.find((x) => String(x.id) === String(kid));
    if (g && !g.classes.some((c) => c.id === value)) onChange(g.classes[0].id);
  };

  if (!groups.length && !allowNone) return null;

  return (
    <>
      <select value={cur?.id ?? ""} onChange={(e) => (e.target.value === "" ? onChange(allowNone ? "" : value) : pickKurs(e.target.value))} style={s}>
        {allowNone ? <option value="">{noneLabel}</option> : (!cur && <option value="">–</option>)}
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name || "—"}</option>)}
      </select>
      {cur && cur.classes.length > 1 && (
        <select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} style={s}>
          {cur.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
    </>
  );
}
