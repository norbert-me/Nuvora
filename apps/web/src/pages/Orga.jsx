// Modul Orga — Sammel-Checklisten je Klasse. Punkte (z.B. „Unterschrift KA1")
// als Spalten, Schüler als Zeilen, je Zelle ein Häkchen. Nur die Häkchen liegen
// im Modul, die Schüler im Kern.
import { useState, useEffect, useMemo, useCallback } from "react";
import { pageTitle, btnPrimary, btnSecondary, selectStyle, Icon, ICONS, iconBtn, COLORS as C } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { swr , lastClass, rememberClass } from "../core/cache.js";

const API = "/api/orga";

export default function Orga() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [items, setItems] = useState([]);
  const [neu, setNeu] = useState("");

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (classId === null && list.length) { const w = lastClass(); setClassId(list.some((c) => c.id === w) ? w : list[0].id); }
    });
  }, []);

  useEffect(() => { if (classId) rememberClass(classId); }, [classId]);

  const cls = useMemo(() => classes.find((c) => c.id === classId), [classes, classId]);
  const students = cls?.students || [];

  const load = useCallback((id) => {
    if (!id) return;
    fetch(`${API}/${id}`).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => { load(classId); }, [classId, load]);

  const anlegen = async () => {
    const name = neu.trim();
    if (!name || !classId) return;
    const r = await fetch(`${API}/${classId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
    if (r && r.ok) { setNeu(""); load(classId); }
  };
  const loeschen = async (id) => {
    if (!confirm(t("orga.delConfirm"))) return;
    await fetch(`${API}/item/${id}`, { method: "DELETE" }).catch(() => {});
    load(classId);
  };
  const toggle = async (item, sid) => {
    // Optimistisch, dann Server.
    setItems((prev) => prev.map((it) => it.id === item.id
      ? { ...it, done: it.done.includes(sid) ? it.done.filter((x) => x !== sid) : [...it.done, sid] } : it));
    fetch(`${API}/item/${item.id}/toggle`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ student_id: sid }) }).catch(() => {});
  };

  const th = { padding: "8px 6px", fontSize: 12, fontWeight: 600, color: "var(--text2)", borderBottom: "1px solid var(--border)", verticalAlign: "bottom" };
  const td = { padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "center" };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ ...pageTitle, marginBottom: 0 }}>{t("orga.title")}</h1>
        <select value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))} style={selectStyle}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "8px 0 16px" }}>{t("orga.hint")}</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anlegen()}
          placeholder={t("orga.newPlaceholder")} style={{ flex: 1, minWidth: 200, padding: "9px 12px", border: "1px solid var(--border2)", borderRadius: 10, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }} />
        <button onClick={anlegen} style={btnPrimary}>{t("orga.add")}</button>
      </div>

      {students.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("orga.noStudents")}</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("orga.noItems")}</p>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: "var(--card)", minWidth: 140 }}>{cls?.name}</th>
                {items.map((it) => (
                  <th key={it.id} style={{ ...th, minWidth: 90 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                      <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: it.done.length === students.length ? "#0a7d3e" : "var(--text3)" }}>{it.done.length}/{students.length}</span>
                      <button onClick={() => loeschen(it.id)} className="icon-btn" style={{ ...iconBtn, padding: 2 }} title={t("common.delete")}><Icon d={ICONS.trash} size={13} color={C.danger} /></button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => (
                <tr key={s.id}>
                  <td style={{ ...td, textAlign: "left", position: "sticky", left: 0, background: "var(--card)", fontWeight: 500 }}>
                    <span style={{ color: "var(--text3)", fontWeight: 400, marginRight: 6 }}>{i + 1}.</span>{s.name}
                  </td>
                  {items.map((it) => {
                    const on = it.done.includes(s.id);
                    return (
                      <td key={it.id} style={td}>
                        <button onClick={() => toggle(it, s.id)} title={on ? t("orga.done") : t("orga.open")}
                          style={{ width: 24, height: 24, borderRadius: 6, cursor: "pointer", fontSize: 14, fontWeight: 700,
                            border: on ? "none" : "1px solid var(--border2)", background: on ? "#0a7d3e" : "transparent", color: on ? "#fff" : "transparent" }}>
                          ✓
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
