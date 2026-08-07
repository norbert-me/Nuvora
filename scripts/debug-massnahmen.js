// Diagnose: warum zeigt der Klassenarbeitstermin keine Nachteilsausgleiche?
// In der laufenden Instanz einfügen (eingeloggt, F12 → Konsole).
// Gibt nur Struktur und IDs aus — Namen werden gekürzt, keine Notizen.
(async () => {
  const j = async (u) => { const r = await fetch(u); return r.ok ? r.json() : { _status: r.status }; };
  const kurz = (n) => (n || "").split(" ")[0];

  const kurse = await j("/api/kurse");
  const klassen = await j("/api/classes");

  console.log("=== KURSE ===");
  (kurse || []).forEach((k) => console.log(`  kurs_id=${k.id} "${k.name}" klassen=[${(k.classes || []).map((c) => `${c.id}:${c.name}`).join(", ")}]`));

  console.log("=== KLASSEN / SuS mit Maßnahmen (roh aus der DB) ===");
  (klassen || []).forEach((c) => {
    console.log(`  class_id=${c.id} "${c.name}" kurs_id=${c.kurs_id}`);
    (c.students || []).forEach((s) => {
      if (s.massnahmen && s.massnahmen.length) {
        console.log(`      ${kurz(s.name)} →`, JSON.stringify(s.massnahmen));
      }
    });
  });

  console.log("=== KLASSENARBEITSTERMINE ===");
  const exams = await j("/api/kalender/klassenarbeiten/uebersicht");
  (exams || []).forEach((e) => console.log(`  exam_id=${e.id} class_id=${e.class_id} kurs_id=${e.kurs_id} work_id=${e.work_id} "${e.title || ""}"`));

  console.log("=== WAS DER KALENDER ABFRAGT ===");
  for (const e of exams || []) {
    if (!e.class_id) continue;
    const mitKurs = await j(`/api/classes/${e.class_id}/massnahmen?arbeit=true${e.kurs_id ? `&kurs_id=${e.kurs_id}` : ""}`);
    const ohneKurs = await j(`/api/classes/${e.class_id}/massnahmen?arbeit=true`);
    console.log(`  exam ${e.id}: mit kurs_id=${e.kurs_id} → ${JSON.stringify(mitKurs)}`);
    console.log(`             ohne Kursfilter      → ${JSON.stringify(ohneKurs)}`);
  }

  console.log("=== WAS DAS KURS-PANEL LIEFERT ===");
  for (const k of kurse || []) {
    const m = await j(`/api/kurse/${k.id}/massnahmen`);
    const mit = (m || []).filter((x) => (x.massnahmen || []).length);
    console.log(`  kurs ${k.id} "${k.name}": ${Array.isArray(m) ? m.length : "FEHLER"} SuS, davon mit Maßnahme:`, JSON.stringify(mit));
  }
})();
