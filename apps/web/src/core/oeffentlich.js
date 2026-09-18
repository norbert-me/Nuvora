// Welche Wege gehoeren einem AUSGETEILTEN Zugang (QR-Zettel, Sitzungscode)?
//
// Dort heisst 401 „dieser Zugang gilt nicht mehr" — Modul abgeschaltet, Klasse
// archiviert, Token neu vergeben. Es heisst NIE „deine Sitzung ist abgelaufen".
// Ohne diese Unterscheidung meldete der 401-Abfangjäger in `main.jsx` die
// Lehrkraft aus ihrem eigenen Konto ab, sobald sie den Link ihres Kindes
// oeffnete (gemeldet am 18.09.2026).
const WEGE = /\/lernen\/|\/cd\/|\/codedetektiv\/sessions\//;
const SEITEN = /^\/(lernen|cd|pap-frei)(\/|$)/;

export function istOeffentlich(url = "", pfad = "") {
  return WEGE.test(String(url)) || SEITEN.test(String(pfad));
}
