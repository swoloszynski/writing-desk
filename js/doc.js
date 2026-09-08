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

/** The stages, for validating a remembered one. */
export const STAGES = new Set(['draft', 'edit', 'comment', 'format', 'save']);

/**
 * Where a piece has got to.
 *
 * Not the same list as the stages, and deliberately so. A stage is what you
 * are doing this minute; a status is what the piece is waiting for, which is
 * a thing you decide rather than something the application can work out. The
 * one that has no stage behind it is the important one: a draft that is
 * resting is doing something, and a desk that cannot say so pretends that
 * everything not being worked on has been abandoned.
 */
export const STATUSES = [
  { id: 'drafting',   label: 'Drafting' },
  { id: 'editing',    label: 'Editing' },
  { id: 'mellowing',  label: 'Letting it mellow' },
  { id: 'formatting', label: 'Formatting' },
  { id: 'sharing',    label: 'Done & sharing' },
];
const STATUS_IDS = new Set(STATUSES.map(s => s.id));
export const statusLabel = id =>
  STATUSES.find(s => s.id === id)?.label || STATUSES[0].label;

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

    draft: { sound: false, focus: true, goal: 0, panel: false },

    // Whether Edit shows the comments beside the writing. Off to begin with:
    // Edit is for writing, and the notes are there when you ask for them.
    // Comment always shows them, whatever this says.
    showComments: false,
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
    id: uid('d'),
    status: 'drafting',
    updatedAt: new Date().toISOString(),
    words: 0,
    title: 'Untitled',
    author: '',
    settings: defaultSettings(),
    // The stage you were on last. Coming back to a document should put you
    // where you left it, not at whichever stage happens to be second.
    stage: 'edit',
    draft: defaultDraft(),
    comments: [],
    sections: [
      {
        id: uid('s'),
        name: 'About Writing Desk',
        startsNewPage: false,
        html:
          '<h1>About Writing Desk</h1>' +
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
          'preview shows it, or markdown, or plain text.</p>' +
          '<p>Behind all five is <b>the desk</b>: the name in the top left ' +
          'takes you to everything you have written. This section is ours, ' +
          'not yours — delete it whenever you like, from the list on the ' +
          'left. Nothing here removes your writing on its own.</p>',
      },
    ],
  };
}

/**
 * A document with nothing in it.
 *
 * The base for anything read back from storage or handed to us from outside.
 * `defaultDoc` carries the introduction, and the introduction belongs to
 * exactly one document — the first one this application ever makes. A record
 * that arrives with no sections is an empty document, not an invitation to
 * put our own writing in it.
 */
export function blankDoc() {
  const doc = defaultDoc();
  doc.sections = [{ id: uid('s'), name: 'Opening', startsNewPage: false,
                    html: '<p><br></p>' }];
  return doc;
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
  const doc = blankDoc();
  doc.id = typeof saved.id === 'string' && saved.id ? saved.id : doc.id;
  doc.status = STATUS_IDS.has(saved.status) ? saved.status : doc.status;
  doc.updatedAt = saved.updatedAt || doc.updatedAt;
  doc.words = Number.isFinite(saved.words) ? saved.words : 0;
  doc.title = saved.title ?? doc.title;
  doc.author = saved.author ?? doc.author;
  doc.settings = merge(defaultSettings(), saved.settings);
  doc.draft = { ...defaultDraft(), ...(saved.draft || {}) };
  doc.comments = Array.isArray(saved.comments) ? saved.comments.map(normalizeComment) : [];
  doc.stage = STAGES.has(saved.stage) ? saved.stage : doc.stage;
  if (Array.isArray(saved.sections) && saved.sections.length) {
    doc.sections = saved.sections.map(normalizeSection);
  }
  return doc;
}

/** Words in a document, counted off its own markup. Stored so the desk can
 *  show a count without parsing every document it lists. */
export function wordsIn(doc) {
  const probe = document.createElement('div');
  let n = 0;
  for (const section of doc.sections) {
    probe.innerHTML = section.html;
    n += (probe.textContent.match(/\S+/g) || []).length;
  }
  return n;
}

// ---------------------------------------------------------------------------
// The library
//
// Documents live in IndexedDB, one record each. They used to be a single
// localStorage key, which was the right shape for one document and the wrong
// one for a shelf of them: the whole origin gets about five megabytes, every
// save re-serialises the lot, and there is nowhere to put a second.
//
// Only the id of the open document stays in localStorage, because it is the
// one thing that has to be known before anything can be read.
// ---------------------------------------------------------------------------

const CURRENT_KEY = 'writing-desk/current';

export function currentId() {
  try { return localStorage.getItem(CURRENT_KEY); } catch { return null; }
}
export function setCurrentId(id) {
  try { localStorage.setItem(CURRENT_KEY, id); } catch {}
}

/**
 * Whether the desk was the last thing you were looking at.
 *
 * Not a property of a document — you were not in one — so it sits beside the
 * pointer rather than inside a record. The stage you were on is remembered per
 * document, because that is a fact about the document.
 */
const AT_DESK_KEY = 'writing-desk/at-desk';

export function atDesk() {
  try { return localStorage.getItem(AT_DESK_KEY) === '1'; } catch { return false; }
}
export function setAtDesk(on) {
  try {
    if (on) localStorage.setItem(AT_DESK_KEY, '1');
    else localStorage.removeItem(AT_DESK_KEY);
  } catch {}
}

/**
 * Ask the browser to stop treating this origin as disposable.
 *
 * Storage a browser hands out by default is "best-effort", which is the polite
 * name for evictable: one short of disk clears it, and Safari clears it for
 * any site you have not opened in a week. Persistent storage is exempt from
 * both. It is not proof against somebody clearing site data by hand — nothing
 * a browser holds is — but that is a decision rather than an accident.
 *
 * Chrome answers silently, out of how much you seem to use the place. Firefox
 * asks the reader, and that is the reason this is not called at boot: the
 * first thing on the desk is an introduction nobody wrote, and a permission
 * prompt about that is a question about nothing. It waits for a save.
 *
 * Asked once per page load at most. A browser that says no has said no.
 */
let persistence = null;
export function requestPersistence() {
  if (persistence) return persistence;
  persistence = (async () => {
    if (!navigator.storage?.persist) return false;
    try {
      return await navigator.storage.persisted() || await navigator.storage.persist();
    } catch {
      return false;
    }
  })();
  return persistence;
}

/**
 * Strip the parts that are derived, and stamp the ones that are not.
 *
 * `restamp` is off for a document arriving from the folder. Its `updatedAt`
 * belongs to the machine that wrote it, and taking that away is not a
 * cosmetic loss: it is the only thing by which two desks sharing a folder can
 * tell whose copy is the later one. Re-stamping on arrival would make every
 * document this desk received look newer than the one it came from, so the
 * other desk would take it back, restamp it in turn, and the two would pass
 * the same document between them for as long as both were open.
 */
function forStorage(doc, { restamp = true } = {}) {
  return {
    ...doc,
    updatedAt: restamp || !doc.updatedAt ? new Date().toISOString() : doc.updatedAt,
    words: wordsIn(doc),
  };
}

export async function listDocuments() {
  const all = await tx('documents', 'readonly', store => store.getAll());
  return (all || [])
    .map(adoptShape)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function readDocument(id) {
  const raw = await tx('documents', 'readonly', store => store.get(id));
  return raw ? adoptShape(raw) : null;
}

export async function writeDocument(doc, opts) {
  const record = forStorage(doc, opts);
  doc.updatedAt = record.updatedAt;
  doc.words = record.words;
  await tx('documents', 'readwrite', store => store.put(record, record.id));
  return record;
}

/** A document and everything filed under it. There is no undo. */
export async function deleteDocument(id) {
  await tx('documents', 'readwrite', store => store.delete(id));
  for (const rec of await allImages()) {
    if (rec.docId === id) await deleteImage(rec.id);
  }
}

export function newDocument({ title = 'Untitled' } = {}) {
  const doc = blankDoc();
  doc.title = title;
  return doc;
}

/**
 * Open the document that was open last, or make the first one.
 *
 * Also the moment a single-document install becomes a library: whatever was
 * in the old localStorage key is written into the shelf and the key is
 * renamed rather than deleted, so a migration that goes wrong is recoverable
 * by hand instead of being somebody's writing.
 */
export async function openCurrent() {
  await migrate();

  const id = currentId();
  if (id) {
    const found = await readDocument(id);
    if (found) return found;
  }

  const all = await listDocuments();
  if (all.length) { setCurrentId(all[0].id); return all[0]; }

  const first = defaultDoc();
  await writeDocument(first);
  setCurrentId(first.id);
  return first;
}

const LEGACY_KEY = 'writing-desk/doc/v1';

async function migrate() {
  let raw = null;
  try { raw = localStorage.getItem(LEGACY_KEY); } catch { return; }
  if (!raw) return;

  try {
    const doc = adoptShape(JSON.parse(raw));
    await writeDocument(doc);
    setCurrentId(doc.id);
    // Every picture in the store belonged to the one document there was.
    for (const rec of await allImages()) {
      if (!rec.docId) await putImage(rec.id, { ...rec.value, docId: doc.id });
    }
    localStorage.setItem(`${LEGACY_KEY}.migrated`, raw);
    localStorage.removeItem(LEGACY_KEY);
  } catch (err) {
    console.warn('could not move the old document into the library', err);
  }
}

let saveTimer = null;
export function save(doc, { now = false } = {}) {
  clearTimeout(saveTimer);
  const write = () => {
    writeDocument(doc).catch(err => console.warn('could not save', err));
  };
  if (now) write(); else saveTimer = setTimeout(write, 400);
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

// The name still says images because that is what any picture already on this
// machine is filed under. It holds the documents too now. Renaming a database
// somebody's work is already in would strand the work; the cost of a slightly
// wrong name is that somebody reads this comment.
const DB_NAME = 'writing-desk-images';
const DB_VERSION = 3;
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('images')) d.createObjectStore('images');
        if (!d.objectStoreNames.contains('documents')) d.createObjectStore('documents');
        // Directory handles, for the folder on disk. They live here rather
        // than anywhere tidier because a handle is one of the few things only
        // IndexedDB can hold: it does not survive JSON.
        if (!d.objectStoreNames.contains('handles')) d.createObjectStore('handles');
      };
      req.onsuccess = () => {
        const d = req.result;
        // Let go when another tab needs to upgrade.
        //
        // A version bump cannot happen while an older connection is still
        // open, and a browser does not force the issue: it fires this at the
        // old tab and waits. A tab that ignores it holds every other tab on
        // the loading screen, with no error anywhere, until it is closed. So
        // this one steps aside, and takes the shared promise with it so the
        // next read opens a fresh connection at the new version.
        d.onversionchange = () => { d.close(); dbPromise = null; };
        resolve(d);
      };
      req.onerror = () => reject(req.error);
      // Reached when the tab holding the old version predates the handler
      // above and will not let go. Nothing can be done from here, but failing
      // is still better than the wait, which never ends.
      req.onblocked = () => {
        dbPromise = null;
        reject(new Error('Another tab has this desk open on an older version. ' +
                         'Close it and reload.'));
      };
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

export async function putImage(id, record) { return tx('images', 'readwrite', s => s.put(record, id)); }
export async function getImage(id)         { return tx('images', 'readonly',  s => s.get(id)); }
export async function allImageIds()        { return tx('images', 'readonly',  s => s.getAllKeys()); }
export async function deleteImage(id)      { return tx('images', 'readwrite', s => s.delete(id)); }

export async function putHandle(key, value) { return tx('handles', 'readwrite', s => s.put(value, key)); }
export async function getHandle(key)        { return tx('handles', 'readonly',  s => s.get(key)); }
export async function deleteHandle(key)     { return tx('handles', 'readwrite', s => s.delete(key)); }

/** Every picture with its id and the document it belongs to. */
export async function allImages() {
  const [ids, values] = await Promise.all([
    tx('images', 'readonly', s => s.getAllKeys()),
    tx('images', 'readonly', s => s.getAll()),
  ]);
  return (ids || []).map((id, i) => ({ id, docId: values[i]?.docId || null, value: values[i] }));
}

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

export async function unpackImages(images, docId = null) {
  for (const [id, rec] of Object.entries(images || {})) {
    await putImage(id, {
      blob: await dataURLToBlob(rec.data), w: rec.w, h: rec.h,
      name: rec.name || '', docId,
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
  const doc = adoptShape(bundle.doc);
  await unpackImages(bundle.images, doc.id);
  return doc;
}

/**
 * Drop pictures this document no longer references. Runs after an edit
 * settles.
 *
 * Scoped to the one document, which is the whole reason images carry a
 * `docId`. Before there was a library this swept everything the open document
 * did not use — which, with a second document on the shelf, is a function that
 * deletes the other one's pictures every time you open this one.
 */
export async function collectGarbage(doc) {
  const used = referencedImages(doc);
  const mine = (await allImages()).filter(rec => rec.docId === doc.id);
  await Promise.all(mine.filter(rec => !used.has(rec.id)).map(rec => {
    const url = urlCache.get(rec.id);
    if (url) { URL.revokeObjectURL(url); urlCache.delete(rec.id); }
    return deleteImage(rec.id);
  }));
}
