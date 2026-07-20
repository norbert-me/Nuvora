// Kern-Feature: modulübergreifende Themen-Ansicht. Ein Thema, alles was daran
// hängt — CardVote-Fragen, Karten-Decks, Lernpfad-Aufgaben, Kalender-Termine.
// Jede Sektion nur, wenn das Modul aktiv ist (Regel 3). Das Thema gehört dem
// Kern; die Module arbeiten darauf.
import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { pageTitle } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import MaterialPanel from "../components/MaterialPanel.jsx";

export default function ThemaAnsicht() {
  const { t } = useLanguage();
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch(`/api/topics/${id}/usage`).then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData).catch(() => setErr(true));
  }, [id]);

  if (err) return <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("thema.error")}</p>;
  if (!data) return null;

  const Section = ({ show, title, count, empty, children }) => {
    if (!show) return null;
    return (
      <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          {title}
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text3)", background: "var(--bg2)", borderRadius: 980, padding: "1px 9px" }}>{count}</span>
        </div>
        {count === 0 ? <p style={{ fontSize: 13, color: "var(--text3)", margin: 0 }}>{empty}</p> : children}
      </div>
    );
  };
  const row = { display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 13.5 };
  const a = data.active || {};

  return (
    <div style={{ maxWidth: 780, margin: "0 auto" }}>
      <Link to="/topics" style={{ color: "var(--text3)", textDecoration: "none", fontSize: 13, fontWeight: 500 }}>← {t("nav.topics")}</Link>
      <h1 style={{ ...pageTitle, marginTop: 8 }}>{data.name}</h1>
      <p style={{ fontSize: 13.5, color: "var(--text2)", marginBottom: 20 }}>{t("thema.hint")}</p>

      <Section show={a.cardvote} title={t("thema.cardvote")} count={(data.cardvote || []).length} empty={t("thema.empty")}>
        {(data.cardvote || []).map((q) => (
          <div key={q.id} style={row}><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{q.text}</span></div>
        ))}
        <div style={{ marginTop: 10 }}><Link to="/cardvote/questions" style={{ color: "var(--accent)", fontSize: 13, textDecoration: "none" }}>{t("thema.openCardvote")} ↗</Link></div>
      </Section>

      <Section show={a.karten} title={t("thema.karten")} count={(data.karten || []).length} empty={t("thema.empty")}>
        {(data.karten || []).map((d) => (
          <div key={d.id} style={row}>
            <span style={{ flex: 1 }}>{d.name}</span>
            {!d.released && <span style={{ fontSize: 11.5, color: "var(--text3)" }}>{t("thema.draft")}</span>}
            <Link to={`/karten?class=${d.class_id}`} style={{ color: "var(--accent)", textDecoration: "none" }}>↗</Link>
          </div>
        ))}
      </Section>

      <Section show={a.lernpfad} title={t("thema.lernpfad")} count={(data.lernpfad || []).length} empty={t("thema.empty")}>
        {(data.lernpfad || []).map((e) => (
          <div key={e.id} style={row}>
            <span style={{ color: "var(--text3)", fontSize: 12 }}>{e.kategorie}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{e.text || e.code}</span>
          </div>
        ))}
        <div style={{ marginTop: 10 }}><Link to="/lernpfad" style={{ color: "var(--accent)", fontSize: 13, textDecoration: "none" }}>{t("thema.openLernpfad")} ↗</Link></div>
      </Section>

      <Section show={a["code-detektiv"]} title={t("thema.codedetektiv")} count={(data.codedetektiv || []).length} empty={t("thema.empty")}>
        {(data.codedetektiv || []).map((p) => (
          <div key={p.id} style={row}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{p.title || p.client_id}</span>
            <Link to={`/code-detektiv/puzzle/${p.client_id}?mode=solo`} style={{ color: "var(--accent)", textDecoration: "none" }}>↗</Link>
          </div>
        ))}
      </Section>

      <Section show={a.kalender} title={t("thema.kalender")} count={(data.kalender || []).length} empty={t("thema.empty")}>
        {(data.kalender || []).map((e) => (
          <div key={e.id} style={row}>
            <span style={{ color: "var(--text3)", fontSize: 12, minWidth: 90 }}>{e.date ? new Date(e.date).toLocaleDateString() : ""}</span>
            <span style={{ flex: 1 }}>{e.title || "—"}</span>
            <Link to="/kalender" style={{ color: "var(--accent)", textDecoration: "none" }}>↗</Link>
          </div>
        ))}
      </Section>

      {/* Material haengt am Thema — Kern-Feature, immer sichtbar (kein Modul). */}
      <MaterialPanel topicId={Number(id)} />

      {!a.cardvote && !a.karten && !a.lernpfad && !a.kalender && !a["code-detektiv"] && (
        <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("thema.noModulesButMaterial")}</p>
      )}
    </div>
  );
}
