import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { alsJson, hol } from '../../core/melden.js';
import { samplePuzzles } from './samplePuzzles';

function loadState() {
  try {
    const saved = localStorage.getItem('code-detektiv-state');
    if (saved) {
      const parsed = JSON.parse(saved);
      const knownIds = new Set(samplePuzzles.map(p => p.id));
      const customPuzzles = (parsed.puzzles || []).filter(p => !knownIds.has(p.id));
      const sessions = (parsed.sessions || []).map(s => ({
        ...s,
        puzzleIds: s.puzzleIds || (s.puzzleId ? [s.puzzleId] : []),
        currentPuzzleIndex: s.currentPuzzleIndex ?? 0,
        ended: s.ended ?? false,
        roundStartedAt: s.roundStartedAt ?? s.startedAt ?? null,
      }));
      return {
        puzzles: [...samplePuzzles, ...customPuzzles],
        sessions,
        currentUser: parsed.currentUser || null,
        currentSession: parsed.currentSession || null,
      };
    }
  } catch {}
  return null;
}

const initialState = loadState() || {
  puzzles: samplePuzzles,
  sessions: [],
  currentUser: null,
  currentSession: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_PUZZLE':
      return { ...state, puzzles: [...state.puzzles, action.puzzle] };
    case 'UPDATE_PUZZLE':
      return { ...state, puzzles: state.puzzles.map(p => p.id === action.puzzle.id ? action.puzzle : p) };
    case 'DELETE_PUZZLE':
      return { ...state, puzzles: state.puzzles.filter(p => p.id !== action.puzzleId) };
    case 'SET_PUZZLES':
      return { ...state, puzzles: action.puzzles };
    case 'SET_USER':
      return { ...state, currentUser: action.user };
    case 'SET_CURRENT_SESSION':
      return { ...state, currentSession: action.code };
    // Server-Sync: eine Session upserten und ihre eingebetteten Rätsel ergänzen.
    case 'SYNC_SESSION': {
      const sessions = state.sessions.some(s => s.id === action.session.id)
        ? state.sessions.map(s => (s.id === action.session.id ? action.session : s))
        : [...state.sessions, action.session];
      const have = new Set(state.puzzles.map(p => p.id));
      const merged = [...state.puzzles, ...(action.puzzles || []).filter(p => !have.has(p.id))];
      return { ...state, sessions, puzzles: merged };
    }
    case 'CREATE_SESSION': {
      const session = {
        id: crypto.randomUUID().slice(0, 6).toUpperCase(),
        puzzleIds: action.puzzleIds,
        players: [],
        started: false,
        ended: false,
        currentPuzzleIndex: 0,
        results: [],
        createdAt: Date.now(),
        startedAt: null,
        roundStartedAt: null,
      };
      return { ...state, sessions: [...state.sessions, session], currentSession: session.id };
    }
    case 'JOIN_SESSION': {
      const sessions = state.sessions.map(s => {
        if (s.id !== action.sessionId) return s;
        if (s.players.some(p => p.name === action.name)) return s;
        return { ...s, players: [...s.players, { name: action.name, joinedAt: Date.now() }] };
      });
      return { ...state, sessions, currentSession: action.sessionId, currentUser: { name: action.name, role: 'player' } };
    }
    case 'START_SESSION': {
      const sessions = state.sessions.map(s =>
        s.id === action.sessionId ? { ...s, started: true, startedAt: Date.now(), roundStartedAt: Date.now() } : s
      );
      return { ...state, sessions };
    }
    case 'END_SESSION': {
      const sessions = state.sessions.map(s =>
        s.id === action.sessionId ? { ...s, ended: true } : s
      );
      return { ...state, sessions };
    }
    case 'REMOVE_PLAYER': {
      const sessions = state.sessions.map(s =>
        s.id === action.sessionId
          ? {
              ...s,
              players: s.players.filter(p => p.name !== action.playerName),
              results: s.results.filter(r => r.playerName !== action.playerName),
            }
          : s
      );
      return { ...state, sessions };
    }
    case 'SUBMIT_RESULT': {
      const sessions = state.sessions.map(s => {
        if (s.id !== action.sessionId) return s;
        const exists = s.results.some(
          r => r.puzzleId === action.result.puzzleId && r.playerName === action.result.playerName
        );
        if (exists) return s;
        return { ...s, results: [...s.results, action.result] };
      });
      return { ...state, sessions };
    }
    case 'ADVANCE_PUZZLE': {
      const sessions = state.sessions.map(s => {
        if (s.id !== action.sessionId) return s;
        const nextIndex = s.currentPuzzleIndex + 1;
        if (nextIndex >= s.puzzleIds.length) {
          return { ...s, ended: true };
        }
        return { ...s, currentPuzzleIndex: nextIndex, roundStartedAt: Date.now() };
      });
      return { ...state, sessions };
    }
    case 'SYNC_STATE': {
      return { ...state, sessions: action.sessions };
    }
    default:
      return state;
  }
}

const StoreContext = createContext();

const CD_API = '/api/codedetektiv/puzzles';
const S_API = '/api/codedetektiv/sessions';

// Ein Rätsel zum Server schicken (anlegen wie ändern — der Server upsertet).
const raetselSenden = (p) =>
  fetch(CD_API, alsJson('PUT', { client_id: p.id, title: p.title || '', topic_id: p.topic_id ?? null, payload: p }));

/**
 * Beitreten — von der Startseite (mit Code-Eingabe) und von der öffentlichen
 * Seite `/cd/<CODE>` aus derselbe Aufruf. Die Fehlermeldung bleibt bei der
 * Seite: dort heißt 404 „Session nicht gefunden", hier 400 „läuft schon".
 */
export function sessionBeitreten(code, name) {
  return fetch(`${S_API}/${code}/join`, alsJson('POST', { name })).catch(() => null);
}

/** Gibt es diese Session? (Öffentliche Seite prüft das vor dem Formular.) */
export const sessionGibtEs = (code) => hol(`${S_API}/${code}`, null).then((s) => !!s);
// Server-Session in die vom UI erwartete Form bringen.
function mapSession(srv) {
  return {
    id: srv.code,
    puzzleIds: (srv.puzzles || []).map(p => p.id),
    players: srv.players || [],
    results: srv.results || [],
    started: !!srv.started,
    ended: !!srv.ended,
    currentPuzzleIndex: srv.current_index || 0,
    startedAt: srv.started_at ? Date.parse(srv.started_at) : null,
    roundStartedAt: srv.round_started_at ? Date.parse(srv.round_started_at) : null,
  };
}

export function StoreProvider({ children }) {
  const [state, rawDispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state); stateRef.current = state;

  const applySession = (srv) => {
    rawDispatch({ type: 'SYNC_SESSION', session: mapSession(srv), puzzles: srv.puzzles || [] });
    rawDispatch({ type: 'SET_CURRENT_SESSION', code: srv.code });
  };

  // Jeder Session-Aufruf antwortet mit der ganzen Session — also überall
  // derselbe Weg: rufen, Antwort übernehmen, Fehler schlucken (das Polling
  // holt den Stand ohnehin gleich wieder).
  const rufen = (url, opts) =>
    fetch(url, opts).then(r => (r.ok ? r.json() : null)).then(srv => srv && applySession(srv)).catch(() => {});

  // Session-Aktionen laufen jetzt serverseitig (geräteübergreifendes Beitreten).
  const dispatch = (action) => {
    const cur = stateRef.current;
    switch (action.type) {
      case 'ADD_PUZZLE':
      case 'UPDATE_PUZZLE': {
        raetselSenden(action.puzzle).catch(() => {});
        return rawDispatch(action);
      }
      case 'DELETE_PUZZLE':
        fetch(`${CD_API}/${encodeURIComponent(action.puzzleId)}`, { method: 'DELETE' }).catch(() => {});
        return rawDispatch(action);
      case 'CREATE_SESSION': {
        const puzzles = action.puzzleIds.map(id => cur.puzzles.find(p => p.id === id)).filter(Boolean);
        rufen(S_API, alsJson('POST', { puzzles }));
        return;
      }
      case 'JOIN_SESSION':
        rawDispatch({ type: 'SET_USER', user: { name: action.name, role: 'player' } });
        rufen(`${S_API}/${action.sessionId}/join`, alsJson('POST', { name: action.name }));
        return;
      case 'START_SESSION':
        rufen(`${S_API}/${action.sessionId}/start`, { method: 'POST' });
        return;
      case 'END_SESSION':
        rufen(`${S_API}/${action.sessionId}/end`, { method: 'POST' });
        return;
      case 'ADVANCE_PUZZLE':
        rufen(`${S_API}/${action.sessionId}/advance`, { method: 'POST' });
        return;
      case 'REMOVE_PLAYER':
        rufen(`${S_API}/${action.sessionId}/remove`, alsJson('POST', { name: action.playerName }));
        return;
      case 'SUBMIT_RESULT':
        rufen(`${S_API}/${action.sessionId}/result`, alsJson('POST', action.result));
        return;
      default:
        return rawDispatch(action);
    }
  };

  // Laufende Session pollen, damit alle Geräte denselben Stand sehen.
  //
  // Dieser Takt ist der teuerste Netzweg der ganzen Installation: 30 Geräte
  // einer Klasse fragen gleichzeitig, und die Antwort enthält die kompletten
  // Rätsel. Drei Dinge halten ihn klein, ohne das Spiel träger zu machen:
  //
  //  1. Nur wenn das Gerät wirklich zuschaut. Ein Handy mit dunklem Bildschirm
  //     oder ein Tab im Hintergrund fragte vorher weiter — bei einer Klasse, die
  //     in der Pause nicht schließt, stundenlang für nichts.
  //  2. Der Takt richtet sich nach dem Zustand. Schnell nur, wenn gespielt wird
  //     (da zählt jede Sekunde), gemächlich im Wartezimmer und nach dem Ende.
  //  3. Der Server schickt einen ETag (siehe ETagMiddleware): hat sich nichts
  //     geändert, kommt 304 ohne Rumpf zurück. `r.ok` ist dann false, wir lassen
  //     den Stand einfach stehen — genau richtig, er ist ja unverändert.
  useEffect(() => {
    const code = state.currentSession;
    if (!code) return;
    let alive = true;
    let timer = null;
    // Zustand aus der letzten Antwort, nicht aus `state`: der Effekt hängt nur an
    // `currentSession`, sein `state` wäre also der vom Start und der Takt bliebe
    // für immer der erste.
    let stand = null;

    const takt = () => {
      if (stand?.ended) return 10000;
      if (stand?.started) return 1800;
      return 3000; // Wartezimmer: Beitritte dürfen ein paar Sekunden brauchen
    };

    const plan = () => { if (alive) timer = setTimeout(tick, takt()); };

    const tick = () => {
      if (document.hidden) { plan(); return; }
      hol(`${S_API}/${code}`, null)
        .then(srv => {
          if (!alive || !srv) return;
          stand = { started: srv.started, ended: srv.ended };
          rawDispatch({ type: 'SYNC_SESSION', session: mapSession(srv), puzzles: srv.puzzles || [] });
        })
        .finally(plan);
    };

    // Beim Zurückkehren an das Gerät sofort nachsehen, statt auf den Takt zu warten.
    const onVis = () => { if (!document.hidden && alive) { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', onVis);

    tick();
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [state.currentSession]);

  // Beim Start: Rätsel vom Server laden. Lokale (noch nicht übertragene) Rätsel
  // einmalig hochladen — so gehen Bestände aus dem Browser nicht verloren.
  useEffect(() => {
    const localCustoms = ((loadState() || {}).puzzles || []).filter(p => !samplePuzzles.some(sp => sp.id === p.id));
    hol(CD_API).then(async (rows) => {
      const serverIds = new Set(rows.map(r => r.client_id));
      for (const p of localCustoms) {
        if (!serverIds.has(p.id)) await raetselSenden(p).catch(() => {});
      }
      const fromServer = rows.map(r => ({ ...r.payload, id: r.client_id, title: r.title, topic_id: r.topic_id }));
      const nurLokal = localCustoms.filter(p => !serverIds.has(p.id));
      rawDispatch({ type: 'SET_PUZZLES', puzzles: [...samplePuzzles, ...fromServer, ...nurLokal] });
    }).catch(() => {});
  }, []);

  // Nur Sessions/Anmeldung lokal halten; Rätsel kommen vom Server.
  useEffect(() => {
    const toSave = {
      sessions: state.sessions,
      currentUser: state.currentUser,
      currentSession: state.currentSession,
    };
    // try/catch wie beim Lesen darueber: Safari wirft im privaten Modus, und
    // eine nicht gespeicherte Spielrunde darf die Seite nicht abstuerzen lassen.
    try { localStorage.setItem('code-detektiv-state', JSON.stringify(toSave)); } catch { /* kein Speicher — Runde laeuft im Arbeitsspeicher weiter */ }
  }, [state]);

  // Cross-Tab-Sync über localStorage entfällt: Sessions kommen jetzt vom Server
  // (geräteübergreifend), das Polling hält alle Geräte aktuell.

  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  return useContext(StoreContext);
}

export function calculateRoundScores(results, puzzleId, players) {
  const puzzleResults = results.filter(r => r.puzzleId === puzzleId);
  const solved = puzzleResults.filter(r => r.solved).sort((a, b) => {
    if (a.attempts !== b.attempts) return a.attempts - b.attempts;
    return a.time - b.time;
  });
  const unsolved = players
    .filter(p => !solved.some(r => r.playerName === p.name))
    .map(p => {
      const failed = puzzleResults.find(r => r.playerName === p.name);
      return { playerName: p.name, solved: false, attempts: failed?.attempts || 0, time: failed?.time || 0, points: 0 };
    });
  const ranked = solved.map((r, i) => ({ ...r, points: Math.max(1, 10 - i), rank: i + 1 }));
  return [...ranked, ...unsolved.map(u => ({ ...u, rank: ranked.length + 1 }))];
}

export function calculateTotalScores(results, puzzleIds, players) {
  const totals = {};
  for (const p of players) {
    totals[p.name] = { playerName: p.name, totalPoints: 0, rounds: [] };
  }
  for (const pid of puzzleIds) {
    const round = calculateRoundScores(results, pid, players);
    for (const r of round) {
      if (totals[r.playerName]) {
        totals[r.playerName].totalPoints += (r.points || 0);
        totals[r.playerName].rounds.push({ puzzleId: pid, points: r.points || 0, rank: r.rank });
      }
    }
  }
  return Object.values(totals).sort((a, b) => b.totalPoints - a.totalPoints);
}
