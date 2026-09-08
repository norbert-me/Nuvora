import { chromium } from "playwright";
import { zugang, anmeldungHinterlegen, tourWegklicken, TOUR_TAKT_KNAPP } from "./browser-gemeinsam.mjs";
const { basis, email, passwort } = zugang();
const browser = await chromium.launch();
const kontext = await browser.newContext({ baseURL: basis, locale:"de-DE", viewport:{width:1280,height:900} });
const login = await kontext.request.post("/api/auth/login",{data:{email,password:passwort}});
const {token,user}=await login.json();
await anmeldungHinterlegen(kontext, token, user, { modulCacheLeeren:true, extra:{cardvote_lang:"de"} });
const seite = await kontext.newPage();
await seite.goto("/tafel",{waitUntil:"networkidle"});
await tourWegklicken(seite, TOUR_TAKT_KNAPP);
for (let i=0;i<12;i++){
  const b = await seite.evaluate(() => { const d=[...document.querySelectorAll("div")].find(x=>x.style.transform&&x.style.transform.startsWith("scale")); return d? d.style.transform : "?"; });
  console.log(i, b);
  await seite.waitForTimeout(500);
}
await browser.close();
