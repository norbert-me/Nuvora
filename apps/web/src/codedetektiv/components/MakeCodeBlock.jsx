import { useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';

const stopEvt = e => { e.stopPropagation(); };

// A single editable field: a dropdown (when `select` is set), or a text/number
// input with an optional +/- stepper for numeric fields.
function FieldControl({ field: f, onField }) {
  const step = delta => {
    const n = parseInt(f.value, 10);
    onField?.(f.key, String((Number.isNaN(n) ? 0 : n) + delta));
  };
  if (f.select) {
    return (
      <select className="block-select" value={f.value} disabled={!onField}
        onPointerDown={stopEvt} onClick={stopEvt}
        onChange={e => onField?.(f.key, e.target.value)}>
        {f.select.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <span className="block-field" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {f.numeric && onField && (
        <button type="button" className="stepper-btn" onClick={() => step(-1)}
          onPointerDown={stopEvt} tabIndex={-1} aria-label="weniger">−</button>
      )}
      <input className="block-input" value={f.value}
        size={Math.max(String(f.value ?? '').length, 1)}
        onChange={e => onField?.(f.key, e.target.value)}
        onClick={stopEvt} onPointerDown={stopEvt} readOnly={!onField} placeholder="?" />
      {f.numeric && onField && (
        <button type="button" className="stepper-btn" onClick={() => step(1)}
          onPointerDown={stopEvt} tabIndex={-1} aria-label="mehr">+</button>
      )}
      {f.suffix && <span>{f.suffix}</span>}
    </span>
  );
}

function BlockFields({ fields, onFieldChange }) {
  if (!fields || fields.length === 0) return null;
  return fields.map(f => <FieldControl key={f.key} field={f} onField={onFieldChange} />);
}

// A value (reporter) block: rounded pill shown inside a slot.
function ValueBlock({ block }) {
  return (
    <span className="mc-value" data-cat={block.cat}>
      <BlockParts parts={block.parts} />
    </span>
  );
}

// Slot contents shared by static and interactive slots.
function SlotInner({ slot }) {
  if (slot.child) return <ValueBlock block={slot.child} />;
  if (slot.literal) {
    const v = slot.literal.value ?? '';
    return (
      <input className="block-input" value={v} readOnly placeholder="?"
        size={Math.max(String(v).length, 1)} onPointerDown={e => e.stopPropagation()} />
    );
  }
  return null;
}

// Read-only slot (Admin preview, drag overlay, nested value slots).
function StaticSlot({ slot }) {
  return <span className={`mc-slot ${slot.child ? 'filled' : slot.literal ? 'literal' : 'empty'}`}><SlotInner slot={slot} /></span>;
}

// A placed value block that can be dragged back out of its slot.
function DraggableValue({ block, slotId }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pv-${slotId}`, data: { type: 'placed-value', slotId, block },
  });
  return (
    <span ref={setNodeRef} {...attributes} {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: 'grab' }}>
      <ValueBlock block={block} />
    </span>
  );
}

// Interactive slot: a drop target that accepts value blocks.
function DroppableSlot({ slot }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${slot.id}`, data: { slotId: slot.id } });
  return (
    <span ref={setNodeRef}
      className={`mc-slot ${slot.child ? 'filled' : slot.literal ? 'literal' : 'empty'} ${isOver ? 'over' : ''}`}>
      {slot.child ? <DraggableValue block={slot.child} slotId={slot.id} /> : <SlotInner slot={slot} />}
    </span>
  );
}

// Render a parts list: text spans, read-only slots (nested in a value block),
// and editable fields resolved from `fields` by key.
function BlockParts({ parts, fields, onField }) {
  if (!parts) return null;
  return parts.map((p, i) => {
    if (p.text !== undefined) return <span key={i} className="part-text">{p.text}</span>;
    if (p.field !== undefined) {
      const f = fields?.find(x => x.key === p.field);
      return f ? <FieldControl key={i} field={f} onField={onField} /> : null;
    }
    return <span key={i} className="part-slot"><StaticSlot slot={p} /></span>;
  });
}

// Header content of a block: parts list (value/if blocks) or label + legacy
// fields, then the block's own value-input slots. `interactive` makes those
// slots droppable (only inside the solution DnD context).
function BlockContent({ block, onFieldChange, interactive }) {
  const onField = onFieldChange ? (k, v) => onFieldChange(block.id, k, v) : undefined;
  const Slot = interactive ? DroppableSlot : StaticSlot;
  return (
    <span className="block-label">
      {block.parts
        ? <BlockParts parts={block.parts} fields={block.fields} onField={onField} />
        : <>{block.label}{block.fields && <BlockFields fields={block.fields} onFieldChange={onField} />}</>}
      {block.slots && block.slots.map((s, i) => (
        <span key={i} className="part-slot" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Slot slot={s} />
          {s.suffix && <span>{s.suffix}</span>}
        </span>
      ))}
    </span>
  );
}

function isHatType(type) {
  return type === 'event' || type === 'event-container';
}

function isContainerType(type) {
  return type === 'container' || type === 'event-container';
}

export function DraggableToolboxBlock({ block, dragId }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { type: 'toolbox', block },
  });

  const style = { opacity: isDragging ? 0.4 : 1, cursor: 'grab' };

  if (block.type === 'value') {
    return (
      <span ref={setNodeRef} {...attributes} {...listeners} style={{ ...style, display: 'inline-flex' }}>
        <ValueBlock block={block} />
      </span>
    );
  }

  if (isContainerType(block.type)) {
    return (
      <div ref={setNodeRef} {...attributes} {...listeners}
        className={`mc-container-block ${isHatType(block.type) ? 'hat-container' : ''}`}
        data-cat={block.cat} style={style}>
        <div className="mc-block-header">
          <BlockContent block={block} />
        </div>
        <div className="mc-block-body" style={{ minHeight: 24 }} />
        <div className="mc-block-footer" />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} {...attributes} {...listeners}
      className={`mc-block ${isHatType(block.type) ? 'hat-block' : ''}`}
      data-cat={block.cat} style={style}>
      <BlockContent block={block} />
    </div>
  );
}

export function MazeToolboxBlock({ block, dragId }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { type: 'toolbox', block },
  });

  if (isContainerType(block.type)) {
    return (
      <div ref={setNodeRef} {...attributes} {...listeners}
        className="mc-container-block" data-cat={block.cat}
        style={{ opacity: isDragging ? 0.4 : 1, cursor: 'grab' }}>
        <div className="mc-block-header">
          <BlockContent block={block} />
        </div>
        <div className="mc-block-body" style={{ minHeight: 20 }} />
        <div className="mc-block-footer" />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="mc-block" data-cat={block.cat}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: 'grab' }}>
      <BlockContent block={block} />
    </div>
  );
}

// Faded, greyed-out copy of the block being dragged, shown at the exact spot it
// would land if released now. Non-interactive.
export function GhostBlock({ block }) {
  if (!block) return <div className="mc-ghost" />;
  const tall = isContainerType(block.type);
  return (
    <div className={`mc-ghost-block ${tall ? 'mc-ghost-tall' : ''}`} data-cat={block.cat}>
      <BlockContent block={block} />
    </div>
  );
}

function ContainerBody({ block, children }) {
  const { setNodeRef } = useDroppable({ id: `dropzone-${block.id}`, data: { containerId: block.id } });
  return (
    <div ref={setNodeRef} className="mc-block-body">
      {children}
    </div>
  );
}

export function SortableBlock({ block, onFieldChange, dropTarget, ghostBlock }) {
  // Deliberately ignore the sortable transform/transition: we don't want live
  // list-shifting. The floating DragOverlay shows the moving block and a single
  // dashed ghost shows the drop position. The original is hidden while dragging.
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: block.id });
  // Hide the dragged block but KEEP its slot (visibility, not display:none) so
  // the surrounding blocks don't shift. Combined with the zero-height ghost line
  // this keeps every block's measured rect fixed during the drag, so the
  // pointer-based collision test lands on the block the cursor is actually over.
  const style = isDragging ? { visibility: 'hidden' } : undefined;

  if (isContainerType(block.type)) {
    const kids = block.children || [];
    const ghostAt = dropTarget && dropTarget.parentId === block.id ? dropTarget.index : null;
    const childNodes = kids.map(child => (
      <SortableBlock key={child.id} block={child} onFieldChange={onFieldChange} dropTarget={dropTarget} ghostBlock={ghostBlock} />
    ));
    if (ghostAt != null) childNodes.splice(ghostAt, 0, <GhostBlock key="__ghost" block={ghostBlock} />);
    return (
      <div ref={setNodeRef} style={style}
        className={`mc-container-block ${isHatType(block.type) ? 'hat-container' : ''}`}
        data-cat={block.cat}>
        <div className="mc-block-header" {...attributes} {...listeners}>
          <BlockContent block={block} onFieldChange={onFieldChange} interactive />
        </div>
        <ContainerBody block={block}>
          {childNodes.length > 0 ? childNodes : (
            <div style={{ color: '#999', fontSize: 13, padding: '8px 0' }}>Blöcke hierhin ziehen</div>
          )}
        </ContainerBody>
        <div className="mc-block-footer" />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`mc-block ${isHatType(block.type) ? 'hat-block' : ''}`}
      data-cat={block.cat}>
      <BlockContent block={block} onFieldChange={onFieldChange} interactive />
    </div>
  );
}

export function DraggableBlock({ block, onFieldChange }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: block.id,
    data: { type: 'canvas-block', block },
  });
  const style = isDragging ? { visibility: 'hidden' } : undefined;

  if (isContainerType(block.type)) {
    return (
      <div ref={setNodeRef} style={style}
        className={`mc-container-block ${isHatType(block.type) ? 'hat-container' : ''}`}
        data-cat={block.cat} data-block-id={block.id}>
        <div className="mc-block-header" {...attributes} {...listeners}>
          <BlockContent block={block} onFieldChange={onFieldChange} interactive />
        </div>
        <ContainerBody block={block}>
          {(block.children || []).length > 0
            ? block.children.map(child => (
                <DraggableBlock key={child.id} block={child} onFieldChange={onFieldChange} />
              ))
            : <div style={{ color: '#999', fontSize: 13, padding: '8px 0' }}>Blöcke hierhin ziehen</div>
          }
        </ContainerBody>
        <div className="mc-block-footer" />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`mc-block ${isHatType(block.type) ? 'hat-block' : ''}`}
      data-cat={block.cat} data-block-id={block.id}>
      <BlockContent block={block} onFieldChange={onFieldChange} interactive />
    </div>
  );
}

export function DragOverlayBlock({ block }) {
  if (block.type === 'value') {
    return <span style={{ opacity: 0.9 }}><ValueBlock block={block} /></span>;
  }
  if (isContainerType(block.type)) {
    return (
      <div className={`mc-container-block ${isHatType(block.type) ? 'hat-container' : ''}`}
        data-cat={block.cat} style={{ opacity: 0.9, boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
        <div className="mc-block-header">
          <BlockContent block={block} />
        </div>
        {/* Ganzen Block zeigen: die verschachtelten Kinder gehoeren mit ins
            Drag-Bild, sonst schwebt nur der Kopf. */}
        <div className="mc-block-body">
          {block.children?.map(child => (
            <StaticBlock key={child.id} block={child} />
          ))}
        </div>
        <div className="mc-block-footer" />
      </div>
    );
  }
  return (
    <div className={`mc-block ${isHatType(block.type) ? 'hat-block' : ''}`}
      data-cat={block.cat} style={{ opacity: 0.9, boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
      <BlockContent block={block} />
    </div>
  );
}

export function StaticBlock({ block }) {
  if (isContainerType(block.type)) {
    return (
      <div className={`mc-container-block ${isHatType(block.type) ? 'hat-container' : ''}`} data-cat={block.cat}>
        <div className="mc-block-header">
          <BlockContent block={block} />
        </div>
        <div className="mc-block-body">
          {block.children?.map(child => (
            <StaticBlock key={child.id} block={child} />
          ))}
        </div>
        <div className="mc-block-footer" />
      </div>
    );
  }

  return (
    <div className={`mc-block ${isHatType(block.type) ? 'hat-block' : ''}`} data-cat={block.cat} style={{ cursor: 'default' }}>
      <BlockContent block={block} />
    </div>
  );
}

export function CollapsibleCategory({ cat, catInfo, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="toolbox-category-header" onClick={() => setOpen(!open)}>
        <span className={`toolbox-toggle ${open ? '' : 'collapsed'}`}>▼</span>
        <span className="cat-dot" style={{ background: catInfo?.color || '#888' }} />
        {catInfo?.label || cat}
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {children}
        </div>
      )}
    </div>
  );
}
