import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  DndContext, closestCenter, pointerWithin, PointerSensor,
  useSensor, useSensors, DragOverlay, useDroppable, MeasuringStrategy,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useStore } from '../data/store';
import {
  DraggableToolboxBlock, MazeToolboxBlock, SortableBlock,
  DraggableBlock, DragOverlayBlock, CollapsibleCategory,
  StaticBlock, GhostBlock,
} from '../components/MakeCodeBlock';
import { MazeRunner } from '../components/MazeRunner';
import { Timer, useElapsedTime } from '../components/Timer';
import { CATEGORIES, BLOCK_TEMPLATES } from '../data/samplePuzzles';
import {
  IconSearch, IconBulb, IconCheck, IconX, IconClock, IconPlay,
  IconReset, IconBack, IconChevronLeft, IconChevronRight, IconParty, IconUndo,
} from '../components/Icons';

const SHOW_SOLUTION_AFTER = 5;
const SNAP_DISTANCE = 60;

function canvasCollision(args) {
  const within = pointerWithin(args);
  if (!within.length) return closestCenter(args);
  const rank = (id) => {
    const s = String(id);
    if (s.startsWith('slot-')) return -1;
    if (s === 'toolbox-return') return 0;
    if (s.startsWith('dropzone-')) return 1;
    if (s.startsWith('stack-')) return 3;
    if (s === 'canvas-drop') return 4;
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

function mazeCollision(args) {
  const within = pointerWithin(args);
  if (!within.length) return closestCenter(args);
  const rank = (id) => {
    const s = String(id);
    if (s === 'toolbox-return') return 0;
    if (s === 'solution-drop') return 2;
    return 1;
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

function DroppableCanvas({ children }) {
  const { setNodeRef } = useDroppable({ id: 'canvas-drop' });
  return <div ref={setNodeRef} style={{ position: 'relative', width: '100%', minHeight: '100%' }}>{children}</div>;
}

function StackZone({ stack, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stack-${stack.id}`, data: { stackId: stack.id } });
  return (
    <div ref={setNodeRef} id={`stack-el-${stack.id}`}
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

function DroppableSolutionArea({ children }) {
  const { setNodeRef } = useDroppable({ id: 'solution-drop' });
  return (
    <div ref={setNodeRef} className="solution-stack"
      style={{ display: 'flex', flexDirection: 'column', minHeight: 160, borderRadius: 8,
        padding: '8px 8px 56px', background: 'rgba(0,0,0,0.02)', border: '1px dashed #d5d5d5' }}>
      {children}
    </div>
  );
}

function DroppableToolboxReturn({ active }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'toolbox-return' });
  return (
    <div ref={setNodeRef} className={`toolbox-return-zone ${active ? 'active' : ''} ${isOver ? 'over' : ''}`}>
      {active ? <><IconUndo size={14} /> Block entfernen</> : ''}
    </div>
  );
}

export default function PuzzlePage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session');
  const isSolo = !sessionId;
  const navigate = useNavigate();
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

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef(null);
  const canvasRef = useRef(null);
  const contentRef = useRef(null);

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

  // ── Zoom / Pan ──

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

  function fitAll() {
    if (!contentRef.current || !canvasRef.current) return;
    const content = contentRef.current.getBoundingClientRect();
    const canvas = canvasRef.current.getBoundingClientRect();
    if (content.width === 0 || content.height === 0) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    const scaleX = (canvas.width - 40) / (content.width / zoom);
    const scaleY = (canvas.height - 40) / (content.height / zoom);
    const newZoom = Math.min(2, Math.max(0.25, Math.min(scaleX, scaleY)));
    setZoom(newZoom);
    setPan({ x: 0, y: 0 });
  }

  function getCanvasCoords() {
    if (!canvasRef.current) return { x: 50, y: 50 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (pointerRef.current.x - rect.left - pan.x) / zoom,
      y: (pointerRef.current.y - rect.top - pan.y) / zoom,
    };
  }

  // ── Stack helpers ──

  function findSnapStackId(cx, cy, excludeBlockId) {
    for (const stack of stacks) {
      if (excludeBlockId && stack.blocks.some(b => b.id === excludeBlockId || (b.children && b.children.some(c => c.id === excludeBlockId)))) continue;
      const el = document.getElementById(`stack-el-${stack.id}`);
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

  if (!puzzle) return <div className="page-container">Rätsel nicht gefunden.</div>;

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
    if (!dtype && over.id === 'toolbox-return') {
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
      const stack = findStackByBlockId(block.id);
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

    // Value block handling
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
      } else if (srcSlot && overId === 'toolbox-return') {
        setStacks(prev => prev.map(s => ({ ...s, blocks: fillSlot(s.blocks, srcSlot, null) })));
      }
      return;
    }

    if (overSlot) return;

    // Remove block (+ sub-stack)
    if (overId === 'toolbox-return') {
      if (dtype === 'canvas-block' || !dtype) {
        removeSubStackFromStacks(active.id);
      }
      return;
    }

    // From toolbox
    if (dtype === 'toolbox') {
      const block = active.data.current.block;
      const newBlock = {
        ...block, sourceId: block.id,
        id: `placed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        children: isContainerType(block.type) ? [] : undefined,
        fields: block.fields?.map(f => ({ ...f })),
        slots: block.slots?.map((s, i) => ({
          ...s, id: `slot-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
          child: s.child ? { ...s.child } : null,
        })),
      };

      const isHat = isHatType(newBlock.type);

      if (overId.startsWith('stack-')) {
        const stackId = overId.slice(6);
        const target = stacks.find(s => s.id === stackId);
        if (isHat && target && target.blocks.length > 0) {
          // Hat can't go under existing blocks - create new stack instead
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
      setFeedback(null);
      return;
    }

    // Move canvas block (+ sub-stack below it)
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
      } else if (overId === 'canvas-drop') {
        const coords = getCanvasCoords();
        const snapId = findSnapStackId(coords.x, coords.y, blockId);
        if (snapId && snapId !== srcStack.id) {
          if (!doMove(snapId)) {
            // Can't append (hat constraint), create new stack
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

  function removeSubStackFromStacks(blockId) {
    setStacks(prev => prev.map(s => {
      const idx = s.blocks.findIndex(b => b.id === blockId);
      if (idx < 0) return s;
      return { ...s, blocks: s.blocks.slice(0, idx) };
    }).filter(s => s.blocks.length > 0));
    setFeedback(null);
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

  function formatTime(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
            {countdown > 0 ? countdown : 'Los!'}
          </div>
        </div>
      )}
      <div className="app-header">
        <h1><IconSearch size={22} /> {puzzle.title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {hasTimeLimit
            ? <Timer seconds={puzzle.timeLimit} running={timerRunning} onTimeUp={handleTimeUp} />
            : <Timer seconds={0} running={timerRunning} countUp />}
          {isSolo && <button className="btn btn-outline" onClick={() => navigate(-1)}><IconBack size={14} /> Zurück</button>}
        </div>
      </div>

      <div className="page-container" style={{ maxWidth: '100%' }}>
        <div style={{ background: '#e3f2fd', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 14, color: '#1565c0' }}>
          <IconBulb size={16} /> {puzzle.description}
        </div>

        <DndContext sensors={sensors}
          collisionDetection={isMaze ? mazeCollision : canvasCollision}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          {...dndHandlers}>
          <div style={{ display: 'grid', gridTemplateColumns: toolboxOpen ? '260px 1fr' : '1fr', gap: 16 }}>

            {toolboxOpen && (
              <div className="block-toolbox">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0 }}>Verfügbare Blöcke</h3>
                  <button onClick={() => setToolboxOpen(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#888' }}
                    title="Toolbox ausblenden"><IconChevronLeft size={14} /></button>
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
                <DroppableToolboxReturn active={draggingFromCanvas} />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {!toolboxOpen && (
                <button className="btn btn-outline" onClick={() => setToolboxOpen(true)}
                  style={{ alignSelf: 'flex-start', padding: '4px 12px', fontSize: 12 }}>
                  <IconChevronRight size={12} /> Blöcke anzeigen
                </button>
              )}

              {isMaze && puzzle.maze && (
                <div style={{ background: '#fff', borderRadius: 8, border: '1px solid #e0e0e0', padding: 20, display: 'flex', justifyContent: 'center' }}>
                  <MazeRunner maze={puzzle.maze} commands={mazeSolutionBlocks} running={mazeRunning} onFinish={handleMazeFinish} />
                </div>
              )}

              <div className="solution-area">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <h3 style={{ margin: 0 }}>Deine Lösung {totalBlockCount > 0 && `(${totalBlockCount} Blöcke)`}</h3>
                  {!isMaze && (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12 }}
                        onClick={() => setZoom(z => Math.min(3, z + 0.2))}>+</button>
                      <span style={{ fontSize: 12, minWidth: 40, textAlign: 'center', color: '#666' }}>{Math.round(zoom * 100)}%</span>
                      <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12 }}
                        onClick={() => setZoom(z => Math.max(0.25, z - 0.2))}>-</button>
                      <button className="btn btn-outline" style={{ padding: '4px 8px', fontSize: 12, marginLeft: 4 }}
                        onClick={fitAll}>Alles zeigen</button>
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
                          return <div className="drop-zone">Ziehe Blöcke von links hierhin</div>;
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
                      minWidth: 800, minHeight: 500,
                    }}>
                      <DroppableCanvas>
                        {stacks.length === 0 && !activeBlock && (
                          <div style={{
                            position: 'absolute', top: '50%', left: '50%',
                            transform: 'translate(-50%, -50%)',
                            color: '#aaa', fontSize: 14, pointerEvents: 'none',
                          }}>Blöcke hierhin ziehen</div>
                        )}
                        {stacks.map(stack => (
                          <StackZone key={stack.id} stack={stack}>
                            {stack.blocks.map(block => (
                              <DraggableBlock key={block.id} block={block}
                                onFieldChange={!solved ? handleFieldChange : undefined} />
                            ))}
                          </StackZone>
                        ))}
                      </DroppableCanvas>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  <button className="btn btn-success" onClick={checkSolution}
                    disabled={totalBlockCount === 0 || solved || mazeRunning}>
                    {isMaze ? <><IconPlay size={14} /> Ausführen</> : <><IconCheck size={14} /> Prüfen</>}
                  </button>
                  <button className="btn btn-outline" onClick={reset} disabled={solved || mazeRunning}>
                    <IconReset size={14} /> Zurücksetzen
                  </button>
                  {solved && isSolo && (
                    <button className="btn btn-primary" onClick={() => navigate('/code-detektiv/solo')}>Nächstes Rätsel →</button>
                  )}
                  {solved && sessionId && (
                    <button className="btn btn-primary" onClick={() => navigate(`/code-detektiv/play/${sessionId}`)}>Zurück zur Session →</button>
                  )}
                  {feedback === 'timeout' && sessionId && (
                    <button className="btn btn-primary" onClick={() => navigate(`/code-detektiv/play/${sessionId}`)}>Zurück zur Session →</button>
                  )}
                </div>

                {feedback === 'correct' && (
                  <div className="feedback-correct" style={{ marginTop: 16 }}>
                    <IconParty size={20} /> Richtig!
                    <div className="feedback-stats">
                      <span><IconClock size={14} /> Zeit: {formatTime(elapsed)}</span>
                      <span><IconReset size={14} /> {attempts} {attempts === 1 ? 'Versuch' : 'Versuche'}</span>
                    </div>
                  </div>
                )}
                {feedback === 'wrong' && (
                  <div className="feedback-wrong" style={{ marginTop: 16 }}>
                    <IconX size={16} /> Noch nicht richtig. Versuch es nochmal!
                    {isSolo && !showSolution && attempts >= 3 && (
                      <div style={{ fontSize: 12, marginTop: 4, fontWeight: 400 }}>
                        Noch {SHOW_SOLUTION_AFTER - attempts} {SHOW_SOLUTION_AFTER - attempts === 1 ? 'Versuch' : 'Versuche'} bis zur Lösung
                      </div>
                    )}
                  </div>
                )}
                {feedback === 'timeout' && (
                  <div className="feedback-wrong" style={{ marginTop: 16 }}><IconClock size={16} /> Zeit abgelaufen!</div>
                )}
                {showSolution && isSolo && (
                  <div className="solution-reveal">
                    <h4><IconBulb size={16} /> Lösung:</h4>
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

// ── Helpers ──

function isContainerType(type) {
  return type === 'container' || type === 'event-container';
}

function isHatType(type) {
  return type === 'event' || type === 'event-container';
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
    if (b.id === containerId && b.children) {
      return { ...b, children: [...b.children, newBlock] };
    }
    if (b.children) return { ...b, children: addToContainer(b.children, containerId, newBlock) };
    return b;
  });
}

function insertAt(blocks, parentId, index, newBlock) {
  if (parentId == null) { const c = [...blocks]; c.splice(index, 0, newBlock); return c; }
  return blocks.map(b => {
    if (b.id === parentId) { const k = [...(b.children || [])]; k.splice(index, 0, newBlock); return { ...b, children: k }; }
    if (b.children) return { ...b, children: insertAt(b.children, parentId, index, newBlock) };
    return b;
  });
}

function moveBlock(blocks, activeId, pos) {
  const active = findBlock(blocks, activeId);
  if (!active) return blocks;
  if (active.children && pos.parentId && findBlock(active.children, pos.parentId)) return blocks;
  const srcParent = findParentContainer(blocks, activeId);
  const srcParentId = srcParent ? srcParent.id : null;
  const srcList = srcParent ? srcParent.children : blocks;
  const srcIndex = srcList.findIndex(b => b.id === activeId);
  let targetIndex = pos.index;
  if (srcParentId === pos.parentId && srcIndex !== -1 && srcIndex < pos.index) targetIndex -= 1;
  const stripped = removeBlockDeep(blocks, activeId);
  return insertAt(stripped, pos.parentId, targetIndex, active);
}

function removeBlockDeep(blocks, id) {
  const out = [];
  for (const b of blocks) {
    if (b.id === id) continue;
    out.push(b.children ? { ...b, children: removeBlockDeep(b.children, id) } : b);
  }
  return out;
}

function findParentContainer(blocks, childId, parent = null) {
  for (const b of blocks) {
    if (b.id === childId) return parent;
    if (b.children) { const f = findParentContainer(b.children, childId, b); if (f !== undefined) return f; }
  }
  return undefined;
}

function countAllBlocks(blocks) {
  let count = 0;
  for (const b of blocks) { count++; if (b.children) count += countAllBlocks(b.children); }
  return count;
}

function flattenSolution(blocks) {
  const result = [];
  for (const block of blocks) {
    if (isContainerType(block.type)) {
      result.push({ ...block, children: [] });
      if (block.children) for (const child of block.children) result.push({ ...child });
    } else {
      result.push({ ...block });
    }
  }
  return result;
}

function collectSlotValues(blocks, acc) {
  for (const b of blocks) {
    if (b.slots) for (const s of b.slots) if (s.child) acc.push(s.child);
    if (b.parts) for (const p of b.parts) if (p.slot && p.child) acc.push(p.child);
    if (b.children) collectSlotValues(b.children, acc);
  }
  return acc;
}

function fillSlot(blocks, slotId, child) {
  return blocks.map(b => {
    let nb = b;
    if (b.slots && b.slots.some(s => s.id === slotId)) {
      nb = { ...nb, slots: b.slots.map(s => (s.id === slotId ? { ...s, child } : s)) };
    }
    if (nb.children) nb = { ...nb, children: fillSlot(nb.children, slotId, child) };
    return nb;
  });
}

function slotSig(slot) {
  if (!slot) return '';
  if (slot.child) return 'c(' + valueSig(slot.child) + ')';
  if (slot.literal) return 'l:' + (slot.literal.value ?? '');
  return '_';
}
function partsSig(parts) {
  return (parts || []).map(p => (p.text !== undefined ? 't:' + p.text : 's:' + slotSig(p))).join('|');
}
function valueSig(vb) {
  if (!vb) return '∅';
  return (vb.cat || '') + ':' + partsSig(vb.parts);
}

function compareBlocks(placed, solution) {
  if (placed.length !== solution.length) return false;
  for (let i = 0; i < placed.length; i++) {
    if (placed[i].label !== solution[i].label) return false;
    if (placed[i].cat !== solution[i].cat) return false;
    if (partsSig(placed[i].parts) !== partsSig(solution[i].parts)) return false;
    if (solution[i].fields) {
      for (const sf of solution[i].fields) {
        if (sf.check === false) continue;
        const pf = placed[i].fields?.find(f => f.key === sf.key);
        if (!pf || pf.value !== sf.value) return false;
      }
    }
    if (solution[i].slots) {
      const ps = placed[i].slots || [];
      if (ps.length !== solution[i].slots.length) return false;
      for (let k = 0; k < solution[i].slots.length; k++) {
        if (slotSig(ps[k]) !== slotSig(solution[i].slots[k])) return false;
      }
    }
    if (isContainerType(solution[i].type)) {
      if (!placed[i].children || !solution[i].children) return false;
      if (!compareBlocks(placed[i].children, solution[i].children)) return false;
    }
  }
  return true;
}
