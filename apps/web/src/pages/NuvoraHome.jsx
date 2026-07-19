// Nuvoras Startseite: der Rahmen, nicht ein Modul.
// Zeigt die aktivierten Module als Einstieg. Ohne Module fuehrt sie zur
// Modulauswahl statt eine leere Seite zu zeigen.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useModules } from "../core/modules.js";
import { useLanguage } from "../i18n/index.jsx";
import { StageBadge, Icon, ICONS, iconBtn } from "../components/Icons.jsx";
import { pageTitle } from "../components/Icons.jsx";

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
  const { t } = useLanguage();
  const { active, loading } = useModules();
  const orderKey = `nuvora_modorder_${user?.id ?? "x"}`;
  const [order, setOrder] = useState(() => { try { return JSON.parse(localStorage.getItem(orderKey)) || []; } catch { return []; } });
  const [edit, setEdit] = useState(false);
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);

  if (loading) return null;

  const firstName = (user?.name || "").split(" ")[0];
  const name = (m) => (t(`mod.${m.key}.name`) !== `mod.${m.key}.name` ? t(`mod.${m.key}.name`) : m.name);
  const desc = (m) => (t(`mod.${m.key}.desc`) !== `mod.${m.key}.desc` ? t(`mod.${m.key}.desc`) : m.description);
  // Nach gespeicherter Reihenfolge; unbekannte (neue) Module hinten anhaengen.
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? 1000 + active.findIndex((m) => m.key === k) : i; };
  const shown = [...active].sort((a, b) => rank(a.key) - rank(b.key));

  const persist = (keys) => { setOrder(keys); try { localStorage.setItem(orderKey, JSON.stringify(keys)); } catch { /* egal */ } };

  // Vorschau-Reihenfolge waehrend des Ziehens: die gezogene Kachel sitzt schon
  // dort, wo sie beim Loslassen landen wuerde — man sieht das Ergebnis live.
  const previewKeys = () => {
    const keys = shown.map((m) => m.key);
    if (!dragKey || !overKey || dragKey === overKey) return keys;
    const from = keys.indexOf(dragKey), to = keys.indexOf(overKey);
    if (from < 0 || to < 0) return keys;
    keys.splice(to, 0, keys.splice(from, 1)[0]);
    return keys;
  };
  const displayList = (dragKey && overKey ? previewKeys() : shown.map((m) => m.key)).map((k) => shown.find((m) => m.key === k));
  const commit = () => { persist(previewKeys()); setDragKey(null); setOverKey(null); };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h1 style={{ ...pageTitle, marginBottom: 0, flex: 1 }}>
          {firstName ? t("home.welcome", { name: firstName }) : t("home.welcomePlain")}
        </h1>
        {active.length > 1 && (
          <button onClick={() => setEdit((e) => !e)} className="icon-btn" style={{ ...iconBtn, border: edit ? "1px solid var(--accent)" : "1px solid var(--border2)", borderRadius: 10, padding: 8 }} title={t("home.arrange")}>
            {edit ? <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)", padding: "0 4px" }}>{t("common.done")}</span> : <Icon d={ICONS.edit} size={17} />}
          </button>
        )}
      </div>
      <p style={{ color: "var(--text2)", marginBottom: 28, marginTop: 8 }}>
        {edit ? t("home.arrangeHint") : t("home.intro")}
      </p>

      {active.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: 36 }}>
          <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            {t("home.noModuleTitle")}
          </p>
          <p style={{ color: "var(--text2)", marginBottom: 20 }}>
            {t("home.noModuleText")}
          </p>
          <Link
            to="/modules"
            style={{
              display: "inline-block", padding: "10px 18px", borderRadius: 980,
              background: "var(--accent)", color: "#fff", textDecoration: "none",
              fontWeight: 600, fontSize: 14,
            }}
          >
            {t("home.chooseModules")}
          </Link>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {(edit ? displayList : shown).map((m) => {
              const inner = (<>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  {edit && <span style={{ color: "var(--text3)", display: "inline-flex" }}><Icon d={ICONS.grip} size={16} /></span>}
                  <span>{name(m)}</span> <StageBadge stage={m.stage} />
                </div>
                <div style={{ fontSize: 13.5, color: "var(--text2)", lineHeight: 1.6 }}>{desc(m)}</div>
              </>);
              if (edit) {
                // Bearbeiten: Karten sind ziehbar. Die gezogene Kachel wird zum
                // gestrichelten Platzhalter, die restlichen weichen live aus —
                // so sieht man die Reihenfolge schon vor dem Loslassen.
                const isDragged = dragKey === m.key;
                return (
                  <div key={m.key} draggable
                    onDragStart={() => setDragKey(m.key)}
                    onDragOver={(e) => e.preventDefault()}
                    // Nur beim Betreten einer ANDEREN Kachel neu einsortieren —
                    // die gezogene (gedimmte) selbst ignorieren, sonst oszilliert
                    // die Vorschau (Flackern) direkt vor dem Ablegen.
                    onDragEnter={() => { if (dragKey && m.key !== dragKey && overKey !== m.key) setOverKey(m.key); }}
                    onDrop={commit}
                    onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                    style={{ ...card, cursor: "grab", borderStyle: "dashed",
                      ...(isDragged ? { opacity: 0.35, borderColor: "var(--accent)", background: "var(--bg2)" } : {}) }}>
                    {inner}
                  </div>
                );
              }
              // Externe Module leben ausserhalb der React-App — echter Seitenwechsel.
              return m.external
                ? <a key={m.key} href={m.path} style={card}>{inner}</a>
                : <Link key={m.key} to={m.path} style={card}>{inner}</Link>;
            })}
          </div>
        </>
      )}
    </div>
  );
}
