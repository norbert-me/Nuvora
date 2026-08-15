// Modul Material-Ausleihe — Gegenstände verleihen und Rückgabe im Blick.
// Ausleiher: ein Kern-Schüler (Klasse wählen) oder ein Freitextname.
import { useState, useEffect, useCallback } from "react";
import { undoDelete } from "../core/undo.jsx";
import { AddButton, badge, btnPrimary, btnSecondary, cardStyle, CONTROL_R, selectStyle, Toggle, Icon, ICONS, iconBtn, COLORS as C, inputStyle, Empty } from "../components/Icons.jsx";
import KursKlasseSelect from "../components/KursKlasseSelect.jsx";
import { useLanguage } from "../i18n/index.jsx";
import { swr } from "../core/cache.js";
import { alsJson, hol } from "../core/melden.js";

const API = "/api/ausleihe";
const fld = inputStyle; // gemeinsame Texteingabe
const UEBERFAELLIG_TAGE = 14; // ab so vielen Tagen draußen: rot markiert
const tageDraussen = (out) => Math.floor((Date.now() - new Date(out).getTime()) / 86400000);

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
  const [nurOffene, setNurOffene] = useState(false); // nur verliehene Gegenstände

  useEffect(() => {
    return swr("classes", "/api/classes", (d) => setClasses(Array.isArray(d) ? d : []));
  }, []);

  const load = useCallback(() => {
    hol(`${API}/items`).then((d) => setItems(Array.isArray(d) ? d : []));
  }, []);
  useEffect(() => { load(); }, [load]);

  const students = (classes.find((c) => c.id === Number(classId))?.students) || [];

  const anlegen = async () => {
    const name = neu.trim(); if (!name) return;
    const r = await fetch(`${API}/items`, alsJson("POST", { name })).catch(() => null);
    if (r && r.ok) { setNeu(""); load(); }
  };
  const loeschen = (id) => {
    const it = items.find((x) => x.id === id);
    if (offen === id) setOffen(null);
    setItems((prev) => prev.filter((x) => x.id !== id)); // sofort weg
    undoDelete({ message: t("undo.deleted", { name: it?.name || "" }), undo: () => load(), commit: async () => { await fetch(`${API}/items/${id}`, { method: "DELETE" }).catch(() => {}); } });
  };

  const oeffnen = (id) => {
    if (offen === id) { setOffen(null); return; }
    setOffen(id); setBorrower(""); setStudentId("");
    hol(`${API}/loans?item_id=${id}`).then((d) => setLoans(Array.isArray(d) ? d : []));
  };
  const reloadLoans = (id) => hol(`${API}/loans?item_id=${id}`).then((d) => setLoans(Array.isArray(d) ? d : []));

  const verleihen = async (itemId) => {
    const b = studentId ? "" : borrower.trim();
    if (!studentId && !b) return;
    const r = await fetch(`${API}/loans`, alsJson("POST", { item_id: itemId, borrower: b, student_id: studentId ? Number(studentId) : null })).catch(() => null);
    if (r && r.ok) { setBorrower(""); setStudentId(""); reloadLoans(itemId); load(); }
  };
  const zurueck = async (loanId, itemId) => { await fetch(`${API}/loans/${loanId}/return`, { method: "PUT" }).catch(() => {}); reloadLoans(itemId); load(); };

  const fmt = (d) => (d ? new Date(d).toLocaleDateString() : "");
  const offeneLoans = loans.filter((l) => !l.returned_at);
  const zurueckLoans = loans.filter((l) => l.returned_at);

  return (
    <div style={{ maxWidth: "none" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === "Enter" && anlegen()} placeholder={t("ausleihe.newPlaceholder")} style={{ ...fld, flex: 1, minWidth: 200 }} />
        <AddButton onClick={anlegen} title={t("ausleihe.add")} />
      </div>
      {items.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Toggle checked={nurOffene} onChange={setNurOffene} label={t("ausleihe.onlyOpen")} />
        </div>
      )}

      {items.length === 0 ? (
        <Empty title={t("ausleihe.noItems")} hint={t("ausleihe.noItemsHint")} />
      ) : (nurOffene ? items.filter((it) => it.open > 0) : items).length === 0 ? (
        <p style={{ color: "var(--text3)", fontSize: 14 }}>{t("ausleihe.noneOut")}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(nurOffene ? items.filter((it) => it.open > 0) : items).map((it) => (
            <div key={it.id} style={{ ...cardStyle, padding: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px" }}>
                <button onClick={() => oeffnen(it.id)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", color: "var(--text)", fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--text3)", fontSize: 12 }}>{offen === it.id ? "▾" : "▸"}</span>
                  {it.name}
                </button>
                {it.open > 0 && <span style={badge(C.danger)}>{t("ausleihe.outCount", { n: it.open })}</span>}
                {it.overdue > 0 && <span title={t("ausleihe.overdueHint", { d: UEBERFAELLIG_TAGE })} style={{ ...badge(C.danger), background: C.danger, color: C.aufAkzent }}>{t("ausleihe.overdueCount", { n: it.overdue })}</span>}
                <button onClick={() => loeschen(it.id)} className="icon-btn" style={{ ...iconBtn, padding: 4 }} title={t("common.delete")} aria-label={t("common.delete")}><Icon d={ICONS.trash} size={15} color={C.danger} /></button>
              </div>

              {offen === it.id && (
                <div style={{ borderTop: "1px solid var(--border)", padding: 12 }}>
                  {/* Verleihen */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                    <KursKlasseSelect value={classId === "" ? "" : Number(classId)} allowNone noneLabel={`– ${t("ausleihe.freeText")} –`}
                      onChange={(id) => { setClassId(id === "" ? "" : String(id)); setStudentId(""); }} />
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
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: zurueckLoans.length ? 12 : 0 }}>
                      {offeneLoans.map((l) => {
                        const tage = tageDraussen(l.out_at);
                        const ueber = tage >= UEBERFAELLIG_TAGE;
                        return (
                        <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: ueber ? `1px solid ${C.danger}` : "1px solid var(--border)", borderRadius: CONTROL_R, background: ueber ? "rgba(209,53,15,0.06)" : undefined }}>
                          <span style={{ flex: 1, fontWeight: 500 }}>{l.borrower}</span>
                          <span style={{ fontSize: 12, color: ueber ? C.danger : "var(--text3)", fontWeight: ueber ? 700 : 400 }}>{t("ausleihe.sinceDays", { n: tage })}</span>
                          <button onClick={() => zurueck(l.id, it.id)} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 13 }}>{t("ausleihe.return")}</button>
                        </div>
                        );
                      })}
                    </div>
                  )}
                  {zurueckLoans.length > 0 && (
                    <details>
                      <summary style={{ fontSize: 13, color: "var(--text3)", cursor: "pointer" }}>{t("ausleihe.history")} ({zurueckLoans.length})</summary>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                        {zurueckLoans.map((l) => (
                          <div key={l.id} style={{ display: "flex", gap: 8, fontSize: 13, color: "var(--text3)" }}>
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
