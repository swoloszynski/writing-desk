// The folder.
//
// Everything else the desk keeps is inside one browser profile, and a browser
// profile is a thing people clear. Persistent storage makes that harder and an
// installed application makes it harder again, but neither makes it a
// different kind of thing: it is still the browser's drawer, and the browser
// still owns the drawer.
//
// So: a folder on the actual disk, chosen once. From then on every save writes
// the whole document — words, pictures, comments, settings — into a file you
// can see in the Finder, back up, and open on a machine that has never heard
// of this application. If the drawer is emptied tomorrow the folder is still
// there. That is the entire idea.
//
// Chromium desktop only, because it is the only engine that implements the
// directory picker. Everywhere else this reports itself unsupported and the
// interface offers the .json download instead, which is the same file arrived
// at by hand.

import * as Doc from './doc.js';

const HANDLE_KEY = 'folder';

/** The picked directory, and the filename last written for each document. */
let dir = null;
let names = {};
let loaded = false;

/** 'unsupported' | 'off' | 'ready' | 'blocked' — see status(). */
let state = 'off';
let lastError = '';

export const supported = () =>
  typeof window.showDirectoryPicker === 'function' && window.isSecureContext;

/**
 * What to tell the reader.
 *
 *   unsupported  this browser has no directory picker
 *   off          no folder chosen
 *   ready        chosen, permitted, being written to
 *   blocked      chosen, but the permission needs granting again
 *
 * `blocked` is the ordinary state on a fresh page load rather than a fault.
 * A browser will not hand back write access to a folder without a gesture
 * from the reader, so a tab that has only been reloaded has a handle it
 * cannot yet use, and something has to say so.
 */
export function status() {
  return { state, name: dir?.name || '', error: lastError };
}

/** Read the remembered handle and see where we stand. Never prompts. */
export async function resume() {
  if (loaded) return status();
  loaded = true;
  if (!supported()) { state = 'unsupported'; return status(); }

  try {
    const saved = await Doc.getHandle(HANDLE_KEY);
    if (!saved?.dir) return status();
    dir = saved.dir;
    names = saved.names || {};
    state = await dir.queryPermission({ mode: 'readwrite' }) === 'granted'
      ? 'ready' : 'blocked';
  } catch (err) {
    // A handle whose folder has been deleted or whose disk is not mounted
    // throws on the first question asked of it. Not an error worth shouting
    // about; it just means there is no folder.
    console.warn('could not pick up the folder again', err);
    dir = null;
    state = 'off';
  }
  return status();
}

/** Ask for a folder. Must be called from a click. */
export async function choose() {
  if (!supported()) { state = 'unsupported'; return status(); }
  const picked = await window.showDirectoryPicker({
    id: 'writing-desk',        // the browser reopens where it left off
    mode: 'readwrite',
    startIn: 'documents',
  });
  dir = picked;
  names = {};
  state = 'ready';
  lastError = '';
  await remember();
  return status();
}

/** Ask again for a folder already chosen. Must be called from a click. */
export async function reconnect() {
  if (!dir) return status();
  const granted = await dir.requestPermission({ mode: 'readwrite' });
  state = granted === 'granted' ? 'ready' : 'blocked';
  return status();
}

export async function forget() {
  dir = null;
  names = {};
  state = 'off';
  lastError = '';
  try { await Doc.deleteHandle(HANDLE_KEY); } catch {}
  return status();
}

/** The file a document is being written to, if it has one yet. */
export const fileNameFor = docId => names[docId] || null;

/**
 * Delete the file a document was being written to.
 *
 * Called when the document itself is deleted, so that the folder stays a
 * picture of the shelf rather than an attic. The mapping goes either way —
 * a file that could not be removed is one nothing points at any more, and
 * leaving the name behind would only make the next retitle try to delete a
 * file belonging to a document that no longer exists.
 */
export async function remove(docId) {
  const name = names[docId];
  if (!name) return false;

  let gone = false;
  if (state === 'ready' && dir) {
    try { await dir.removeEntry(name); gone = true; }
    catch (err) { console.warn('could not remove the file', err); }
  }
  delete names[docId];
  await remember();
  return gone;
}

async function remember() {
  try { await Doc.putHandle(HANDLE_KEY, { dir, names }); } catch {}
}

const fileFor = doc => `${
  (doc.title || 'document').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document'
}.writing-desk.json`;

// One write at a time, and never a queue of them. If a save lands while a
// write is in flight the newest document wins and the ones in between are not
// worth the disk they would cost.
let writing = false;
let again = null;

/**
 * Write the document into the folder.
 *
 * Debounced well behind the ordinary save: IndexedDB takes a keystroke every
 * 400ms without noticing, but this serialises every picture in the document
 * into a data URL, and doing that between words would be felt.
 */
let timer = null;
export function schedule(doc, { now = false } = {}) {
  if (state !== 'ready') return;
  clearTimeout(timer);
  if (now) write(doc);
  else timer = setTimeout(() => write(doc), 4000);
}

export async function write(doc) {
  if (state !== 'ready' || !dir) return false;
  if (writing) { again = doc; return false; }
  writing = true;
  try {
    return await writeOne(doc);
  } finally {
    writing = false;
    const next = again;
    again = null;
    if (next) write(next);
  }
}

/**
 * Write every document on the shelf.
 *
 * The folder is a property of the library, not of whichever document happens
 * to be open, so choosing one has to mean all of them. Anything less is the
 * worst version of this feature: a reader who has pointed the desk at a folder
 * believes the work is on disk, and four fifths of it is not.
 *
 * The open document is passed in separately because the copy in the database
 * is up to 400ms behind the one being typed into.
 */
export async function writeAll(current = null) {
  if (state !== 'ready' || !dir) return 0;
  if (writing) return 0;
  writing = true;
  try {
    let n = 0;
    for (const rec of await Doc.listDocuments()) {
      if (await writeOne(current?.id === rec.id ? current : rec)) n++;
    }
    return n;
  } finally {
    writing = false;
  }
}

async function writeOne(doc) {
  try {
    const name = fileFor(doc);
    const bundle = await Doc.serialize(doc);

    // createWritable writes to a scratch file and swaps it in on close, so a
    // crash halfway through leaves the previous copy rather than half of this
    // one.
    const file = await dir.getFileHandle(name, { create: true });
    const out = await file.createWritable();
    await out.write(JSON.stringify(bundle, null, 1));
    await out.close();

    // A retitled document is a differently named file, and leaving the old one
    // behind would quietly turn one document into two.
    const had = names[doc.id];
    if (had && had !== name) {
      try { await dir.removeEntry(had); } catch {}
    }
    if (had !== name) { names[doc.id] = name; await remember(); }

    lastError = '';
    return true;
  } catch (err) {
    // The folder has been moved, or the permission withdrawn from under us.
    console.warn('could not write to the folder', err);
    lastError = err?.message || String(err);
    if (err?.name === 'NotAllowedError') state = 'blocked';
    return false;
  }
}
