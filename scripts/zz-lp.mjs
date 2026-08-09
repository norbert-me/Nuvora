import { chromium } from "playwright";
const b = await chromium.launch();
const k = await b.newContext({ baseURL: "http://127.0.0.1:8124", viewport: { width: 1280, height: 900 } });
const r = await k.request.post("/api/auth/login", { data: { email: "selftest@example.com", password: "Selbsttest123" } });
const { token, user } = await r.json();
await k.addInitScript(([t,u])=>{localStorage.setItem("token",t);localStorage.setItem("user",u);localStorage.setItem("cardvote_lang","de");},[token,JSON.stringify(user)]);
const s = await k.newPage();
const fehler = [];
s.on("console", (m) => { if (m.type() === "error") fehler.push("Konsole: "+m.text().slice(0,200)); });
s.on("pageerror", (e) => fehler.push("Absturz: "+String(e).slice(0,200)));
s.on("response", (x) => { if (x.url().includes("/api/")) console.log("  API", x.status(), new URL(x.url()).pathname); });
await s.goto("/lernpfad", { waitUntil: "networkidle" });
for (const nm of [/später|later/i, /überspringen|skip/i]) {
  try { const l = s.getByRole("button", { name: nm }).first(); if (await l.isVisible({timeout:1000})) await l.click(); } catch {}
}
await s.waitForTimeout(4000);
console.log("Konsole:", fehler.length ? fehler : "sauber");
const zeilen = await s.locator("#lp-app table tbody tr").count().catch(()=>-1);
console.log("Tabellenzeilen:", zeilen);
console.log("Text:", (await s.locator("body").innerText()).replace(/\n+/g," | ").slice(0, 500));
await s.screenshot({ path: process.argv[2], fullPage: true });
await b.close();
