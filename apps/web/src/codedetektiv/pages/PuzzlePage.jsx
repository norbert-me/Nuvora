import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  DndContext, PointerSensor, useSensor, useSensors, DragOverlay, useDroppable, MeasuringStrategy,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useCdBase } from '../base.jsx';
import { useStore } from '../data/store';
import {
  DraggableToolboxBlock, MazeToolboxBlock, SortableBlock,
  DraggableBlock, DragOverlayBlock, CollapsibleCategory,
  StaticBlock, GhostBlock,
} from '../components/MakeCodeBlock';
import {
  DroppableCanvas, Leinwand, ReturnZone, StackZone, ZoomSegment,
  findSnapStackId, kollisionNach, leinwandAblegen, machKollision, useZoomPan,
} from '../components/Blockflaeche.jsx';
import {
  collectSlotValues, compareBlocks, countAllBlocks, fillSlot, findBlock,
  findParentContainer, findStackByBlockId, flattenSolution, getSubStack,
  isContainerType, moveBlock, removeBlockDeep, updateBlockField, valueSig,
} from '../data/bloecke.js';
import { MazeRunner } from '../components/MazeRunner';
import { Timer, useElapsedTime } from '../components/Timer';
import { CATEGORIES, BLOCK_TEMPLATES } from '../data/samplePuzzles';
import {
  IconSearch, IconBulb, IconCheck, IconX, IconClock, IconPlay,
  IconReset, IconBack, IconChevronLeft, IconChevronRight, IconParty,
} from '../components/Icons';
import { cardStyle, panelStyle, toolbarIconBtn } from '../../components/Icons.jsx';
import { mmss } from '../../core/datum.js';
import { useCdText } from '../i18n.js';

const SHOW_SOLUTION_AFTER = 5;

// Namen der Ablegezonen dieser Seite (der Editor hat eigene, siehe Admin.jsx).
const CANVAS_ID = 'canvas-drop';
const RETURN_ID = 'toolbox-return';
const stackDomId = (id) => `stack-el-${id}`;
const canvasCollision = machKollision({ canvasId: CANVAS_ID, returnId: RETURN_ID, mitSlots: true });
// Das Labyrinth hat keine freie Fläche, sondern eine einzige Liste: dort
// gewinnen die Blöcke selbst vor der Liste, in der sie liegen.
const mazeCollision = kollisionNach((id) => {
  const s = String(id);
  if (s === RETURN_ID) return 0;
  if (s === 'solution-drop') return 2;
  return 1;
});

function DroppableSolutionArea({ children }) {
  const { setNodeRef } = useDroppable({ id: 'solution-drop' });
  return (
    <div ref={setNodeRef} className="solution-stack"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 160, borderRadius: 8,
        padding: '8px 8px 56px', background: 'var(--bg2)', border: '1px dashed var(--border2)' }}>
      {children}
    </div>
  );
}

export default function PuzzlePage() {
  const { t } = useCdText();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session');
  const isSolo = !sessionId;
  const navigate = useNavigate();
  const base = useCdBase();
  const { state, dispatch } = useStore();
  const puzzle = state.puzzles.find(p => p.id === id);

  // Maze uses flat list, sort uses stacks
  const [mazeSolutionBlocks, setMazeSolutionBlocks] = useState([]);
  const [stacks, setStacks] = useState([]);
  const [toolboxOpen, setToolboxOpen] = useState(true);

  const [feedback, setFeedback] = useState(null);
  const [countdown, setCountdown] = useState(sessionId ? 3 : null);
  const [timerRunning, setTimerRunning] = useState(!sessionId);
  const [mazeRunning, setMazeRunning] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [solved, setSolved] = useState(false);
  const [activeBlock, setActiveBlock] = useState(null);
  const [draggingFromCanvas, setDraggingFromCanvas] = useState(false);
  const [dropTarget, setDropTarget] = useState(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [showSolution, setShowSolution] = useState(false);

  const zp = useZoomPan();

  const elapsed = useElapsedTime(timerRunning);
  const hasTimeLimit = !isSolo && puzzle?.timeLimit;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const isMaze = puzzle?.type === 'maze';

  const allPlacedBlocks = useMemo(() => {
    if (isMaze) return mazeSolutionBlocks;
    const sorted = [...stacks].sort((a, b) => a.x - b.x || a.y - b.y);
    return sorted.flatMap(s => s.blocks);
  }, [stacks, mazeSolutionBlocks, isMaze]);

  const totalBlockCount = useMemo(() => countAllBlocks(allPlacedBlocks), [allPlacedBlocks]);

  const toolboxBlocks = useMemo(() => {
    if (!puzzle) return [];
    if (puzzle.type === 'maze' && puzzle.availableBlocks) return puzzle.availableBlocks;

    const mode = puzzle.distractorMode || 'none';

    if (mode === 'all') {
      return BLOCK_TEMPLATES.map(b => ({
        ...b,
        fields: b.fields?.map(f => ({ ...f, value: '' })),
        children: isContainerType(b.type) ? [] : undefined,
      }));
    }

    const solutionBlocks = flattenSolution(puzzle.solution);
    const cleared = solutionBlocks.map(b => ({
      ...b,
      fields: b.fields?.map(f => ({ ...f, value: '' })),
      slots: b.slots?.map(s => ({ ...s, child: null })),
    }));

    let distractors = [];
    if (mode === 'none') {
      distractors = (puzzle.distractors || []).map(b => ({
        ...b,
        fields: b.fields?.map(f => ({ ...f, value: '' })),
      }));
    } else if (mode === 'percent') {
      const pct = puzzle.distractorPercent || 15;
      const count = Math.max(1, Math.ceil(solutionBlocks.length * pct / 100));
      const solutionSigs = new Set(solutionBlocks.map(b => b.cat + ':' + b.label));
      const candidates = BLOCK_TEMPLATES.filter(b =>
        !solutionSigs.has(b.cat + ':' + b.label) && b.type !== 'value'
      );
      const shuffled = [...candidates].sort(() => Math.random() - 0.5);
      distractors = shuffled.slice(0, count).map((b, i) => ({
        ...b,
        id: `dist-auto-${i}`,
        fields: b.fields?.map(f => ({ ...f, value: '' })),
        children: isContainerType(b.type) ? [] : undefined,
      }));
    }

    const values = collectSlotValues(puzzle.solution, []);
    for (const name of puzzle.variables || []) {
      values.push({ type: 'value', cat: 'variables', parts: [{ text: name }] });
    }
    const seen = new Set();
    const valuePalette = [];
    for (const v of values) {
      const sig = valueSig(v);
      if (seen.has(sig)) continue;
      seen.add(sig);
      valuePalette.push({ ...v, id: `pal-${valuePalette.length}` });
    }

    const combined = [...cleared, ...distractors, ...valuePalette];
    return combined.sort(() => Math.random() - 0.5);
  }, [puzzle]);

  const groupedToolbox = useMemo(() => {
    if (!puzzle || puzzle.type === 'maze') return null;
    const groups = {};
    for (const block of toolboxBlocks) {
      if (!groups[block.cat]) groups[block.cat] = [];
      groups[block.cat].push(block);
    }
    return groups;
  }, [toolboxBlocks, puzzle]);

  useEffect(() => {
    if (solved && sessionId && state.currentUser) {
      dispatch({
        type: 'SUBMIT_RESULT', sessionId,
        result: { puzzleId: id, playerName: state.currentUser.name, attempts, time: elapsed, solved: true },
      });
    }
  }, [solved]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      const t = setTimeout(() => { setCountdown(null); setTimerRunning(true); }, 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    const onMove = e => { pointerRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const koordinaten = () => zp.koordinaten(pointerRef.current);
  const snap = (cx, cy, ausser) => findSnapStackId(stacks, stackDomId, zp.zoom, cx, cy, ausser);

  if (!puzzle) return <div className="page-container">{t('cd.raetsel_fehlt', 'Rätsel nicht gefunden.')}</div>;

  // ── Field changes (stacks or maze) ──

  function handleFieldChange(blockId, fieldKey, value) {
    if (isMaze) {
      setMazeSolutionBlocks(prev => updateBlockField(prev, blockId, fieldKey, value));
    } else {
      setStacks(prev => prev.map(s => ({ ...s, blocks: updateBlockField(s.blocks, blockId, fieldKey, value) })));
    }
  }

  // ── Maze DnD (kept simple, same as before) ──

  function handleMazeDragStart(event) {
    const dtype = event.active.data.current?.type;
    if (dtype === 'toolbox') {
      setActiveBlock(event.active.data.current.block);
      setDraggingFromCanvas(false);
    } else {
      const found = findBlock(mazeSolutionBlocks, event.active.id);
      if (found) { setActiveBlock(found); setDraggingFromCanvas(true); }
    }
  }

  function handleMazeDragOver(event) {
    const { over } = event;
    if (!over) { setDropTarget(null); return; }
    if (over.id === 'solution-drop') {
      setDropTarget({ parentId: null, index: mazeSolutionBlocks.length });
    } else {
      const parent = findParentContainer(mazeSolutionBlocks, over.id);
      const list = parent ? parent.children : mazeSolutionBlocks;
      const idx = list.findIndex(b => b.id === over.id);
      if (idx < 0) { setDropTarget(null); return; }
      const rect = over.rect;
      const after = rect ? pointerRef.current.y > rect.top + rect.height / 2 : false;
      setDropTarget({ parentId: parent ? parent.id : null, index: idx + (after ? 1 : 0) });
    }
  }

  function handleMazeDragEnd(event) {
    const { active, over } = event;
    setActiveBlock(null);
    setDraggingFromCanvas(false);
    setDropTarget(null);
    if (!over) return;

    const dtype = active.data.current?.type;
    if (!dtype && over.id === RETURN_ID) {
      setMazeSolutionBlocks(prev => removeBlockDeep(prev, active.id));
      return;
    }
    if (dtype === 'toolbox') {
      const block = active.data.current.block;
      const newBlock = { ...block, id: `placed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        children: isContainerType(block.type) ? [] : undefined,
        fields: block.fields?.map(f => ({ ...f })) };
      setMazeSolutionBlocks(prev => [...prev, newBlock]);
      return;
    }
    if (active.id !== over.id) {
      const pos = (() => {
        if (over.id === 'solution-drop') return { parentId: null, index: mazeSolutionBlocks.length };
        const parent = findParentContainer(mazeSolutionBlocks, over.id);
        const list = parent ? parent.children : mazeSolutionBlocks;
        const idx = list.findIndex(b => b.id === over.id);
        if (idx < 0) return null;
        const rect = over.rect;
        const after = rect ? pointerRef.current.y > rect.top + rect.height / 2 : false;
        return { parentId: parent ? parent.id : null, index: idx + (after ? 1 : 0) };
      })();
      if (pos) setMazeSolutionBlocks(prev => moveBlock(prev, active.id, pos));
    }
  }

  // ── Canvas DnD (sort puzzles) ──

  const draggedSubStackRef = useRef([]);

  function handleCanvasDragStart(event) {
    const { active } = event;
    const dtype = active.data.current?.type;
    if (dtype === 'toolbox') {
      setActiveBlock(active.data.current.block);
      setDraggingFromCanvas(false);
      draggedSubStackRef.current = [];
    } else if (dtype === 'placed-value') {
      setActiveBlock(active.data.current.block);
      setDraggingFromCanvas(true);
      draggedSubStackRef.current = [];
    } else if (dtype === 'canvas-block') {
      const block = active.data.current.block;
      setActiveBlock(block);
      setDraggingFromCanvas(true);
      const stack = findStackByBlockId(stacks, block.id);
      draggedSubStackRef.current = stack ? getSubStack(stack, block.id) : [block];
    } else {
      for (const stack of stacks) {
        const found = findBlock(stack.blocks, active.id);
        if (found) {
          setActiveBlock(found);
          setDraggingFromCanvas(true);
          draggedSubStackRef.current = getSubStack(stack, active.id);
          break;
        }
      }
    }
  }

  function handleCanvasDragOver(event) {
    const { over } = event;
    if (!over) { setDropTarget(null); return; }
    if (typeof over.id === 'string' && over.id.startsWith('slot-')) { setDropTarget(null); return; }
    const overId = String(over.id);
    if (overId.startsWith('stack-')) {
      const stackId = overId.slice(6);
      const stack = stacks.find(s => s.id === stackId);
      if (stack) setDropTarget({ stackId, parentId: null, index: stack.blocks.length });
    } else {
      setDropTarget(null);
    }
  }

  function handleCanvasDragEnd(event) {
    const { active, over } = event;
    const subStack = draggedSubStackRef.current;
    setActiveBlock(null);
    setDraggingFromCanvas(false);
    setDropTarget(null);
    draggedSubStackRef.current = [];
    if (!over) return;

    const dtype = active.data.current?.type;
    const overId = String(over.id);
    const overSlot = overId.startsWith('slot-') ? overId.slice(5) : null;

    // Wertblöcke in Steckplätze — das gibt es nur beim Lösen, nicht im Editor.
    if (dtype === 'placed-value' || (dtype === 'toolbox' && active.data.current.block.type === 'value')) {
      const srcSlot = active.data.current.slotId;
      if (overSlot) {
        const value = { ...active.data.current.block, id: `val-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
        setStacks(prev => prev.map(s => {
          let blocks = s.blocks;
          if (srcSlot && srcSlot !== overSlot) blocks = fillSlot(blocks, srcSlot, null);
          blocks = fillSlot(blocks, overSlot, value);
          return { ...s, blocks };
        }));
        setFeedback(null);
      } else if (srcSlot && overId === RETURN_ID) {
        setStacks(prev => prev.map(s => ({ ...s, blocks: fillSlot(s.blocks, srcSlot, null) })));
      }
      return;
    }

    if (overSlot) return;

    leinwandAblegen({
      event, subStack, stacks, setStacks, koordinaten, snap,
      canvasId: CANVAS_ID, returnId: RETURN_ID, mitSlots: true,
      nachAenderung: () => setFeedback(null),
    });
  }

  // ── Solution checking ──

  function checkSolution() {
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);
    if (puzzle.type === 'maze') {
      setMazeRunning(true);
      return;
    }
    const correct = compareBlocks(allPlacedBlocks, puzzle.solution);
    if (correct) {
      setFeedback('correct');
      setSolved(true);
      setTimerRunning(false);
    } else {
      setFeedback('wrong');
      if (isSolo && newAttempts >= SHOW_SOLUTION_AFTER) setShowSolution(true);
    }
  }

  function handleMazeFinish(success) {
    setMazeRunning(false);
    if (success) {
      setFeedback('correct');
      setSolved(true);
      setTimerRunning(false);
    } else {
      setFeedback('wrong');
      if (isSolo && attempts >= SHOW_SOLUTION_AFTER) setShowSolution(true);
    }
  }

  function handleTimeUp() {
    setTimerRunning(false);
    setFeedback('timeout');
    if (sessionId && state.currentUser) {
      dispatch({
        type: 'SUBMIT_RESULT', sessionId,
        result: { puzzleId: id, playerName: state.currentUser.name, attempts, time: puzzle.timeLimit, solved: false },
      });
    }
  }

  function reset() {
    setStacks([]);
    setMazeSolutionBlocks([]);
    setFeedback(null);
    setMazeRunning(false);
  }

  // ── Render ──

  const dndHandlers = isMaze
    ? { onDragStart: handleMazeDragStart, onDragOver: handleMazeDragOver, onDragEnd: handleMazeDragEnd }
    : { onDragStart: handleCanvasDragStart, onDragOver: handleCanvasDragOver, onDragEnd: handleCanvasDragEnd };

  return (
    <div>
      {countdown !== null && (
        <div className="countdown-overlay">
          <div className="countdown-number" key={countdown}>
            {countdown > 0 ? countdown : t('cd.los', 'Los!')}
          </div>
        </div>
      )}
      <div className="app-header">
        <h1><IconSearch size={22} /> {puzzle.title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {hasTimeLimit
            ? <Timer seconds={puzzle.timeLimit} running={timerRunning} onTimeUp={handleTimeUp} />
            : <Timer seconds={0} running={timerRunning} countUp />}
          {isSolo && <button className="btn btn-outline" onClick={() => navigate(-1)}><IconBack size={14} /> {t('cd.zurueck', 'Zurück')}</button>}
        </div>
      </div>

      <div className="page-container" style={{ maxWidth: '100%' }}>
        <div style={{ ...panelStyle, marginBottom: 16, fontSize: 14, color: 'var(--text)' }}>
          <IconBulb size={16} /> {puzzle.description}
        </div>

        <DndContext sensors={sensors}
          collisionDetection={isMaze ? mazeCollision : canvasCollision}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          {...dndHandlers}>
          <div className={`cd-editorgrid${toolboxOpen ? '' : ' zu'}`} style={{ display: 'grid', gap: 16 }}>

            {toolboxOpen && (
              <div className="block-toolbox">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0 }}>{t('cd.puzzle.verfuegbare_bloecke', 'Verfügbare Blöcke')}</h3>
                  <button onClick={() => setToolboxOpen(false)}
                    className="icon-btn" style={toolbarIconBtn}
                    title={t('cd.puzzle.toolbox_zu', 'Toolbox ausblenden')}><IconChevronLeft size={14} /></button>
                </div>
                {isMaze ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                    {toolboxBlocks.map((block, i) => (
                      <MazeToolboxBlock key={`${block.id}-${i}`} block={block} dragId={`tb-mz-${block.id}-${i}`} />
                    ))}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                    {groupedToolbox && Object.entries(groupedToolbox).map(([cat, blocks]) => (
                      <CollapsibleCategory key={cat} cat={cat} catInfo={CATEGORIES[cat]}>
                        {blocks.map((block, i) => (
                          <DraggableToolboxBlock key={`${block.id}-${i}`} block={block} dragId={`tb-${cat}-${block.id}-${i}`} />
                        ))}
                      </CollapsibleCategory>
                    ))}
                  </div>
                )}
                <ReturnZone id={RETURN_ID} active={draggingFromCanvas} />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {!toolboxOpen && (
                <button className="btn btn-outline btn-leiste" onClick={() => setToolboxOpen(true)}
                  style={{ alignSelf: 'flex-start' }}>
                  <IconChevronRight size={12} /> {t('cd.puzzle.bloecke_zeigen', 'Blöcke anzeigen')}
                </button>
              )}

              {isMaze && puzzle.maze && (
                <div style={{ ...cardStyle, padding: 20, display: 'flex', justifyContent: 'center' }}>
                  <MazeRunner maze={puzzle.maze} commands={mazeSolutionBlocks} running={mazeRunning} onFinish={handleMazeFinish} />
                </div>
              )}

              <div className="solution-area">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ margin: 0 }}>
                    {t('cd.puzzle.deine_loesung', 'Deine Lösung')}
                    {totalBlockCount > 0 && ` ${t('cd.bloecke_zahl', '({{n}} Blöcke)', { n: totalBlockCount })}`}
                  </h3>
                  {!isMaze && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {/* Ein Gedanke („wie nah?"), also EIN Bedienelement:
                          Segment mit duennen Trennern statt drei Kaesten. */}
                      <ZoomSegment zoom={zp.zoom} setZoom={zp.setZoom} />
                      <button className="btn btn-outline btn-leiste"
                        onClick={zp.alleszeigen}>{t('cd.puzzle.alles_zeigen', 'Alles zeigen')}</button>
                    </div>
                  )}
                </div>

                {isMaze ? (
                  /* Maze: simple vertical list */
                  <SortableContext items={mazeSolutionBlocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                    <DroppableSolutionArea>
                      {(() => {
                        const ghostAt = activeBlock && dropTarget && dropTarget.parentId == null ? dropTarget.index : null;
                        if (mazeSolutionBlocks.length === 0 && ghostAt == null) {
                          return <div className="drop-zone">{t('cd.puzzle.ziehen_links', 'Ziehe Blöcke von links hierhin')}</div>;
                        }
                        const nodes = mazeSolutionBlocks.map(block => (
                          <SortableBlock key={block.id} block={block}
                            onFieldChange={!solved ? handleFieldChange : undefined}
                            dropTarget={dropTarget} ghostBlock={activeBlock} />
                        ));
                        if (ghostAt != null) nodes.splice(ghostAt, 0, <GhostBlock key="__ghost" block={activeBlock} />);
                        return nodes;
                      })()}
                    </DroppableSolutionArea>
                  </SortableContext>
                ) : (
                  /* Sort: free canvas with stacks */
                  <Leinwand zp={zp} inhaltStil={{ minWidth: 800, minHeight: 500 }}>
                    <DroppableCanvas id={CANVAS_ID}
                      leer={stacks.length === 0 && !activeBlock}
                      hinweis={t('cd.bloecke_hierhin', 'Blöcke hierhin ziehen')}>
                      {stacks.map(stack => (
                        <StackZone key={stack.id} stack={stack} domId={stackDomId}>
                          {stack.blocks.map(block => (
                            <DraggableBlock key={block.id} block={block}
                              onFieldChange={!solved ? handleFieldChange : undefined} />
                          ))}
                        </StackZone>
                      ))}
                    </DroppableCanvas>
                  </Leinwand>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  <button className="btn btn-success" onClick={checkSolution}
                    disabled={totalBlockCount === 0 || solved || mazeRunning}>
                    {isMaze ? <><IconPlay size={14} /> {t('cd.puzzle.ausfuehren', 'Ausführen')}</> : <><IconCheck size={14} /> {t('cd.puzzle.pruefen', 'Prüfen')}</>}
                  </button>
                  <button className="btn btn-outline" onClick={reset} disabled={solved || mazeRunning}>
                    <IconReset size={14} /> {t('cd.puzzle.zuruecksetzen', 'Zurücksetzen')}
                  </button>
                  {solved && isSolo && (
                    <button className="btn btn-primary" onClick={() => navigate(`${base}/solo`)}>{t('cd.puzzle.naechstes_raetsel', 'Nächstes Rätsel')} →</button>
                  )}
                  {solved && sessionId && (
                    <button className="btn btn-primary" onClick={() => navigate(`${base}/play/${sessionId}`)}>{t('cd.puzzle.zurueck_session', 'Zurück zur Session')} →</button>
                  )}
                  {feedback === 'timeout' && sessionId && (
                    <button className="btn btn-primary" onClick={() => navigate(`${base}/play/${sessionId}`)}>{t('cd.puzzle.zurueck_session', 'Zurück zur Session')} →</button>
                  )}
                </div>

                {feedback === 'correct' && (
                  <div className="feedback-correct" style={{ marginTop: 16 }}>
                    <IconParty size={20} /> {t('cd.puzzle.richtig', 'Richtig!')}
                    <div className="feedback-stats">
                      <span><IconClock size={14} /> {t('cd.zeit', 'Zeit')}: {mmss(elapsed)}</span>
                      <span><IconReset size={14} /> {attempts} {attempts === 1 ? t('cd.versuch', 'Versuch') : t('cd.versuche', 'Versuche')}</span>
                    </div>
                  </div>
                )}
                {feedback === 'wrong' && (
                  <div className="feedback-wrong" style={{ marginTop: 16 }}>
                    <IconX size={16} /> {t('cd.puzzle.falsch', 'Noch nicht richtig. Versuch es nochmal!')}
                    {isSolo && !showSolution && attempts >= 3 && (
                      <div style={{ fontSize: 12, marginTop: 4, fontWeight: 400 }}>
                        {SHOW_SOLUTION_AFTER - attempts === 1
                          ? t('cd.puzzle.noch_ein_versuch', 'Noch 1 Versuch bis zur Lösung')
                          : t('cd.puzzle.noch_versuche', 'Noch {{n}} Versuche bis zur Lösung', { n: SHOW_SOLUTION_AFTER - attempts })}
                      </div>
                    )}
                  </div>
                )}
                {feedback === 'timeout' && (
                  <div className="feedback-wrong" style={{ marginTop: 16 }}><IconClock size={16} /> {t('cd.puzzle.zeit_um', 'Zeit abgelaufen!')}</div>
                )}
                {showSolution && isSolo && (
                  <div className="solution-reveal">
                    <h4><IconBulb size={16} /> {t('cd.puzzle.loesung', 'Lösung')}:</h4>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {puzzle.solution.map(block => <StaticBlock key={block.id} block={block} />)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {createPortal(
            <DragOverlay>{activeBlock ? <DragOverlayBlock block={activeBlock} /> : null}</DragOverlay>,
            document.body
          )}
        </DndContext>
      </div>
    </div>
  );
}
