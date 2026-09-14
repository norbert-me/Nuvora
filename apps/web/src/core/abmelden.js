// Was beim Abmelden aus dem BROWSER verschwinden muss — an einer Stelle.
//
// Das Abmelden raeumte bisher Token, Nutzer und die `nuvora_cache_*`-Listen.
// Das war die kleinere Haelfte: liegen geblieben sind der API-Zwischenspeicher
// des Service-Workers (nach `vorladen()` stehen dort Noten, Anwesenheit und
// Klassenlisten ALLER Klassen — auch Foerderschwerpunkte, sobald jemand die
// Angaben eines Kindes geoeffnet hat), die Tafel-Arbeitsfassung, die
// Code-Detektiv-Runde mit den Namen der Mitspielenden, die PAP-Entwuerfe und
// die Fehlerliste der Outbox mit rohen Klassen- und Schueler-IDs.
//
// Am geteilten Rechner im Lehrerzimmer ist genau das der Weg, auf dem Daten bei
// der naechsten Person landen — derselbe Grund, aus dem `ll_schueler` schon
// einmal nachgezogen wurde. Und `Legal.jsx` sagt den Betroffenen zu, dass die
// Ablagen „beim Abmelden wieder entfernt" werden; das muss stimmen.
//
// Drei Abmeldewege gibt es (Knopf im Profil, 401 im Dashboard, 401 in der
// Klassenliste) — sie rufen alle hierher, statt die Liste dreimal zu fuehren.
import { loesche, schluessel } from "./speicher.js";

// Einzelne Schluessel mit personenbezogenem Inhalt.
const SCHLUESSEL = [
  "token", "user",
  "nuvora:vorgeladen",
  // Anzeige-Cache der eingebetteten Lernpfad-App: unter `ll_schueler` liegen
  // Schuelernamen.
  "ll_aufgaben", "ll_schueler", "ll_klassen", "ll_id_counter",
  // Tafel: Freitext aus dem Unterricht, in dem regelmaessig Namen stehen.
  "nuvora_tafel_v1",
  // Code-Detektiv: `sessions[].players[].name` samt Spielstaenden.
  "code-detektiv-state",
  // PAP: gezeichnete Abgaben/Entwuerfe.
  "nuvora_pap_entwurf", "nuvora_pap_frei",
  // Outbox-Nebenablagen: die Fehlerliste zeigt rohe URLs mit IDs, die
  // Behelfs-ID-Abbildung gehoert zur Warteschlange des vorigen Kontos.
  "nuvora_outbox_fehler", "nuvora_idmap",
  // Zuletzt gewaehlte Klasse, eingeklappte Abschnitte, ausgeblendete fremde
  // Kalender (deren URLs sind die Abo-Adressen der Lehrkraft).
  "nuvora_selected_class", "noten_collapsed", "noten_agg", "kal_ext_aus",
];

// Ganze Familien. `sitzplan_mark_*` haelt Markierungen je Schueler-ID,
// `nuvora_dash_<id>`/`nuvora_modorder_<id>` die Einrichtung eines Kontos.
const PRAEFIXE = ["nuvora_cache_", "sitzplan_mark_", "sitzplan_view_",
                  "nuvora_dash_", "nuvora_modorder_", "nuvora_profil_"];

// Bewusst NICHT geraeumt, weil es dem GERAET gehoert und niemandem etwas
// verraet: `cardvote_lang`, `nuvora_sparsam`, `nuvora_bundesland`,
// `nuvora_session_muted`/`_volume`, `lp_pdf_format`, `lp_gen_prefs`,
// `nuvora_app_update_weg`, `nuvora_sw_reparatur`.

/**
 * Den API-Zwischenspeicher des Service-Workers wegwerfen.
 *
 * Er ist rein nach Adresse geschluesselt (kein `Vary: Authorization`) — ohne
 * dieses Raeumen bekaeme das naechste Konto am selben Browser bei schlechtem
 * Netz die zwischengespeicherten Antworten des vorigen zu sehen, weil der
 * Worker nach 3,5 s den Vorrat ausliefert.
 *
 * Laeuft absichtlich ohne `await` ins Leere, wenn es den Speicher nicht gibt:
 * ein Browser ohne Cache-API hat auch nichts liegen.
 */
export async function apiVorratWegwerfen() {
  try {
    if (!globalThis.caches) return;
    const namen = await caches.keys();
    await Promise.all(namen.filter((n) => n.startsWith("nuvora-api")).map((n) => caches.delete(n)));
  } catch { /* kein Cache-Zugriff: dann gibt es auch nichts zu raeumen */ }
}

/**
 * Alles Personenbezogene aus dem Browser nehmen.
 *
 * Die Outbox-Warteschlange (IndexedDB) raeumt der Aufrufer VORHER, wenn er sie
 * kennt — sie enthaelt ungespeicherte Arbeit, und die wegzuwerfen ist eine
 * andere Entscheidung als das Vergessen eines Zwischenspeichers.
 */
export function raeumeBrowser() {
  SCHLUESSEL.forEach(loesche);
  PRAEFIXE.forEach((p) => schluessel(p).forEach(loesche));
  return apiVorratWegwerfen();
}

export const _SCHLUESSEL = SCHLUESSEL;   // fuer den Test
export const _PRAEFIXE = PRAEFIXE;
