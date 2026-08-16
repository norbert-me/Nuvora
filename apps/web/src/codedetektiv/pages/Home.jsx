import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCdBase } from '../base.jsx';
import { useStore, sessionBeitreten } from '../data/store';
import { IconSearch, IconGamepad, IconPuzzle } from '../components/Icons';
import {
  btnPrimary, btnSecondary, cardStyle, inputStyle, pageForm, pageTitle, pageIntro, COLORS,
} from '../../components/Icons.jsx';
import { useCdText } from '../i18n.js';

export default function Home() {
  const { t } = useCdText();
  const navigate = useNavigate();
  const base = useCdBase();
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

  async function handleJoin(e) {
    e.preventDefault();
    setError('');
    const code = joinCode.toUpperCase().trim();
    const name = playerName.trim();
    if (!code || !name) return;
    // Serverseitig beitreten (geräteübergreifend). Fehler direkt zurückmelden.
    const r = await sessionBeitreten(code, name);
    if (!r || !r.ok) {
      setError(r && r.status === 404
        ? t('cd.session.nicht_gefunden', 'Session nicht gefunden.')
        : t('cd.session.beitritt_fehler', 'Beitreten nicht möglich.'));
      return;
    }
    dispatch({ type: 'SET_USER', user: { name, role: 'player' } });
    dispatch({ type: 'SET_CURRENT_SESSION', code });
    navigate(`${base}/play/${code}`);
  }

  // Normale Shell-Flaeche statt Violett-Verlauf und Glaskarten: die Startseite
  // ist eine Seite wie jede andere in Nuvora, kein eigenes Produkt.
  const knopf = { ...btnSecondary, width: '100%', justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 8 };
  return (
    <div style={{ ...pageForm, padding: '24px 0' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <IconSearch size={40} />
        <h1 style={{ ...pageTitle, marginTop: 8 }}>{t('cd.titel', 'Code-Detektiv')}</h1>
        <p style={{ ...pageIntro, marginBottom: 0 }}>
          {t('cd.home.claim', 'Finde die Bugs! Sortiere die Blöcke! Werde Meister-Detektiv!')}
        </p>
      </div>

      <div style={cardStyle}>
        {isInSession && (
          <button
            onClick={() => navigate(`${base}/play/${activeSession.id}`)}
            style={{ ...btnPrimary, width: '100%', marginBottom: 12 }}
          >
            {t('cd.home.zurueck_session', 'Zurück zur Session {{code}}', { code: activeSession.id })}
          </button>
        )}

        {!showJoin ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={() => navigate(`${base}/admin`)} style={{ ...btnPrimary, width: '100%' }}>
              {t('cd.home.admin', 'Admin / Rätsel erstellen')}
            </button>
            <button onClick={() => setShowJoin(true)} style={knopf}>
              <IconGamepad size={18} /> {t('cd.home.beitreten', 'Rätsel beitreten')}
            </button>
            <button onClick={() => navigate(`${base}/solo`)} style={knopf}>
              <IconPuzzle size={18} /> {t('cd.solo.titel', 'Solo üben')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleJoin}>
            <div style={{ marginBottom: 10 }}>
              <input
                type="text"
                placeholder={t('cd.dein_name', 'Dein Name')}
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                required
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <input
                type="text"
                placeholder={t('cd.home.code_platzhalter', 'Session-Code (z.B. A3F2K1)')}
                value={joinCode}
                onChange={e => { setJoinCode(e.target.value.toUpperCase()); setError(''); }}
                required
                maxLength={6}
                style={{ ...inputStyle, width: '100%', fontSize: 18, textAlign: 'center', letterSpacing: 4, fontWeight: 700 }}
              />
            </div>
            {error && (
              <div style={{ color: COLORS.danger, fontSize: 13.5, fontWeight: 600, marginBottom: 12 }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => { setShowJoin(false); setError(''); }} style={{ ...btnSecondary, flex: 1 }}>
                {t('cd.zurueck', 'Zurück')}
              </button>
              <button type="submit" style={{ ...btnPrimary, flex: 2 }}>
                {t('cd.beitreten', 'Beitreten')} →
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
