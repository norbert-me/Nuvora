// Gestylte, theme-bewusste Dialoge statt der nativen window.confirm/alert/prompt.
// Promise-basiert und modul-frei aufrufbar (kein Hook nötig):
//   if (await askConfirm("Wirklich löschen?")) …
//   await showAlert("Gespeichert.");
//   const txt = await askPrompt("Kurze Beschreibung:");
// <DialogHost/> wird einmal in der Shell gemountet.
import { useState, useEffect } from "react";

let _push = null;               // vom Host registriert
const _queue = [];              // bevor der Host bereit ist

function request(req) {
  return new Promise((resolve) => {
    const item = { ...req, resolve };
    if (_push) _push(item); else _queue.push(item);
  });
}

export function askConfirm(message, opts = {}) {
  return request({ kind: "confirm", message, ok: opts.ok, cancel: opts.cancel, danger: opts.danger });
}
export function showAlert(message, opts = {}) {
  return request({ kind: "alert", message, ok: opts.ok });
}
export function askPrompt(message, opts = {}) {
  return request({ kind: "prompt", message, placeholder: opts.placeholder || "", initial: opts.initial || "", ok: opts.ok, cancel: opts.cancel });
}

export function DialogHost() {
  const [cur, setCur] = useState(null);
  const [val, setVal] = useState("");

  useEffect(() => {
    _push = (item) => setCur((c) => c || item); // eins nach dem anderen
    while (_queue.length) _push(_queue.shift());
    return () => { _push = null; };
  }, []);

  useEffect(() => { if (cur) setVal(cur.initial || ""); }, [cur]);

  if (!cur) return null;
  const schliessen = (result) => { cur.resolve(result); setCur(null); };
  const bestaetigen = () => schliessen(cur.kind === "prompt" ? val : true);
  const abbrechen = () => schliessen(cur.kind === "prompt" ? null : false);
  const okLabel = cur.ok || (cur.kind === "alert" ? "OK" : "OK");

  return (
    <div onClick={abbrechen} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 3000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--card)", color: "var(--text)", borderRadius: 16, maxWidth: 380, width: "100%", padding: 22, border: "1px solid var(--border)", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 15, lineHeight: 1.5, marginBottom: cur.kind === "prompt" ? 12 : 18, whiteSpace: "pre-wrap" }}>{cur.message}</div>
        {cur.kind === "prompt" && (
          <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={cur.placeholder}
            onKeyDown={(e) => { if (e.key === "Enter") bestaetigen(); if (e.key === "Escape") abbrechen(); }}
            style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--border2)", borderRadius: 10, fontSize: 14, background: "var(--bg)", color: "var(--text)", boxSizing: "border-box", marginBottom: 16 }} />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {cur.kind !== "alert" && (
            <button onClick={abbrechen} style={{ padding: "8px 16px", borderRadius: 980, border: "1px solid var(--border2)", background: "var(--card)", color: "var(--text2)", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>{cur.cancel || "Abbrechen"}</button>
          )}
          <button autoFocus={cur.kind !== "prompt"} onClick={bestaetigen}
            style={{ padding: "8px 18px", borderRadius: 980, border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer",
              background: cur.danger ? "#d1350f" : "var(--text)", color: cur.danger ? "#fff" : "var(--bg)" }}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}
