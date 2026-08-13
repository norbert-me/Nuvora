// Ein Textfeld, das beim Oeffnen so hoch ist wie sein Inhalt.
//
// Feste `rows` sind fuer leere Felder gedacht. Steht schon etwas drin — die
// Lernziele eines Themas sind oft zehn Zeilen —, sieht man beim Aufklappen
// zwei davon und muss in einem winzigen Kasten scrollen, um zu lesen, was man
// selbst geschrieben hat.
//
// Deckel per `maxHeight` (Voreinstellung 40vh): ohne ihn schoebe ein langer
// Text die Knoepfe „Speichern"/„Abbrechen" aus dem Dialog heraus.
import { useEffect, useRef } from "react";

export default function AutoTextarea({ value, style, maxHeight = "40vh", ...rest }) {
  const ref = useRef(null);

  const anpassen = () => {
    const el = ref.current;
    if (!el) return;
    // Erst zurueck auf „auto": sonst waechst die Hoehe nur, schrumpft aber nie
    // wieder, wenn Text geloescht wird.
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Auch bei Aenderungen von aussen (Laden, Zuruecksetzen), nicht nur beim Tippen.
  useEffect(anpassen, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onInput={anpassen}
      style={{ maxHeight, overflowY: "auto", ...style }}
      {...rest}
    />
  );
}
