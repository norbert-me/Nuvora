// Modul Lernpfad: Aufgaben — auf dem Nuvora-Kern.
//
// Unterschied zur alten App: das Thema ist kein Freitext mehr, sondern zeigt
// auf die Kern-Taxonomie (dieselbe, die CardVote-Fragen nutzen). Erst dadurch
// findet ein schwach ausgefallenes Testthema seine Uebungsaufgaben.
import { useState, useEffect } from "react";
import { Icon, ICONS, iconBtn, COLORS as C } from "../../components/Icons.jsx";
import TopicPicker from "../../components/TopicPicker.jsx";

const API = "/api/lernpfad";

const KATEGORIEN = ["Basis", "Standard", "Erweitert"];
const KOMPETENZEN = ["Operieren", "Modellieren", "Argumentieren", "Darstellen", "Problemlösen", "Kommunizieren"];
const METHODEN = ["Einzelarbeit", "Partnerarbeit", "Gruppenarbeit", "Plenum"];

const EMPTY = {
  topic_id: null, kategorie: "Basis", aufgabentext: "", loesung: "",
  operator: "", kompetenz: "", methode: "", unteraufgaben: 1,
  quelle_typ: "", quelle_detail: "", lrs: false, lrs_text: "",
  foerderschwerpunkte: null, latex: "",
};

export default function Exercises() {
  const [items, setItems] = useState([]);
  const [topics, setTopics] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [filterTopic, setFilterTopic] = useState(null);

  const load = () =>
    fetch(`${API}/exercises`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setItems(Array.isArray(d) ? d : []))
      .catch(() => setError("Aufgaben konnten nicht geladen werden"))
      .finally(() => setLoaded(true));

  useEffect(() => {
    load();
    fetch("/api/topics").then((r) => (r.ok ? r.json() : [])).then((d) => setTopics(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const topicLabel = (id) => {
    const t = topics.find((x) => x.id === id);
    if (!t) return "—";
    const p = t.parent_id ? topics.find((x) => x.id === t.parent_id) : null;
    return p ? `${p.name} / ${t.name}` : t.name;
  };

  const save = async () => {
    setError("");
    const isNew = !editing.id;
    const res = await fetch(isNew ? `${API}/exercises` : `${API}/exercises/${editing.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...EMPTY, ...editing, id: undefined }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.detail || "Speichern fehlgeschlagen");
      return;
    }
    setEditing(null);
    load();
  };

  const remove = async (ex) => {
    if (!confirm("Aufgabe löschen?")) return;
    await fetch(`${API}/exercises/${ex.id}`, { method: "DELETE" });
    load();
  };

  const shown = filterTopic ? items.filter((i) => i.topic_id === filterTopic) : items;

  if (editing) {
    return (
      <div style={{ maxWidth: 720 }}>
        <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 16 }}>
          {editing.id ? "Aufgabe bearbeiten" : "Neue Aufgabe"}
        </h2>
        {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13 }}>{error}</p>}

        <Field label="Thema">
          <TopicPicker value={editing.topic_id} onChange={(id) => setEditing({ ...editing, topic_id: id })} />
        </Field>

        <Field label="Aufgabentext">
          <textarea
            value={editing.aufgabentext} onChange={(e) => setEditing({ ...editing, aufgabentext: e.target.value })}
            rows={3} autoFocus style={inp}
          />
        </Field>

        <Field label="Lösung">
          <textarea value={editing.loesung} onChange={(e) => setEditing({ ...editing, loesung: e.target.value })} rows={2} style={inp} />
        </Field>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Field label="Kategorie">
            <Select value={editing.kategorie} onChange={(v) => setEditing({ ...editing, kategorie: v })} options={KATEGORIEN} />
          </Field>
          <Field label="Kompetenz">
            <Select value={editing.kompetenz} onChange={(v) => setEditing({ ...editing, kompetenz: v })} options={KOMPETENZEN} allowEmpty />
          </Field>
          <Field label="Methode">
            <Select value={editing.methode} onChange={(v) => setEditing({ ...editing, methode: v })} options={METHODEN} allowEmpty />
          </Field>
          <Field label="Unteraufgaben">
            <input
              type="number" min={1} max={99} value={editing.unteraufgaben}
              onChange={(e) => setEditing({ ...editing, unteraufgaben: Number(e.target.value) || 1 })}
              style={{ ...inp, width: 80 }}
            />
          </Field>
        </div>

        <Field label="Operator">
          <input value={editing.operator} onChange={(e) => setEditing({ ...editing, operator: e.target.value })} placeholder="z. B. Berechne" style={{ ...inp, maxWidth: 260 }} />
        </Field>

        <Field label="Quelle">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={editing.quelle_typ} onChange={(e) => setEditing({ ...editing, quelle_typ: e.target.value })} placeholder="z. B. schulbuch" style={{ ...inp, maxWidth: 180 }} />
            <input value={editing.quelle_detail} onChange={(e) => setEditing({ ...editing, quelle_detail: e.target.value })} placeholder="z. B. S.10 Nr.1" style={{ ...inp, maxWidth: 200 }} />
          </div>
        </Field>

        <div style={{ marginTop: 8, marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={!!editing.lrs} onChange={(e) => setEditing({ ...editing, lrs: e.target.checked })} />
            LRS-Variante vorhanden
          </label>
          {editing.lrs && (
            <textarea
              value={editing.lrs_text} onChange={(e) => setEditing({ ...editing, lrs_text: e.target.value })}
              rows={2} placeholder="Angepasster Text" style={{ ...inp, marginTop: 8 }}
            />
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={save} disabled={!editing.aufgabentext.trim()} style={{ ...btnPrimary, opacity: editing.aufgabentext.trim() ? 1 : 0.4 }}>Speichern</button>
          <button onClick={() => setEditing(null)} style={btnSecondary}>Abbrechen</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Aufgaben</h1>
      <p style={{ color: "var(--text2)", marginBottom: 18, fontSize: 14 }}>
        Aufgaben hängen an Themen aus dem Kern — denselben, die CardVote-Fragen nutzen.
      </p>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <button onClick={() => setEditing({ ...EMPTY })} style={btnPrimary}>Neue Aufgabe</button>
        <span style={{ fontSize: 13, color: "var(--text2)" }}>Filter:</span>
        <TopicPicker value={filterTopic} onChange={setFilterTopic} />
      </div>

      {!loaded && <p style={{ color: "var(--text3)", fontSize: 14 }}>Lädt…</p>}
      {loaded && shown.length === 0 && (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>
          {items.length === 0 ? "Noch keine Aufgaben." : "Keine Aufgabe zu diesem Thema."}
        </p>
      )}

      {shown.map((ex) => (
        <div key={ex.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", marginBottom: 8, border: "1px solid var(--border)", borderRadius: 14, background: "var(--card)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, color: "var(--text)", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ex.aufgabentext || <span style={{ color: "var(--text3)" }}>(ohne Text)</span>}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span>{topicLabel(ex.topic_id)}</span>
              {ex.kategorie && <span>· {ex.kategorie}</span>}
              {ex.quelle_detail && <span>· {ex.quelle_detail}</span>}
              {ex.lrs && <span>· LRS</span>}
            </div>
          </div>
          <button onClick={() => setEditing({ ...ex })} className="icon-btn" style={iconBtn} title="Bearbeiten"><Icon d={ICONS.edit} /></button>
          <button onClick={() => remove(ex)} className="icon-btn" style={iconBtn} title="Löschen"><Icon d={ICONS.trash} color={C.danger} /></button>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

function Select({ value, onChange, options, allowEmpty }) {
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ ...inp, width: "auto" }}>
      {allowEmpty && <option value="">–</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

const inp = { width: "100%", padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box", resize: "vertical" };
const btnSecondary = { padding: "9px 18px", cursor: "pointer", fontSize: 14, border: "1px solid var(--border2)", borderRadius: 980, background: "var(--card)", color: "var(--text)", fontWeight: 500 };
const btnPrimary = { padding: "9px 18px", cursor: "pointer", fontSize: 14, border: "none", borderRadius: 980, background: "var(--text)", color: "var(--bg)", fontWeight: 600 };
