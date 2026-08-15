// Gestylte, theme-bewusste Dialoge statt der nativen window.confirm/alert/prompt.
// Promise-basiert und modul-frei aufrufbar (kein Hook nötig):
//   if (await askConfirm("Wirklich löschen?")) …
//   await showAlert("Gespeichert.");
//   const txt = await askPrompt("Kurze Beschreibung:");
// <DialogHost/> wird einmal in der Shell gemountet.
import { useState, useEffect, useId } from "react";
import { Modal, btnPrimary, btnSecondary, inputStyle, COLORS as C } from "../components/Icons.jsx";

let _push = null;               // vom Host registriert
const _queue = [];              // bevor der Host bereit ist
let _lfd = 0;                   // laufende Nummer je Anfrage (React-key)

function request(req) {
  return new Promise((resolve) => {
    const item = { ...req, resolve, id: ++_lfd };
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
  // Eins nach dem anderen — aber die wartenden kommen in eine Schlange. Vorher
  // wurde eine zweite Nachfrage stillschweigend weggeworfen; ihr Promise blieb
  // fuer immer offen und der Aufrufer hing (z.B. zwei Loeschungen kurz
  // hintereinander: die zweite Aktion passierte nie).
  const [cur, setCur] = useState(null);
  const [wartend, setWartend] = useState([]);
  const [val, setVal] = useState("");
  const titelId = useId();

  useEffect(() => {
    _push = (item) => setCur((c) => { if (c) { setWartend((w) => [...w, item]); return c; } return item; });
    while (_queue.length) _push(_queue.shift());
    return () => { _push = null; };
  }, []);

  useEffect(() => { if (cur) setVal(cur.initial || ""); }, [cur]);

  if (!cur) return null;
  const schliessen = (result) => {
    cur.resolve(result);
    setCur(wartend[0] || null);
    setWartend((w) => w.slice(1));
  };
  const bestaetigen = () => schliessen(cur.kind === "prompt" ? val : true);
  const abbrechen = () => schliessen(cur.kind === "prompt" ? null : false);
  const okLabel = cur.ok || (cur.kind === "alert" ? "OK" : "OK");

  // Ueber die gemeinsame Modal-Komponente: role="dialog", Fokus-Fang,
  // Fokus-Rueckgabe, Escape und Scroll-Sperre gibt es damit hier genauso wie in
  // den Seiten-Dialogen. Wichtig fuer den verschachtelten Fall (Nachfrage ueber
  // einem offenen Modal): der Modal-Stapel macht die Nachfrage zum obersten
  // Dialog — vorher fing das darunterliegende Modal Tab und Escape ab, die
  // Nachfrage war per Tastatur nicht zu beantworten und Escape schloss das
  // falsche Fenster. zIndex bleibt ueber allem, weil der Host vor den Routen
  // gerendert wird und sonst unter einem Seiten-Modal laege.
  // key: jede Nachfrage ist ein eigener Dialog (Fokus neu setzen und zurueckgeben).
  return (
    <Modal key={cur.id} onClose={abbrechen} width={380} labelledby={titelId} overlayStyle={{ zIndex: 3000 }}>
      <div id={titelId} style={{ fontSize: 16, lineHeight: 1.5, marginBottom: cur.kind === "prompt" ? 12 : 16, whiteSpace: "pre-wrap" }}>{cur.message}</div>
      {cur.kind === "prompt" && (
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={cur.placeholder}
          onKeyDown={(e) => { if (e.key === "Enter") bestaetigen(); }}
          style={{ ...inputStyle, width: "100%", marginBottom: 16 }} />
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {cur.kind !== "alert" && (
          <button onClick={abbrechen} style={btnSecondary}>{cur.cancel || "Abbrechen"}</button>
        )}
        <button autoFocus={cur.kind !== "prompt"} onClick={bestaetigen}
          style={{ ...btnPrimary, ...(cur.danger ? { background: C.danger, color: C.aufAkzent } : null) }}>{okLabel}</button>
      </div>
    </Modal>
  );
}
