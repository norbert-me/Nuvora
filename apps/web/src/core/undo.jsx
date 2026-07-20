// Undo-Toast statt Bestätigungsdialog beim Löschen.
//
// Muster: der Aufrufer entfernt das Element SOFORT aus der UI und ruft dann
//   undoDelete({ message, undo, commit })
// - undo():   stellt die UI wieder her (Nutzer klickt „Rückgängig")
// - commit(): führt das echte Löschen aus (Server), wenn die Frist (5 s)
//             abläuft. So gibt es keinen Dialog und kein Re-Create-Problem.
// <UndoHost/> wird einmal in der Shell gemountet.
import { useState, useEffect, useRef } from "react";

let _push = null;
const _queue = [];

export function undoDelete({ message, undo, commit, seconds = 5 }) {
  const item = { id: Math.random().toString(36).slice(2), message, undo, commit, seconds };
  if (_push) _push(item); else _queue.push(item);
}

export function UndoHost() {
  const [items, setItems] = useState([]);
  const timers = useRef({});

  useEffect(() => {
    _push = (item) => {
      setItems((prev) => [...prev, item]);
      timers.current[item.id] = setTimeout(() => finish(item.id, false), item.seconds * 1000);
    };
    while (_queue.length) _push(_queue.shift());
    return () => { _push = null; };
  }, []);

  // false = Frist abgelaufen → commit; true = Nutzer klickt Rückgängig → undo.
  const finish = (id, undone) => {
    clearTimeout(timers.current[id]); delete timers.current[id];
    setItems((prev) => {
      const it = prev.find((x) => x.id === id);
      if (it) { try { undone ? it.undo?.() : it.commit?.(); } catch { /* egal */ } }
      return prev.filter((x) => x.id !== id);
    });
  };

  if (!items.length) return null;
  return (
    <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 3200, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
      {items.map((it) => (
        <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 16, background: "#1e293b", color: "#fff", padding: "10px 12px 10px 16px", borderRadius: 10, fontSize: 14, boxShadow: "0 6px 20px rgba(0,0,0,0.3)", minWidth: 260 }}>
          <span style={{ flex: 1 }}>{it.message}</span>
          <button onClick={() => finish(it.id, true)}
            style={{ background: "none", border: "none", color: "#7dd3fc", fontWeight: 700, fontSize: 14, cursor: "pointer", padding: "2px 6px" }}>
            Rückgängig
          </button>
        </div>
      ))}
    </div>
  );
}
