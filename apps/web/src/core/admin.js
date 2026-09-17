// Wer ist "die Administration"? Konto 1 immer (es hat die Installation
// aufgesetzt und laesst sich nicht herabstufen), dazu jedes Konto, das dazu
// ernannt wurde. Serverseitig entscheidet dasselbe in app/rollen.py — hier ist
// die eine Quelle fuer die Oberflaeche, damit eine Aenderung an der Regel
// nicht drei Stellen vergisst.
export const ADMIN_USER_ID = 1;

// Sicherungen tragen die Daten ALLER Konten — nur Konto 1, keine ernannte
// Administration (Gegenstueck: rollen.ist_betreiber).
export function istBetreiber(user) {
  return !!user && user.id === ADMIN_USER_ID;
}

export function istAdmin(user) {
  return !!user && (user.id === ADMIN_USER_ID || !!user.is_admin);
}
