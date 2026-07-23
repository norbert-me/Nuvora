// Gesetzliche Feiertage je Bundesland, berechnet (kein stale Datensatz).
// Oster-Sonntag via Gauß/Anonymer-Algorithmus; bewegliche Feste relativ dazu.
// Rückgabe: [{ start, end, label }] (jeweils ein Tag, start === end).

function ostersonntag(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);      // 3 = März, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plus = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Bundesland -> Zusatz-Feiertage (über die bundesweiten hinaus).
// h3k=Hl. Drei Könige, fron=Fronleichnam, mhf=Mariä Himmelfahrt, ref=Reformationstag,
// allh=Allerheiligen, bbt=Buß- und Bettag, wkt=Weltkindertag, ift=Frauentag,
// osts=Ostersonntag, pfis=Pfingstsonntag.
const EXTRA = {
  BW: ["h3k", "fron", "allh"],
  BY: ["h3k", "fron", "allh"],           // Mariä Himmelfahrt nur in kath. Gemeinden — weggelassen
  BE: ["ift"],
  BB: ["ref", "osts", "pfis"],
  HB: ["ref"],
  HH: ["ref"],
  HE: ["fron"],
  MV: ["ref", "ift"],
  NI: ["ref"],
  NW: ["fron", "allh"],
  RP: ["fron", "allh"],
  SL: ["fron", "mhf", "allh"],
  SN: ["ref", "bbt"],
  ST: ["h3k", "ref"],
  SH: ["ref"],
  TH: ["ref", "wkt"],
};

// Buß- und Bettag: Mittwoch vor dem 23. November.
function bussUndBettag(year) {
  const d = new Date(year, 10, 23);            // 23. Nov
  d.setDate(d.getDate() - ((d.getDay() + 4) % 7) - 1);   // zurück auf den Mittwoch davor
  return d;
}

export function feiertage(year, land) {
  const O = ostersonntag(year);
  const out = [];
  const add = (date, label) => out.push({ start: ymd(date), end: ymd(date), label });

  // Bundesweit
  add(new Date(year, 0, 1), "Neujahr");
  add(plus(O, -2), "Karfreitag");
  add(plus(O, 1), "Ostermontag");
  add(new Date(year, 4, 1), "Tag der Arbeit");
  add(plus(O, 39), "Christi Himmelfahrt");
  add(plus(O, 50), "Pfingstmontag");
  add(new Date(year, 9, 3), "Tag der Deutschen Einheit");
  add(new Date(year, 11, 25), "1. Weihnachtstag");
  add(new Date(year, 11, 26), "2. Weihnachtstag");

  const extra = EXTRA[land] || [];
  if (extra.includes("h3k")) add(new Date(year, 0, 6), "Heilige Drei Könige");
  if (extra.includes("ift")) add(new Date(year, 2, 8), "Internationaler Frauentag");
  if (extra.includes("osts")) add(O, "Ostersonntag");
  if (extra.includes("pfis")) add(plus(O, 49), "Pfingstsonntag");
  if (extra.includes("fron")) add(plus(O, 60), "Fronleichnam");
  if (extra.includes("mhf")) add(new Date(year, 7, 15), "Mariä Himmelfahrt");
  if (extra.includes("wkt")) add(new Date(year, 8, 20), "Weltkindertag");
  if (extra.includes("ref")) add(new Date(year, 9, 31), "Reformationstag");
  if (extra.includes("allh")) add(new Date(year, 10, 1), "Allerheiligen");
  if (extra.includes("bbt")) add(bussUndBettag(year), "Buß- und Bettag");

  return out;
}
