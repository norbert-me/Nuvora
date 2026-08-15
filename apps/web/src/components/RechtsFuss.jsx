// Rechtshinweis für die Seiten, die Lernende OHNE Konto sehen.
//
// /lernen/<token> und /cd/<code> laufen bewusst außerhalb der Shell — sie haben
// keine Navigation und keine Fußleiste, damit nichts vom Üben ablenkt. Damit
// fehlte dort aber auch der Weg zu Impressum und Datenschutz, und genau das
// verlangt § 5 DDG: leicht erkennbar, unmittelbar erreichbar, ständig verfügbar.
//
// Deshalb dieser eine kleine Fuß statt zweier Nachbauten.
import { Link } from "react-router-dom";

export default function RechtsFuss({ hinweis }) {
  return (
    <footer style={{ textAlign: "center", padding: "24px 16px", fontSize: 12, color: "var(--text3)" }}>
      {hinweis && (
        <p style={{ margin: "0 auto 8px", maxWidth: 460, lineHeight: 1.5 }}>{hinweis}</p>
      )}
      <Link to="/legal" style={{ color: "var(--text3)" }}>Impressum &amp; Datenschutz</Link>
    </footer>
  );
}
