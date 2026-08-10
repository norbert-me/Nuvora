// Wer ist "die Administration"? Genau ein Konto: das erste (id 1) — so
// entscheidet es auch der Server in `_require_admin`. Das stand vorher an
// mehreren Stellen als nacktes `user.id === 1` im Code; hier ist die eine
// Quelle, damit eine Änderung an der Regel nicht drei Stellen vergisst.
export const ADMIN_USER_ID = 1;

export function istAdmin(user) {
  return !!user && user.id === ADMIN_USER_ID;
}
