import { chromium } from "playwright";
const b = await chromium.launch();
const k = await b.newContext({ baseURL: "http://127.0.0.1:8124", viewport: { width: 1280, height: 900 } });
const r = await k.request.post("/api/auth/login", { data: { email: "selftest@example.com", password: "Selbsttest123" } });
const { token, user } = await r.json();
await k.addInitScript(([t,u])=>{localStorage.setItem("token",t);localStorage.setItem("user",u);localStorage.setItem("cardvote_lang","de");},[token,JSON.stringify(user)]);
const s = await k.newPage();
const anfragen = [];
s.on("response", (x) => { if (x.url().includes("/api/")) anfragen.push(`${x.status()} ${new URL(x.url()).pathname}${new URL(x.url()).search}`); });
await s.goto(process.argv[2] || "/auswertung", { waitUntil: "networkidle" });
for (const name of [/überspringen|skip|saltar/i, /später|later/i]) {
  try { const bt = s.getByRole("button", { name }).first(); if (await bt.isVisible({ timeout: 800 })) await bt.click(); } catch {}
}
await s.waitForTimeout(1500);
console.log("API-Aufrufe:\n " + anfragen.join("\n "));
console.log("\nText:", (await s.locator("body").innerText()).slice(0, 400).replace(/\n+/g, " | "));
await s.screenshot({ path: process.argv[3] || "/tmp/probe.png", fullPage: true });
await b.close();
