// Foto eines Kindes — rund, mit Initialen als Rückfall.
//
// Fotos ließen sich hochladen, waren danach aber nur in der Klassenmaske zu
// sehen. Genau dort braucht man sie am wenigsten: hilfreich sind sie im
// Sitzplan, beim Ziehen und in der Anwesenheit, also überall dort, wo man
// Namen und Gesichter zusammenbringen muss.
//
// Geladen wird immer die kleine Fassung (`?klein=true`, 256 px, rund 20 KB).
// Bei 30 Kindern sind das 600 KB statt womöglich 100 MB Handyfotos — in einem
// Schulnetz der Unterschied zwischen „ist da" und „lädt".
import AuthImage from "./AuthImage.jsx";
import { CONTROL_R } from "./Icons.jsx";

/** Initialen aus „Mia O." → „MO", aus „Timur" → „T". */
export function initialen(name) {
  const teile = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!teile.length) return "?";
  const erste = teile[0][0] || "";
  const letzte = teile.length > 1 ? (teile[teile.length - 1][0] || "") : "";
  return (erste + letzte).toUpperCase();
}

/**
 * @param student  {id, name, has_photo}
 * @param size     Kantenlänge in Pixeln
 * @param zoomable Klick vergrößert (in Listen meist unerwünscht)
 */
// `form`: "rund" (Standard, Listen und Chips) oder "eckig". Eckig ist für den
// Sitzplan da — dort sitzen die Bilder auf einem rechteckigen Platz, und ein
// Kreis darin verschenkt genau die Fläche, auf die es am Beamer ankommt: das
// Gesicht. Der Radius folgt dann den Tokens (CONTROL_R) wie alles Eckige.
export default function Portrait({ student, size = 32, zoomable = false, form = "rund", style }) {
  const rund = {
    // Ausnahme von den Radius-Tokens NUR beim Kreis: dort IST der Radius die
    // halbe Kante — anders wird aus dem Quadrat kein Kreis.
    width: size, height: size, borderRadius: form === "eckig" ? CONTROL_R : size / 2, flexShrink: 0,
    objectFit: "cover", border: "1px solid var(--border2)", ...style,
  };

  if (!student?.has_photo) {
    return (
      <span aria-hidden="true" title={student?.name || ""}
        style={{ ...rund, display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "var(--bg2)", color: "var(--text3)",
          fontSize: Math.max(9, Math.round(size * 0.38)), fontWeight: 700, letterSpacing: 0.2 }}>
        {initialen(student?.name)}
      </span>
    );
  }
  return (
    <AuthImage src={`/api/classes/students/${student.id}/photo?klein=true`}
      alt={student.name || ""} zoomable={zoomable} style={rund} />
  );
}
