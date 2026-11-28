// Fehlersuche in der Entwicklerkonsole der Lehrkraft (Wunsch des Nutzers, 28.11.2026: „mach eine Option
// fuers Debuggen in der Entwicklerkonsole, dann kann ich dir darueber die Infos geben").
//
//   nuvoraDebug.karten("Jesus")      — auf der Seite „QR-Zugaenge": warum sieht dieses Kind welchen Stapel?
//   nuvoraDebug.karten("<Token>")    — dasselbe mit dem Zugangs-Token (letzter Teil der /lernen/-Adresse)
//
// Die Antwort kommt vom Server (GET /api/karten/debug/zugang/{token}) und rechnet mit denselben Filtern wie
// die Lernseite. Ausgegeben wird als Tabelle plus ein JSON zum Kopieren. Nichts wird veraendert.
const TOKEN = /^[A-Za-z0-9_-]{20,}$/;

function tokenAusSeite(suche) {
  const s = String(suche || "").trim().toLowerCase();
  const links = [...document.querySelectorAll('a[href^="/lernen/"]')];
  const treffer = links.filter((a) => (a.getAttribute("aria-label") || "").toLowerCase().includes(s));
  if (treffer.length === 1) return treffer[0].getAttribute("href").split("/").pop();
  if (treffer.length > 1) throw new Error(`Mehrere Kinder passen zu „${suche}": ${treffer.map((a) => a.getAttribute("aria-label")).join(" | ")}`);
  throw new Error(`Kein Kind „${suche}" auf dieser Seite — Seite „Karteikarten → QR-Zugaenge" oeffnen oder den Token angeben.`);
}

async function karten(nameOderToken) {
  const token = TOKEN.test(String(nameOderToken || "")) ? nameOderToken : tokenAusSeite(nameOderToken);
  const r = await fetch(`/api/karten/debug/zugang/${encodeURIComponent(token)}`);
  if (!r.ok) throw new Error(`Server: ${r.status} ${await r.text().catch(() => "")}`);
  const d = await r.json();
  console.log(`%cKarteikarten-Diagnose: ${d.kind.name} (Niveau ${d.kind.niveau || "ohne"}) · Server ${d.version}`, "font-weight:bold");
  console.log("Kurse des Kindes:");
  console.table(d.kurse);
  console.log("Stapel (sieht_es = bekommt das Kind):");
  console.table(d.stapel.map(({ stapel, sieht_es, grund, zugewiesen, herkunft_kurs, fach, niveau, ausgerollt }) =>
    ({ stapel, sieht_es, grund, zugewiesen: zugewiesen.join(", "), herkunft_kurs, fach, niveau, ausgerollt })));
  console.log("Zum Weitergeben (rechte Maustaste → Objekt kopieren):", d);
  return d;
}

export function debugEinrichten() {
  if (typeof window === "undefined") return;
  window.nuvoraDebug = { karten, hilfe: () => "nuvoraDebug.karten(\"Name oder Token\") — warum sieht ein Kind welche Karteikarten?" };
}
