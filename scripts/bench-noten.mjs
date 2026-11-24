// Messung der Notenseite (lokaler Aufbau: API :8000 mit Messdaten, Vite :5173).
//   node scripts/bench-noten.mjs [--drossel 4] [--schnappschuss datei.html]
// Misst: erster Aufbau, Klick auf eine Zelle, Eintragen mit Enter (Kind fuer Kind),
// Scrollen (Bildabstaende). Der Schnappschuss der Tabelle erlaubt den Vergleich vorher/nachher.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DROSSEL = Number(arg("--drossel", 4));
const SNAP = arg("--schnappschuss", "");
const BASIS = "http://localhost:5173";

const r = await fetch("http://localhost:8000/api/auth/login", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "bench@schule.de", password: "benchmark-passwort-123" }),
});
const { access_token, token, user } = await r.json();
const tok = access_token || token;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([t, u]) => {
  localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u));
  localStorage.setItem("nuvora_kerntour_done", "1"); localStorage.setItem("nuvora_tour_noten_done", "1"); localStorage.setItem("cardvote_lang", "de"); localStorage.setItem(`nuvora_onboarded_${u.id}`, "1");
}, [tok, user]);
const page = await ctx.newPage();
const fehler = [];
page.on("pageerror", (e) => fehler.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") fehler.push(m.text()); });
const cdp = await ctx.newCDPSession(page);
if (DROSSEL > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: DROSSEL });

const t0 = Date.now();
await page.goto(`${BASIS}/auswertung?tab=noten`);
await page.waitForSelector("table tbody tr td button", { timeout: 60000 });
const aufbau = Date.now() - t0;
await page.waitForTimeout(800);

const zellen = await page.locator("table tbody tr").count();
const knoten = await page.evaluate(() => document.querySelectorAll("table *").length);

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// Klick auf eine Zelle -> Eingabefeld da
const PROFIL = process.argv.includes("--profil");
if (PROFIL) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
const klick = [];
for (let i = 0; i < 8; i++) {
  const zelle = page.locator("table tbody tr").nth(i + 2).locator("td").nth(3 + i).locator("button").first();
  const t = Date.now();
  await zelle.click();
  await page.waitForSelector("table tbody input", { timeout: 10000 });
  klick.push(Date.now() - t);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
}

// Eintragen: Wert + Enter, Kind fuer Kind (eine Spalte abarbeiten)
const eintrag = [];
await page.locator("table tbody tr").nth(0).locator("td").nth(4).locator("button").first().click();
await page.waitForSelector("table tbody input");
for (let i = 0; i < 12; i++) {
  const t = Date.now();
  await page.keyboard.type(String(1 + (i % 5)));
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === "INPUT", null, { timeout: 10000 });
  eintrag.push(Date.now() - t);
}
// Pause: das Auto-Speichern schreibt und laedt neu. Direkt danach weitertippen —
// wie ein Mensch, der kurz aufgeschaut hat. Der Neuaufbau nach dem Speichern darf den
// naechsten Griff nicht ausbremsen.
await page.waitForTimeout(2500);
const nach = [];
for (let i = 0; i < 4; i++) {
  const t = Date.now();
  await page.keyboard.type("3");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === "INPUT", null, { timeout: 10000 });
  nach.push(Date.now() - t);
}
await page.keyboard.press("Escape");
await page.waitForTimeout(2500);

if (PROFIL) {
  const { profile } = await cdp.send("Profiler.stop");
  const selbst = new Map();
  const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const n = byId.get(id); const cf = n.callFrame;
    const k = `${cf.functionName || "(anonym)"} ${cf.url.split("/").slice(-2).join("/")}:${cf.lineNumber}`;
    selbst.set(k, (selbst.get(k) || 0) + (dt[i] || 0));
  });
  const top = [...selbst.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  console.log("PROFIL (Selbstzeit, ms, ueber Klicks+Eintraege):");
  for (const [k, v] of top) console.log(String(Math.round(v / 1000)).padStart(7), k);
}
// Scrollen: Bildabstaende beim waagerechten und senkrechten Durchlauf
const scroll = await page.evaluate(async () => {
  const box = document.querySelector(".schiene-sichtbar");
  const deltas = [];
  let last = performance.now();
  const frame = () => new Promise((res) => requestAnimationFrame((ts) => { deltas.push(ts - last); last = ts; res(); }));
  for (let i = 0; i < 60; i++) { box.scrollLeft += 40; await frame(); }
  for (let i = 0; i < 60; i++) { box.scrollLeft -= 40; await frame(); }
  for (let i = 0; i < 40; i++) { box.scrollTop += 12; await frame(); }
  deltas.shift();
  deltas.sort((a, b) => a - b);
  const sum = deltas.reduce((a, b) => a + b, 0);
  return { mittel: sum / deltas.length, p95: deltas[Math.floor(deltas.length * 0.95)], max: deltas[deltas.length - 1] };
});

if (SNAP) {
  const html = await page.evaluate(() => document.querySelector("table").outerHTML);
  writeFileSync(SNAP, html);
  console.log("Schnappschuss", createHash("sha1").update(html).digest("hex").slice(0, 12), `${html.length} Zeichen`);
}
console.log(JSON.stringify({
  drossel: DROSSEL, aufbau_ms: aufbau, zeilen: zellen, dom_knoten: knoten,
  klick_median_ms: median(klick), klick_alle: klick,
  eintrag_median_ms: median(eintrag), eintrag_alle: eintrag,
  nach_speichern_ms: nach,
  scroll_mittel_ms: +scroll.mittel.toFixed(1), scroll_p95_ms: +scroll.p95.toFixed(1), scroll_max_ms: +scroll.max.toFixed(1),
  fehler: fehler.slice(0, 3),
}, null, 1));
await browser.close();
