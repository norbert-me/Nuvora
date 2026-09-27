// Freitext mit Tabellen: Anzeige und Eingabe (Verlaufsplan im Kalender).
//
// Die Tabelle steht im Text als Zeilen mit „|" (core/texttabelle.js) — der
// Editor schreibt sie mit drei Knöpfen, damit niemand Striche zählen muss,
// und zeigt darunter, wie sie aussehen wird.
import { useEffect, useRef, useState } from "react";

import { ICONS, Icon, toolbarBtn } from "./Icons.jsx";
import { hatTabelle, spalteAnhaengen, tabelleEinfuegen, teileText, zeileAnhaengen } from "../core/texttabelle.js";

const zelle = { border: "1px solid var(--border)", padding: "4px 8px", textAlign: "left", verticalAlign: "top" };

/** Nur lesen: Text bleibt Text, Tabellenzeilen werden ein Raster. */
export function TextMitTabellen({ text, style }) {
  const teile = teileText(text);
  if (!teile.length) return null;
  return (
    <div style={style}>
      {teile.map((t, i) => t.art === "text" ? (
        <div key={i} style={{ whiteSpace: "pre-wrap" }}>{t.text}</div>
      ) : (
        // Breite Tabellen scrollen in sich, statt den Dialog aufzudruecken.
        <div key={i} style={{ overflowX: "auto", margin: "4px 0" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {t.zeilen.map((z, r) => (
                <tr key={r} style={r === 0 && t.zeilen.length > 1 ? { background: "var(--bg2)", fontWeight: 600 } : undefined}>
                  {z.map((c, k) => <td key={k} style={zelle}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** Eingabe: Textfeld, das mitwächst, plus Tabellen-Knöpfe und Vorschau. */
export function TextMitTabellenFeld({ value, onChange, placeholder, style, t }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [inTabelle, setInTabelle] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, window.innerHeight * 0.4)}px`;
  }, [value]);

  // Nach dem Einfuegen die Schreibstelle an die neue Zelle setzen.
  useEffect(() => {
    if (pos == null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(pos, pos);
    setPos(null);
  }, [pos]);

  const merke = () => {
    const el = ref.current;
    if (el) setInTabelle(zeileAnhaengen(el.value, el.selectionStart) != null);
  };
  const anwenden = (fn) => {
    const el = ref.current;
    const r = fn(value || "", el ? el.selectionStart : (value || "").length);
    if (!r) return;
    onChange(r.text);
    setPos(r.pos);
    setInTabelle(true);
  };
  const knopf = { ...toolbarBtn, padding: "0 8px", gap: 4, fontSize: 12 };

  return (
    <div>
      <textarea ref={ref} value={value} placeholder={placeholder} rows={2}
        onChange={(e) => { onChange(e.target.value); merke(); }} onSelect={merke} onKeyUp={merke} onClick={merke}
        style={{ ...style, resize: "vertical", fontFamily: hatTabelle(value) ? "ui-monospace, monospace" : undefined }} />
      <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
        <button type="button" onClick={() => anwenden(tabelleEinfuegen)} style={knopf} title={t("text.tabelle")} aria-label={t("text.tabelle")}>
          <Icon d={ICONS.tabelle} size={14} /> {t("text.tabelle")}
        </button>
        {inTabelle && (<>
          <button type="button" onClick={() => anwenden(zeileAnhaengen)} style={knopf} title={t("text.zeile")} aria-label={t("text.zeile")}>
            <Icon d={ICONS.plus} size={13} /> {t("text.zeile")}
          </button>
          <button type="button" onClick={() => anwenden(spalteAnhaengen)} style={knopf} title={t("text.spalte")} aria-label={t("text.spalte")}>
            <Icon d={ICONS.plus} size={13} /> {t("text.spalte")}
          </button>
        </>)}
      </div>
      {hatTabelle(value) && <TextMitTabellen text={value} style={{ marginTop: 8, fontSize: 13, color: "var(--text2)" }} />}
    </div>
  );
}
