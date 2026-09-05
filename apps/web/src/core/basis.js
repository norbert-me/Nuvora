// Die oeffentliche Adresse fuer Links, die AUS DEM HAUS gehen (Beitrittslink
// fuers Kind, QR-Zettel). `location.origin` waere die des Browsers — im
// Schulnetz die LAN-Adresse, und die ist ausserhalb tot. Der Server kennt sie
// (SITE_URL); ist sie nicht gesetzt, bleibt es beim Ursprung des Aufrufs.
let zwischenspeicher = null;

export async function oeffentlicheBasis() {
  if (zwischenspeicher !== null) return zwischenspeicher;
  const daten = await fetch("/api/auth/basis").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  zwischenspeicher = (daten && daten.url) || window.location.origin;
  return zwischenspeicher;
}
