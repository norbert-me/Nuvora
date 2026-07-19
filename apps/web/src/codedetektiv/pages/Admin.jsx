import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, pointerWithin, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay, useDroppable, MeasuringStrategy,
} from '@dnd-kit/core';
import { useStore } from '../data/store';
import { CATEGORIES, BLOCK_TEMPLATES } from '../data/samplePuzzles';
import { IconUndo, IconChevronLeft, IconChevronRight } from '../components/Icons';
import {
  DraggableToolboxBlock, DraggableBlock, DragOverlayBlock,
  CollapsibleCategory, GhostBlock,
} from '../components/MakeCodeBlock';
import { importPuzzleFromHex } from '../data/makecodeImport';

function groupByCategory(templates) {
  const groups = {};
  for (const b of templates) {
    if (!groups[b.cat]) groups[b.cat] = [];
    groups[b.cat].push(b);
  }
  return groups;
}

const GROUPED_TEMPLATES = groupByCategory(BLOCK_TEMPLATES);
const SNAP_DISTANCE = 60;

function isContainerType(type) {
  return type === 'container' || type === 'event-container';
}

function isHatType(type) {
  return type === 'event' || type === 'event-container';
}

function DroppableCanvas({ children }) {
  const { setNodeRef } = useDroppable({ id: 'editor-canvas' });
  return <div ref={setNodeRef} style={{ position: 'relative', width: '100%', minHeight: '100%' }}>{children}</div>;
}

function StackZone({ stack, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stack-${stack.id}`, data: { stackId: stack.id } });
  return (
    <div ref={setNodeRef} id={`adm-stack-${stack.id}`}
      style={{
        position: 'absolute', left: stack.x, top: stack.y,
        paddingBottom: 30,
        outline: isOver ? '2px dashed rgba(30,144,255,0.4)' : 'none',
        borderRadius: 8,
      }}>
      <div className="solution-stack" style={{ display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  );
}

function DroppableReturnZone({ active }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'editor-return' });
  return (
    <div ref={setNodeRef} className={`toolbox-return-zone ${active ? 'active' : ''} ${isOver ? 'over' : ''}`}>
      {active ? <><IconUndo size={14} /> Block entfernen</> : ''}
    </div>
  );
}

function editorCollision(args) {
  const within = pointerWithin(args);
  if (!within.length) return closestCenter(args);
  const rank = (id) => {
    const s = String(id);
    if (s === 'editor-return') return 0;
    if (s.startsWith('dropzone-')) return 1;
    if (s.startsWith('stack-')) return 3;
    if (s === 'editor-canvas') return 4;
    return 2;
  };
  const area = (c) => {
    const r = c.data?.droppableContainer?.rect?.current;
    return r ? r.width * r.height : Infinity;
  };
  return [...within].sort((a, b) => {
    const r = rank(a.id) - rank(b.id);
    return r !== 0 ? r : area(a) - area(b);
  });
}

export default function Admin() {
  const navigate = useNavigate();
  const { state, dispatch } = useStore();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
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

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef(null);
  const canvasRef = useRef(null);
  const contentRef = useRef(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const allBlocks = stacks.flatMap(s => flattenWithChildren(s.blocks));
  const blockCount = allBlocks.length;

  function getCanvasCoords() {
    if (!canvasRef.current) return { x: 50, y: 50 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (pointerRef.current.x - rect.left - pan.x) / zoom,
      y: (pointerRef.current.y - rect.top - pan.y) / zoom,
    };
  }

  function findSnapStackId(cx, cy, excludeBlockId) {
    for (const stack of stacks) {
      if (excludeBlockId && stack.blocks.some(b => b.id === excludeBlockId)) continue;
      const el = document.getElementById(`adm-stack-${stack.id}`);
      if (!el) continue;
      const h = el.offsetHeight / zoom;
      const w = el.offsetWidth / zoom;
      const dx = cx - stack.x;
      if (dx < -SNAP_DISTANCE || dx > w + SNAP_DISTANCE) continue;
      if (cy >= stack.y - SNAP_DISTANCE && cy <= stack.y + h + SNAP_DISTANCE) return stack.id;
    }
    return null;
  }

  function findStackByBlockId(blockId) {
    return stacks.find(s => {
      for (const b of s.blocks) {
        if (b.id === blockId) return true;
        if (b.children && b.children.some(c => c.id === blockId)) return true;
      }
      return false;
    });
  }

  // ── Zoom/Pan ──

  function handleWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(z => Math.min(3, Math.max(0.25, z - e.deltaY * 0.002)));
  }

  function handleCanvasPointerDown(e) {
    if (e.target !== canvasRef.current && e.target !== contentRef.current) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    canvasRef.current.setPointerCapture(e.pointerId);
  }

  function handleCanvasPointerMove(e) {
    if (!isPanning || !panStart.current) return;
    setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  }

  function handleCanvasPointerUp() {
    setIsPanning(false);
    panStart.current = null;
  }

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
      const { title: t, solution } = await importPuzzleFromHex(text);
      setTitle(t);
      setType('sort');
      setStacks([{
        id: `stk-import-${Date.now()}`,
        x: 50, y: 50,
        blocks: solution,
      }]);
      setImportInfo(`Importiert: "${t}" (${solution.length} Blöcke aus ${file.name})`);
    } catch (err) {
      setImportError(err.message || 'Import fehlgeschlagen.');
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
    setDescription('');
    setStacks([]);
  }

  function savePuzzle() {
    const sorted = [...stacks].sort((a, b) => a.x - b.x || a.y - b.y);
    const allBlocks = sorted.flatMap(s => s.blocks);
    if (!title.trim() || allBlocks.length === 0) {
      alert('Titel und mindestens ein Block sind nötig!');
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
    alert(editingPuzzleId ? 'Rätsel aktualisiert!' : 'Rätsel gespeichert!');
    setEditingPuzzleId(null);
    setTitle('');
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

  function getSubStack(stack, blockId) {
    const idx = stack.blocks.findIndex(b => b.id === blockId);
    if (idx < 0) return [];
    return stack.blocks.slice(idx);
  }

  function removeSubStack(blocks, startId) {
    const idx = blocks.findIndex(b => b.id === startId);
    if (idx < 0) return blocks;
    return blocks.slice(0, idx);
  }

  function canAppendToStack(targetStack, blocksToAdd) {
    if (blocksToAdd.length === 0) return false;
    if (isHatType(blocksToAdd[0].type) && targetStack.blocks.length > 0) return false;
    return true;
  }

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
      const stack = findStackByBlockId(block.id);
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
    const { active, over } = event;
    const subStack = draggedSubStackRef.current;
    setActiveBlock(null);
    setDraggingFromEditor(false);
    draggedSubStackRef.current = [];
    if (!over) return;

    const dtype = active.data.current?.type;
    const overId = String(over.id);

    // Remove (sub-stack)
    if (overId === 'editor-return') {
      if (dtype === 'canvas-block' || !dtype) {
        setStacks(prev => prev.map(s => {
          const idx = s.blocks.findIndex(b => b.id === active.id);
          if (idx < 0) return s;
          return { ...s, blocks: s.blocks.slice(0, idx) };
        }).filter(s => s.blocks.length > 0));
      }
      return;
    }

    // From toolbox
    if (dtype === 'toolbox') {
      const block = active.data.current.block;
      const newBlock = {
        ...block,
        id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        children: isContainerType(block.type) ? [] : undefined,
        fields: block.fields ? block.fields.map(f => ({ ...f })) : undefined,
      };
      const isHat = isHatType(newBlock.type);

      if (overId.startsWith('stack-')) {
        const stackId = overId.slice(6);
        const target = stacks.find(s => s.id === stackId);
        if (isHat && target && target.blocks.length > 0) {
          const coords = getCanvasCoords();
          setStacks(prev => [...prev, {
            id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            x: Math.max(0, coords.x), y: Math.max(0, coords.y),
            blocks: [newBlock],
          }]);
        } else {
          setStacks(prev => prev.map(s =>
            s.id === stackId ? { ...s, blocks: [...s.blocks, newBlock] } : s
          ));
        }
      } else if (overId.startsWith('dropzone-')) {
        if (!isHat) {
          const containerId = overId.slice('dropzone-'.length);
          setStacks(prev => prev.map(s => ({
            ...s, blocks: addToContainer(s.blocks, containerId, newBlock),
          })));
        }
      } else {
        const coords = getCanvasCoords();
        const snapId = findSnapStackId(coords.x, coords.y, null);
        if (snapId && !isHat) {
          const target = stacks.find(s => s.id === snapId);
          if (target && canAppendToStack(target, [newBlock])) {
            setStacks(prev => prev.map(s =>
              s.id === snapId ? { ...s, blocks: [...s.blocks, newBlock] } : s
            ));
          } else {
            setStacks(prev => [...prev, {
              id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              x: Math.max(0, coords.x), y: Math.max(0, coords.y),
              blocks: [newBlock],
            }]);
          }
        } else {
          setStacks(prev => [...prev, {
            id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            x: Math.max(0, coords.x), y: Math.max(0, coords.y),
            blocks: [newBlock],
          }]);
        }
      }
      return;
    }

    // Move canvas block (+ sub-stack)
    if (dtype === 'canvas-block' || !dtype) {
      const blockId = active.id;
      const srcStack = findStackByBlockId(blockId);
      if (!srcStack) return;
      const blocksToMove = subStack.length > 0 ? subStack : [findBlock(srcStack.blocks, blockId)].filter(Boolean);
      if (blocksToMove.length === 0) return;

      const doMove = (targetStackId) => {
        const target = stacks.find(s => s.id === targetStackId);
        if (!target || !canAppendToStack(target, blocksToMove)) return false;
        setStacks(prev => {
          const updated = prev.map(s => {
            if (s.id === srcStack.id) return { ...s, blocks: removeSubStack(s.blocks, blockId) };
            if (s.id === targetStackId) return { ...s, blocks: [...s.blocks, ...blocksToMove] };
            return s;
          });
          return updated.filter(s => s.blocks.length > 0);
        });
        return true;
      };

      if (overId.startsWith('stack-')) {
        const targetStackId = overId.slice(6);
        if (targetStackId === srcStack.id) return;
        doMove(targetStackId);
      } else if (overId.startsWith('dropzone-')) {
        if (blocksToMove.length === 1 && !isHatType(blocksToMove[0].type)) {
          const containerId = overId.slice('dropzone-'.length);
          const block = blocksToMove[0];
          setStacks(prev => {
            const removed = prev.map(s => ({ ...s, blocks: removeSubStack(s.blocks, blockId) }));
            const added = removed.map(s => ({ ...s, blocks: addToContainer(s.blocks, containerId, block) }));
            return added.filter(s => s.blocks.length > 0);
          });
        }
      } else if (overId === 'editor-canvas') {
        const coords = getCanvasCoords();
        const snapId = findSnapStackId(coords.x, coords.y, blockId);
        if (snapId && snapId !== srcStack.id) {
          if (!doMove(snapId)) {
            setStacks(prev => {
              const removed = prev.map(s =>
                s.id === srcStack.id ? { ...s, blocks: removeSubStack(s.blocks, blockId) } : s
              ).filter(s => s.blocks.length > 0);
              return [...removed, {
                id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                x: Math.max(0, coords.x), y: Math.max(0, coords.y),
                blocks: blocksToMove,
              }];
            });
          }
        } else if (!snapId) {
          setStacks(prev => {
            const removed = prev.map(s =>
              s.id === srcStack.id ? { ...s, blocks: removeSubStack(s.blocks, blockId) } : s
            ).filter(s => s.blocks.length > 0);
            return [...removed, {
              id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              x: Math.max(0, coords.x), y: Math.max(0, coords.y),
              blocks: blocksToMove,
            }];
          });
        }
      }
    }
  }

  // ── Session ──

  function togglePuzzleSelection(puzzleId) {
    setSelectedPuzzles(prev =>
      prev.includes(puzzleId) ? prev.filter(id => id !== puzzleId) : [...prev, puzzleId]
    );
  }

  function createSession() {
    if (selectedPuzzles.length === 0) {
      alert('Wähle mindestens ein Rätsel aus!');
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
            <h2 style={{ marginBottom: 16 }}>Aktive Sessions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {activeSessions.map(session => {
                const currentPuzzle = state.puzzles.find(p => p.id === session.puzzleIds[session.currentPuzzleIndex]);
                return (
                  <div key={session.id} style={{ background: '#fff', borderRadius: 8, border: '1px solid #e0e0e0', padding: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div>
                        <h3 style={{ fontSize: 18 }}>
                          Session: <span style={{ color: '#1e90ff', letterSpacing: 2 }}>{session.id}</span>
                        </h3>
                        <p style={{ fontSize: 13, color: '#888' }}>
                          {session.puzzleIds.length} Rätsel, Runde {session.currentPuzzleIndex + 1}/{session.puzzleIds.length}
                          {currentPuzzle && ` - ${currentPuzzle.title}`}
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {!session.started && (
                          <button className="btn btn-success"
                            onClick={() => dispatch({ type: 'START_SESSION', sessionId: session.id })}>
                            Starten
                          </button>
                        )}
                        <button className="btn btn-primary" onClick={() => navigate(`/code-detektiv/play/${session.id}`)}>
                          Ansehen
                        </button>
                        <button className="btn btn-danger" onClick={() => {
                          if (confirm('Session wirklich beenden?')) dispatch({ type: 'END_SESSION', sessionId: session.id });
                        }}>
                          Beenden
                        </button>
                      </div>
                    </div>
                    <div style={{ background: '#f9f9f9', borderRadius: 8, padding: 12 }}>
                      <h4 style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>Spieler ({session.players.length})</h4>
                      {session.players.length === 0 && <p style={{ color: '#ccc', fontSize: 13 }}>Noch keine Spieler</p>}
                      {session.players.map(p => (
                        <div key={p.name} className="player-list-item">
                          <span style={{ fontSize: 14 }}>{p.name}</span>
                          <button className="btn btn-danger" style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={() => dispatch({ type: 'REMOVE_PLAYER', sessionId: session.id, playerName: p.name })}>
                            Entfernen
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
            {editingPuzzleId && 'Rätsel bearbeiten'}
            {editingPuzzleId && (
              <button className="btn btn-outline" onClick={cancelEdit} style={{ marginLeft: 12, fontSize: 12 }}>Abbrechen</button>
            )}
          </h2>

          <div className="admin-form" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label>MakeCode .hex importieren</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="file" accept=".hex" onChange={handleImportHex} disabled={importing} />
                {blockCount > 0 && (
                  <button type="button" className="btn btn-outline" style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => { setStacks([]); setImportInfo(''); }}>Leeren</button>
                )}
              </div>
              <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                {importing ? 'Importiere...' : 'Blöcke aus einer MakeCode/Calliope-Datei laden.'}
              </p>
              {importInfo && <p style={{ fontSize: 12, color: '#2e7d32', marginTop: 4 }}>{importInfo}</p>}
              {importError && <p style={{ fontSize: 12, color: '#f44336', marginTop: 4 }}>{importError}</p>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: 12 }}>
              <div className="form-group">
                <label>Titel</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="z.B. LED blinken lassen" />
              </div>
              <div className="form-group">
                <label>Beschreibung / Aufgabe</label>
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Was sollen die SuS tun?" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: 12 }}>
              <div className="form-group">
                <label>Typ</label>
                <select value={type} onChange={e => setType(e.target.value)}>
                  <option value="sort">Sortieren</option>
                  <option value="maze">Labyrinth</option>
                </select>
              </div>
              <div className="form-group">
                <label>Schwierigkeit</label>
                <select value={difficulty} onChange={e => setDifficulty(Number(e.target.value))}>
                  <option value={1}>Leicht</option>
                  <option value={2}>Mittel</option>
                  <option value={3}>Schwer</option>
                </select>
              </div>
              <div className="form-group">
                <label>Zeitlimit (Sek.)</label>
                <input type="number" value={timeLimit} onChange={e => setTimeLimit(Number(e.target.value))} min={30} step={30} />
              </div>
              <div className="form-group">
                <label>Angezeigte Bausteine</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select value={distractorMode} onChange={e => setDistractorMode(e.target.value)} style={{ flex: 1 }}>
                    <option value="none">Nur benötigte</option>
                    <option value="percent">Benötigte + Störer</option>
                    <option value="all">Alle Bausteine</option>
                  </select>
                  {distractorMode === 'percent' && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                      <input type="number" value={distractorPercent}
                        onChange={e => setDistractorPercent(Number(e.target.value))}
                        min={5} max={100} step={5}
                        style={{ width: 60 }} />
                      <span style={{ fontSize: 13, color: '#666' }}>%</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <DndContext sensors={sensors} collisionDetection={editorCollision}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div style={{ display: 'grid', gridTemplateColumns: toolboxOpen ? '260px 1fr' : '1fr', gap: 16, minHeight: 400 }}>
              {toolboxOpen && (
                <div className="block-toolbox">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3>Block-Vorlagen</h3>
                    <button className="btn btn-outline" style={{ padding: '2px 6px', fontSize: 11 }}
                      onClick={() => setToolboxOpen(false)}><IconChevronLeft size={12} /></button>
                  </div>
                  {Object.entries(GROUPED_TEMPLATES).map(([cat, tBlocks]) => (
                    <CollapsibleCategory key={cat} cat={cat} catInfo={CATEGORIES[cat]}>
                      {tBlocks.map((block, i) => (
                        <DraggableToolboxBlock key={block.id} block={block} dragId={`adm-tb-${block.id}-${i}`} />
                      ))}
                    </CollapsibleCategory>
                  ))}
                  <DroppableReturnZone active={draggingFromEditor} />
                </div>
              )}

              <div className="solution-area">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!toolboxOpen && (
                      <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12 }}
                        onClick={() => setToolboxOpen(true)}>
                        <IconChevronRight size={12} /> Bausteine
                      </button>
                    )}
                    <h3 style={{ margin: 0 }}>
                      Lösung {blockCount > 0 && `(${blockCount} Blöcke)`}
                    </h3>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12 }}
                      onClick={() => setZoom(z => Math.min(3, z + 0.2))}>+</button>
                    <span style={{ fontSize: 12, minWidth: 40, textAlign: 'center', color: '#666' }}>{Math.round(zoom * 100)}%</span>
                    <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12 }}
                      onClick={() => setZoom(z => Math.max(0.25, z - 0.2))}>-</button>
                  </div>
                </div>

                <div
                  ref={canvasRef}
                  onWheel={handleWheel}
                  onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={handleCanvasPointerUp}
                  style={{
                    overflow: 'auto', minHeight: 300, maxHeight: 'calc(100vh - 280px)', position: 'relative',
                    cursor: isPanning ? 'grabbing' : 'default',
                    background: 'rgba(0,0,0,0.02)', borderRadius: 8,
                    border: '1px dashed #d5d5d5',
                  }}
                >
                  <div ref={contentRef} style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: '0 0',
                    position: 'relative',
                    minHeight: 600,
                  }}>
                    <DroppableCanvas>
                      {stacks.length === 0 && !activeBlock && (
                        <div style={{
                          position: 'absolute', top: '50%', left: '50%',
                          transform: 'translate(-50%, -50%)',
                          color: '#aaa', fontSize: 14, pointerEvents: 'none',
                        }}>Blöcke von links hierhin ziehen</div>
                      )}
                      {stacks.map(stack => (
                        <StackZone key={stack.id} stack={stack}>
                          {stack.blocks.map(block => (
                            <div key={block.id}>
                              <DraggableBlock block={block} onFieldChange={handleFieldChange} />
                            </div>
                          ))}
                        </StackZone>
                      ))}
                    </DroppableCanvas>
                  </div>
                </div>

                <button className="btn btn-success" onClick={savePuzzle} style={{ width: '100%', marginTop: 16 }}>
                  {editingPuzzleId ? 'Änderungen speichern' : 'Rätsel speichern'}
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
          <div>
            <h2 style={{ marginBottom: 16 }}>Session erstellen</h2>
            <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e0e0e0', padding: 20 }}>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>Wähle Rätsel für die Session aus:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {state.puzzles.map(puzzle => (
                  <label key={puzzle.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    borderRadius: 6, cursor: 'pointer',
                    background: selectedPuzzles.includes(puzzle.id) ? '#e3f2fd' : '#f9f9f9',
                    border: selectedPuzzles.includes(puzzle.id) ? '1px solid #1e90ff' : '1px solid #eee',
                  }}>
                    <input type="checkbox" checked={selectedPuzzles.includes(puzzle.id)}
                      onChange={() => togglePuzzleSelection(puzzle.id)} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{puzzle.title}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>
                        {puzzle.type === 'maze' ? 'Labyrinth' : 'Sortieren'}
                      </div>
                    </div>
                    {selectedPuzzles.includes(puzzle.id) && (
                      <span style={{ fontSize: 12, color: '#1e90ff', fontWeight: 600 }}>
                        #{selectedPuzzles.indexOf(puzzle.id) + 1}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <button className="btn btn-primary" onClick={createSession}
                disabled={selectedPuzzles.length === 0} style={{ width: '100%' }}>
                Session erstellen ({selectedPuzzles.length} Rätsel)
              </button>
            </div>
          </div>

          <div>
            <h2 style={{ marginBottom: 16 }}>Vorhandene Rätsel</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {state.puzzles.map(puzzle => (
                <div key={puzzle.id} className="puzzle-card" onClick={() => navigate(`/code-detektiv/puzzle/${puzzle.id}?mode=solo`)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 600 }}>{puzzle.title}</h3>
                      <p style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{puzzle.description}</p>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <span className="cat-badge" style={{ background: puzzle.type === 'maze' ? CATEGORIES.movement.color : CATEGORIES.basic.color }}>
                          {puzzle.type === 'maze' ? 'Labyrinth' : 'Sortieren'}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button className="btn btn-outline"
                        onClick={e => { e.stopPropagation(); navigate(`/code-detektiv/puzzle/${puzzle.id}?mode=solo`); }}
                        style={{ fontSize: 12, padding: '6px 12px' }}>
                        Vorschau
                      </button>
                      <button className="btn btn-primary"
                        onClick={e => { e.stopPropagation(); editPuzzle(puzzle); }}
                        style={{ fontSize: 12, padding: '6px 12px' }}>
                        Bearbeiten
                      </button>
                      {puzzle.id.startsWith('custom-') && (
                        <button className="btn btn-danger"
                          onClick={e => {
                            e.stopPropagation();
                            if (confirm('Rätsel wirklich löschen?')) dispatch({ type: 'DELETE_PUZZLE', puzzleId: puzzle.id });
                          }}
                          style={{ fontSize: 12, padding: '6px 12px' }}>
                          Löschen
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

// ── Helpers ──

function flattenWithChildren(blocks) {
  const result = [];
  for (const b of blocks) { result.push(b); if (b.children) result.push(...flattenWithChildren(b.children)); }
  return result;
}

function updateBlockField(blocks, blockId, fieldKey, value) {
  return blocks.map(b => {
    if (b.id === blockId) return { ...b, fields: b.fields?.map(f => f.key === fieldKey ? { ...f, value } : f) };
    if (b.children) return { ...b, children: updateBlockField(b.children, blockId, fieldKey, value) };
    return b;
  });
}

function findBlock(blocks, id) {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children) { const f = findBlock(b.children, id); if (f) return f; }
  }
  return null;
}

function addToContainer(blocks, containerId, newBlock) {
  return blocks.map(b => {
    if (b.id === containerId && b.children) return { ...b, children: [...b.children, newBlock] };
    if (b.children) return { ...b, children: addToContainer(b.children, containerId, newBlock) };
    return b;
  });
}

function removeBlockDeep(blocks, id) {
  const out = [];
  for (const b of blocks) {
    if (b.id === id) continue;
    out.push(b.children ? { ...b, children: removeBlockDeep(b.children, id) } : b);
  }
  return out;
}
