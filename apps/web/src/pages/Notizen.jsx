// Modul Beobachtungen — formative Notizen je Schüler. Bewusst getrennt von der
// Note. Klasse wählen → Schüler → Notizen (Datum, Kategorie, Text).
import { useState, useEffect } from "react";
import { pageTitle, btnPrimary, btnSecondary, inputStyle, selectStyle, Icon, ICONS, iconBtn, COLORS as C, Empty, pageApp} from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { swr, lastClass, rememberClass } from "../core/cache.js";
import { useUrlClass } from "../core/klassenwahl.js";

const API = "/api/notizen";
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function Notizen() {
  const { t } = useLanguage();
  const CATS = [t("notizen.catEffort"), t("notizen.catSocial"), t("notizen.catProgress"), t("notizen.catOther")];
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [counts, setCounts] = useState({});
  const [sel, setSel] = useState(null); // gewählter Schüler
  const [list, setList] = useState([]);
  const [text, setText] = useState("");
  const [cat, setCat] = useState("");
  const [date, setDate] = useState(ymd(new Date()));

  useEffect(() => swr("classes", "/api/classes", (d) => {
    const l = Array.isArray(d) ? d : []; setClasses(l);
    if (classId === null && l.length) { const w = lastClass(); setClassId(l.some((c) => c.id === w) ? w : l[0].id); }
  }), []);
  // Aus dem Kurs verlinkt (?class=&kurs=): dann diesen Inhalt zeigen. Als
  // einzige der Schueler-Seiten fehlte das hier — wer aus dem Kurs in die
  // Beobachtungen sprang, landete bei der zuletzt gewaehlten Klasse und sah
  // die Notizen fremder Kinder.
  useUrlClass(setClassId);
  useEffect(() => { if (classId) rememberClass(classId); }, [classId]);

  const cls = classes.find((c) => c.id === classId);
  const students = cls?.students || [];

  const loadCounts = () => { if (classId) fetch(`${API}/counts?class_id=${classId}`).then((r) => (r.ok ? r.json() : {})).then((d) => setCounts(d || {})).catch(() => {}); };
  useEffect(() => { setSel(null); loadCounts(); }, [classId]);

  const loadList = (sid) => fetch(`${API}?student_id=${sid}`).then((r) => (r.ok ? r.json() : [])).then((d) => setList(Array.isArray(d) ? d : [])).catch(() => {});
  const open = (s) => { setSel(s); setText(""); setCat(""); setDate(ymd(new Date())); loadList(s.id); };

  const add = async () => {
    if (!sel || !text.trim()) return;
    await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ student_id: sel.id, date: date || null, category: cat || "", text: text.trim() }) }).catch(() => {});
    setText(""); loadList(sel.id); loadCounts();
  };
  const del = async (id) => { await fetch(`${API}/${id}`, { method: "DELETE" }).catch(() => {}); if (sel) loadList(sel.id); loadCounts(); };
  const fmt = (iso) => { try { return new Date(iso + "T00:00:00").toLocaleDateString(); } catch { return iso; } };

  return (
    <div style={{ ...pageApp }}>
      <p style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 16 }}>{t("notizen.intro")}</p>

      <div style={{ marginBottom: 16 }}><KursKlasseSelect value={classId} onChange={setClassId} /></div>

      {!sel ? (
        students.length === 0 ? <Empty title={t("notizen.noStudents")} /> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
            {students.map((s) => (
              <button key={s.id} onClick={() => open(s)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                {counts[String(s.id)] > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: "1px 8px", borderRadius: 980, background: "var(--accent-bg, rgba(10,132,255,0.12))", color: "var(--accent)" }}>{counts[String(s.id)]}</span>}
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <button onClick={() => setSel(null)} style={{ ...btnSecondary, padding: "6px 12px" }}>← {t("common.back")}</button>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{sel.name}</h2>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", padding: 14, marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, padding: "8px 8px" }} />
              <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ ...selectStyle, padding: "8px 26px 8px 10px", fontSize: 13 }}>
                <option value="">{t("notizen.category")}</option>
                {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={t("notizen.placeholder")} rows={3} style={{ ...inputStyle, width: "100%", resize: "vertical", boxSizing: "border-box" }} />
            <div style={{ marginTop: 8, textAlign: "right" }}>
              <button onClick={add} disabled={!text.trim()} style={{ ...btnPrimary, opacity: text.trim() ? 1 : 0.5 }}>{t("common.add")}</button>
            </div>
          </div>

          {list.length === 0 ? (
            <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("notizen.empty")}</p>
          ) : list.map((o) => (
            <div key={o.id} style={{ display: "flex", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)", marginBottom: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 2 }}>
                  {o.date ? fmt(o.date) : ""}{o.category ? ` · ${o.category}` : ""}
                </div>
                <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{o.text}</div>
              </div>
              <button onClick={() => del(o.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
