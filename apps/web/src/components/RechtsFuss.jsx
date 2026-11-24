// Rechtshinweis für die Seiten, die Lernende OHNE Konto sehen.
//
// /lernen/<token> und /cd/<code> laufen bewusst außerhalb der Shell — sie haben
// keine Navigation und keine Fußleiste, damit nichts vom Üben ablenkt. Damit
// fehlte dort aber auch der Weg zu Impressum und Datenschutz, und genau das
// verlangt § 5 DDG: leicht erkennbar, unmittelbar erreichbar, ständig verfügbar.
//
// Deshalb dieser eine kleine Fuß statt zweier Nachbauten.
import { Link } from "react-router-dom";

// Der Fuss klebt am unteren Fensterrand (sticky): der Weg zu Impressum und
// Datenschutz muss „leicht erkennbar und ständig verfügbar" sein — bisher sah man ihn
// erst, wenn man bis ans Seitenende scrollte.
export default function RechtsFuss({ hinweis }) {
  return (
    <footer style={{ position: "sticky", bottom: 0, zIndex: 5, textAlign: "center",
      padding: "8px 16px max(8px, env(safe-area-inset-bottom))", fontSize: 12, color: "var(--text3)",
      background: "var(--bg)", borderTop: "1px solid var(--border)" }}>
      {hinweis && (
        <p style={{ margin: "0 auto 4px", maxWidth: 460, lineHeight: 1.4, fontSize: 11 }}>{hinweis}</p>
      )}
      <Link to="/legal" style={{ color: "var(--text3)", display: "inline-block", padding: "6px 4px" }}>Impressum &amp; Datenschutz</Link>
    </footer>
  );
}
