// Springt die Startseite beim Laden? Misst Layout-Verschiebungen (CLS) bei erstem und zweitem Besuch.
//   node scripts/bench-start.mjs   (lokaler Aufbau wie bench-noten.mjs)
import { chromium } from "playwright";
const r = await fetch("http://localhost:8000/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "bench@schule.de", password: "benchmark-passwort-123" }) });
const { token, user } = await r.json();
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(([t, u]) => {
  if (!localStorage.getItem("token")) {
    localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u));
    localStorage.setItem("nuvora_kerntour_done", "1"); localStorage.setItem("cardvote_lang", "de"); localStorage.setItem(`nuvora_onboarded_${u.id}`, "1");
  }
}, [token, user]);
async function besuch(name, drossel) {
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 250, downloadThroughput: 500000, uploadThroughput: 500000 });
  await p.addInitScript(() => {
    window.__cls = 0; window.__shifts = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push(+e.value.toFixed(4)); window.__quellen = (window.__quellen || []).concat((e.sources || []).map((q) => `${q.node ? (q.node.nodeName + ' ' + (q.node.textContent || '').slice(0, 40).replace(/\s+/g, ' ')) : '?'} ${Math.round(q.previousRect.y)}->${Math.round(q.currentRect.y)} h${Math.round(q.previousRect.height)}->${Math.round(q.currentRect.height)}`)); } })
      .observe({ type: "layout-shift", buffered: true });
  });
  await p.goto("http://localhost:5173/");
  await p.waitForTimeout(6000);
  const cls = await p.evaluate(() => ({ cls: +window.__cls.toFixed(4), n: window.__shifts.length, shifts: window.__shifts.slice(0, 8), quellen: (window.__quellen || []).slice(0, 8) }));
  console.log(name, JSON.stringify(cls, null, 1));
  await p.close();
}
await besuch("erster Besuch ");
await besuch("zweiter Besuch");
await b.close();
