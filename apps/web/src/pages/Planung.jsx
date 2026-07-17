// Nuvora-Kern: Wochenplanung.
//
// Verbindet die Module, setzt aber keins voraus: Wochen mit Themenblöcken (aus
// der Kern-Taxonomie) und einem Test-Marker. Lernpfad liefert Aufgaben zu den
// Themen, CardVote prüft sie — beides optional.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary, pageTitle } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import TopicPicker from "../components/TopicPicker.jsx";

const API = "/api/planung";

export default function Planung() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [plan, setPlan] = useState(null);   // { class_id, plan_blocks, weeks }
  const [topics, setTopics] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).then((d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (list.length && classId === null) setClassId(list[0].id);
    }).catch(() => {});
    fetch("/api/topics").then((r) => (r.ok ? r.json() : [])).then((d) => setTopics(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const load = (id) => id && fetch(`${API}/classes/${id}`).then((r) => (r.ok ? r.json() : null)).then(setPlan).catch(() => {});
  useEffect(() => { load(classId); }, [classId]);

  const call = async (fn) => {
    setError("");
    const res = await fn();
    if (!res.ok) { const b = await res.json().catch(() => ({})); setError(typeof b.detail === "string" ? b.detail : t("common.notWork")); return false; }
    await load(classId);
    return true;
  };

  const topicLabel = (id) => {
    const tp = topics.find((x) => x.id === id);
    if (!tp) return "";
    const p = tp.parent_id ? topics.find((x) => x.id === tp.parent_id) : null;
    return p ? `${p.name} / ${tp.name}` : tp.name;
  };

  if (classes.length === 0) {
    return (
      <div style={{ maxWidth: 700 }}>
        <h1 style={pageTitle}>{t("plan.title")}</h1>
        <p style={{ color: "var(--text2)", fontSize: 14 }}>
          {t("plan.needClass").split("{{link}}")[0]}<Link to="/classes" style={{ color: "var(--accent)" }}>{t("nav.classes")}</Link>{t("plan.needClass").split("{{link}}")[1]}
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>{t("plan.title")}</h1>
        <select value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)" }}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <p style={{ color: "var(--text2)", marginBottom: 18, fontSize: 14 }}>{t("plan.intro")}</p>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {topics.length === 0 && (
        <p style={{ fontSize: 13.5, color: "#b8860b", marginBottom: 16 }}>
          {t("plan.needTopics").split("{{link}}")[0]}<Link to="/topics" style={{ color: "var(--accent)" }}>{t("nav.topics")}</Link>{t("plan.needTopics").split("{{link}}")[1]}
        </p>
      )}

      {/* Einstellung: Blöcke pro Woche */}
      {plan && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, fontSize: 13.5, flexWrap: "wrap" }}>
          <span style={{ color: "var(--text2)" }}>{t("plan.blocksSetting")}:</span>
          <select value={plan.plan_blocks} onChange={(e) => call(() => fetch(`${API}/classes/${classId}/setting`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan_blocks: Number(e.target.value) }) }))}
            style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)" }}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span style={{ color: "var(--text3)", fontSize: 12 }}>{t("plan.blocksHint")}</span>
          <button onClick={() => call(() => fetch(`${API}/classes/${classId}/weeks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: "" }) }))}
            style={{ ...btnPrimary, marginLeft: "auto" }}>{t("plan.addWeek")}</button>
        </div>
      )}

      {plan && plan.weeks.length === 0 && <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("plan.empty")}</p>}

      {plan && plan.weeks.map((w, wi) => (
        <div key={w.id} style={{ marginBottom: 14, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <input
              defaultValue={w.label} placeholder={t("plan.weekN", { n: wi + 1 })}
              onBlur={(e) => { if (e.target.value !== w.label) call(() => fetch(`${API}/weeks/${w.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: e.target.value, notiz: w.notiz, test_done: w.test_done }) })); }}
              style={{ flex: 1, fontSize: 16, fontWeight: 700, padding: "4px 6px", border: "1px solid transparent", borderRadius: 6, background: "transparent", color: "var(--text)" }}
            />
            <button onClick={() => { if (confirm(t("plan.delWeek", { name: w.label || t("plan.weekN", { n: wi + 1 }) }))) call(() => fetch(`${API}/weeks/${w.id}`, { method: "DELETE" })); }}
              className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>
          </div>

          {/* Themenblöcke */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {w.blocks.map((b, bi) => (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: "var(--text3)", width: 70, flexShrink: 0 }}>{t("plan.block")} {bi + 1}</span>
                <TopicPicker value={b.topic_id} onChange={(id) => call(() => fetch(`${API}/blocks/${b.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic_id: id }) }))} style={{ flex: 1 }} />
                <button onClick={() => call(() => fetch(`${API}/blocks/${b.id}`, { method: "DELETE" }))} className="icon-btn" style={{ ...iconBtn, padding: 3 }} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} size={14} /></button>
              </div>
            ))}
            <button onClick={() => call(() => fetch(`${API}/weeks/${w.id}/blocks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }))}
              style={{ alignSelf: "flex-start", border: "none", background: "none", color: "var(--accent)", cursor: "pointer", fontSize: 13, padding: "2px 0" }}>{t("plan.addBlock")}</button>
          </div>

          {/* Test-Marker + Notiz */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13.5 }} title={t("plan.testHint")}>
              <input type="checkbox" checked={w.test_done} onChange={(e) => call(() => fetch(`${API}/weeks/${w.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: w.label, notiz: w.notiz, test_done: e.target.checked }) }))} />
              {t("plan.test")}
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}
