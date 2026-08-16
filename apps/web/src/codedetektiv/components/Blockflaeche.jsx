// Die Zeichenfläche für Blockstapel — EINE Bauform für Editor und Spielseite.
//
// `pages/Admin.jsx` (Rätsel bauen) und `pages/PuzzlePage.jsx` (Rätsel lösen)
// sind dieselbe Fläche mit demselben Verhalten: Blöcke aus der Kiste ziehen,
// untereinander einrasten, verschieben, in einen Container legen, wieder
// wegwerfen — dazu Zoom, Verschieben der Ansicht und die Ablegezonen. Beide
// Dateien hatten das komplett getrennt stehen, bis hin zu zeichengleichen
// 150-Zeilen-`handleDragEnd`. Unterschiedlich sind nur drei Dinge, und die
// stehen jetzt als Parameter da: die Namen der Ablegezonen, ob Wert-Steckplätze
// mitspielen (nur beim Lösen) und was nach einer Änderung passieren soll.
import { useRef, useState } from 'react';
import { closestCenter, pointerWithin, useDroppable } from '@dnd-kit/core';

import { Segment, segmentBtn } from '../../components/Icons.jsx';
import { useCdText } from '../i18n.js';
import { IconUndo } from './Icons';
import {
  addToContainer, canAppendToStack, findBlock, findStackByBlockId,
  isContainerType, isHatType, removeSubStack,
} from '../data/bloecke.js';

/** Wie weit daneben darf man loslassen, damit ein Block noch einrastet (px). */
export const SNAP_DISTANCE = 60;

const neueId = (praefix) => `${praefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Welcher Treffer gewinnt, wenn mehrere Ablegezonen unter dem Zeiger liegen?
 *
 * Kleine, spezielle Zonen schlagen große, allgemeine: ein Steckplatz vor dem
 * Papierkorb, der vor dem Container-Rumpf, der vor dem Stapel, der vor der
 * leeren Fläche. Bei Gleichstand gewinnt die kleinere Fläche.
 */
export function kollisionNach(rang) {
  const flaeche = (c) => {
    const r = c.data?.droppableContainer?.rect?.current;
    return r ? r.width * r.height : Infinity;
  };
  return (args) => {
    const within = pointerWithin(args);
    if (!within.length) return closestCenter(args);
    return [...within].sort((a, b) => {
      const r = rang(a.id) - rang(b.id);
      return r !== 0 ? r : flaeche(a) - flaeche(b);
    });
  };
}

/** Die Rangfolge der freien Fläche (Editor und Sortier-Rätsel). */
export function machKollision({ canvasId, returnId, mitSlots = false }) {
  return kollisionNach((id) => {
    const s = String(id);
    if (mitSlots && s.startsWith('slot-')) return -1;
    if (s === returnId) return 0;
    if (s.startsWith('dropzone-')) return 1;
    if (s.startsWith('stack-')) return 3;
    if (s === canvasId) return 4;
    return 2;
  });
}

/**
 * Zoom und Verschieben der Ansicht.
 *
 * Stand zweimal wortgleich da (Rad mit Strg/Cmd, Ziehen der leeren Fläche,
 * Umrechnen der Zeigerposition in Flächen-Koordinaten).
 */
export function useZoomPan() {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef(null);
  const canvasRef = useRef(null);
  const contentRef = useRef(null);

  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(z => Math.min(3, Math.max(0.25, z - e.deltaY * 0.002)));
  };
  /** Auf dem freien Grund gedrückt (Rahmen, Inhalt oder die Ablegefläche)? */
  const aufFreiemGrund = (el) =>
    el === canvasRef.current || el === contentRef.current || el?.dataset?.cdCanvas === '1';

  const onPointerDown = (e) => {
    if (!aufFreiemGrund(e.target)) return;
    setIsPanning(true);
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    canvasRef.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!isPanning || !panStart.current) return;
    setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
  };
  const onPointerUp = () => { setIsPanning(false); panStart.current = null; };

  /** Zeigerposition (Fensterkoordinaten) → Koordinaten auf der Fläche. */
  const koordinaten = (zeiger) => {
    if (!canvasRef.current) return { x: 50, y: 50 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (zeiger.x - rect.left - pan.x) / zoom,
      y: (zeiger.y - rect.top - pan.y) / zoom,
    };
  };

  /** Alles ins Bild holen. */
  const alleszeigen = () => {
    if (!contentRef.current || !canvasRef.current) return;
    const content = contentRef.current.getBoundingClientRect();
    const canvas = canvasRef.current.getBoundingClientRect();
    if (content.width === 0 || content.height === 0) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
    const scaleX = (canvas.width - 40) / (content.width / zoom);
    const scaleY = (canvas.height - 40) / (content.height / zoom);
    setZoom(Math.min(2, Math.max(0.25, Math.min(scaleX, scaleY))));
    setPan({ x: 0, y: 0 });
  };

  return { zoom, setZoom, pan, isPanning, canvasRef, contentRef, koordinaten, alleszeigen,
    handler: { onWheel, onPointerDown, onPointerMove, onPointerUp } };
}

/**
 * Rastet ein an dieser Stelle losgelassener Block an einem Stapel ein?
 *
 * @param domId  Stapel-Id → id des DOM-Knotens (Editor und Spielseite benennen
 *               ihre Knoten verschieden, sonst kollidierten sie auf einer Seite)
 */
export function findSnapStackId(stacks, domId, zoom, cx, cy, excludeBlockId) {
  for (const stack of stacks) {
    if (excludeBlockId && stack.blocks.some(b =>
      b.id === excludeBlockId || (b.children && b.children.some(c => c.id === excludeBlockId)))) continue;
    const el = document.getElementById(domId(stack.id));
    if (!el) continue;
    const h = el.offsetHeight / zoom;
    const w = el.offsetWidth / zoom;
    const dx = cx - stack.x;
    if (dx < -SNAP_DISTANCE || dx > w + SNAP_DISTANCE) continue;
    if (cy >= stack.y - SNAP_DISTANCE && cy <= stack.y + h + SNAP_DISTANCE) return stack.id;
  }
  return null;
}

/**
 * Die Fläche selbst — nimmt Blöcke an, die nirgendwo sonst landen.
 *
 * Sie liegt **absolut über der ganzen Inhaltsfläche** (`inset: 0`), nicht im
 * Fluss. Hier stand `minHeight: '100%'` — eine Prozentangabe gegen ein
 * Elternteil, das seine Höhe nur aus `min-height` bezieht, und die wird zu 0.
 * Die Ablegezone war damit **0 px hoch**: `pointerWithin` traf sie nie, jedes
 * Ablegen fiel auf den Notnagel `closestCenter` — und der nimmt die Zone mit
 * dem nächsten Mittelpunkt, nicht die unter dem Zeiger. War die Fläche leer,
 * sass ihr entartetes Rechteck oben am Rand, und ein weiter unten
 * losgelassener Baustein landete stattdessen in der **Rückgabezone** der
 * Werkzeugkiste: still weggeworfen, Zähler bleibt bei „Lösung". Gemessen:
 * `over` meldete `editor-return` statt `editor-canvas`.
 *
 * @param leer     nichts abgelegt → den Hinweis zeigen
 * @param hinweis  „Blöcke hierhin ziehen" (Text kommt von der Seite)
 */
export function DroppableCanvas({ id, leer = false, hinweis, children }) {
  const { setNodeRef } = useDroppable({ id });
  return (
    // `data-cd-canvas`: `useZoomPan` erkennt daran, dass ein Zeigerdruck hier
    // die Ansicht verschieben soll — die Fläche liegt jetzt über allem, sonst
    // wäre das Schieben der leeren Fläche mit dieser Änderung verloren.
    <div ref={setNodeRef} data-cd-canvas="1" style={{ position: 'absolute', inset: 0 }}>
      {leer && hinweis && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'var(--text3)', fontSize: 14, pointerEvents: 'none',
        }}>{hinweis}</div>
      )}
      {children}
    </div>
  );
}

/** Ein Stapel an seiner Position. */
export function StackZone({ stack, domId, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stack-${stack.id}`, data: { stackId: stack.id } });
  return (
    <div ref={setNodeRef} id={domId(stack.id)}
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

/** Zurück in die Kiste = wegwerfen. Sichtbar nur, während gezogen wird. */
export function ReturnZone({ id, active }) {
  const { t } = useCdText();
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`toolbox-return-zone ${active ? 'active' : ''} ${isOver ? 'over' : ''}`}>
      {active ? <><IconUndo size={14} /> {t('cd.block_entfernen', 'Block entfernen')}</> : ''}
    </div>
  );
}

/** Ein Gedanke („wie nah?"), also EIN Bedienelement: + / Prozent / −. */
export function ZoomSegment({ zoom, setZoom }) {
  const { t } = useCdText();
  return (
    <Segment>
      <button style={segmentBtn} title={t('cd.puzzle.groesser', 'Größer')}
        onClick={() => setZoom(z => Math.min(3, z + 0.2))}>+</button>
      <span style={{ ...segmentBtn, minWidth: 48, cursor: 'default', color: 'var(--text2)' }}>{Math.round(zoom * 100)}%</span>
      <button style={segmentBtn} title={t('cd.puzzle.kleiner', 'Kleiner')}
        onClick={() => setZoom(z => Math.max(0.25, z - 0.2))}>-</button>
    </Segment>
  );
}

/** Der Rahmen um die Fläche: rollbar, zoombar, verschiebbar. */
export function Leinwand({ zp, inhaltStil, children }) {
  return (
    <div
      ref={zp.canvasRef}
      {...zp.handler}
      style={{
        overflow: 'auto', minHeight: 300, maxHeight: 'calc(100vh - 280px)', position: 'relative',
        cursor: zp.isPanning ? 'grabbing' : 'default',
        background: 'var(--bg2)', borderRadius: 10,
        border: '1px dashed var(--border2)',
      }}
    >
      <div ref={zp.contentRef} style={{
        transform: `translate(${zp.pan.x}px, ${zp.pan.y}px) scale(${zp.zoom})`,
        transformOrigin: '0 0',
        position: 'relative',
        ...inhaltStil,
      }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Ablegen auf der Fläche — die Regeln, die Editor und Spielseite teilen.
 *
 * @param event          das dnd-kit-Ereignis
 * @param subStack       der gezogene Block samt allem, was unter ihm hängt
 * @param stacks/setStacks  der Zustand der Fläche
 * @param koordinaten    () => Ablegepunkt in Flächen-Koordinaten
 * @param snap           (cx, cy, ausser) => Stapel-Id zum Einrasten oder null
 * @param canvasId/returnId  die Namen der beiden großen Zonen
 * @param mitSlots       Blöcke bringen Wert-Steckplätze mit (nur beim Lösen)
 * @param nachAenderung  läuft, wenn sich etwas geändert hat (Rückmeldung leeren)
 */
export function leinwandAblegen({
  event, subStack, stacks, setStacks, koordinaten, snap,
  canvasId, returnId, mitSlots = false, nachAenderung,
}) {
  const { active, over } = event;
  if (!over) return;

  const dtype = active.data.current?.type;
  const overId = String(over.id);

  // Wegwerfen — samt allem, was unter dem Block hängt.
  if (overId === returnId) {
    if (dtype === 'canvas-block' || !dtype) {
      setStacks(prev => prev.map(s => {
        const idx = s.blocks.findIndex(b => b.id === active.id);
        if (idx < 0) return s;
        return { ...s, blocks: s.blocks.slice(0, idx) };
      }).filter(s => s.blocks.length > 0));
      nachAenderung?.();
    }
    return;
  }

  const neuerStapel = (coords, blocks) => ({
    id: neueId('stk'), x: Math.max(0, coords.x), y: Math.max(0, coords.y), blocks,
  });

  // Aus der Kiste geholt.
  if (dtype === 'toolbox') {
    const block = active.data.current.block;
    const newBlock = {
      ...block,
      ...(mitSlots ? { sourceId: block.id } : null),
      id: neueId('placed'),
      children: isContainerType(block.type) ? [] : undefined,
      fields: block.fields?.map(f => ({ ...f })),
      ...(mitSlots ? {
        slots: block.slots?.map((s, i) => ({
          ...s, id: `slot-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
          child: s.child ? { ...s.child } : null,
        })),
      } : null),
    };
    const isHat = isHatType(newBlock.type);

    if (overId.startsWith('stack-')) {
      const stackId = overId.slice(6);
      const target = stacks.find(s => s.id === stackId);
      if (isHat && target && target.blocks.length > 0) {
        // Ein Hut kann nicht unter bestehende Blöcke — also ein neuer Stapel.
        setStacks(prev => [...prev, neuerStapel(koordinaten(), [newBlock])]);
      } else {
        setStacks(prev => prev.map(s => (s.id === stackId ? { ...s, blocks: [...s.blocks, newBlock] } : s)));
      }
    } else if (overId.startsWith('dropzone-')) {
      if (!isHat) {
        const containerId = overId.slice('dropzone-'.length);
        setStacks(prev => prev.map(s => ({ ...s, blocks: addToContainer(s.blocks, containerId, newBlock) })));
      }
    } else {
      const coords = koordinaten();
      const snapId = snap(coords.x, coords.y, null);
      const target = snapId ? stacks.find(s => s.id === snapId) : null;
      if (snapId && !isHat && target && canAppendToStack(target, [newBlock])) {
        setStacks(prev => prev.map(s => (s.id === snapId ? { ...s, blocks: [...s.blocks, newBlock] } : s)));
      } else {
        setStacks(prev => [...prev, neuerStapel(coords, [newBlock])]);
      }
    }
    nachAenderung?.();
    return;
  }

  // Einen schon abgelegten Block verschieben (samt Teilstapel darunter).
  if (dtype === 'canvas-block' || !dtype) {
    const blockId = active.id;
    const srcStack = findStackByBlockId(stacks, blockId);
    if (!srcStack) return;
    const blocksToMove = subStack.length > 0 ? subStack : [findBlock(srcStack.blocks, blockId)].filter(Boolean);
    if (blocksToMove.length === 0) return;

    const doMove = (targetStackId) => {
      const target = stacks.find(s => s.id === targetStackId);
      if (!target || !canAppendToStack(target, blocksToMove)) return false;
      setStacks(prev => prev.map(s => {
        if (s.id === srcStack.id) return { ...s, blocks: removeSubStack(s.blocks, blockId) };
        if (s.id === targetStackId) return { ...s, blocks: [...s.blocks, ...blocksToMove] };
        return s;
      }).filter(s => s.blocks.length > 0));
      return true;
    };

    // Herauslösen und woanders neu ablegen.
    const nachDraussen = (coords, blocks) => setStacks(prev => {
      const removed = prev.map(s =>
        (s.id === srcStack.id ? { ...s, blocks: removeSubStack(s.blocks, blockId) } : s)
      ).filter(s => s.blocks.length > 0);
      return [...removed, neuerStapel(coords, blocks)];
    });

    if (overId.startsWith('stack-')) {
      const targetStackId = overId.slice(6);
      if (targetStackId === srcStack.id) return;
      doMove(targetStackId);
    } else if (overId.startsWith('dropzone-')) {
      if (blocksToMove.length === 1 && !isHatType(blocksToMove[0].type)) {
        const containerId = overId.slice('dropzone-'.length);
        const block = blocksToMove[0];
        setStacks(prev => prev
          .map(s => ({ ...s, blocks: removeSubStack(s.blocks, blockId) }))
          .map(s => ({ ...s, blocks: addToContainer(s.blocks, containerId, block) }))
          .filter(s => s.blocks.length > 0));
      }
    } else if (overId === canvasId) {
      const coords = koordinaten();
      const snapId = snap(coords.x, coords.y, blockId);
      if (snapId && snapId !== srcStack.id) {
        // Rastet nicht ein (Hut-Regel) → als eigener Stapel liegen lassen.
        if (!doMove(snapId)) nachDraussen(coords, blocksToMove);
      } else if (!snapId) {
        nachDraussen(coords, blocksToMove);
      }
    }
  }
}
