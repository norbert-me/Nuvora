import { useEffect, useState } from "react";
import { useLanguage } from "../i18n";
import { modalOverlay, modalPanel, overlayGuard, btnPrimary, btnSecondary } from "./Icons.jsx";

// „Was ist neu?" — die Änderungsliste nach einem Update, beim ersten Anmelden
// danach. Der Stand hängt am Konto (users.changelog_seen), nicht am Browser:
// sonst käme dieselbe Liste am Rechner und am Tablet ein zweites Mal.
//
// Der Text kommt als Markdown-Ausschnitt aus CHANGELOG.md. Gerendert wird nur,
// was dort wirklich vorkommt — fette Zwischenüberschriften und Listenpunkte;
// eine Markdown-Bibliothek für zwei Formen wäre 40 kB für nichts.
function Zeilen({ text }) {
  const bloecke = [];
  let liste = null;
  for (const roh of (text || "").split("\n")) {
    const z = roh.trim();
    if (!z) continue;
    if (z.startsWith("**") && z.endsWith("**")) {
      liste = null;
      bloecke.push({ art: "kopf", text: z.slice(2, -2) });
    } else if (z.startsWith("- ")) {
      if (!liste) { liste = { art: "liste", punkte: [] }; bloecke.push(liste); }
      liste.punkte.push(z.slice(2));
    } else if (liste) {
      // Fortsetzungszeile eines umbrochenen Punktes.
      liste.punkte[liste.punkte.length - 1] += " " + z;
    } else {
      bloecke.push({ art: "text", text: z });
    }
  }
  return (
    <>
      {bloecke.map((b, i) => b.art === "kopf" ? (
        <div key={i} style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", margin: i ? "16px 0 6px" : "0 0 6px" }}>{b.text}</div>
      ) : b.art === "liste" ? (
        <ul key={i} style={{ margin: "0 0 4px", paddingLeft: 18, display: "grid", gap: 4 }}>
          {b.punkte.map((p, j) => <li key={j} style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>{p}</li>)}
        </ul>
      ) : (
        <p key={i} style={{ fontSize: 13, color: "var(--text2)", margin: "0 0 8px" }}>{b.text}</p>
      ))}
    </>
  );
}

export default function WasIstNeu() {
  const { t } = useLanguage();
  const [daten, setDaten] = useState(null);

  useEffect(() => {
    fetch("/api/changelog").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && (d.abschnitte || []).length) setDaten(d);
    }).catch(() => {});
  }, []);

  if (!daten) return null;

  const schliessen = () => {
    // Zuerst weg, dann merken: der Dialog darf nicht am Netz hängen.
    setDaten(null);
    fetch("/api/changelog/seen", { method: "POST" }).catch(() => {});
  };

  return (
    <div {...overlayGuard(schliessen)} style={modalOverlay}>
      <div style={{ ...modalPanel, maxWidth: 560 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{t("neu.titel")}</div>
        <p style={{ fontSize: 12, color: "var(--text3)", margin: "0 0 16px" }}>
          {t("neu.fassung", { version: daten.version })}
        </p>
        {daten.abschnitte.map((a) => (
          <div key={a.version} style={{ marginBottom: 20 }}>
            {daten.abschnitte.length > 1 && (
              <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 6 }}>{a.version}{a.datum ? ` — ${a.datum}` : ""}</div>
            )}
            <Zeilen text={a.inhalt} />
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <a href="https://github.com/norbert-me/Nuvora/releases" target="_blank" rel="noreferrer"
            style={{ ...btnSecondary, textDecoration: "none" }}>{t("neu.alle")}</a>
          <button onClick={schliessen} style={btnPrimary}>{t("neu.ok")}</button>
        </div>
      </div>
    </div>
  );
}
