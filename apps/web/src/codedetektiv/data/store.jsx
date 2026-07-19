import { createContext, useContext, useReducer, useEffect } from 'react';
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
const jsonHeaders = { 'Content-Type': 'application/json' };

export function StoreProvider({ children }) {
  const [state, rawDispatch] = useReducer(reducer, initialState);

  // Rätsel liegen jetzt im Kern (themen-getaggt, im Kalender planbar). Der Store
  // spiegelt sie lokal; Anlegen/Ändern/Löschen wird an den Server geschickt.
  const dispatch = (action) => {
    if (action.type === 'ADD_PUZZLE' || action.type === 'UPDATE_PUZZLE') {
      const p = action.puzzle;
      fetch(CD_API, { method: 'PUT', headers: jsonHeaders,
        body: JSON.stringify({ client_id: p.id, title: p.title || '', topic_id: p.topic_id ?? null, payload: p }) }).catch(() => {});
    } else if (action.type === 'DELETE_PUZZLE') {
      fetch(`${CD_API}/${encodeURIComponent(action.puzzleId)}`, { method: 'DELETE' }).catch(() => {});
    }
    rawDispatch(action);
  };

  // Beim Start: Rätsel vom Server laden. Lokale (noch nicht übertragene) Rätsel
  // einmalig hochladen — so gehen Bestände aus dem Browser nicht verloren.
  useEffect(() => {
    const localCustoms = ((loadState() || {}).puzzles || []).filter(p => !samplePuzzles.some(sp => sp.id === p.id));
    fetch(CD_API).then(r => (r.ok ? r.json() : [])).then(async (rows) => {
      const serverIds = new Set(rows.map(r => r.client_id));
      for (const p of localCustoms) {
        if (!serverIds.has(p.id)) {
          await fetch(CD_API, { method: 'PUT', headers: jsonHeaders,
            body: JSON.stringify({ client_id: p.id, title: p.title || '', topic_id: p.topic_id ?? null, payload: p }) }).catch(() => {});
        }
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
    localStorage.setItem('code-detektiv-state', JSON.stringify(toSave));
  }, [state]);

  useEffect(() => {
    function handleStorage(e) {
      if (e.key === 'code-detektiv-state' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed.sessions) {
            dispatch({ type: 'SYNC_STATE', sessions: parsed.sessions });
          }
        } catch {}
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

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
