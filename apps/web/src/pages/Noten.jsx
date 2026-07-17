// Modul Noten: Leistungsbewertung.
//
// Bewusst KEINE Zeugnisnote: das Werkzeug mittelt die eingetragenen Noten
// gewichtet und zeigt, wie viel des Leistungskonzepts schon abgedeckt ist.
// Beobachtungen werden gesammelt, aber nie gerechnet — "Anstrengungsbereitschaft"
// ist kein Messwert, und ein Schnitt daraus wäre Scheinobjektivität.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon, ICONS, iconBtn, COLORS as C } from "../components/Icons.jsx";

const API = "/api/noten";

// Ganze Noten plus Tendenzen — dieselbe Skala, die CardVote auswirft.
const NOTEN = [1, 1.3, 1.7, 2, 2.3, 2.7, 3, 3.3, 3.7, 4, 4.3, 4.7, 5, 5.3, 5.7, 6];

export default function Noten() {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [cats, setCats] = useState([]);
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState([]);
  const [error, setError] = useState("");
  const [neueKat, setNeueKat] = useState({ name: "", weight: "" });
  const [erfassen, setErfassen] = useState(null); // {student, kind}

  useEffect(() => {
    fetch("/api/classes").then((r) => (r.ok ? r.json() : [])).then((d) => {
      const list = Array.isArray(d) ? d : [];
      setClasses(list);
      if (list.length && classId === null) setClassId(list[0].id);
    }).catch(() => {});
  }, []);

  const load = async (id) => {
    if (!id) return;
    const [c, e, s] = await Promise.all([
      fetch(`${API}/classes/${id}/categories`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/classes/${id}/entries`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API}/classes/${id}/summary`).then((r) => (r.ok ? r.json() : [])),
    ]);
    setCats(c); setEntries(e); setSummary(s);
  };
  useEffect(() => { load(classId); }, [classId]);

  const call = async (fn) => {
    setError("");
    const res = await fn();
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.detail === "string" ? b.detail : "Das hat nicht geklappt");
      return false;
    }
    await load(classId);
    return true;
  };

  const addKat = async (e) => {
    e.preventDefault();
    if (!neueKat.name.trim()) return;
    const ok = await call(() => fetch(`${API}/classes/${classId}/categories`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: neueKat.name.trim(), weight: Number(neueKat.weight) || 0, position: cats.length }),
    }));
    if (ok) setNeueKat({ name: "", weight: "" });
  };

  const delKat = async (k) => {
    const n = entries.filter((e) => e.category_id === k.id).length;
    if (!confirm(`„${k.name}“ löschen?${n ? `\n${n} Eintrag/Einträge verschwinden mit.` : ""}`)) return;
    await call(() => fetch(`${API}/categories/${k.id}`, { method: "DELETE" }));
  };

  const speichern = async (body) => {
    const ok = await call(() => fetch(`${API}/entries`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    if (ok) setErfassen(null);
  };

  const gewichtSumme = cats.reduce((n, k) => n + (k.weight || 0), 0);
  const klasse = classes.find((c) => c.id === classId);

  if (classes.length === 0) {
    return (
      <div style={{ maxWidth: 700 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Noten</h1>
        <p style={{ color: "var(--text2)", fontSize: 14 }}>
          Noch keine Klasse. Lege sie unter <Link to="/classes" style={{ color: "var(--accent)" }}>Klassen</Link> an —
          Klassen und Schüler gehören Nuvora, alle Module nutzen dieselben.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Noten</h1>
        <select
          value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)" }}
        >
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <p style={{ color: "var(--text2)", marginBottom: 20, fontSize: 14 }}>
        Der Schnitt ist eine Rechenhilfe aus deinen Noten, keine Zeugnisnote.
        Beobachtungen werden gesammelt, aber nie mitgerechnet.
      </p>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      {/* ─── Kategorien ─── */}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Kategorien</h2>
      <p style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 10 }}>
        Aus deinem Leistungskonzept, z. B. „Selbstständiges und kooperatives Arbeiten" mit 15 %.
        {gewichtSumme > 0 && (
          <> Summe: <strong style={{ color: gewichtSumme === 100 ? "var(--text2)" : "#b8860b" }}>{gewichtSumme} %</strong>
          {gewichtSumme !== 100 && " — ergibt noch nicht 100 %."}</>
        )}
      </p>

      {cats.map((k) => (
        <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", marginBottom: 5, border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)" }}>
          <span style={{ flex: 1, fontSize: 14 }}>{k.name}</span>
          <span style={{ fontSize: 13, color: "var(--text3)" }}>{k.weight} %</span>
          <button onClick={() => delKat(k)} className="icon-btn" style={iconBtn} title="Löschen">
            <Icon d={ICONS.trash} color={C.danger} />
          </button>
        </div>
      ))}

      <form onSubmit={addKat} style={{ display: "flex", gap: 8, margin: "10px 0 26px", flexWrap: "wrap" }}>
        <input
          value={neueKat.name} onChange={(e) => setNeueKat({ ...neueKat, name: e.target.value })}
          placeholder="Neue Kategorie" style={{ flex: 1, minWidth: 200, ...inp }}
        />
        <input
          type="number" min={0} max={100} value={neueKat.weight}
          onChange={(e) => setNeueKat({ ...neueKat, weight: e.target.value })}
          placeholder="%" style={{ width: 80, ...inp }}
        />
        <button type="submit" disabled={!neueKat.name.trim()} style={{ ...btnPrimary, opacity: neueKat.name.trim() ? 1 : 0.4 }}>
          Hinzufügen
        </button>
      </form>

      {/* ─── Übersicht ─── */}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{klasse?.name}</h2>
      {cats.length === 0 ? (
        <p style={{ fontSize: 13.5, color: "var(--text3)" }}>Lege zuerst eine Kategorie an.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Name</th>
                {cats.map((k) => (
                  <th key={k.id} style={th} title={`${k.name} · ${k.weight} %`}>
                    {k.name.length > 14 ? k.name.slice(0, 13) + "…" : k.name}
                    <div style={{ fontWeight: 400, color: "var(--text3)", fontSize: 11 }}>{k.weight} %</div>
                  </th>
                ))}
                <th style={th}>Schnitt</th>
                <th style={th}>Beob.</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.student_id}>
                  <td style={{ ...td, textAlign: "left" }}>{s.name}</td>
                  {cats.map((k) => (
                    <td key={k.id} style={td}>
                      {s.per_category[String(k.id)] ?? <span style={{ color: "var(--border2)" }}>–</span>}
                    </td>
                  ))}
                  <td style={{ ...td, fontWeight: 700 }}>
                    {s.weighted ?? <span style={{ color: "var(--border2)" }}>–</span>}
                    {s.weighted !== null && s.weight_covered < 100 && (
                      <div style={{ fontWeight: 400, fontSize: 10.5, color: "#b8860b" }} title="So viel Prozent deines Konzepts sind bisher mit Noten belegt">
                        {s.weight_covered} % belegt
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, color: "var(--text3)" }}>{s.observations || ""}</td>
                  <td style={td}>
                    <button onClick={() => setErfassen({ student: s, kind: "grade" })} style={{ ...btnSecondary, padding: "3px 9px", fontSize: 12 }}>+</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {erfassen && (
        <Erfassen
          student={erfassen.student} cats={cats}
          entries={entries.filter((e) => e.student_id === erfassen.student.student_id)}
          onClose={() => setErfassen(null)} onSave={speichern}
          onDelete={(id) => call(() => fetch(`${API}/entries/${id}`, { method: "DELETE" }))}
        />
      )}
    </div>
  );
}

function Erfassen({ student, cats, entries, onClose, onSave, onDelete }) {
  const [kind, setKind] = useState("grade");
  const [catId, setCatId] = useState(cats[0]?.id ?? null);
  const [value, setValue] = useState(2);
  const [tendency, setTendency] = useState(1);
  const [note, setNote] = useState("");

  const speichern = () => onSave({
    category_id: catId, student_id: student.student_id, kind,
    value: kind === "grade" ? Number(value) : null,
    tendency: kind === "observation" ? tendency : null,
    note,
  });

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 18, maxWidth: 460, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 22, border: "1px solid var(--border)" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>{student.name}</h3>

        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {[["grade", "Note"], ["observation", "Beobachtung"]].map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)} style={{
              ...btnSecondary, flex: 1,
              border: kind === k ? "1px solid var(--accent)" : "1px solid var(--border2)",
              background: kind === k ? "var(--accent-bg)" : "var(--card)",
              color: kind === k ? "var(--accent)" : "var(--text2)",
            }}>{label}</button>
          ))}
        </div>

        <Feld label="Kategorie">
          <select value={catId ?? ""} onChange={(e) => setCatId(Number(e.target.value))} style={inp}>
            {cats.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.weight} %)</option>)}
          </select>
        </Feld>

        {kind === "grade" ? (
          <Feld label="Note">
            <select value={value} onChange={(e) => setValue(e.target.value)} style={inp}>
              {NOTEN.map((n) => <option key={n} value={n}>{n.toFixed(1).replace(".", ",")}</option>)}
            </select>
          </Feld>
        ) : (
          <Feld label="Richtung">
            <div style={{ display: "flex", gap: 6 }}>
              {[[1, "positiv"], [0, "neutral"], [-1, "negativ"]].map(([v, label]) => (
                <button key={v} onClick={() => setTendency(v)} style={{
                  ...btnSecondary, flex: 1,
                  border: tendency === v ? "1px solid var(--accent)" : "1px solid var(--border2)",
                  background: tendency === v ? "var(--accent-bg)" : "var(--card)",
                }}>{label}</button>
              ))}
            </div>
          </Feld>
        )}

        <Feld label={kind === "grade" ? "Notiz (optional)" : "Was war?"}>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000}
            placeholder={kind === "grade" ? "z. B. Kurztest Bruchrechnung" : "z. B. hat unaufgefordert geholfen"}
            style={{ ...inp, resize: "vertical" }}
          />
        </Feld>

        <div style={{ display: "flex", gap: 8, marginTop: 6, marginBottom: 18 }}>
          <button onClick={speichern} disabled={!catId} style={{ ...btnPrimary, opacity: catId ? 1 : 0.4 }}>Speichern</button>
          <button onClick={onClose} style={btnSecondary}>Schließen</button>
        </div>

        {entries.length > 0 && (
          <>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>Bisher</div>
            {entries.map((e) => {
              const k = cats.find((c) => c.id === e.category_id);
              return (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 12.5 }}>
                  <span style={{ width: 70, color: "var(--text3)" }}>
                    {new Date(e.date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: "var(--text3)" }}>{k?.name}: </span>
                    {e.kind === "grade"
                      ? <strong>{e.value?.toFixed(1).replace(".", ",")}</strong>
                      : <span style={{ color: e.tendency > 0 ? "#0a7d3e" : e.tendency < 0 ? "var(--danger, #dc2626)" : "var(--text2)" }}>
                          {e.tendency > 0 ? "+" : e.tendency < 0 ? "−" : "·"}
                        </span>}
                    {e.note && <span style={{ color: "var(--text2)" }}> {e.note}</span>}
                  </span>
                  <button onClick={() => onDelete(e.id)} className="icon-btn" style={iconBtn} title="Löschen">
                    <Icon d={ICONS.trash} color={C.danger} />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function Feld({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12.5, color: "var(--text2)", marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

const inp = { width: "100%", padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
const th = { padding: "8px 6px", borderBottom: "2px solid var(--border)", fontWeight: 600, fontSize: 12, color: "var(--text2)", textAlign: "center", whiteSpace: "nowrap" };
const td = { padding: "7px 6px", borderBottom: "1px solid var(--border)", textAlign: "center", color: "var(--text)" };
const btnSecondary = { padding: "7px 14px", cursor: "pointer", fontSize: 13.5, border: "1px solid var(--border2)", borderRadius: 980, background: "var(--card)", color: "var(--text)", fontWeight: 500 };
const btnPrimary = { padding: "7px 14px", cursor: "pointer", fontSize: 13.5, border: "none", borderRadius: 980, background: "var(--text)", color: "var(--bg)", fontWeight: 600 };
