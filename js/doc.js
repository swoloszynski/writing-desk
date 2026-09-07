// The document.
//
// One object holds everything: the draft you are still typing, the sections
// it became, the comments people left on it, and every setting that decides
// where a line falls on paper. It all lives in localStorage except images,
// which go to IndexedDB — a handful of photographs would blow the ~5MB
// localStorage budget on their own, and losing the writing to save a picture
// is the wrong trade.

const KEY = 'writing-desk/doc/v1';

/**
 * Inches.
 *
 * `sheet` is what goes through the printer; `page` is what a reader sees. For
 * everything but a folded booklet those are the same rectangle. A booklet
 * turns the sheet sideways and puts two pages on it, which is why the two
 * measurements have to be kept apart.
 */
export const PAPER = {
  letter:   { name: 'US Letter',  sheetW: 8.5,   sheetH: 11,    pageW: 8.5,   pageH: 11,    fold: false },
  a4:       { name: 'A4',         sheetW: 8.27,  sheetH: 11.69, pageW: 8.27,  pageH: 11.69, fold: false },
  a5:       { name: 'A5',         sheetW: 5.83,  sheetH: 8.27,  pageW: 5.83,  pageH: 8.27,  fold: false },
  digest:   { name: 'Digest',     sheetW: 5.5,   sheetH: 8.5,   pageW: 5.5,   pageH: 8.5,   fold: false },
  'zine-letter': { name: 'Zine · Letter folded', sheetW: 11,    sheetH: 8.5,  pageW: 5.5,   pageH: 8.5,  fold: true },
  'zine-a4':     { name: 'Zine · A4 folded',     sheetW: 11.69, sheetH: 8.27, pageW: 5.845, pageH: 8.27, fold: true },
};

export const PAPER_KEYS = Object.keys(PAPER);
export const paperOf = settings => PAPER[settings.paper] || PAPER.letter;
export const isFolded = settings => paperOf(settings).fold;

export const PX_PER_IN = 96;   // CSS reference pixel
export const PT_PER_IN = 72;   // PDF point
export const PX_TO_PT = PT_PER_IN / PX_PER_IN;   // 0.75
export const PT_TO_PX = PX_PER_IN / PT_PER_IN;   // 1.333…

export function defaultSettings() {
  return {
    paper: 'letter',
    // Inches. On a folded booklet `inside` is the spine edge and it swaps
    // sides page to page, which is why it is not called left. On a document
    // printed one page to a sheet nothing swaps and it simply is the left.
    margins: { top: 1, bottom: 1, inside: 1, outside: 1 },

    body: { font: 'EB Garamond', size: 11.5, lineHeight: 1.45, align: 'left',
            indent: 0, paraSpace: 0.6 },

    headings: {
      h1: { font: 'Space Grotesk', size: 22, weight: 700, italic: false,
            align: 'left', before: 0, after: 0.4, caps: false, tracking: -0.01 },
      h2: { font: 'Space Grotesk', size: 15, weight: 700, italic: false,
            align: 'left', before: 1, after: 0.3, caps: false, tracking: 0 },
      h3: { font: 'Inter', size: 11.5, weight: 700, italic: false,
            align: 'left', before: 0.8, after: 0.2, caps: true, tracking: 0.06 },
    },

    quote: { font: 'EB Garamond', size: 11.5, italic: true, indent: 1 },
    caption: { font: 'Inter', size: 8.5, align: 'center' },

    folio: { on: true, position: 'bottom-center', font: 'Inter', size: 9,
             startAt: 1, hideOnFirst: true, hideOnBlank: true, format: '#' },

    press: { flipBack: false, foldLine: true, cropMarks: false, spreadGap: true,
             exportMode: 'reading' },

    draft: { sound: false, focus: true, goal: 0 },
  };
}

let nextId = 1;
export function uid(prefix = 'id') {
  return `${prefix}${Date.now().toString(36)}${(nextId++).toString(36)}`;
}

export function defaultDraft() {
  return { text: '', startedAt: null, keystrokes: 0, seconds: 0 };
}

export function defaultDoc() {
  return {
    version: 1,
    title: 'Untitled',
    author: '',
    settings: defaultSettings(),
    draft: defaultDraft(),
    comments: [],
    sections: [
      {
        id: uid('s'),
        name: 'Opening',
        startsNewPage: false,
        html:
          '<h1>A working title</h1>' +
          '<p>Five stages, left to right along the top, and they are meant to ' +
          'be walked in order.</p>' +
          '<p><b>Draft</b> is a room with no back door. You can type and you ' +
          'can press return; you cannot delete, and you cannot move the ' +
          'cursor. The only way out of a bad sentence is the next one. ' +
          'Markdown gets you headings and lists without reaching for the ' +
          'mouse, because there is no mouse to reach for.</p>' +
          '<p><b>Edit</b> is this — an ordinary editor, where everything you ' +
          'were denied comes back. Cut, move, retitle, add a picture, break ' +
          'the piece into sections.</p>' +
          '<p><b>Comment</b> makes a link you can send someone. They read it ' +
          'in their browser, highlight the parts they have something to say ' +
          'about, and send their notes back. Nothing goes to a server.</p>' +
          '<p><b>Format</b> is where it becomes an object: paper size, ' +
          'margins, and one set of type rules that every heading and ' +
          'paragraph of the same kind obeys at once.</p>' +
          '<p><b>Save</b> writes the file — a PDF laid out exactly as the ' +
          'preview shows it, or markdown, or plain text.</p>',
      },
    ],
  };
}

/** Deep-merge saved settings over the defaults, so old saves survive new keys. */
function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base && base[k])
      ? merge(base[k], v) : v;
  }
  return out;
}

export function normalizeSection(s) {
  return {
    id: s.id || uid('s'),
    name: s.name || 'Section',
    startsNewPage: !!s.startsNewPage,
    html: typeof s.html === 'string' ? s.html : '',
  };
}

export function normalizeComment(c) {
  return {
    id: c.id || uid('c'),
    sectionId: c.sectionId || null,
    // Where the passage sits, and what it said when the note was written.
    // The offsets move as the document is edited; the quote is what lets a
    // comment find its way home again afterwards.
    start: Number.isFinite(c.start) ? c.start : 0,
    end: Number.isFinite(c.end) ? c.end : 0,
    quote: typeof c.quote === 'string' ? c.quote : '',
    author: c.author || 'Anonymous',
    text: typeof c.text === 'string' ? c.text : '',
    createdAt: c.createdAt || new Date().toISOString(),
    resolved: !!c.resolved,
    orphaned: !!c.orphaned,
    replies: Array.isArray(c.replies)
      ? c.replies.map(r => ({
          id: r.id || uid('r'),
          author: r.author || 'Anonymous',
          text: typeof r.text === 'string' ? r.text : '',
          createdAt: r.createdAt || new Date().toISOString(),
        }))
      : [],
  };
}

/** Take a plain object apart into a document, filling in anything missing. */
export function adoptShape(saved) {
  const doc = defaultDoc();
  doc.title = saved.title ?? doc.title;
  doc.author = saved.author ?? doc.author;
  doc.settings = merge(defaultSettings(), saved.settings);
  doc.draft = { ...defaultDraft(), ...(saved.draft || {}) };
  doc.comments = Array.isArray(saved.comments) ? saved.comments.map(normalizeComment) : [];
  if (Array.isArray(saved.sections) && saved.sections.length) {
    doc.sections = saved.sections.map(normalizeSection);
  }
  return doc;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultDoc();
    return adoptShape(JSON.parse(raw));
  } catch (err) {
    console.warn('could not read the saved document; starting fresh', err);
    return defaultDoc();
  }
}

let saveTimer = null;
export function save(doc, { now = false } = {}) {
  clearTimeout(saveTimer);
  const write = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(doc));
    } catch (err) {
      console.warn('could not save', err);
    }
  };
  if (now) write(); else saveTimer = setTimeout(write, 400);
}

export function clearSaved() {
  localStorage.removeItem(KEY);
}

/** Page box in CSS pixels, and the content box inside the margins. */
export function metrics(settings) {
  const p = paperOf(settings);
  const m = settings.margins;
  const pageW = p.pageW * PX_PER_IN;
  const pageH = p.pageH * PX_PER_IN;
  return {
    paper: p,
    folded: p.fold,
    sheetW: p.sheetW * PX_PER_IN,
    sheetH: p.sheetH * PX_PER_IN,
    pageW, pageH,
    marginTop: m.top * PX_PER_IN,
    marginBottom: m.bottom * PX_PER_IN,
    marginInside: m.inside * PX_PER_IN,
    marginOutside: m.outside * PX_PER_IN,
    contentW: pageW - (m.inside + m.outside) * PX_PER_IN,
    contentH: pageH - (m.top + m.bottom) * PX_PER_IN,
  };
}

/**
 * Where the page number sits, in pixels down from the top of the page.
 *
 * Shared by the preview and the PDF so the two cannot drift. It wants to be
 * roughly centred in the bottom margin, but two things matter more: it must
 * not crowd the text block above it, and it must not fall into the strip near
 * the paper edge that most printers refuse to print on.
 */
export function folioBaseline(settings, m) {
  const size = settings.folio.size * PT_TO_PX;
  const mb = m.marginBottom;
  const clearBelow = size * 0.32 + 14;   // descender, plus room off the trim
  const clearAbove = size * 0.85;        // never touch the last line of text

  let fromBottom = mb - Math.max(clearAbove, mb * 0.45);
  fromBottom = Math.min(
    Math.max(fromBottom, clearBelow),
    Math.max(clearBelow, mb - clearAbove),
  );
  return m.pageH - fromBottom;
}

// ---------------------------------------------------------------------------
// Images
//
// Stored as blobs in IndexedDB and referenced from the HTML by id, so the
// document text stays small and a reload does not have to re-parse megabytes
// of base64 before it can show you a word.
// ---------------------------------------------------------------------------

const DB_NAME = 'writing-desk-images';
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('images')) {
          req.result.createObjectStore('images');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction('images', mode);
    const req = fn(t.objectStore('images'));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

export async function putImage(id, record) { return tx('readwrite', s => s.put(record, id)); }
export async function getImage(id)         { return tx('readonly',  s => s.get(id)); }
export async function allImageIds()        { return tx('readonly',  s => s.getAllKeys()); }
export async function deleteImage(id)      { return tx('readwrite', s => s.delete(id)); }

/** Object URLs, made once per image and reused for the life of the page. */
const urlCache = new Map();
export async function imageURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await getImage(id);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}
export function cachedImageURL(id) { return urlCache.get(id) || null; }

// ---------------------------------------------------------------------------
// Backup
//
// There is no server behind this. Everything lives in one browser profile, and
// clearing site data would take the lot, so the document can be written out
// whole — images included — and read back later or on another machine.
// ---------------------------------------------------------------------------

const BACKUP_FORMAT = 'writing-desk/1';
const BACKUP_FORMATS = new Set([BACKUP_FORMAT]);

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}

export function referencedImages(doc) {
  const used = new Set();
  const probe = document.createElement('div');
  for (const s of doc.sections) {
    probe.innerHTML = s.html;
    probe.querySelectorAll('img[data-zimg]').forEach(img => used.add(img.dataset.zimg));
  }
  return used;
}

/** Every image the document points at, as data URLs, for a portable file. */
export async function packImages(doc) {
  const images = {};
  for (const id of referencedImages(doc)) {
    const rec = await getImage(id);
    if (!rec) continue;
    images[id] = {
      name: rec.name || '', w: rec.w, h: rec.h,
      data: await blobToDataURL(rec.blob),
    };
  }
  return images;
}

export async function unpackImages(images) {
  for (const [id, rec] of Object.entries(images || {})) {
    await putImage(id, {
      blob: await dataURLToBlob(rec.data), w: rec.w, h: rec.h, name: rec.name || '',
    });
  }
}

export async function serialize(doc) {
  return {
    format: BACKUP_FORMAT,
    savedAt: new Date().toISOString(),
    doc,
    images: await packImages(doc),
  };
}

/** @returns the restored document; throws if the file is not one of ours. */
export async function deserialize(bundle) {
  if (!bundle || !BACKUP_FORMATS.has(bundle.format) || !bundle.doc) {
    throw new Error('That does not look like a Writing Desk file.');
  }
  await unpackImages(bundle.images);
  return adoptShape(bundle.doc);
}

/** Drop images no block references any more. Runs after an edit settles. */
export async function collectGarbage(doc) {
  const used = referencedImages(doc);
  const ids = await allImageIds();
  await Promise.all(ids.filter(id => !used.has(id)).map(id => {
    const url = urlCache.get(id);
    if (url) { URL.revokeObjectURL(url); urlCache.delete(id); }
    return deleteImage(id);
  }));
}
