// Einheitliche Auswahl: erst Kurs, dann — nur wenn der Kurs mehrere Fach-Klassen
// hat — das Fach. Gibt weiterhin eine class_id nach außen (Backend unverändert),
// die Oberfläche denkt aber in Kursen. Bei 1 Klasse/Kurs nur ein Feld.
import { useEffect, useState } from "react";
import { selectStyle } from "./Icons.jsx";

export default function KursKlasseSelect({ value, onChange, style }) {
  const [groups, setGroups] = useState([]); // [{ id, name, classes:[{id,name}] }]

  useEffect(() => {
    fetch("/api/kurse")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        // Nur Sharing-Klassen je Kurs; Kurse ohne Klassen weglassen.
        const g = (Array.isArray(d) ? d : [])
          .map((k) => ({ id: k.id, name: k.name, classes: (k.classes || []).filter((c) => c.shared) }))
          .filter((x) => x.classes.length);
        setGroups(g);
      })
      .catch(() => {});
  }, []);

  const cur = groups.find((g) => g.classes.some((c) => c.id === value));
  const s = { ...selectStyle, ...style };

  const pickKurs = (kid) => {
    const g = groups.find((x) => x.id === Number(kid));
    if (g && !g.classes.some((c) => c.id === value)) onChange(g.classes[0].id);
  };

  if (!groups.length) return null;

  return (
    <>
      <select value={cur?.id ?? ""} onChange={(e) => pickKurs(e.target.value)} style={s}>
        {!cur && <option value="">–</option>}
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      {cur && cur.classes.length > 1 && (
        <select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} style={s}>
          {cur.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
    </>
  );
}
