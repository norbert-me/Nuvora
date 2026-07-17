import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon, ICONS, iconBtn, COLORS as C } from "../components/Icons.jsx";
import ImportMenu from "../components/ImportMenu.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api";

export default function Classes() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [students, setStudents] = useState([]);

  const [loadError, setLoadError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = () => fetch(`${API}/classes`).then((r) => {
    if (r.status === 401) { localStorage.removeItem("token"); localStorage.removeItem("user"); location.reload(); return []; }
    return r.json();
  }).then((d) => { setClasses(Array.isArray(d) ? d : []); setLoadError(false); }).catch(() => setLoadError(true)).finally(() => setLoaded(true));
  useEffect(() => {
    const timer = setTimeout(() => { if (classes.length === 0) setLoadError(true); }, 15000);
    load().then(() => clearTimeout(timer));
    return () => clearTimeout(timer);
  }, []);

  const MAX_CARDS = 50;

  const startNew = () => {
    setEditing({ id: null });
    setName("");
    setStudents([{ card_id: 1, name: "" }]);
  };

  const startEdit = (cls) => {
    setEditing(cls);
    setName(cls.name);
    const sorted = [...cls.students].sort((a, b) => a.card_id - b.card_id);
    const rows = sorted.map((s, i) => ({ card_id: i + 1, name: s.name }));
    if (rows.length === 0) rows.push({ card_id: 1, name: "" });
    setStudents(rows);
  };

  const save = async () => {
    const filled = students.filter((s) => s.name.trim() !== "");
    const body = { name, students: filled.map((s) => ({ card_id: s.card_id, name: s.name.trim() })) };
    if (editing.id) {
      await fetch(`${API}/classes/${editing.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } else {
      await fetch(`${API}/classes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    setEditing(null);
    load();
  };

  const remove = async (id) => {
    if (!confirm(t("classes.deleteConfirm"))) return;
    await fetch(`${API}/classes/${id}`, { method: "DELETE" });
    load();
  };

  const importJson = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.type === "cardvote_class") {
        await fetch(`${API}/import/class`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
        load();
      } else { alert(t("classes.invalidFormat")); }
    };
    input.click();
  };

  const importXlsx = async () => {
    const className = prompt(t("classes.classNamePrompt"));
    if (!className) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/import/class-xlsx?name=${encodeURIComponent(className)}`, { method: "POST", body: form });
      if (res.ok) { load(); } else { const err = await res.json(); alert(err.detail || t("classes.importError")); }
    };
    input.click();
  };

  const updateStudent = (idx, value) => {
    const updated = [...students];
    updated[idx] = { ...updated[idx], name: value };
    setStudents(updated);
  };

  const removeStudent = (idx) => {
    if (!confirm(t("classes.removeCardConfirm"))) return;
    const updated = students.filter((_, i) => i !== idx);
    setStudents(updated.map((s, i) => ({ ...s, card_id: i + 1 })));
  };

  const addRow = () => {
    if (students.length >= MAX_CARDS) return;
    setStudents([...students, { card_id: students.length + 1, name: "" }]);
  };

  const downloadFile = async (url, filename) => {
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (editing) {
    const filled = students.filter((s) => s.name.trim() !== "").length;
    return (
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{editing.id ? t("classes.editTitle") : t("classes.newTitle")}</h2>
        <div style={{ marginBottom: 16 }}>
          <input placeholder={t("classes.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)}
            style={{ padding: "10px 14px", fontSize: 18, width: 300, border: "1px solid var(--border2)", borderRadius: 10 }} autoFocus />
        </div>
        <p style={{ color: "var(--text3)", marginBottom: 8, fontSize: 14 }}>
          {t("classes.fillHint", { filled, total: students.length })}
        </p>
        <div style={{ maxWidth: 500, marginBottom: 12 }}>
          {students.map((s, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ width: 44, textAlign: "right", fontWeight: 700, color: s.name.trim() ? "var(--text)" : "var(--border2)", fontSize: 14, flexShrink: 0 }}>
                #{s.card_id}
              </span>
              <input value={s.name} onChange={(e) => updateStudent(idx, e.target.value)} placeholder={t("common.name")}
                style={{ flex: 1, padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)" }} />
              <button onClick={() => removeStudent(idx)} style={{ border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", alignItems: "center", flexShrink: 0 }} title={t("classes.removeCard")}>
                <Icon d={ICONS.trash} color={C.danger} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <button onClick={addRow} disabled={students.length >= MAX_CARDS} style={{ ...btnSecondary, opacity: students.length >= MAX_CARDS ? 0.4 : 1 }}>{t("classes.addRow")}</button>
          <button onClick={save} disabled={!name.trim()} style={btnPrimary}>{t("common.save")}</button>
          <button onClick={() => setEditing(null)} style={btnSecondary}>{t("common.cancel")}</button>
        </div>
        <p style={{ fontSize: 12, color: "var(--text3)", margin: 0 }}>
          {t("classes.limit", { max: MAX_CARDS, count: students.length })}
        </p>
      </div>
    );
  }

  if (loadError && classes.length === 0 && !editing) return <p style={{ color: "#d1350f" }}>{t("common.connectionError")}</p>;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={startNew} style={btnPrimary}>{t("classes.new")}</button>
        <div style={{ marginLeft: 8 }}>
          <ImportMenu
            importItems={[
              { label: t("classes.importExcel"), onClick: importXlsx },
              { label: t("classes.importJson"), onClick: importJson },
            ]}
            templateItems={[
              { label: t("classes.templateExcel"), href: `${API}/import/class-template.xlsx` },
            ]}
          />
        </div>
      </div>

      {!loaded && !loadError && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("common.loading")}</p>}
      {loaded && !loadError && classes.length === 0 && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("classes.empty")}</p>}

      {classes.map((cls) => (
        <div key={cls.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", marginBottom: 10, border: "1px solid var(--border)", borderRadius: 16, background: "var(--card)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong style={{ fontSize: 16, color: "var(--text)" }}>{cls.name}</strong>
            <span style={{ color: "var(--text3)", fontSize: 13 }}>{cls.students.length} {t("classes.learners")}</span>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <Link to={`/class-evaluation/${cls.id}`} className="icon-btn" style={{ ...iconBtn, textDecoration: "none" }} title={t("classes.evalTitle")}><Icon d={ICONS.chart} color="#0066cc" /></Link>
            <button onClick={() => downloadFile(`${API}/classes/${cls.id}/cards-pdf`, `CardVote_${cls.name}.pdf`)} className="icon-btn" style={iconBtn} title={t("classes.printCards")}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/></svg></button>
            <button onClick={() => downloadFile(`${API}/export/class/${cls.id}`, `${cls.name}.json`)} className="icon-btn" style={iconBtn} title={t("classes.export")}><Icon d={ICONS.download} /></button>
            <button onClick={() => startEdit(cls)} className="icon-btn" style={iconBtn} title={t("common.edit")}><Icon d={ICONS.edit} /></button>
            <button onClick={() => remove(cls.id)} className="icon-btn" style={iconBtn} title={t("common.delete")}><Icon d={ICONS.trash} color={C.danger} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

const btnSecondary = { padding: "9px 18px", cursor: "pointer", fontSize: 14, border: "1px solid var(--border2)", borderRadius: 980, background: "var(--card)", color: "var(--text)", fontWeight: 500, letterSpacing: "-0.1px" };
const btnPrimary = { padding: "9px 18px", cursor: "pointer", fontSize: 14, border: "none", borderRadius: 980, background: "var(--text)", color: "var(--bg)", fontWeight: 600, letterSpacing: "-0.1px" };
