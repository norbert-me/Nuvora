import { useNavigate } from 'react-router-dom';
import { useCdBase } from '../base.jsx';
import { useStore } from '../data/store';
import { CATEGORIES } from '../data/samplePuzzles';
import { IconSearch, IconPuzzle, IconMap, IconStar, IconClock, IconBack } from '../components/Icons';
import { useCdText } from '../i18n.js';

export default function Solo() {
  const { t } = useCdText();
  const navigate = useNavigate();
  const base = useCdBase();
  const { state } = useStore();

  return (
    <div>
      <div className="app-header">
        <h1><IconSearch size={22} /> {t('cd.titel', 'Code-Detektiv')}</h1>
        <button className="btn btn-outline" onClick={() => navigate(base)}><IconBack size={14} /> {t('cd.zurueck', 'Zurück')}</button>
      </div>
      <div className="page-container">
        <h2 style={{ marginBottom: 20 }}>{t('cd.solo.titel', 'Solo üben')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {state.puzzles.map(puzzle => (
            <div
              key={puzzle.id}
              className="puzzle-card"
              onClick={() => navigate(`${base}/puzzle/${puzzle.id}?mode=solo`)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 24 }}>{puzzle.type === 'maze' ? <IconMap size={24} /> : <IconPuzzle size={24} />}</span>
                <h3 style={{ fontSize: 16, fontWeight: 600 }}>{puzzle.title}</h3>
              </div>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>{puzzle.description}</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="cat-badge" style={{ background: puzzle.type === 'maze' ? CATEGORIES.movement.color : CATEGORIES.basic.color }}>
                  {puzzle.type === 'maze' ? t('cd.typ.labyrinth', 'Labyrinth') : t('cd.typ.sortieren', 'Sortieren')}
                </span>
                {Array.from({ length: puzzle.difficulty }, (_, i) => <IconStar key={i} size={14} />)}
                <span style={{ fontSize: 12, color: '#999', marginLeft: 'auto' }}>
                  <IconClock size={12} /> {Math.floor(puzzle.timeLimit / 60)}:{String(puzzle.timeLimit % 60).padStart(2, '0')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
