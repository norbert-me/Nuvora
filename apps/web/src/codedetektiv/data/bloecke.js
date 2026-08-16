// Der Blockbaum — EINE Quelle für die Rechnungen auf den MakeCode-Bausteinen.
//
// Der Rätsel-Editor (`pages/Admin.jsx`) und die Spielseite (`pages/PuzzlePage.jsx`)
// arbeiten auf derselben Datenform: eine Liste von Blöcken, jeder mit `fields`
// (Eingaben), `slots` (Steckplätze für Wertblöcke) und `children` (Rumpf eines
// Containers). Beide Seiten hatten dieselben Baumfunktionen zeichengleich
// abgeschrieben — `findBlock`, `updateBlockField`, `addToContainer`,
// `removeBlockDeep`, dazu `isContainerType`/`isHatType` sogar dreimal
// (Admin, PuzzlePage, MakeCodeBlock).
//
// Der Grund, warum das hier steht und nicht nur eine Aufräumarbeit ist:
// `compareBlocks` entscheidet, ob ein Kind richtig liegt. Zwei Kopien einer
// Lösungsprüfung heißen zwei Gelegenheiten, sie verschieden falsch zu haben.
//
// Die Block-Beschriftungen ('gehe vorwärts' …) sind DATEN und werden hier
// zeichengleich verglichen — sie dürfen nie übersetzt werden, sonst schlägt
// die Lösungsprüfung fehl.
//
// Regressionstest: `bloecke.test.js`.

/** Container = hat einen Rumpf, in den Blöcke hineingehören. */
export function isContainerType(type) {
  return type === 'container' || type === 'event-container';
}

/** Hut = Startblock („beim Start", „wenn Knopf") — steht immer ganz oben. */
export function isHatType(type) {
  return type === 'event' || type === 'event-container';
}

/** Wert eines Eingabefeldes ändern — auch tief in Containern. */
export function updateBlockField(blocks, blockId, fieldKey, value) {
  return blocks.map(b => {
    if (b.id === blockId) return { ...b, fields: b.fields?.map(f => f.key === fieldKey ? { ...f, value } : f) };
    if (b.children) return { ...b, children: updateBlockField(b.children, blockId, fieldKey, value) };
    return b;
  });
}

/** Block mit dieser id im ganzen Baum; `null`, wenn es ihn nicht gibt. */
export function findBlock(blocks, id) {
  for (const b of blocks) {
    if (b.id === id) return b;
    if (b.children) { const f = findBlock(b.children, id); if (f) return f; }
  }
  return null;
}

/** Block hinten an den Rumpf des Containers hängen. */
export function addToContainer(blocks, containerId, newBlock) {
  return blocks.map(b => {
    if (b.id === containerId && b.children) return { ...b, children: [...b.children, newBlock] };
    if (b.children) return { ...b, children: addToContainer(b.children, containerId, newBlock) };
    return b;
  });
}

/** Block an einer Stelle einfügen. `parentId == null` = oberste Ebene. */
export function insertAt(blocks, parentId, index, newBlock) {
  if (parentId == null) { const c = [...blocks]; c.splice(index, 0, newBlock); return c; }
  return blocks.map(b => {
    if (b.id === parentId) { const k = [...(b.children || [])]; k.splice(index, 0, newBlock); return { ...b, children: k }; }
    if (b.children) return { ...b, children: insertAt(b.children, parentId, index, newBlock) };
    return b;
  });
}

/** Block samt Kindern aus dem Baum nehmen. */
export function removeBlockDeep(blocks, id) {
  const out = [];
  for (const b of blocks) {
    if (b.id === id) continue;
    out.push(b.children ? { ...b, children: removeBlockDeep(b.children, id) } : b);
  }
  return out;
}

/**
 * Der Container, in dem dieser Block steckt.
 *
 * `null` = oberste Ebene, `undefined` = gibt es gar nicht. Der Unterschied ist
 * gewollt: die Aufrufer prüfen auf `!== undefined`.
 */
export function findParentContainer(blocks, childId, parent = null) {
  for (const b of blocks) {
    if (b.id === childId) return parent;
    if (b.children) { const f = findParentContainer(b.children, childId, b); if (f !== undefined) return f; }
  }
  return undefined;
}

/** Block verschieben (innerhalb der Liste oder in einen Container). */
export function moveBlock(blocks, activeId, pos) {
  const active = findBlock(blocks, activeId);
  if (!active) return blocks;
  // Ein Container darf nicht in sich selbst wandern.
  if (active.children && pos.parentId && findBlock(active.children, pos.parentId)) return blocks;
  const srcParent = findParentContainer(blocks, activeId);
  const srcParentId = srcParent ? srcParent.id : null;
  const srcList = srcParent ? srcParent.children : blocks;
  const srcIndex = srcList.findIndex(b => b.id === activeId);
  let targetIndex = pos.index;
  // Die Entnahme verschiebt den Zielindex.
  if (srcParentId === pos.parentId && srcIndex !== -1 && srcIndex < pos.index) targetIndex -= 1;
  const stripped = removeBlockDeep(blocks, activeId);
  return insertAt(stripped, pos.parentId, targetIndex, active);
}

/** Alle Blöcke zählen, Kinder eingeschlossen. */
export function countAllBlocks(blocks) {
  let count = 0;
  for (const b of blocks) { count++; if (b.children) count += countAllBlocks(b.children); }
  return count;
}

/**
 * Die Lösung flach machen: Container behalten ihre Form, aber ihre Kinder
 * stehen zusätzlich einzeln in der Werkzeugkiste — sonst könnte man einen
 * Rumpf gar nicht füllen.
 */
export function flattenSolution(blocks) {
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

/** Alle Wertblöcke einsammeln, die irgendwo in einem Steckplatz sitzen. */
export function collectSlotValues(blocks, acc) {
  for (const b of blocks) {
    if (b.slots) for (const s of b.slots) if (s.child) acc.push(s.child);
    if (b.parts) for (const p of b.parts) if (p.slot && p.child) acc.push(p.child);
    if (b.children) collectSlotValues(b.children, acc);
  }
  return acc;
}

/** Steckplatz füllen (`child = null` leert ihn). */
export function fillSlot(blocks, slotId, child) {
  return blocks.map(b => {
    let nb = b;
    if (b.slots && b.slots.some(s => s.id === slotId)) {
      nb = { ...nb, slots: b.slots.map(s => (s.id === slotId ? { ...s, child } : s)) };
    }
    if (nb.children) nb = { ...nb, children: fillSlot(nb.children, slotId, child) };
    return nb;
  });
}

// ─── Signaturen: „sieht das gleich aus?" als Zeichenkette ───

export function slotSig(slot) {
  if (!slot) return '';
  if (slot.child) return 'c(' + valueSig(slot.child) + ')';
  if (slot.literal) return 'l:' + (slot.literal.value ?? '');
  return '_';
}

export function partsSig(parts) {
  return (parts || []).map(p => (p.text !== undefined ? 't:' + p.text : 's:' + slotSig(p))).join('|');
}

export function valueSig(vb) {
  if (!vb) return '∅';
  return (vb.cat || '') + ':' + partsSig(vb.parts);
}

/**
 * Liegt das Kind richtig?
 *
 * Verglichen wird Beschriftung, Kategorie, die Bausteinteile, die Eingabefelder
 * (außer mit `check: false` — z.B. die Pausendauer, die egal ist), die
 * Steckplätze und rekursiv der Rumpf eines Containers.
 */
export function compareBlocks(placed, solution) {
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

// ─── Stapel auf der Fläche ───
// Ein „Stapel" ist eine Gruppe untereinander eingerasteter Blöcke an einer
// Position (x/y) auf der Zeichenfläche.

/** Der gezogene Block UND alles, was unter ihm hängt — Blöcke kleben aneinander. */
export function getSubStack(stack, blockId) {
  const idx = stack.blocks.findIndex(b => b.id === blockId);
  if (idx < 0) return [];
  return stack.blocks.slice(idx);
}

/** Denselben Teilstapel aus der Blockliste entfernen. */
export function removeSubStack(blocks, startId) {
  const idx = blocks.findIndex(b => b.id === startId);
  if (idx < 0) return blocks;
  return blocks.slice(0, idx);
}

/** Darf das unten an diesen Stapel? Ein Hut nur, wenn der Stapel leer ist. */
export function canAppendToStack(targetStack, blocksToAdd) {
  if (blocksToAdd.length === 0) return false;
  if (isHatType(blocksToAdd[0].type) && targetStack.blocks.length > 0) return false;
  return true;
}

/** Der Stapel, in dem dieser Block (oder eines seiner Kinder) steckt. */
export function findStackByBlockId(stacks, blockId) {
  return stacks.find(s => {
    for (const b of s.blocks) {
      if (b.id === blockId) return true;
      if (b.children && b.children.some(c => c.id === blockId)) return true;
    }
    return false;
  });
}
