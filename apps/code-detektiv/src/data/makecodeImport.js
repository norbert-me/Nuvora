// Import a MakeCode / Calliope .hex file and turn its embedded Blockly program
// into this app's block model (see samplePuzzles.jsx for the shape).
//
// A MakeCode .hex is Intel-HEX. The program source is appended in custom
// record-type 0x0E rows, starting with the magic 41140E2F B82FA2BB, then a
// JSON header, then an LZMA-compressed blob holding meta JSON + files JSON.
// files["main.blocks"] is the Blockly XML we map here.

import lzmaSrc from 'lzma/src/lzma-d-min.js?raw';

// The lib assigns its export onto `this` (worker/global). Evaluate it in a
// scratch scope and grab the decompressor. Done once, lazily.
let _lzma = null;
function getLzma() {
  if (!_lzma) {
    // eslint-disable-next-line no-new-func
    _lzma = new Function(lzmaSrc + '\nreturn this.LZMA_WORKER || this.LZMA;').call({});
  }
  return _lzma;
}

const SOURCE_MAGIC = '41140e2fb82fa2bb';

function hexRecordsToBytes(hexText) {
  const lines = hexText.split(/\r?\n/);
  let hex = '';
  for (const line of lines) {
    if (line.slice(7, 9) === '0E') {
      const n = parseInt(line.slice(1, 3), 16);
      hex += line.slice(9, 9 + n * 2);
    }
  }
  if (!hex) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function readUInt16LE(bytes, off) {
  return bytes[off] | (bytes[off + 1] << 8);
}

// Decompress the LZMA blob. The lib returns an already UTF-8-decoded string
// whose length lines up with the header's byte offsets, so slice it directly.
// (If it ever returns a raw byte array instead, decode that as UTF-8.)
function lzmaDecompress(compressed) {
  return new Promise((resolve, reject) => {
    getLzma().decompress(Array.from(compressed), (result, err) => {
      if (err) return reject(err);
      resolve(typeof result === 'string'
        ? result
        : new TextDecoder('utf-8').decode(Uint8Array.from(result, b => b & 0xff)));
    });
  });
}

// Returns { files, meta } where files["main.blocks"] is the Blockly XML.
export async function extractMakeCodeSource(hexText) {
  const bytes = hexRecordsToBytes(hexText);
  if (!bytes) throw new Error('Keine MakeCode-Quelle in der .hex gefunden.');
  const magic = Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (magic !== SOURCE_MAGIC) throw new Error('Ungültige MakeCode-Quelle (Magic passt nicht).');

  const headerSize = readUInt16LE(bytes, 8);
  const dec = new TextDecoder('utf-8');
  const header = JSON.parse(dec.decode(bytes.slice(16, 16 + headerSize)));
  const compressed = bytes.slice(16 + headerSize);

  const plain = await lzmaDecompress(compressed);
  const files = JSON.parse(plain.slice(header.headerSize, header.headerSize + header.textSize));
  return { files, header };
}

// ── Blockly XML → app blocks ──────────────────────────────────────────────

let idCounter = 0;
function nextId() { return `imp-${Date.now().toString(36)}-${idCounter++}`; }

function humanize(type) {
  return type.replace(/^pxt[-_]/, '').replace(/[-_]/g, ' ');
}

// The real child of a <value> is a <block> if present, else the <shadow>.
function realOfValue(valueEl) {
  return [...valueEl.children].find(c => c.tagName === 'block')
    || [...valueEl.children].find(c => c.tagName === 'shadow');
}

const COMPARE_OPS = { EQ: '=', NEQ: '≠', LT: '<', LTE: '≤', GT: '>', GTE: '≥' };

// Render an expression block (number, variable, comparison, boolean logic,
// A literal input value pulled from a number/text shadow.
function literalFromReal(real) {
  if (!real) return { value: '', numeric: false };
  const t = real.getAttribute('type');
  const f = n => {
    const x = [...real.children].find(c => c.tagName === 'field' && c.getAttribute('name') === n);
    return x ? x.textContent : null;
  };
  if (t === 'math_number' || t === 'math_integer') return { value: f('NUM') ?? '0', numeric: true };
  if (t === 'math_number_minmax') return { value: f('SLIDER') ?? '0', numeric: true };
  if (t === 'text') return { value: f('TEXT') ?? '', numeric: false };
  return { value: '', numeric: false };
}

// A value-input slot: { slot, key, suffix, child, literal }. `child` is a value
// (reporter) block when the input holds an expression; otherwise `literal` holds
// a plain { value, numeric } that renders as an editable input.
function slotFromValue(valueEl, key) {
  const slot = { slot: true, id: nextId(), key: String(key || '').toLowerCase(), suffix: '', child: null, literal: null };
  if (!valueEl) return slot;
  const real = realOfValue(valueEl);
  const child = mapValue(real);
  if (child) slot.child = child;
  else slot.literal = literalFromReal(real);
  return slot;
}

// Build a value (reporter) block from an expression element, or null when the
// element is just a number/text literal (those stay as slot inputs). Value
// blocks render from a `parts` list of { text } and slot objects.
function mapValue(real) {
  if (!real) return null;
  const type = real.getAttribute('type');
  const field = name => {
    const f = [...real.children].find(c => c.tagName === 'field' && c.getAttribute('name') === name);
    return f ? f.textContent : null;
  };
  const slot = name => slotFromValue(
    [...real.children].find(c => c.tagName === 'value' && c.getAttribute('name') === name), name);
  const vb = (cat, parts) => ({ id: nextId(), type: 'value', cat, parts });
  switch (type) {
    case 'math_number': case 'math_integer': case 'math_number_minmax': case 'text':
      return null;
    case 'variables_get':
      return vb('variables', [{ text: field('VAR') || '?' }]);
    case 'argument_reporter_number':
    case 'argument_reporter_string':
    case 'argument_reporter_boolean':
      return vb('variables', [{ text: field('VALUE') || '?' }]);
    case 'device_random':
      return vb('math', [{ text: 'Zufallszahl von' }, slot('min'), { text: 'bis' }, slot('limit')]);
    case 'logic_boolean':
      return vb('logic', [{ text: field('BOOL') === 'FALSE' ? 'falsch' : 'wahr' }]);
    case 'logic_negate':
      return vb('logic', [{ text: 'nicht' }, slot('BOOL')]);
    case 'logic_compare':
      return vb('logic', [slot('A'), { text: COMPARE_OPS[field('OP')] || '?' }, slot('B')]);
    case 'logic_operation':
      return vb('logic', [slot('A'), { text: field('OP') === 'OR' ? 'oder' : 'und' }, slot('B')]);
    case 'device_get_button2':
    case 'device_button_is_pressed':
      return vb('input', [{ text: `Knopf ${btn(field('NAME'))} gedrückt` }]);
    default:
      return vb('basic', [{ text: humanize(type) }]);
  }
}

// Category + German label rules for the block types we know. Everything else
// falls back to a humanised type name so the structure still imports.
// kind: 'event' | 'container' | 'statement'
const MAP = {
  'pxt-on-start':                { cat: 'basic',     kind: 'event',     label: () => 'beim Start' },
  'device_forever':             { cat: 'basic',     kind: 'event',     label: () => 'dauerhaft' },
  'device_button_selected_event': { cat: 'input',   kind: 'event',     build: (f) => buttonEvent(f) },
  'device_button_event':        { cat: 'input',     kind: 'event',     build: (f) => buttonEvent(f) },
  'device_gesture_event':       { cat: 'input',     kind: 'event',     label: (f) => `wenn ${gesture(f.NAME)}` },
  'radio_on_number_drag':       { cat: 'input',     kind: 'event',     label: () => 'wenn Zahl empfangen' },
  'radio_on_number':            { cat: 'input',     kind: 'event',     label: () => 'wenn Zahl empfangen' },

  'controls_repeat_ext':        { cat: 'loops',     kind: 'container',  label: () => 'wiederhole', valFields: [['TIMES', 'mal']] },
  'device_while':               { cat: 'loops',     kind: 'container',  label: () => 'solange' },
  'controls_simple_for':        { cat: 'loops',     kind: 'container',  label: () => 'für Index' },
  'pxt_controls_for':           { cat: 'loops',     kind: 'container',  label: () => 'für Index' },
  'controls_if':                { cat: 'logic',     kind: 'container',  label: () => 'wenn wahr' },

  'variables_set':              { cat: 'variables', kind: 'statement',  label: (f) => `setze ${f.VAR ?? '?'} auf`, valFields: [['VALUE', '']] },
  'variables_change':           { cat: 'variables', kind: 'statement',  label: (f) => `ändere ${f.VAR ?? '?'} um`, valFields: [['VALUE', '']] },

  'device_show_number':         { cat: 'basic',     kind: 'statement',  label: () => 'zeige Zahl', valFields: [['number', '']] },
  'basic_show_number':          { cat: 'basic',     kind: 'statement',  label: () => 'zeige Zahl', valFields: [['number', '']] },
  'device_print_message':       { cat: 'basic',     kind: 'statement',  label: () => 'zeige Text', valFields: [['text', '']] },
  'basic_show_string':          { cat: 'basic',     kind: 'statement',  label: () => 'zeige Text', valFields: [['text', '']] },
  'basic_show_leds':            { cat: 'basic',     kind: 'statement',  label: () => 'zeige LEDs' },
  'device_show_leds':           { cat: 'basic',     kind: 'statement',  label: () => 'zeige LEDs' },
  'basic_show_icon':            { cat: 'basic',     kind: 'statement',  label: (f) => `zeige Symbol ${icon(f.i)}`.trim() },
  'device_show_icon':           { cat: 'basic',     kind: 'statement',  label: (f) => `zeige Symbol ${icon(f.i)}`.trim() },
  'device_clear_display':       { cat: 'basic',     kind: 'statement',  label: () => 'lösche Bildschirm' },
  'device_pause':               { cat: 'basic',     kind: 'statement',  label: () => 'pausiere', valFields: [['pause', 'ms']] },
  'basic_pause':                { cat: 'basic',     kind: 'statement',  label: () => 'pausiere', valFields: [['pause', 'ms']] },

  'radio_set_group':            { cat: 'input',     kind: 'statement',  label: () => 'setze Funkgruppe auf', valFields: [['ID', '']] },
  'radio_datagram_send':        { cat: 'input',     kind: 'statement',  label: () => 'sende Zahl', valFields: [['value', '']] },
  'radio_send_number':          { cat: 'input',     kind: 'statement',  label: () => 'sende Zahl', valFields: [['value', '']] },
};

const BUTTON_OPTIONS = ['A', 'B', 'A+B'];
function btn(name) {
  const raw = String(name || 'A').replace(/^Button\./, '');
  return raw === 'AB' ? 'A+B' : raw;
}

function icon(name) {
  return name ? String(name).replace(/^IconNames\./, '') : '';
}

// "wenn Knopf [A ▾] gedrückt" — the button is an editable dropdown field.
function buttonEvent(fields) {
  return {
    parts: [{ text: 'wenn Knopf' }, { field: 'name' }, { text: 'gedrückt' }],
    fields: [{ key: 'name', value: btn(fields.NAME), select: BUTTON_OPTIONS }],
  };
}

function gesture(name) {
  const g = { Shake: 'geschüttelt', LogoUp: 'Logo oben', LogoDown: 'Logo unten',
    ScreenUp: 'Display oben', ScreenDown: 'Display unten', TiltLeft: 'nach links gekippt',
    TiltRight: 'nach rechts gekippt', FreeFall: 'im freien Fall' };
  const key = String(name || '').replace(/^Gesture\./, '');
  return g[key] || key || 'geschüttelt';
}

// Expression / reporter blocks produce a value; they are never a valid
// standalone program and should be dropped if left loose at the top level.
function isExpressionType(type) {
  if (!type) return false;
  if (/^(math_|logic_|text_)/.test(type)) return true;
  return [
    'text', 'variables_get', 'argument_reporter_number', 'argument_reporter_string',
    'argument_reporter_boolean', 'device_random', 'math_random', 'math_random_int',
    'device_temperature', 'device_get_acceleration', 'device_light_level',
  ].includes(type);
}

function collectFields(el) {
  const fields = {};
  const values = {};
  for (const child of el.children) {
    if (child.tagName === 'field') fields[child.getAttribute('name')] = child.textContent;
    else if (child.tagName === 'value') values[child.getAttribute('name')] = child;
  }
  return { fields, values };
}

function statementChildren(el, name) {
  const st = [...el.children].find(c => c.tagName === 'statement' && c.getAttribute('name') === name);
  return st ? parseChain([...st.children].find(c => c.tagName === 'block')) : [];
}

// controls_if → one logic container per branch: "wenn <cond> dann", any number
// of "sonst wenn <cond> dann", and a final "sonst". The app has no native
// if/else, so branches become sibling containers.
function mapIf(el) {
  const mut = [...el.children].find(c => c.tagName === 'mutation');
  const elseif = mut ? parseInt(mut.getAttribute('elseif') || '0', 10) : 0;
  const hasElse = mut ? mut.getAttribute('else') === '1' : false;
  const condSlot = i => slotFromValue(
    [...el.children].find(c => c.tagName === 'value' && c.getAttribute('name') === `IF${i}`), 'cond');
  const container = (parts, children) => ({ id: nextId(), type: 'container', cat: 'logic', parts, children });
  const out = [];
  for (let i = 0; i <= elseif; i++) {
    out.push(container(
      [{ text: i === 0 ? 'wenn' : 'sonst wenn' }, condSlot(i), { text: 'dann' }],
      statementChildren(el, `DO${i}`)));
  }
  if (hasElse) out.push(container([{ text: 'sonst' }], statementChildren(el, 'ELSE')));
  return out;
}

// Map one XML block to zero or more app blocks. Zero when it is disabled
// (MakeCode greys out dead/unreachable blocks) — those are dropped on import.
function mapBlockList(el) {
  if (el.getAttribute('disabled-reasons')) return [];
  if (el.getAttribute('type') === 'controls_if') return mapIf(el);
  return [mapBlock(el)];
}

// The <statement>/<next> chain inside a block, as an array of app blocks.
function parseChain(firstBlockEl) {
  const out = [];
  let cur = firstBlockEl;
  while (cur) {
    out.push(...mapBlockList(cur));
    const next = [...cur.children].find(c => c.tagName === 'next');
    cur = next ? [...next.children].find(c => c.tagName === 'block') : null;
  }
  return out;
}

function mapBlock(el) {
  const type = el.getAttribute('type');
  const { fields, values } = collectFields(el);
  const info = MAP[type];

  // Value inputs become slots (they may hold a value block or a literal input).
  const slots = [];
  if (info?.valFields) {
    for (const [name, suffix] of info.valFields) {
      const s = slotFromValue(values[name], name);
      s.suffix = suffix;
      slots.push(s);
    }
  } else if (!info) {
    for (const [name, valueEl] of Object.entries(values)) {
      slots.push(slotFromValue(valueEl, name));
    }
  }

  const cat = info?.cat ?? 'basic';
  const kind = info?.kind ?? 'statement';
  const built = info?.build ? info.build(fields, values) : null;

  // Children live in the first <statement> element (HANDLER / DO / etc).
  const stmtEl = [...el.children].find(c => c.tagName === 'statement');
  const children = stmtEl
    ? parseChain([...stmtEl.children].find(c => c.tagName === 'block'))
    : undefined;

  const appType = kind === 'event' ? 'event-container' : kind === 'container' ? 'container' : 'statement';

  const block = { id: nextId(), type: appType, cat };
  if (built?.parts) block.parts = built.parts;
  else block.label = info ? info.label(fields, values) : humanize(type);
  if (built?.fields) block.fields = built.fields;
  if (slots.length) block.slots = slots;
  if (appType === 'container' || appType === 'event-container') block.children = children || [];
  return block;
}

// Parse main.blocks XML into { solution, variables }. solution is the ordered
// list of top-level programs (events); variables are the declared names, used to
// build draggable getter blocks for the toolbox.
export function parseBlocksXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  const varsEl = [...root.children].find(c => c.tagName === 'variables');
  const variables = varsEl
    ? [...varsEl.children].filter(c => c.tagName === 'variable').map(v => v.textContent)
    : [];
  const tops = [...root.children].filter(
    c => c.tagName === 'block'
      && !c.getAttribute('disabled-reasons')
      && !isExpressionType(c.getAttribute('type'))
  );
  return { solution: tops.flatMap(mapBlockList), variables };
}

// Backwards-compatible helper returning just the solution array.
export function blocksXmlToSolution(xml) {
  return parseBlocksXml(xml).solution;
}

// One-shot: .hex text → { title, solution, variables }.
export async function importPuzzleFromHex(hexText) {
  const { files, header } = await extractMakeCodeSource(hexText);
  const xml = files['main.blocks'];
  if (!xml) throw new Error('Kein Blockly-Programm (main.blocks) in der Datei.');
  const { solution, variables } = parseBlocksXml(xml);
  return { title: header.name || 'Importiertes Programm', solution, variables };
}
