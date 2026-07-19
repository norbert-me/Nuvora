// Modul Material-Ausleihe — Gegenstände verleihen und Rückgabe im Blick.
// Ausleiher: ein Kern-Schüler (Klasse wählen) oder ein Freitextname.
import { useState, useEffect, useCallback } from "react";
import { askConfirm, askPrompt, showAlert } from "../core/dialog.jsx";
import { pageTitle, btnPrimary, btnSecondary, selectStyle, Icon, ICONS, iconBtn, COLORS as C } from "../components/Icons.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { swr } from "../core/cache.js";

const API = "/api/ausleihe";
const fld = { padding: "9px 12px", border: "1px solid var(--border2)", borderRadius: 10, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" };

export default function Ausleihe() {
  const { t } = useLanguage();
  const [classes, setClasses] = useState([]);
  const [items, setItems] = useState([]);
  const [neu, setNeu] = useState("");
  const [offen, setOffen] = useState(null);   // aufgeklappter Gegenstand
  const [loans, setLoans] = useState([]);      // Ausleihen des offenen Gegenstands
  const [borrower, setBorrower] = useState("");
  const [classId, setClassId] = useState("");
  const [studentId, setStudentId] = useState("");

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => setClasses(Array.isArray(d) ? d : []));
  }, []);

  const load = useCallback(() => {
    fetch(`${API}/items`).then((r) => (r.ok ? r.json() : [])).then((d) => setItems(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const students = (classes.find((c) => c.id === Number(classId))?.students) || [];

  const anlegen = async () => {
    const name = neu.trim(); if (!name) return;
    const r = await fetch(`${API}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).catch(() => null);
    if (r && r.ok) { setNeu(""); load(); }
  };
  const loeschen = async (id) => { if (!await askConfirm(t("ausleihe.delConfirm"))) return; await fetch(`${API}/items/${id}`, { method: "DELETE" }).catch(() => {}); if (offen === id) setOffen(null); load(); };

  const oeffnen = (id) => {
    if (offen === id) { setOffen(null); return; }
    setOffen(id); setBorrower(""); setStudentId("");
    fetch(`${API}/loans?item_id=${id}`).then((r) => (r.ok ? r.json() : [])).then((d) => setLoans(Array.isArray(d) ? d : [])).catch(() => {});
  };
  const reloadLoans = (id) => fetch(`${API}/loans?item_id=${id}`).then((r) => (r.ok ? r.json() : [])).then((d) => setLoans(Array.isArray(d) ? d : [])).catch(() => {});

  const verleihen = async (itemId) => {
    const b = studentId ? "" : borrower.trim();
    if (!studentId && !b) return;
    const r = await fetch(`${API}/loans`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: itemId, borrower: b, student_id: studentId ? Number(studentId) : null }) }).catch(() => null);
    if (r && r.ok) { setBorrower(""); setStudentId(""); reloadLoans(itemId); load(); }
  };
  const zurueck = async (loanId, itemId) => { await fetch(`${API}/loans/${loanId}/return`, { method: "PUT" }).catch(() => {}); reloadLoans(itemId); load(); };

  const fmt = (d) => (d ? new Date(d).toLocaleDateString() : "");
  const offeneLoans = loans.filter((l) => !l.returned_at);
  const zurueckLoans = loans.filter((l) => l.returned_at);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <h1 style={pageTitle}>{t("ausleihe.title")}</h1>
      <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 16px" }}>{t("ausleihe.hint")}</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anlegen()} placeholder={t("ausleihe.newPlaceholder")} style={{ ...fld, flex: 1, minWidth: 200 }} />
        <button onClick={anlegen} style={btnPrimary}>{t("ausleihe.add")}</button>
      </div>

      {items.length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("ausleihe.noItems")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it) => (
            <div key={it.id} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                <button onClick={() => oeffnen(it.id)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", color: "var(--text)", fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "var(--text3)", fontSize: 12 }}>{offen === it.id ? "▾" : "▸"}</span>
                  {it.name}
                </button>
                {it.open > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 9px", borderRadius: 980, background: "rgba(209,53,15,0.12)", color: "#d1350f" }}>{t("ausleihe.outCount", { n: it.open })}</span>}
                <button onClick={() => loeschen(it.id)} className="icon-btn" style={{ ...iconBtn, padding: 5 }} title={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
              </div>

              {offen === it.id && (
                <div style={{ borderTop: "1px solid var(--border)", padding: 14 }}>
                  {/* Verleihen */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                    <select value={classId} onChange={(e) => { setClassId(e.target.value); setStudentId(""); }} style={selectStyle}>
                      <option value="">– {t("ausleihe.freeText")} –</option>
                      {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {classId ? (
                      <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={selectStyle}>
                        <option value="">– {t("ausleihe.pickStudent")} –</option>
                        {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    ) : (
                      <input value={borrower} onChange={(e) => setBorrower(e.target.value)} placeholder={t("ausleihe.borrowerPlaceholder")} style={{ ...fld, flex: 1, minWidth: 160 }} />
                    )}
                    <button onClick={() => verleihen(it.id)} style={btnPrimary}>{t("ausleihe.lend")}</button>
                  </div>

                  {offeneLoans.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--text3)", margin: "0 0 8px" }}>{t("ausleihe.noOpen")}</p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: zurueckLoans.length ? 12 : 0 }}>
                      {offeneLoans.map((l) => (
                        <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", border: "1px solid var(--border)", borderRadius: 8 }}>
                          <span style={{ flex: 1, fontWeight: 500 }}>{l.borrower}</span>
                          <span style={{ fontSize: 12, color: "var(--text3)" }}>{t("ausleihe.since", { d: fmt(l.out_at) })}</span>
                          <button onClick={() => zurueck(l.id, it.id)} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 13 }}>{t("ausleihe.return")}</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {zurueckLoans.length > 0 && (
                    <details>
                      <summary style={{ fontSize: 12.5, color: "var(--text3)", cursor: "pointer" }}>{t("ausleihe.history")} ({zurueckLoans.length})</summary>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                        {zurueckLoans.map((l) => (
                          <div key={l.id} style={{ display: "flex", gap: 10, fontSize: 12.5, color: "var(--text3)" }}>
                            <span style={{ flex: 1 }}>{l.borrower}</span>
                            <span>{fmt(l.out_at)} – {fmt(l.returned_at)} ✓</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
