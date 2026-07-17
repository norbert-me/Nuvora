// Modul Noten: leere Tabelle, die du selbst füllst.
//
// Bedienung wie eine Tabellenkalkulation: Zeilen sind die Schüler, Spalten
// legst du an, in die Zelle wird getippt. Kein Dialog, kein Formular — wer im
// Unterricht eine Note einträgt, hat keine Zeit für drei Klicks.
//
// Bewusst KEINE vorgegebenen Kategorien: das Leistungskonzept ist
// Fachkonferenz-Recht, kein Softwareinhalt.
//
// Und bewusst keine Zeugnisnote: gerechnet wird der gewichtete Schnitt der
// eingetragenen Noten, mehr nicht. Beobachtungen zählen nie mit —
// "Anstrengungsbereitschaft" ist kein Messwert.
import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Icon, ICONS, iconBtn, COLORS as C, btnPrimary, btnSecondary, pageTitle } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";

const API = "/api/noten";

// Eingabe akzeptiert "2", "2,3", "2.3" — deutsche Schreibweise ist die
// naheliegende, der Punkt kommt von der Zehnertastatur.
function parseNote(text) {
  const n = parseFloat(String(text).replace(",", "."));
  if (Number.isNaN(n) || n < 1 || n > 6) return null;
  return Math.round(n * 10) / 10;
}

export default function Noten() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState(null);
  const [cats, setCats] = useState([]);
  const [entries, setEntries] = useState([]);
  const [summary, setSummary] = useState([]);
  const [error, setError] = useState("");
  const [neueSpalte, setNeueSpalte] = useState(false);
  const [zelle, setZelle] = useState(null);      // "studentId:catId"
  const [beobFuer, setBeobFuer] = useState(null); // student

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
      setError(typeof b.detail === "string" ? b.detail : t("common.notWork"));
      return false;
    }
    await load(classId);
    return true;
  };

  const noteSetzen = async (studentId, catId, text) => {
    setZelle(null);
    const wert = parseNote(text);
    if (wert === null) return;
    await call(() => fetch(`${API}/entries`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category_id: catId, student_id: studentId, kind: "grade", value: wert, note: "" }),
    }));
  };

  const gewichtSumme = cats.reduce((n, k) => n + (k.weight || 0), 0);
  const klasse = classes.find((c) => c.id === classId);
  const notenVon = (sid, cid) =>
    entries.filter((e) => e.student_id === sid && e.category_id === cid && e.kind === "grade");

  if (classes.length === 0) {
    return (
      <div style={{ maxWidth: 700 }}>
        <h1 style={pageTitle}>{t("noten.title")}</h1>
        <p style={{ color: "var(--text2)", fontSize: 14 }}>
          {t("noten.needClass").split("{{link}}")[0]}<Link to="/classes" style={{ color: "var(--accent)" }}>{t("nav.classes")}</Link>{t("noten.needClass").split("{{link}}")[1]}
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <h1 style={pageTitle}>{t("noten.title")}</h1>
        <select
          value={classId ?? ""} onChange={(e) => setClassId(Number(e.target.value))}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)" }}
        >
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {cats.length > 0 && (
          <span style={{ fontSize: 12.5, color: gewichtSumme === 100 ? "var(--text3)" : "#b8860b" }}>
            {gewichtSumme !== 100 ? t("noten.weightNot100", { n: gewichtSumme }) : t("noten.weightSum", { n: gewichtSumme })}
          </span>
        )}
      </div>

      {error && <p style={{ color: "var(--danger, #dc2626)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 12 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", position: "sticky", left: 0, background: "var(--card)", minWidth: 150 }}>
                {klasse?.name}
              </th>
              {cats.map((k) => (
                <Spalte key={k.id} kat={k} onSave={(b) => call(() => fetch(`${API}/categories/${k.id}`, {
                  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
                }))} onDelete={() => {
                  const n = entries.filter((e) => e.category_id === k.id).length;
                  if (!confirm(t("noten.delColumn", { name: k.name }) + (n ? "\n" + t("noten.delEntries", { n }) : ""))) return;
                  call(() => fetch(`${API}/categories/${k.id}`, { method: "DELETE" }));
                }} />
              ))}
              <th style={{ ...th, minWidth: 44 }}>
                {neueSpalte ? (
                  <NeueSpalte
                    onCancel={() => setNeueSpalte(false)}
                    onSave={async (b) => {
                      const ok = await call(() => fetch(`${API}/classes/${classId}/categories`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ ...b, position: cats.length }),
                      }));
                      if (ok) setNeueSpalte(false);
                    }}
                  />
                ) : (
                  <button onClick={() => setNeueSpalte(true)} title={t("noten.newColTitle")}
                    style={{ border: "none", background: "none", cursor: "pointer", color: "var(--accent)", fontSize: 18, lineHeight: 1, padding: 4 }}>
                    +
                  </button>
                )}
              </th>
              {cats.length > 0 && <th style={th}>{t("noten.avg")}</th>}
              <th style={{ ...th, minWidth: 40 }} title={t("noten.obsTitle")}>{t("noten.obs")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.student_id}>
                <td style={{ ...td, textAlign: "left", position: "sticky", left: 0, background: "var(--card)", fontWeight: 500 }}>
                  {s.name}
                </td>
                {cats.map((k) => {
                  const id = `${s.student_id}:${k.id}`;
                  const noten = notenVon(s.student_id, k.id);
                  return (
                    <td key={k.id} style={{ ...td, padding: 0 }}>
                      {zelle === id ? (
                        <Zelle
                          onSave={(text) => noteSetzen(s.student_id, k.id, text)}
                          onCancel={() => setZelle(null)}
                        />
                      ) : (
                        <button
                          onClick={() => setZelle(id)}
                          title={noten.length > 1 ? noten.map((e) => fmt(e.value)).join(" · ") : t("noten.enterGrade")}
                          style={{
                            width: "100%", minHeight: 34, border: "none", background: "none", cursor: "text",
                            color: "var(--text)", fontSize: 13.5, fontWeight: noten.length ? 600 : 400,
                          }}
                        >
                          {s.per_category[String(k.id)] !== undefined
                            ? String(s.per_category[String(k.id)]).replace(".", ",")
                            : <span style={{ color: "var(--border2)" }}>·</span>}
                          {noten.length > 1 && (
                            <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400 }}> ({noten.length})</span>
                          )}
                        </button>
                      )}
                    </td>
                  );
                })}
                <td style={td}></td>
                {cats.length > 0 && (
                  <td style={{ ...td, fontWeight: 700 }}>
                    {s.weighted !== null ? String(s.weighted).replace(".", ",") : <span style={{ color: "var(--border2)" }}>·</span>}
                    {s.weighted !== null && s.weight_covered < 100 && (
                      <div style={{ fontWeight: 400, fontSize: 10, color: "#b8860b" }}
                        title={t("noten.covered")}>
                        {s.weight_covered} %
                      </div>
                    )}
                  </td>
                )}
                <td style={td}>
                  <button onClick={() => setBeobFuer(s)} title={t("noten.obsHeading")}
                    style={{ border: "none", background: "none", cursor: "pointer", color: s.observations ? "var(--accent)" : "var(--text3)", fontSize: 12.5, padding: 4 }}>
                    {s.observations || "+"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, color: "var(--text3)", marginTop: 10, lineHeight: 1.6 }}>
        {t("noten.cellHint", { a: "2", b: "2,3" })}
      </p>

      {beobFuer && (
        <Beobachtungen
          student={beobFuer} cats={cats}
          entries={entries.filter((e) => e.student_id === beobFuer.student_id && e.kind === "observation")}
          onClose={() => setBeobFuer(null)}
          onSave={(b) => call(() => fetch(`${API}/entries`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b),
          }))}
          onDelete={(id) => call(() => fetch(`${API}/entries/${id}`, { method: "DELETE" }))}
        />
      )}
    </div>
  );
}

// Zelle: Eingabe direkt im Feld, Enter speichert, Escape bricht ab.
function Zelle({ onSave, onCancel }) {
  const { t } = useLanguage();
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <input
      ref={ref} defaultValue=""
      onBlur={(e) => (e.target.value.trim() ? onSave(e.target.value) : onCancel())}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSave(e.target.value);
        if (e.key === "Escape") onCancel();
      }}
      placeholder="2,3"
      style={{
        width: "100%", minHeight: 34, border: "2px solid var(--accent)", borderRadius: 4,
        background: "var(--input-bg, var(--bg))", color: "var(--text)", textAlign: "center",
        fontSize: 13.5, padding: 0, boxSizing: "border-box",
      }}
    />
  );
}

function Spalte({ kat, onSave, onDelete }) {
  const { t } = useLanguage();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(kat.name);
  const [weight, setWeight] = useState(kat.weight);

  if (edit) {
    return (
      <th style={{ ...th, minWidth: 130 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
          style={{ ...kopfInp, marginBottom: 4 }} />
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)}
            style={{ ...kopfInp, width: 52 }} />
          <span style={{ fontSize: 11, color: "var(--text3)" }}>%</span>
          <button onClick={() => { onSave({ name: name.trim(), weight: Number(weight) || 0, position: kat.position }); setEdit(false); }}
            style={{ border: "none", background: "none", cursor: "pointer", color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>OK</button>
        </div>
      </th>
    );
  }

  return (
    <th style={{ ...th, minWidth: 90 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
        <button onClick={() => setEdit(true)} title={`${kat.name} · ${kat.weight} % — klicken zum Ändern`}
          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text2)", fontSize: 12, fontWeight: 600, padding: 0, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {kat.name}
        </button>
        <button onClick={onDelete} className="icon-btn" style={{ ...iconBtn, padding: 2 }} title={t("noten.delColTitle")}>
          <Icon d={ICONS.trash} color={C.danger} />
        </button>
      </div>
      <div style={{ fontWeight: 400, color: "var(--text3)", fontSize: 11 }}>{kat.weight} %</div>
    </th>
  );
}

function NeueSpalte({ onSave, onCancel }) {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  return (
    <div style={{ minWidth: 130 }}>
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={t("noten.colNamePlaceholder")}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        style={{ ...kopfInp, marginBottom: 4 }} />
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="%"
          style={{ ...kopfInp, width: 52 }} />
        <button onClick={() => name.trim() && onSave({ name: name.trim(), weight: Number(weight) || 0 })}
          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>OK</button>
        <button onClick={onCancel}
          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text3)", fontSize: 12 }}>×</button>
      </div>
    </div>
  );
}

function Beobachtungen({ student, cats, entries, onClose, onSave, onDelete }) {
  const { t } = useLanguage();
  const [catId, setCatId] = useState(cats[0]?.id ?? null);
  const [tendency, setTendency] = useState(1);
  const [note, setNote] = useState("");

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 200 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", borderRadius: 18, maxWidth: 460, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 22, border: "1px solid var(--border)" }}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>{student.name}</h3>
        <p style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 16 }}>
          {t("noten.obsSub")}
        </p>

        {cats.length === 0 ? (
          <p style={{ fontSize: 13.5, color: "var(--text3)" }}>{t("noten.needColumnFirst")}</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              <select value={catId ?? ""} onChange={(e) => setCatId(Number(e.target.value))} style={{ ...inp, flex: 1, minWidth: 140 }}>
                {cats.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
              {[[1, "+"], [0, "·"], [-1, "−"]].map(([v, label]) => (
                <button key={v} onClick={() => setTendency(v)} style={{
                  width: 38, cursor: "pointer", fontSize: 15, borderRadius: 8, fontWeight: 700,
                  border: tendency === v ? "1px solid var(--accent)" : "1px solid var(--border2)",
                  background: tendency === v ? "var(--accent-bg)" : "var(--card)",
                  color: tendency === v ? "var(--accent)" : "var(--text2)",
                }}>{label}</button>
              ))}
            </div>
            <input
              value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
              placeholder={t("noten.obsPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && catId) {
                  onSave({ category_id: catId, student_id: student.student_id, kind: "observation", tendency, note });
                  setNote("");
                }
              }}
              style={{ ...inp, marginBottom: 10 }}
            />
            <button
              onClick={() => { onSave({ category_id: catId, student_id: student.student_id, kind: "observation", tendency, note }); setNote(""); }}
              disabled={!catId} style={{ ...btnPrimary, opacity: catId ? 1 : 0.4, marginBottom: 18 }}
            >
              {t("noten.note")}
            </button>
          </>
        )}

        {entries.map((e) => {
          const k = cats.find((c) => c.id === e.category_id);
          return (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid var(--border)", fontSize: 12.5 }}>
              <span style={{ width: 62, color: "var(--text3)" }}>
                {new Date(e.date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
              </span>
              <span style={{ width: 14, fontWeight: 700, color: e.tendency > 0 ? "#0a7d3e" : e.tendency < 0 ? "var(--danger, #dc2626)" : "var(--text3)" }}>
                {e.tendency > 0 ? "+" : e.tendency < 0 ? "−" : "·"}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ color: "var(--text3)" }}>{k?.name}: </span>{e.note}
              </span>
              <button onClick={() => onDelete(e.id)} className="icon-btn" style={iconBtn} title={t("common.delete")}>
                <Icon d={ICONS.trash} color={C.danger} />
              </button>
            </div>
          );
        })}

        <button onClick={onClose} style={{ ...btnSecondary, marginTop: 14 }}>{t("noten.close")}</button>
      </div>
    </div>
  );
}

const inp = { width: "100%", padding: 8, border: "1px solid var(--border2)", borderRadius: 8, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };
const kopfInp = { width: "100%", padding: 4, border: "1px solid var(--border2)", borderRadius: 6, fontSize: 12, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box", fontWeight: 400 };
const th = { padding: "8px 6px", borderBottom: "2px solid var(--border)", fontWeight: 600, fontSize: 12, color: "var(--text2)", textAlign: "center", whiteSpace: "nowrap" };
const td = { padding: "4px 6px", borderBottom: "1px solid var(--border)", textAlign: "center", color: "var(--text)" };
