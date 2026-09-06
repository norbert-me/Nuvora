import { useEffect, useState } from "react";
import {
  pageApp, pageTitle, cardStyle, panelStyle, badge, Icon, ICONS,
  COLORS as C, sectionLabel, toolbarInput,
} from "../components/Icons.jsx";
import Portrait from "../components/Portrait.jsx";
import { useLanguage } from "../i18n";

// Ein Kind, nicht eine Zeile in einer Liste.
//
// Der Grund für diese Seite steht im Datenmodell: bis zur Personen-Ebene war
// dieselbe Anna in „7.5 LZ" und „7.5 Mathematik" zweimal vorhanden, und die
// Frage „wie steht sie insgesamt da?" ließ sich nur beantworten, indem man
// Namen verglich. Hier steht jedes Kind einmal — und darunter, was in seinen
// Kursen zusammenkommt.
//
// Gerechnet wird nichts eigenes: der Themenstand kommt vom Server, der ihn aus
// derselben Quelle holt wie die Schülerseite. Zwei Rechnungen wären zwei
// Wahrheiten.
export default function Personen() {
  const { t } = useLanguage();
  const [liste, setListe] = useState([]);
  const [suche, setSuche] = useState("");
  const [offen, setOffen] = useState(null);
  const [stand, setStand] = useState(null);

  useEffect(() => {
    fetch("/api/personen").then((r) => (r.ok ? r.json() : [])).then((d) => setListe(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const zeigen = async (p) => {
    if (offen === p.id) { setOffen(null); return; }
    setOffen(p.id);
    setStand(null);
    const d = await fetch(`/api/personen/${p.id}/auswertung`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setStand(d);
  };

  const gefiltert = liste.filter((p) => !suche.trim()
    || p.name.toLowerCase().includes(suche.trim().toLowerCase())
    || (p.kurse || []).some((k) => k.toLowerCase().includes(suche.trim().toLowerCase())));

  return (
    <div style={pageApp}>
      <h1 style={pageTitle}>{t("personen.titel")}</h1>
      <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder={t("personen.suche")}
        style={{ ...toolbarInput, width: "100%", maxWidth: 320, marginBottom: 16 }} />

      {liste.length === 0 && <p style={{ fontSize: 14, color: "var(--text3)" }}>{t("personen.leer")}</p>}

      {gefiltert.map((p) => (
        <div key={p.id} style={{ ...cardStyle, padding: 12, marginBottom: 8 }}>
          {/* Name UND Bild öffnen dasselbe: die Person. Ein eigener Knopf
              „Auswertung" daneben war ein dritter Weg zum selben Ort — und die
              Zeile stand voller Angaben (Kurs, E/G), die man beim Suchen nicht
              liest, auf dem Handy aber umbricht. */}
          <button onClick={() => zeigen(p)}
            style={{ display: "flex", alignItems: "center", gap: 12, width: "100%",
              border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
            <Portrait student={{ id: p.id, name: p.name, has_photo: p.has_photo }} size={34} form="eckig" quelle="person" />
            <span style={{ fontWeight: 600, flex: 1, color: "var(--text)" }}>{p.name}</span>
            <span style={{ color: "var(--text3)", display: "inline-flex",
              transform: offen === p.id ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
              <Icon d={ICONS.open} size={14} />
            </span>
          </button>

          {offen === p.id && (
            <div style={{ ...panelStyle, padding: 12, marginTop: 12 }}>
              {!stand && <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("common.loading")}</p>}
              {stand && (
                <>
                  {/* Die Angaben zur Person stehen HIER — beim Namen, nicht in
                      jeder Zeile der Liste. */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                    {stand.niveau && <span style={badge(stand.niveau === "E" ? C.info : C.success)}>{stand.niveau}</span>}
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>{(p.kurse || []).join(" · ")}</span>
                  </div>
                  {(stand.teile || []).length === 0 && (
                    <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("personen.nochNichts")}</p>
                  )}
                  {(stand.teile || []).map((teil) => (
                    <div key={teil.student_id} style={{ marginBottom: 12 }}>
                      <div style={{ ...sectionLabel, margin: "0 0 6px" }}>{teil.kurs || "—"}</div>
                      {(teil.themen || []).length === 0 ? (
                        <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{t("personen.keineThemen")}</p>
                      ) : (
                        <div style={{ display: "grid", gap: 4 }}>
                          {(teil.themen || []).slice(0, 8).map((th, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                              <span style={{ flex: 1 }}>{th.thema || th.name || "—"}</span>
                              {th.pct == null ? (
                                <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("personen.zuWenig")}</span>
                              ) : (
                                <span style={{ ...badge(th.pct >= 75 ? C.success : th.pct >= 50 ? C.warning : C.danger) }}>
                                  {Math.round(th.pct)} %
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
