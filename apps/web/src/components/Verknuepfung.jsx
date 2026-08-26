// „Neu anlegen oder mit Vorhandenem verknüpfen?" — der Dialog dazu, an einer Stelle.
//
// Importierte Daten bringen Verknüpfungen mit, die es im eigenen Konto schon
// geben kann: eine Lernleiter nennt ihr Thema, ein Quiz will in einen Ordner,
// ein Kartenstapel gehört zu einer Klasse. Bisher entschied das die Software
// still — Namenstreffer nehmen, sonst neu anlegen. Bei jemandem mit gepflegter
// Themenstruktur entstand so ein zweites „Bruchrechnung" neben dem eigenen,
// und gemerkt hat es niemand.
//
// Deshalb wird gefragt, und zwar IMMER, nicht nur im Konfliktfall: ob ein
// Thema neu entsteht, ist eine Entscheidung über die eigene Ablage — auch
// dann, wenn zufällig nichts gleich heißt.
//
// Vorbelegt ist der Namenstreffer (sonst „neu anlegen" mit dem Namen aus der
// Datei), damit der übliche Fall ein Klick bleibt.
import { useEffect, useMemo, useState } from "react";

import {
  btnPrimary, btnSecondary, DialogKopf, inputStyle, Modal, selectStyle,
} from "./Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

export const NEU = "__neu__";
export const LEER = "__leer__";

/** Namensvergleich fürs Vorbelegen: Groß/klein und Randleerzeichen zählen nicht. */
const gleich = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/**
 * Baum (Ordner: `children`) als flache Liste mit Pfadnamen „Ober / Unter".
 * Die Auswahl zeigt damit denselben Namen, den auch der Server versteht.
 */
export function flachBaum(knoten, praefix = "") {
  const out = [];
  for (const k of knoten || []) {
    const name = praefix ? `${praefix} / ${k.name}` : k.name;
    out.push({ id: k.id, name });
    out.push(...flachBaum(k.children || [], name));
  }
  return out;
}

/** Flache Themenliste (parent_id) als „Oberthema / Unterthema". */
export function themenNamen(topics) {
  const byId = {};
  (topics || []).forEach((t) => { byId[t.id] = t; });
  return (topics || []).map((t) => {
    const p = t.parent_id ? byId[t.parent_id] : null;
    return { id: t.id, name: p ? `${p.name} / ${t.name}` : t.name };
  }).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/**
 * @param {object[]} zeilen  je Verknüpfung eine:
 *   { key, label, vorschlag, optionen: [{id, name}], nurVorhanden?, leerLabel?, hinweis? }
 *   `leerLabel` fügt „ohne" als Wahl hinzu (ein Kartenstapel muss kein Thema
 *   haben) — die Antwort ist dann { id: null, name: "" }.
 *   `nurVorhanden` lässt „neu anlegen" weg (eine Klasse legt kein Import an —
 *   sie hat Schüler, die niemand aus einer fremden Datei bekommt).
 * @param {(werte) => void} onFertig  werte: { key: { id: number|null, name: string|null } }
 */
export default function VerknuepfungDialog({ titel, hinweis, zeilen, onAbbruch, onFertig, okLabel }) {
  const { t } = useLanguage();

  const start = useMemo(() => {
    const w = {};
    for (const z of zeilen) {
      const treffer = (z.optionen || []).find((o) => gleich(o.name, z.vorschlag));
      const ohneWahl = z.leerLabel && !z.vorschlag ? LEER : null;
      w[z.key] = {
        wahl: treffer ? String(treffer.id) : (ohneWahl || (z.nurVorhanden ? String((z.optionen || [])[0]?.id ?? "") : NEU)),
        name: z.vorschlag || "",
      };
    }
    return w;
  }, [zeilen]);

  const [werte, setWerte] = useState(start);
  useEffect(() => { setWerte(start); }, [start]);

  const setz = (key, teil) => setWerte((v) => ({ ...v, [key]: { ...v[key], ...teil } }));

  // Fertig ist nur, wer für jede Zeile etwas Brauchbares hat: eine gewählte ID
  // oder einen nicht leeren Namen.
  const bereit = zeilen.every((z) => {
    const w = werte[z.key] || {};
    if (w.wahl === LEER) return true;
    return w.wahl === NEU ? !!(w.name || "").trim() : !!w.wahl;
  });

  const fertig = () => {
    const out = {};
    for (const z of zeilen) {
      const w = werte[z.key] || {};
      out[z.key] = w.wahl === LEER
        ? { id: null, name: "" }
        : w.wahl === NEU
        ? { id: null, name: (w.name || "").trim() }
        : { id: Number(w.wahl), name: (z.optionen || []).find((o) => String(o.id) === String(w.wahl))?.name || "" };
    }
    onFertig(out);
  };

  return (
    <Modal onClose={onAbbruch} width={520} label={titel}>
      <DialogKopf titel={titel} onClose={onAbbruch} schliessenLabel={t("common.close")} />
      <p style={{ fontSize: 13, color: "var(--text2)", margin: "0 0 12px" }}>{hinweis || t("verkn.hinweis")}</p>

      {zeilen.map((z) => {
        const w = werte[z.key] || {};
        return (
          <div key={z.key} style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
              {z.label}
            </label>
            <select value={w.wahl} onChange={(e) => setz(z.key, { wahl: e.target.value })}
              style={{ ...selectStyle, width: "100%" }}>
              {z.leerLabel && <option value={LEER}>{z.leerLabel}</option>}
              {!z.nurVorhanden && <option value={NEU}>{t("verkn.neu")}</option>}
              {(z.optionen || []).map((o) => (
                <option key={o.id} value={String(o.id)}>{o.name}</option>
              ))}
            </select>
            {w.wahl === NEU && (
              <input value={w.name} onChange={(e) => setz(z.key, { name: e.target.value.slice(0, 200) })}
                placeholder={t("verkn.neuName")} style={{ ...inputStyle, width: "100%", marginTop: 6 }} />
            )}
            {z.hinweis && <p style={{ fontSize: 12, color: "var(--text3)", margin: "4px 0 0" }}>{z.hinweis}</p>}
            {z.nurVorhanden && !(z.optionen || []).length && (
              <p style={{ fontSize: 12, color: "var(--text3)", margin: "4px 0 0" }}>{t("verkn.keineOptionen")}</p>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button onClick={onAbbruch} style={btnSecondary}>{t("common.abort")}</button>
        <button onClick={fertig} disabled={!bereit} style={{ ...btnPrimary, opacity: bereit ? 1 : 0.5 }}>
          {okLabel || t("verkn.uebernehmen")}
        </button>
      </div>
    </Modal>
  );
}
