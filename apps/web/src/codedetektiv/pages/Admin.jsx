import { useState, useRef, useEffect } from 'react';
import { themenIndex } from "../../core/topics.js";
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useCdBase } from '../base.jsx';
import {
  DndContext, PointerSensor, useSensor, useSensors, DragOverlay, MeasuringStrategy,
} from '@dnd-kit/core';
import { useStore } from '../data/store';
import { CATEGORIES, BLOCK_TEMPLATES } from '../data/samplePuzzles';
import { IconChevronLeft, IconChevronRight } from '../components/Icons';
import { cardStyle, panelStyle, COLORS } from '../../components/Icons.jsx';
import {
  DraggableToolboxBlock, DraggableBlock, DragOverlayBlock,
  CollapsibleCategory,
} from '../components/MakeCodeBlock';
import {
  DroppableCanvas, Leinwand, ReturnZone, StackZone, ZoomSegment,
  findSnapStackId, leinwandAblegen, machKollision, useZoomPan,
} from '../components/Blockflaeche.jsx';
import {
  countAllBlocks, findBlock, findStackByBlockId, getSubStack, updateBlockField,
} from '../data/bloecke.js';
import { importPuzzleFromHex } from '../data/makecodeImport';
import { useCdText } from '../i18n.js';

function groupByCategory(templates) {
  const groups = {};
  for (const b of templates) {
    if (!groups[b.cat]) groups[b.cat] = [];
    groups[b.cat].push(b);
  }
  return groups;
}

const GROUPED_TEMPLATES = groupByCategory(BLOCK_TEMPLATES);

// Namen der Ablegezonen. Editor und Spielseite dürfen sich nicht denselben
// Knoten teilen — sonst zeigen zwei Flächen auf dieselbe Id.
const CANVAS_ID = 'editor-canvas';
const RETURN_ID = 'editor-return';
const stackDomId = (id) => `adm-stack-${id}`;
const editorCollision = machKollision({ canvasId: CANVAS_ID, returnId: RETURN_ID });

export default function Admin() {
  const { t } = useCdText();
  const navigate = useNavigate();
  const base = useCdBase();
  const { state, dispatch } = useStore();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [topicId, setTopicId] = useState('');
  const [topics, setTopics] = useState([]);
  useEffect(() => {
    fetch('/api/topics').then(r => (r.ok ? r.json() : [])).then(d => setTopics(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);
  // Siehe core/topics.js — eine Quelle fuer Beschriftung UND Reihenfolge.
  const themen = themenIndex(topics);
  const topicLabel = (tp) => themen.label(tp);
  const [type, setType] = useState('sort');
  const [difficulty, setDifficulty] = useState(1);
  const [timeLimit, setTimeLimit] = useState(120);
  const [distractorMode, setDistractorMode] = useState('none');
  const [distractorPercent, setDistractorPercent] = useState(15);
  const [stacks, setStacks] = useState([]);

  const [editingPuzzleId, setEditingPuzzleId] = useState(null);
  const [selectedPuzzles, setSelectedPuzzles] = useState([]);
  const [importError, setImportError] = useState('');
  const [importInfo, setImportInfo] = useState('');
  const [importing, setImporting] = useState(false);

  const [activeBlock, setActiveBlock] = useState(null);
  const [draggingFromEditor, setDraggingFromEditor] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(true);
  const pointerRef = useRef({ x: 0, y: 0 });

  const zp = useZoomPan();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const blockCount = countAllBlocks(stacks.flatMap(s => s.blocks));

  const koordinaten = () => zp.koordinaten(pointerRef.current);
  const snap = (cx, cy, ausser) => findSnapStackId(stacks, stackDomId, zp.zoom, cx, cy, ausser);

  // ── Import ──

  async function handleImportHex(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportError('');
    setImportInfo('');
    setStacks([]);
    setImporting(true);
    try {
      const text = await file.text();
      const { title: titelNeu, solution } = await importPuzzleFromHex(text);
      setTitle(titelNeu);
      setType('sort');
      setStacks([{
        id: `stk-import-${Date.now()}`,
        x: 50, y: 50,
        blocks: solution,
      }]);
      setImportInfo(t('cd.admin.import_ok', 'Importiert: "{{titel}}" ({{n}} Blöcke aus {{datei}})',
        { titel: titelNeu, n: solution.length, datei: file.name }));
    } catch (err) {
      setImportError(err.message || t('cd.admin.import_fehler', 'Import fehlgeschlagen.'));
    } finally {
      setImporting(false);
    }
  }

  // ── Edit/Save ──

  function editPuzzle(puzzle) {
    const solutionBlocks = (puzzle.solution || []).map(b => ({ ...b, isDistractor: false }));
    const distractorBlocks = (puzzle.distractors || []).map(b => ({ ...b, isDistractor: true }));
    const allBlocks = [...solutionBlocks, ...distractorBlocks];
    setEditingPuzzleId(puzzle.id);
    setTitle(puzzle.title);
    setTopicId(puzzle.topic_id || '');
    setDescription(puzzle.description || '');
    setType(puzzle.type);
    setDifficulty(puzzle.difficulty);
    setTimeLimit(puzzle.timeLimit);
    setDistractorMode(puzzle.distractorMode || 'none');
    setDistractorPercent(puzzle.distractorPercent || 15);
    setStacks([{
      id: `stk-edit-${Date.now()}`,
      x: 50, y: 50,
      blocks: allBlocks,
    }]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingPuzzleId(null);
    setTitle('');
    setTopicId('');
    setDescription('');
    setStacks([]);
  }

  function savePuzzle() {
    const sorted = [...stacks].sort((a, b) => a.x - b.x || a.y - b.y);
    const allBlocks = sorted.flatMap(s => s.blocks);
    if (!title.trim() || allBlocks.length === 0) {
      alert(t('cd.admin.fehlt_titel', 'Titel und mindestens ein Block sind nötig!'));
      return;
    }
    const strip = b => {
      const { isDistractor, ...rest } = b;
      if (rest.children) rest.children = rest.children.map(strip);
      return rest;
    };
    const puzzle = {
      id: editingPuzzleId || `custom-${Date.now()}`,
      title: title.trim(),
      topic_id: topicId ? Number(topicId) : null,
      description: description.trim(),
      type,
      difficulty,
      timeLimit,
      distractorMode,
      distractorPercent: distractorMode === 'percent' ? distractorPercent : undefined,
      solution: allBlocks.filter(b => !b.isDistractor).map(strip),
      distractors: allBlocks.filter(b => b.isDistractor).map(strip),
    };
    dispatch({ type: editingPuzzleId ? 'UPDATE_PUZZLE' : 'ADD_PUZZLE', puzzle });
    alert(editingPuzzleId
      ? t('cd.admin.aktualisiert', 'Rätsel aktualisiert!')
      : t('cd.admin.gespeichert', 'Rätsel gespeichert!'));
    setEditingPuzzleId(null);
    setTitle('');
    setTopicId('');
    setDescription('');
    setStacks([]);
  }

  function handleFieldChange(blockId, fieldKey, value) {
    setStacks(prev => prev.map(s => ({
      ...s, blocks: updateBlockField(s.blocks, blockId, fieldKey, value),
    })));
  }

  // ── DnD ──

  const draggedSubStackRef = useRef([]);

  function handleDragStart(event) {
    const { active } = event;
    const dtype = active.data.current?.type;
    if (dtype === 'toolbox') {
      setActiveBlock(active.data.current.block);
      setDraggingFromEditor(false);
      draggedSubStackRef.current = [];
    } else if (dtype === 'canvas-block') {
      const block = active.data.current.block;
      setActiveBlock(block);
      setDraggingFromEditor(true);
      const stack = findStackByBlockId(stacks, block.id);
      draggedSubStackRef.current = stack ? getSubStack(stack, block.id) : [block];
    } else {
      for (const stack of stacks) {
        const found = findBlock(stack.blocks, active.id);
        if (found) {
          setActiveBlock(found);
          setDraggingFromEditor(true);
          draggedSubStackRef.current = getSubStack(stack, active.id);
          break;
        }
      }
    }
  }

  function handleDragEnd(event) {
    const subStack = draggedSubStackRef.current;
    setActiveBlock(null);
    setDraggingFromEditor(false);
    draggedSubStackRef.current = [];
    leinwandAblegen({
      event, subStack, stacks, setStacks, koordinaten, snap,
      canvasId: CANVAS_ID, returnId: RETURN_ID,
    });
  }

  // ── Session ──

  function togglePuzzleSelection(puzzleId) {
    setSelectedPuzzles(prev =>
      prev.includes(puzzleId) ? prev.filter(id => id !== puzzleId) : [...prev, puzzleId]
    );
  }

  function createSession() {
    if (selectedPuzzles.length === 0) {
      alert(t('cd.admin.waehle_raetsel', 'Wähle mindestens ein Rätsel aus!'));
      return;
    }
    dispatch({ type: 'CREATE_SESSION', puzzleIds: selectedPuzzles });
    dispatch({ type: 'SET_USER', user: { name: 'Admin', role: 'admin' } });
    setSelectedPuzzles([]);
  }

  const activeSessions = state.sessions.filter(s => !s.ended);

  return (
    <div onPointerMove={e => { pointerRef.current = { x: e.clientX, y: e.clientY }; }}>
      {/* Kein eigener Header/Zurueck mehr: laeuft eingebettet in Nuvoras Navbar. */}
      <div className="page-container" style={{ maxWidth: '100%' }}>
        {activeSessions.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ marginBottom: 16 }}>{t('cd.admin.aktive_sessions', 'Aktive Sessions')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {activeSessions.map(session => {
                const currentPuzzle = state.puzzles.find(p => p.id === session.puzzleIds[session.currentPuzzleIndex]);
                return (
                  <div key={session.id} style={{ ...cardStyle, padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div>
                        <h3 style={{ fontSize: 18 }}>
                          {t('cd.session', 'Session')}: <span style={{ color: 'var(--accent)', letterSpacing: 2 }}>{session.id}</span>
                        </h3>
                        <p style={{ fontSize: 13, color: 'var(--text3)' }}>
                          {t('cd.admin.session_stand', '{{n}} Rätsel, Runde {{runde}}/{{gesamt}}', { n: session.puzzleIds.length, runde: session.currentPuzzleIndex + 1, gesamt: session.puzzleIds.length })}
                          {currentPuzzle && ` - ${currentPuzzle.title}`}
                        </p>
                        <p style={{ fontSize: 12.5, color: 'var(--text2)', marginTop: 4 }}>
                          {t('cd.admin.beitritt_link', 'Beitreten (Schüler, ohne Login):')} <strong>{window.location.origin}/cd/{session.id}</strong>
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {!session.started && (
                          <button className="btn btn-success"
                            onClick={() => dispatch({ type: 'START_SESSION', sessionId: session.id })}>
                            {t('cd.admin.starten', 'Starten')}
                          </button>
                        )}
                        <button className="btn btn-primary" onClick={() => navigate(`${base}/play/${session.id}`)}>
                          {t('cd.admin.ansehen', 'Ansehen')}
                        </button>
                        <button className="btn btn-danger" onClick={() => {
                          if (confirm(t('cd.admin.beenden_frage', 'Session wirklich beenden?'))) dispatch({ type: 'END_SESSION', sessionId: session.id });
                        }}>
                          {t('cd.admin.beenden', 'Beenden')}
                        </button>
                      </div>
                    </div>
                    <div style={{ ...panelStyle, padding: 12 }}>
                      <h4 style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 8 }}>{t('cd.spieler_n', 'Spieler ({{n}})', { n: session.players.length })}</h4>
                      {session.players.length === 0 && <p style={{ color: 'var(--text3)', fontSize: 13 }}>{t('cd.admin.keine_spieler', 'Noch keine Spieler')}</p>}
                      {session.players.map(p => (
                        <div key={p.name} className="player-list-item">
                          <span style={{ fontSize: 14 }}>{p.name}</span>
                          <button className="btn btn-danger btn-klein"
                            onClick={() => dispatch({ type: 'REMOVE_PLAYER', sessionId: session.id, playerName: p.name })}>
                            {t('cd.admin.entfernen', 'Entfernen')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Puzzle Editor */}
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ marginBottom: 16 }}>
            {editingPuzzleId && t('cd.admin.bearbeiten_titel', 'Rätsel bearbeiten')}
            {editingPuzzleId && (
              <button className="btn btn-outline btn-klein" onClick={cancelEdit} style={{ marginLeft: 12 }}>{t('cd.abbrechen', 'Abbrechen')}</button>
            )}
          </h2>

          <div className="admin-form" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label>{t('cd.admin.hex_label', 'MakeCode .hex importieren')}</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="file" accept=".hex" onChange={handleImportHex} disabled={importing} />
                {blockCount > 0 && (
                  <button type="button" className="btn btn-outline btn-klein"
                    onClick={() => { setStacks([]); setImportInfo(''); }}>{t('cd.admin.leeren', 'Leeren')}</button>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                {importing
                  ? t('cd.admin.importiert_gerade', 'Importiere...')
                  : t('cd.admin.hex_hinweis', 'Blöcke aus einer MakeCode/Calliope-Datei laden.')}
              </p>
              {importInfo && <p style={{ fontSize: 12, color: COLORS.success, marginTop: 4 }}>{importInfo}</p>}
              {importError && <p style={{ fontSize: 12, color: COLORS.danger, marginTop: 4 }}>{importError}</p>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: 12 }}>
              <div className="form-group">
                <label>{t('cd.admin.titel', 'Titel')}</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('cd.admin.titel_platzhalter', 'z.B. LED blinken lassen')} />
              </div>
              <div className="form-group">
                <label>{t('cd.admin.beschreibung', 'Beschreibung / Aufgabe')}</label>
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder={t('cd.admin.beschreibung_platzhalter', 'Was sollen die SuS tun?')} />
              </div>
            </div>
            <div className="form-group">
              <label>{t('cd.admin.thema', 'Thema (Nuvora) — optional')}</label>
              <select value={topicId} onChange={e => setTopicId(e.target.value)}>
                <option value="">{t('cd.admin.kein_thema', '– kein Thema –')}</option>
                {themen.geordnet.map(tp => <option key={tp.id} value={tp.id}>{topicLabel(tp)}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: 12 }}>
              <div className="form-group">
                <label>{t('cd.admin.typ', 'Typ')}</label>
                <select value={type} onChange={e => setType(e.target.value)}>
                  <option value="sort">{t('cd.typ.sortieren', 'Sortieren')}</option>
                  <option value="maze">{t('cd.typ.labyrinth', 'Labyrinth')}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('cd.admin.schwierigkeit', 'Schwierigkeit')}</label>
                <select value={difficulty} onChange={e => setDifficulty(Number(e.target.value))}>
                  <option value={1}>{t('cd.admin.leicht', 'Leicht')}</option>
                  <option value={2}>{t('cd.admin.mittel', 'Mittel')}</option>
                  <option value={3}>{t('cd.admin.schwer', 'Schwer')}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t('cd.admin.zeitlimit', 'Zeitlimit (Sek.)')}</label>
                <input type="number" value={timeLimit} onChange={e => setTimeLimit(Number(e.target.value))} min={30} step={30} />
              </div>
              <div className="form-group">
                <label>{t('cd.admin.bausteine', 'Angezeigte Bausteine')}</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select value={distractorMode} onChange={e => setDistractorMode(e.target.value)} style={{ flex: 1 }}>
                    <option value="none">{t('cd.admin.nur_noetig', 'Nur benötigte')}</option>
                    <option value="percent">{t('cd.admin.mit_stoerern', 'Benötigte + Störer')}</option>
                    <option value="all">{t('cd.admin.alle_bausteine', 'Alle Bausteine')}</option>
                  </select>
                  {distractorMode === 'percent' && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                      <input type="number" value={distractorPercent}
                        onChange={e => setDistractorPercent(Number(e.target.value))}
                        min={5} max={100} step={5}
                        style={{ width: 60 }} />
                      <span style={{ fontSize: 13, color: 'var(--text2)' }}>%</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <DndContext sensors={sensors} collisionDetection={editorCollision}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className={`cd-editorgrid${toolboxOpen ? '' : ' zu'}`} style={{ display: 'grid', gap: 16, minHeight: 400 }}>
              {toolboxOpen && (
                <div className="block-toolbox">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3>{t('cd.admin.vorlagen', 'Block-Vorlagen')}</h3>
                    <button className="btn btn-outline btn-klein"
                      title={t('cd.puzzle.toolbox_zu', 'Toolbox ausblenden')}
                      onClick={() => setToolboxOpen(false)}><IconChevronLeft size={12} /></button>
                  </div>
                  {Object.entries(GROUPED_TEMPLATES).map(([cat, tBlocks]) => (
                    <CollapsibleCategory key={cat} cat={cat} catInfo={CATEGORIES[cat]}>
                      {tBlocks.map((block, i) => (
                        <DraggableToolboxBlock key={block.id} block={block} dragId={`adm-tb-${block.id}-${i}`} />
                      ))}
                    </CollapsibleCategory>
                  ))}
                  <ReturnZone id={RETURN_ID} active={draggingFromEditor} />
                </div>
              )}

              <div className="solution-area">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!toolboxOpen && (
                      <button className="btn btn-outline btn-leiste"
                        onClick={() => setToolboxOpen(true)}>
                        <IconChevronRight size={12} /> {t('cd.admin.bausteine_kurz', 'Bausteine')}
                      </button>
                    )}
                    <h3 style={{ margin: 0 }}>
                      {t('cd.admin.loesung', 'Lösung')}
                      {blockCount > 0 && ` ${t('cd.bloecke_zahl', '({{n}} Blöcke)', { n: blockCount })}`}
                    </h3>
                  </div>
                  <ZoomSegment zoom={zp.zoom} setZoom={zp.setZoom} />
                </div>

                <Leinwand zp={zp} inhaltStil={{ minHeight: 600 }}>
                  <DroppableCanvas id={CANVAS_ID}
                    leer={stacks.length === 0 && !activeBlock}
                    hinweis={t('cd.admin.ziehen_hinweis', 'Blöcke von links hierhin ziehen')}>
                    {stacks.map(stack => (
                      <StackZone key={stack.id} stack={stack} domId={stackDomId}>
                        {stack.blocks.map(block => (
                          <div key={block.id}>
                            <DraggableBlock block={block} onFieldChange={handleFieldChange} />
                          </div>
                        ))}
                      </StackZone>
                    ))}
                  </DroppableCanvas>
                </Leinwand>

                <button className="btn btn-success" onClick={savePuzzle} style={{ width: '100%', marginTop: 16 }}>
                  {editingPuzzleId
                    ? t('cd.admin.speichern_aenderung', 'Änderungen speichern')
                    : t('cd.admin.speichern', 'Rätsel speichern')}
                </button>
              </div>
            </div>

            {createPortal(
              <DragOverlay>
                {activeBlock ? <DragOverlayBlock block={activeBlock} /> : null}
              </DragOverlay>,
              document.body
            )}
          </DndContext>
        </div>

        {/* Session + Puzzle List */}
        <div className="cd-zweispaltig" style={{ display: 'grid', gap: 24, alignItems: 'start' }}>
          <div>
            <h2 style={{ marginBottom: 16 }}>{t('cd.admin.session_erstellen', 'Session erstellen')}</h2>
            <div style={{ ...cardStyle, padding: 20 }}>
              <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{t('cd.admin.session_auswahl', 'Wähle Rätsel für die Session aus:')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {state.puzzles.map(puzzle => (
                  <label key={puzzle.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    borderRadius: 10, cursor: 'pointer',
                    background: selectedPuzzles.includes(puzzle.id) ? 'var(--bg2)' : 'var(--bg3)',
                    border: selectedPuzzles.includes(puzzle.id) ? '1px solid var(--accent)' : '1px solid var(--border)',
                  }}>
                    <input type="checkbox" checked={selectedPuzzles.includes(puzzle.id)}
                      onChange={() => togglePuzzleSelection(puzzle.id)} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{puzzle.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                        {puzzle.type === 'maze' ? t('cd.typ.labyrinth', 'Labyrinth') : t('cd.typ.sortieren', 'Sortieren')}
                      </div>
                    </div>
                    {selectedPuzzles.includes(puzzle.id) && (
                      <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
                        #{selectedPuzzles.indexOf(puzzle.id) + 1}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <button className="btn btn-primary" onClick={createSession}
                disabled={selectedPuzzles.length === 0} style={{ width: '100%' }}>
                {t('cd.admin.session_erstellen_n', 'Session erstellen ({{n}} Rätsel)', { n: selectedPuzzles.length })}
              </button>
            </div>
          </div>

          <div>
            <h2 style={{ marginBottom: 16 }}>{t('cd.admin.vorhandene', 'Vorhandene Rätsel')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {state.puzzles.map(puzzle => (
                <div key={puzzle.id} className="puzzle-card" onClick={() => navigate(`${base}/puzzle/${puzzle.id}?mode=solo`)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 600 }}>{puzzle.title}</h3>
                      <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>{puzzle.description}</p>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <span className="cat-badge" style={{ background: puzzle.type === 'maze' ? CATEGORIES.movement.color : CATEGORIES.basic.color }}>
                          {puzzle.type === 'maze' ? t('cd.typ.labyrinth', 'Labyrinth') : t('cd.typ.sortieren', 'Sortieren')}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button className="btn btn-outline btn-klein"
                        onClick={e => { e.stopPropagation(); navigate(`${base}/puzzle/${puzzle.id}?mode=solo`); }}>
                        {t('cd.admin.vorschau', 'Vorschau')}
                      </button>
                      <button className="btn btn-primary btn-klein"
                        onClick={e => { e.stopPropagation(); editPuzzle(puzzle); }}>
                        {t('cd.admin.bearbeiten', 'Bearbeiten')}
                      </button>
                      {puzzle.id.startsWith('custom-') && (
                        <button className="btn btn-danger btn-klein"
                          onClick={e => {
                            e.stopPropagation();
                            if (confirm(t('cd.admin.loeschen_frage', 'Rätsel wirklich löschen?'))) dispatch({ type: 'DELETE_PUZZLE', puzzleId: puzzle.id });
                          }}>
                          {t('cd.admin.loeschen', 'Löschen')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
