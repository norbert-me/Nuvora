// Modul Lernpfad: Aufgaben — auf dem Nuvora-Kern.
//
// Unterschied zur alten App: das Thema ist kein Freitext mehr, sondern zeigt
// auf die Kern-Taxonomie (dieselbe, die CardVote-Fragen nutzen). Erst dadurch
// findet ein schwach ausgefallenes Testthema seine Uebungsaufgaben.
import { useState, useEffect } from "react";
import { askConfirm } from "../../core/dialog.jsx";
import { AddButton, Icon, ICONS, iconBtn, btnPrimary, btnSecondary, cardStyle, COLORS as C, inputStyle, pageApp, pageTitle, selectStyle } from "../../components/Icons.jsx";
import Werkzeugleiste, { MehrMenu } from "../../components/Werkzeugleiste.jsx";
import TopicPicker from "../../components/TopicPicker.jsx";
import { useLanguage } from "../../i18n/index.jsx";

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
  const { t } = useLanguage();
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
      .catch(() => setError(t("lp.ex.loadError")))
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
      setError(b.detail || t("lp.ex.saveError"));
      return;
    }
    setEditing(null);
    load();
  };

  const remove = async (ex) => {
    if (!await askConfirm(t("lp.ex.deleteConfirm"))) return;
    await fetch(`${API}/exercises/${ex.id}`, { method: "DELETE" });
    load();
  };

  const shown = filterTopic ? items.filter((i) => i.topic_id === filterTopic) : items;

  if (editing) {
    return (
      <div style={pageApp}>
        <h2 style={{ ...pageTitle, marginBottom: 16 }}>
          {editing.id ? t("lp.ex.editTitle") : t("lp.ex.newTitle")}
        </h2>
        {error && <p style={{ color: C.danger, fontSize: 13 }}>{error}</p>}

        <Field label={t("lp.ex.topic")}>
          <TopicPicker value={editing.topic_id} onChange={(id) => setEditing({ ...editing, topic_id: id })} />
        </Field>

        <Field label={t("lp.ex.text")}>
          <textarea
            value={editing.aufgabentext} onChange={(e) => setEditing({ ...editing, aufgabentext: e.target.value })}
            rows={3} autoFocus style={inp}
          />
        </Field>

        <Field label={t("lp.ex.solution")}>
          <textarea value={editing.loesung} onChange={(e) => setEditing({ ...editing, loesung: e.target.value })} rows={2} style={inp} />
        </Field>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Field label={t("lp.ex.category")}>
            <Select value={editing.kategorie} onChange={(v) => setEditing({ ...editing, kategorie: v })} options={KATEGORIEN} />
          </Field>
          <Field label={t("lp.ex.competence")}>
            <Select value={editing.kompetenz} onChange={(v) => setEditing({ ...editing, kompetenz: v })} options={KOMPETENZEN} allowEmpty />
          </Field>
          <Field label={t("lp.ex.method")}>
            <Select value={editing.methode} onChange={(v) => setEditing({ ...editing, methode: v })} options={METHODEN} allowEmpty />
          </Field>
          <Field label={t("lp.ex.subtasks")}>
            <input
              type="number" min={1} max={99} value={editing.unteraufgaben}
              onChange={(e) => setEditing({ ...editing, unteraufgaben: Number(e.target.value) || 1 })}
              style={{ ...inp, width: 80 }}
            />
          </Field>
        </div>

        <Field label={t("lp.ex.operator")}>
          <input value={editing.operator} onChange={(e) => setEditing({ ...editing, operator: e.target.value })} placeholder={t("lp.ex.operatorPh")} style={{ ...inp, maxWidth: 260 }} />
        </Field>

        <Field label={t("lp.ex.source")}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={editing.quelle_typ} onChange={(e) => setEditing({ ...editing, quelle_typ: e.target.value })} placeholder={t("lp.ex.sourceTypePh")} style={{ ...inp, maxWidth: 180 }} />
            <input value={editing.quelle_detail} onChange={(e) => setEditing({ ...editing, quelle_detail: e.target.value })} placeholder={t("lp.ex.sourceDetailPh")} style={{ ...inp, maxWidth: 200 }} />
          </div>
        </Field>

        <div style={{ marginTop: 8, marginBottom: 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
            <input type="checkbox" checked={!!editing.lrs} onChange={(e) => setEditing({ ...editing, lrs: e.target.checked })} />
            {t("lp.ex.lrs")}
          </label>
          {editing.lrs && (
            <textarea
              value={editing.lrs_text} onChange={(e) => setEditing({ ...editing, lrs_text: e.target.value })}
              rows={2} placeholder={t("lp.ex.lrsPh")} style={{ ...inp, marginTop: 8 }}
            />
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={save} disabled={!editing.aufgabentext.trim()} style={{ ...btnPrimary, opacity: editing.aufgabentext.trim() ? 1 : 0.4 }}>{t("common.save")}</button>
          <button onClick={() => setEditing(null)} style={btnSecondary}>{t("common.cancel")}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={pageApp}>
      <h1 style={pageTitle}>{t("lp.ex.title")}</h1>
      <p style={{ color: "var(--text2)", marginBottom: 16, fontSize: 14 }}>
        {t("lp.ex.intro")}
      </p>

      {error && <p style={{ color: C.danger, fontSize: 13, marginBottom: 8 }}>{error}</p>}

      {/* Werkzeugleiste wie ueberall: links die Auswahl (Themenfilter), daneben
          der eine haeufige Handgriff (neue Aufgabe). */}
      <Werkzeugleiste links={<>
        <span style={{ fontSize: 13, color: "var(--text2)" }}>{t("common.filter")}:</span>
        <TopicPicker value={filterTopic} onChange={setFilterTopic} />
      </>}>
        <AddButton onClick={() => setEditing({ ...EMPTY })} title={t("lp.ex.newTitle")} />
      </Werkzeugleiste>

      {!loaded && <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("common.loading")}</p>}
      {loaded && shown.length === 0 && (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>
          {items.length === 0 ? t("lp.ex.empty") : t("lp.ex.emptyTopic")}
        </p>
      )}

      {shown.map((ex) => (
        <div key={ex.id} style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, color: "var(--text)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ex.aufgabentext || <span style={{ color: "var(--text3)" }}>{t("lp.ex.noText")}</span>}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span>{topicLabel(ex.topic_id)}</span>
              {ex.kategorie && <span>· {ex.kategorie}</span>}
              {ex.quelle_detail && <span>· {ex.quelle_detail}</span>}
              {ex.lrs && <span>· LRS</span>}
            </div>
          </div>
          <button onClick={() => setEditing({ ...ex })} className="icon-btn" style={iconBtn} title={t("common.edit")} aria-label={t("common.edit")}><Icon d={ICONS.edit} /></button>
          {/* Loeschen stand direkt neben Bearbeiten — zwei Pixel daneben und die
              Aufgabe ist weg. Es liegt jetzt im ⋯-Menue, unten und rot. */}
          <MehrMenu eintraege={[{ key: "del", label: t("common.delete"), icon: ICONS.trash, gefahr: true, onClick: () => remove(ex) }]} />
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Select({ value, onChange, options, allowEmpty }) {
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
      {allowEmpty && <option value="">–</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

const inp = { ...inputStyle, width: "100%", resize: "vertical" };
