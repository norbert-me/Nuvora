import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStore } from '../data/store';
import { IconSearch, IconGamepad, IconPuzzle } from '../components/Icons';

export default function Home() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { state, dispatch } = useStore();
  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  // Beitreten-Formular direkt öffnen, wenn die Nuvora-Navbar ?join=1 setzt.
  const [showJoin, setShowJoin] = useState(params.get('join') === '1');
  const [error, setError] = useState('');

  const activeSession = state.currentSession && state.sessions.find(
    s => s.id === state.currentSession && !s.ended
  );
  const isInSession = activeSession && state.currentUser &&
    activeSession.players.some(p => p.name === state.currentUser.name);

  function handleJoin(e) {
    e.preventDefault();
    setError('');
    const code = joinCode.toUpperCase();
    const session = state.sessions.find(s => s.id === code);
    if (!session) {
      setError('Session nicht gefunden!');
      return;
    }
    if (session.ended) {
      setError('Session ist bereits beendet.');
      return;
    }
    if (session.started && !session.players.some(p => p.name === playerName)) {
      setError('Session läuft bereits. Du kannst nicht mehr beitreten.');
      return;
    }
    dispatch({ type: 'JOIN_SESSION', sessionId: session.id, name: playerName });
    navigate(`/code-detektiv/play/${session.id}`);
  }

  return (
    <div style={{ minHeight: '68vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: 20, padding: '40px 20px' }}>
      <div style={{ textAlign: 'center', color: '#fff', maxWidth: 500 }}>
        <div style={{ marginBottom: 8 }}><IconSearch size={64} /></div>
        <h1 style={{ fontSize: 42, fontWeight: 800, marginBottom: 8 }}>Code-Detektiv</h1>
        <p style={{ fontSize: 18, opacity: 0.9, marginBottom: 40 }}>
          Finde die Bugs! Sortiere die Blöcke! Werde Meister-Detektiv!
        </p>

        {isInSession && (
          <div style={{ marginBottom: 20 }}>
            <button
              className="btn"
              onClick={() => navigate(`/code-detektiv/play/${activeSession.id}`)}
              style={{ background: '#4caf50', color: '#fff', fontSize: 16, padding: '14px 40px', borderRadius: 12, fontWeight: 700, width: 280 }}
            >
              Zurück zur Session {activeSession.id}
            </button>
          </div>
        )}

        {!showJoin ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            <button
              className="btn"
              onClick={() => navigate('/code-detektiv/admin')}
              style={{ background: '#fff', color: '#764ba2', fontSize: 16, padding: '14px 40px', borderRadius: 12, fontWeight: 700, width: 280 }}
            >
              Admin / Rätsel erstellen
            </button>
            <button
              className="btn"
              onClick={() => setShowJoin(true)}
              style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 16, padding: '14px 40px', borderRadius: 12, fontWeight: 700, border: '2px solid rgba(255,255,255,0.4)', width: 280 }}
            >
              <IconGamepad size={18} /> Rätsel beitreten
            </button>
            <button
              className="btn"
              onClick={() => navigate('/code-detektiv/solo')}
              style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 16, padding: '14px 40px', borderRadius: 12, fontWeight: 700, border: '2px solid rgba(255,255,255,0.2)', width: 280 }}
            >
              <IconPuzzle size={18} /> Solo üben
            </button>
          </div>
        ) : (
          <form onSubmit={handleJoin} style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 24, backdropFilter: 'blur(10px)' }}>
            <div style={{ marginBottom: 12 }}>
              <input
                type="text"
                placeholder="Dein Name"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                required
                style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: 'none', fontSize: 16, background: 'rgba(255,255,255,0.9)' }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <input
                type="text"
                placeholder="Session-Code (z.B. A3F2K1)"
                value={joinCode}
                onChange={e => { setJoinCode(e.target.value.toUpperCase()); setError(''); }}
                required
                maxLength={6}
                style={{ width: '100%', padding: '12px 16px', borderRadius: 8, border: 'none', fontSize: 20, textAlign: 'center', letterSpacing: 4, fontWeight: 700, background: 'rgba(255,255,255,0.9)' }}
              />
            </div>
            {error && (
              <div style={{ background: 'rgba(244,67,54,0.9)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 14 }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" onClick={() => { setShowJoin(false); setError(''); }} style={{ flex: 1, background: 'rgba(255,255,255,0.2)', color: '#fff', borderRadius: 8, border: 'none', padding: '12px' }}>
                Zurück
              </button>
              <button type="submit" className="btn btn-primary" style={{ flex: 2, borderRadius: 8, padding: '12px', fontSize: 16 }}>
                Beitreten →
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
