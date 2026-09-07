// The settings rail, built from a description rather than by hand, so adding
// a control is one line and every control saves and repaginates the same way.

import { FAMILIES } from './fonts.js';
import { PAPER, PAPER_KEYS, paperOf, isFolded } from './doc.js';

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const set = (obj, path, v) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = v;
};

const fontOptions = () =>
  FAMILIES.map(f => [f.name, `${f.name}`]);

const paperOptions = () => PAPER_KEYS.map(k => [k, PAPER[k].name]);

const inches = n => `${n.toFixed(2).replace(/\.?0+$/, '')} in`;

function sheetNote(settings) {
  const p = paperOf(settings);
  return p.fold
    ? `${inches(p.sheetW)} × ${inches(p.sheetH)}, folded to ${inches(p.pageW)} × ${inches(p.pageH)}`
    : `${inches(p.pageW)} × ${inches(p.pageH)}`;
}

/**
 * Every control in the rail, in order.
 *
 * Built from the settings rather than declared flat, because two margins
 * change their names depending on the paper: on a folded booklet they are the
 * fold and the trimmed edge, and on anything else they are simply left and
 * right. Calling the fold margin "left" on a page that has no fold is how
 * people put their text into the crease.
 */
export function schemaFor(settings) {
  const folded = isFolded(settings);
  return [
    {
      title: 'Page', open: true, fields: [
        { type: 'select', path: 'paper', label: 'Paper', options: paperOptions },
        { type: 'static', label: 'Size', value: sheetNote(settings) },
        { type: 'quad', label: 'Margins (inches)', fields: [
          { type: 'number', path: 'margins.top', label: 'Top', min: 0.15, max: 3, step: 0.05 },
          { type: 'number', path: 'margins.bottom', label: 'Bottom', min: 0.15, max: 3, step: 0.05 },
          { type: 'number', path: 'margins.inside', label: folded ? 'Inside (fold)' : 'Left', min: 0.15, max: 3, step: 0.05 },
          { type: 'number', path: 'margins.outside', label: folded ? 'Outside' : 'Right', min: 0.15, max: 3, step: 0.05 },
        ] },
        folded
          ? { type: 'hint', text: 'Inside is the folded spine edge, and it swaps sides from page to page. Give it a little more than the outside or the text creeps into the crease.' }
          : { type: 'hint', text: 'Wider margins make a shorter line, and a shorter line is easier to read. Somewhere between 60 and 75 characters is the range worth aiming at.' },
      ],
    },
    {
      title: 'Body text', open: true, fields: [
        { type: 'select', path: 'body.font', label: 'Font', options: fontOptions },
        { type: 'number', path: 'body.size', label: 'Size (pt)', min: 5, max: 24, step: 0.25 },
        { type: 'number', path: 'body.lineHeight', label: 'Line height', min: 0.9, max: 2.4, step: 0.02 },
        { type: 'seg', path: 'body.align', label: 'Align',
          options: [['left', 'Left'], ['justify', 'Justify'], ['center', 'Centre']] },
        { type: 'number', path: 'body.paraSpace', label: 'Space after (em)', min: 0, max: 2, step: 0.05 },
        { type: 'number', path: 'body.indent', label: 'First-line indent (em)', min: 0, max: 4, step: 0.1 },
      ],
    },
    ...['h1', 'h2', 'h3'].map((h, i) => ({
      title: `Heading ${i + 1}`, open: false, fields: [
        { type: 'select', path: `headings.${h}.font`, label: 'Font', options: fontOptions },
        { type: 'number', path: `headings.${h}.size`, label: 'Size (pt)', min: 6, max: 60, step: 0.5 },
        { type: 'seg', path: `headings.${h}.weight`, label: 'Weight',
          options: [[400, 'Regular'], [700, 'Bold']], cast: Number },
        { type: 'check', path: `headings.${h}.italic`, label: 'Italic' },
        { type: 'check', path: `headings.${h}.caps`, label: 'All caps' },
        { type: 'seg', path: `headings.${h}.align`, label: 'Align',
          options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] },
        { type: 'number', path: `headings.${h}.before`, label: 'Space before (em)', min: 0, max: 4, step: 0.05 },
        { type: 'number', path: `headings.${h}.after`, label: 'Space after (em)', min: 0, max: 4, step: 0.05 },
        { type: 'number', path: `headings.${h}.tracking`, label: 'Tracking (em)', min: -0.08, max: 0.4, step: 0.005 },
      ],
    })),
    {
      title: 'Quote & caption', open: false, fields: [
        { type: 'select', path: 'quote.font', label: 'Quote font', options: fontOptions },
        { type: 'number', path: 'quote.size', label: 'Quote size (pt)', min: 5, max: 24, step: 0.25 },
        { type: 'check', path: 'quote.italic', label: 'Quote italic' },
        { type: 'number', path: 'quote.indent', label: 'Quote indent (em)', min: 0, max: 4, step: 0.05 },
        { type: 'select', path: 'caption.font', label: 'Caption font', options: fontOptions },
        { type: 'number', path: 'caption.size', label: 'Caption size (pt)', min: 4, max: 16, step: 0.25 },
        { type: 'seg', path: 'caption.align', label: 'Caption align',
          options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] },
      ],
    },
    {
      title: 'Page numbers', open: false, fields: [
        { type: 'check', path: 'folio.on', label: 'Show page numbers' },
        { type: 'seg', path: 'folio.position', label: 'Position',
          options: [['bottom-outside', folded ? 'Outside' : 'Alternating'], ['bottom-center', 'Centre']] },
        { type: 'select', path: 'folio.font', label: 'Font', options: fontOptions },
        { type: 'number', path: 'folio.size', label: 'Size (pt)', min: 4, max: 16, step: 0.25 },
        { type: 'number', path: 'folio.startAt', label: 'First page is', min: -20, max: 500, step: 1 },
        { type: 'check', path: 'folio.hideOnFirst', label: 'Hide on the first page' },
        { type: 'check', path: 'folio.hideOnBlank', label: 'Hide on blank pages' },
      ],
    },
  ];
}

/** The document group, appended last: actions rather than measurements. */
export const DOC_SCHEMA = [
  { type: 'action', id: 'save-copy', text: 'Save a copy  ·  .json' },
  { type: 'action', id: 'open-copy', text: 'Open a copy…' },
  { type: 'hint', text: 'The complete one. Words, pictures, comments and every setting, in a single file. Your work lives in this browser and nowhere else, so this is how it survives a cleared cache or moves to another machine.' },

  { type: 'action', id: 'export-md', text: 'Export Markdown  ·  .md' },
  { type: 'action', id: 'import-md', text: 'Import Markdown…' },
  { type: 'hint', text: 'The portable one. Prose and structure, in a file any editor can open — but markdown has nowhere to put a picture or a typeface, so those do not travel with it.' },

  { type: 'action', id: 'start-over', text: 'Start over', danger: true },
];

/** Options for the press pane, which lives in the Save view instead. */
export const PRESS_SCHEMA = [
  { type: 'check', path: 'press.foldLine', label: 'Fold line' },
  { type: 'check', path: 'press.cropMarks', label: 'Crop marks' },
  { type: 'check', path: 'press.flipBack', label: 'Rotate back sides 180°' },
  { type: 'hint', text: 'Print double-sided. If the second side comes out upside down relative to the first, turn on the rotate option and export again.' },
];

/** The drafting room. Few settings on purpose — it is meant to be a bare room. */
export const DRAFT_SCHEMA = [
  { type: 'check', path: 'draft.focus', label: 'Fade what is behind you' },
  { type: 'check', path: 'draft.sound', label: 'Key sound' },
  { type: 'number', path: 'draft.goal', label: 'Word goal', min: 0, max: 20000, step: 50 },
  { type: 'hint', text: 'A goal of zero means no goal.' },
];

// ---------------------------------------------------------------------------

function control(field, settings, onChange) {
  const wrap = document.createElement('div');

  if (field.type === 'hint') {
    wrap.className = 'hint';
    wrap.textContent = field.text;
    return wrap;
  }

  if (field.type === 'static') {
    wrap.className = 'field';
    wrap.innerHTML = `<label>${field.label}</label>`;
    const v = document.createElement('span');
    v.className = 'hint';
    v.style.textAlign = 'right';
    v.textContent = field.value;
    wrap.appendChild(v);
    return wrap;
  }

  if (field.type === 'action') {
    // One full-width button that says what it does. A separate label beside it
    // only fought the button for room and lost, wrapping "Start over" onto two
    // lines against a button too wide for the rail.
    const b = document.createElement('button');
    b.className = `btn action${field.danger ? ' danger' : ''}`;
    b.textContent = field.text;
    b.dataset.action = field.id;
    return b;
  }

  if (field.type === 'quad') {
    const box = document.createElement('div');
    const head = document.createElement('div');
    head.className = 'hint';
    head.style.marginBottom = '2px';
    head.textContent = field.label;
    box.appendChild(head);
    const q = document.createElement('div');
    q.className = 'quad';
    field.fields.forEach(f => q.appendChild(control(f, settings, onChange)));
    box.appendChild(q);
    return box;
  }

  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = field.label;
  wrap.appendChild(label);

  const fire = v => { set(settings, field.path, v); onChange(field); };

  if (field.type === 'number') {
    const el = document.createElement('input');
    el.type = 'number';
    el.min = field.min; el.max = field.max; el.step = field.step;
    el.value = get(settings, field.path);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      fire(Math.min(field.max, Math.max(field.min, v)));
    });
    wrap.appendChild(el);
    wrap._sync = () => { el.value = get(settings, field.path); };
  }

  else if (field.type === 'select') {
    const el = document.createElement('select');
    const opts = typeof field.options === 'function' ? field.options() : field.options;
    for (const [value, text] of opts) {
      const o = document.createElement('option');
      o.value = value; o.textContent = text;
      el.appendChild(o);
    }
    el.value = get(settings, field.path);
    el.addEventListener('change', () => fire(el.value));
    wrap.appendChild(el);
    wrap._sync = () => { el.value = get(settings, field.path); };
  }

  else if (field.type === 'check') {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = !!get(settings, field.path);
    el.addEventListener('change', () => fire(el.checked));
    wrap.appendChild(el);
    wrap._sync = () => { el.checked = !!get(settings, field.path); };
  }

  else if (field.type === 'seg') {
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'stretch';
    wrap.style.gap = '4px';
    label.style.flex = '0 0 auto';
    const seg = document.createElement('div');
    seg.className = 'seg';
    const cast = field.cast || (v => v);
    for (const [value, text] of field.options) {
      const b = document.createElement('button');
      b.textContent = text;
      b.dataset.value = value;
      b.addEventListener('click', () => {
        fire(cast(value));
        seg.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x === b));
      });
      seg.appendChild(b);
    }
    const paint = () => {
      const cur = String(get(settings, field.path));
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('is-on', x.dataset.value === cur));
    };
    paint();
    wrap.appendChild(seg);
    wrap._sync = paint;
  }

  return wrap;
}

/** Build a list of fields into `host`; returns a function that re-reads them. */
export function buildFields(host, fields, settings, onChange) {
  const syncs = [];
  for (const f of fields) {
    const el = control(f, settings, onChange);
    host.appendChild(el);
    if (el._sync) syncs.push(el._sync);
    el.querySelectorAll?.('.field').forEach(c => c._sync && syncs.push(c._sync));
  }
  return () => syncs.forEach(fn => fn());
}

export function buildSettingsRail(host, settings, onChange) {
  host.textContent = '';
  const syncs = [];
  const groups = [
    ...schemaFor(settings),
    { title: 'Document', open: false, fields: DOC_SCHEMA },
  ];
  for (const group of groups) {
    const d = document.createElement('details');
    d.className = 'group';
    d.open = group.open;
    const s = document.createElement('summary');
    s.textContent = group.title;
    d.appendChild(s);
    const body = document.createElement('div');
    body.className = 'group-body';
    syncs.push(buildFields(body, group.fields, settings, onChange));
    d.appendChild(body);
    host.appendChild(d);
  }
  return () => syncs.forEach(fn => fn());
}
