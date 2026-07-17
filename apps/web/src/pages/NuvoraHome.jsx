// Nuvoras Startseite: der Rahmen, nicht ein Modul.
// Zeigt die aktivierten Module als Einstieg. Ohne Module fuehrt sie zur
// Modulauswahl statt eine leere Seite zu zeigen.
import { Link } from "react-router-dom";
import { useModules } from "../core/modules.js";

const card = {
  display: "block",
  textDecoration: "none",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 20,
  background: "var(--surface)",
  color: "var(--text)",
};

export default function NuvoraHome({ user }) {
  const { active, loading } = useModules();

  if (loading) return null;

  const firstName = (user?.name || "").split(" ")[0];

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6 }}>
        {firstName ? `Willkommen, ${firstName}` : "Willkommen"}
      </h1>
      <p style={{ color: "var(--text2)", marginBottom: 28 }}>
        Nuvora ist deine Basis: Konto, Klassen und Schüler liegen hier. Module
        arbeiten darauf.
      </p>

      {active.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: 36 }}>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Noch kein Modul aktiv
          </p>
          <p style={{ color: "var(--text2)", marginBottom: 20 }}>
            Schalte ein Modul frei, um loszulegen. Du kannst es jederzeit wieder
            abschalten — deine Daten bleiben erhalten.
          </p>
          <Link
            to="/modules"
            style={{
              display: "inline-block", padding: "10px 18px", borderRadius: 980,
              background: "var(--accent)", color: "#fff", textDecoration: "none",
              fontWeight: 600, fontSize: 14,
            }}
          >
            Module auswählen
          </Link>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {active.map((m) =>
              // Externe Module leben ausserhalb der React-App (eigene Seite
              // hinter dem Proxy) — die brauchen einen echten Seitenwechsel,
              // ein <Link> wuerde ins Leere routen.
              m.external ? (
                <a key={m.key} href={m.path} style={card}>
                  <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{m.name}</div>
                  <div style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.6 }}>
                    {m.description}
                  </div>
                </a>
              ) : (
                <Link key={m.key} to={m.path} style={card}>
                  <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{m.name}</div>
                  <div style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.6 }}>
                    {m.description}
                  </div>
                </Link>
              )
            )}
          </div>
          <p style={{ marginTop: 22, fontSize: 13, color: "var(--text3)" }}>
            <Link to="/modules" style={{ color: "var(--accent)" }}>Module verwalten</Link>
          </p>
        </>
      )}
    </div>
  );
}
