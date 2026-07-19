import { useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore, calculateRoundScores, calculateTotalScores } from '../data/store';
import {
  IconX, IconTrophy, IconHourglass, IconPuzzle, IconPlay,
  IconCheckCircle, IconClock, IconBack,
} from '../components/Icons';

export default function PlaySession() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useStore();

  const session = state.sessions.find(s => s.id === sessionId);
  const isAdmin = state.currentUser?.role === 'admin' || !state.currentUser;
  const playerName = state.currentUser?.name;
  const isPlayer = session?.players.some(p => p.name === playerName);

  const currentPuzzleId = session?.puzzleIds?.[session.currentPuzzleIndex];
  const currentPuzzle = currentPuzzleId ? state.puzzles.find(p => p.id === currentPuzzleId) : null;

  const myResult = session?.results.find(
    r => r.puzzleId === currentPuzzleId && r.playerName === playerName
  );

  const roundResults = useMemo(() => {
    if (!session || !currentPuzzleId) return [];
    return calculateRoundScores(session.results, currentPuzzleId, session.players);
  }, [session?.results, currentPuzzleId, session?.players]);

  const allDone = session?.players.length > 0 &&
    session?.players.every(p =>
      session.results.some(r => r.puzzleId === currentPuzzleId && r.playerName === p.name)
    );

  const totalScores = useMemo(() => {
    if (!session) return [];
    const completedPuzzles = session.puzzleIds.slice(0, session.ended ? session.puzzleIds.length : session.currentPuzzleIndex + (allDone ? 1 : 0));
    return calculateTotalScores(session.results, completedPuzzles, session.players);
  }, [session?.results, session?.puzzleIds, session?.currentPuzzleIndex, session?.players, allDone, session?.ended]);

  const isLastPuzzle = session ? session.currentPuzzleIndex >= session.puzzleIds.length - 1 : false;
  useEffect(() => {
    if (session && !session.ended && allDone && isLastPuzzle) {
      dispatch({ type: 'END_SESSION', sessionId: session.id });
    }
  }, [allDone, isLastPuzzle, session?.ended, session?.id]);

  if (!session) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ marginBottom: 16 }}><IconX size={48} /></div>
          <h2 style={{ marginBottom: 8 }}>Session nicht gefunden</h2>
          <p style={{ color: '#666', marginBottom: 24 }}>
            Der Code <strong>{sessionId}</strong> existiert nicht.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/code-detektiv')}><IconBack size={14} /> Zurück zur Startseite</button>
        </div>
      </div>
    );
  }

  if (session.ended) {
    return (
      <div style={{ minHeight: '100vh', background: '#f5f5f5', padding: 24 }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <IconTrophy size={64} />
            <h1 style={{ fontSize: 28, marginTop: 8 }}>Endergebnis</h1>
            <p style={{ color: '#666' }}>Session {session.id}</p>
          </div>
          <Scoreboard scores={totalScores} label="Gesamtpunkte" showTotal />
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <button className="btn btn-primary" onClick={() => navigate('/code-detektiv')}><IconBack size={14} /> Zurück zur Startseite</button>
          </div>
        </div>
      </div>
    );
  }

  if (!session.started) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <div style={{ textAlign: 'center', maxWidth: 450 }}>
          <div style={{ marginBottom: 16 }}><IconHourglass size={48} /></div>
          <h2 style={{ marginBottom: 8 }}>Warte auf Start...</h2>
          <p style={{ color: '#666', marginBottom: 8 }}>
            Session <strong>{session.id}</strong>
          </p>
          <p style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>
            {session.puzzleIds.length} Rätsel in dieser Session
          </p>
          <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e0e0e0', textAlign: 'left' }}>
            <h3 style={{ fontSize: 14, color: '#888', marginBottom: 12 }}>Spieler ({session.players.length})</h3>
            {session.players.length === 0 && (
              <p style={{ color: '#aaa', fontSize: 13 }}>Noch keine Spieler beigetreten</p>
            )}
            {session.players.map((p, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: i < session.players.length - 1 ? '1px solid #f0f0f0' : 'none', fontSize: 15 }}>
                {p.name} {p.name === playerName && <span style={{ color: '#1e90ff' }}>(Du)</span>}
              </div>
            ))}
          </div>
          <p style={{ marginTop: 16, fontSize: 13, color: '#999' }}>Der Admin startet das Rätsel gleich...</p>
        </div>
      </div>
    );
  }

  if (session.started && !isPlayer && !isAdmin) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ marginBottom: 16 }}><IconX size={48} /></div>
          <h2 style={{ marginBottom: 8 }}>Session läuft bereits</h2>
          <p style={{ color: '#666', marginBottom: 24 }}>Du kannst dieser Session nicht mehr beitreten.</p>
          <button className="btn btn-primary" onClick={() => navigate('/code-detektiv')}><IconBack size={14} /> Zurück zur Startseite</button>
        </div>
      </div>
    );
  }

  if (isPlayer && !myResult && currentPuzzle && !allDone) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ marginBottom: 16 }}><IconPuzzle size={48} /></div>
          <h2 style={{ marginBottom: 8 }}>Runde {session.currentPuzzleIndex + 1} von {session.puzzleIds.length}</h2>
          <p style={{ color: '#666', marginBottom: 8 }}>{currentPuzzle.title}</p>
          <p style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>{currentPuzzle.description}</p>
          <button
            className="btn btn-success"
            style={{ fontSize: 18, padding: '14px 40px' }}
            onClick={() => navigate(`/code-detektiv/puzzle/${currentPuzzleId}?session=${sessionId}`)}
          >
            <IconPlay size={16} /> Rätsel starten
          </button>
        </div>
      </div>
    );
  }

  if (isPlayer && myResult && !allDone) {
    const solvedCount = session.players.filter(p =>
      session.results.some(r => r.puzzleId === currentPuzzleId && r.playerName === p.name)
    ).length;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <div style={{ textAlign: 'center', maxWidth: 450 }}>
          <div style={{ marginBottom: 16 }}>{myResult.solved ? <IconCheckCircle size={48} /> : <IconClock size={48} />}</div>
          <h2 style={{ marginBottom: 8 }}>
            {myResult.solved ? 'Geschafft!' : 'Zeit abgelaufen'}
          </h2>
          {myResult.solved && (
            <p style={{ color: '#666', marginBottom: 16 }}>
              {myResult.attempts} {myResult.attempts === 1 ? 'Versuch' : 'Versuche'} - {formatTime(myResult.time)}
            </p>
          )}
          <p style={{ color: '#888', marginBottom: 24 }}>
            Warte auf die anderen Spieler... ({solvedCount}/{session.players.length} fertig)
          </p>
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e0e0e0' }}>
            {session.players.map((p, i) => {
              const pr = session.results.find(r => r.puzzleId === currentPuzzleId && r.playerName === p.name);
              return (
                <div key={i} className="player-list-item">
                  <span>{p.name}</span>
                  <span style={{ fontSize: 13, color: pr ? (pr.solved ? '#4caf50' : '#f44336') : '#999' }}>
                    {pr ? (pr.solved ? <><IconCheckCircle size={14} /> Fertig</> : <><IconClock size={14} /> Zeit abgelaufen</>) : <><IconHourglass size={14} /> Löst noch...</>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (allDone && !session.ended) {
    const isLast = session.currentPuzzleIndex >= session.puzzleIds.length - 1;
    return (
      <div style={{ minHeight: '100vh', background: '#f5f5f5', padding: 24 }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <h2>Runde {session.currentPuzzleIndex + 1} abgeschlossen!</h2>
            <p style={{ color: '#666' }}>{currentPuzzle?.title}</p>
          </div>

          <Scoreboard scores={roundResults} label="Runden-Ergebnis" />

          {totalScores.length > 0 && session.currentPuzzleIndex > 0 && (
            <div style={{ marginTop: 24 }}>
              <Scoreboard scores={totalScores} label="Gesamtwertung" showTotal />
            </div>
          )}

          {isAdmin && (
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              {isLast ? (
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 16, padding: '12px 32px' }}
                  onClick={() => dispatch({ type: 'END_SESSION', sessionId: session.id })}
                >
                  <IconTrophy size={18} /> Session beenden
                </button>
              ) : (
                <button
                  className="btn btn-success"
                  style={{ fontSize: 16, padding: '12px 32px' }}
                  onClick={() => dispatch({ type: 'ADVANCE_PUZZLE', sessionId: session.id })}
                >
                  <IconPlay size={14} /> Nächstes Rätsel ({session.currentPuzzleIndex + 2}/{session.puzzleIds.length})
                </button>
              )}
            </div>
          )}

          {!isAdmin && (
            <p style={{ textAlign: 'center', marginTop: 24, color: '#888' }}>
              {isLast ? 'Warte auf Endergebnis...' : 'Warte auf nächstes Rätsel...'}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ color: '#888' }}>Lade...</p>
      </div>
    </div>
  );
}

function Scoreboard({ scores, label, showTotal }) {
  return (
    <div className="scoreboard">
      <div className="scoreboard-header">{label}</div>
      {scores.map((s, i) => (
        <div key={s.playerName} className="scoreboard-row">
          <div className={`scoreboard-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}`}>
            {i + 1}
          </div>
          <div className="scoreboard-name">{s.playerName}</div>
          {!showTotal && s.solved !== undefined && (
            <div className="scoreboard-detail">
              {s.solved ? `${s.attempts}x - ${formatTime(s.time)}` : 'nicht gelöst'}
            </div>
          )}
          <div className="scoreboard-points">
            {showTotal ? s.totalPoints : s.points || 0} Pkt
          </div>
        </div>
      ))}
    </div>
  );
}

function formatTime(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
