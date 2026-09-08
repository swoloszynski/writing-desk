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
// It reads as well as writes. A folder inside iCloud Drive or Dropbox is the
// same folder on two machines, so the files in it are not always ones this
// browser put there: they arrive from the desk you were sitting at yesterday.
// Connecting to a folder therefore means taking in what is already in it, and
// noticing later when something in it changes underneath us. See scan().
//
// What this deliberately is not is a merge. Two devices that edit the same
// document while apart have produced two documents, and no amount of
// timestamp arithmetic turns them back into one. When that happens both are
// kept and the reader is told. Losing the quieter of the two silently is the
// one outcome worth writing this much code to avoid.
//
// Chromium desktop only, because it is the only engine that implements the
// directory picker. Everywhere else this reports itself unsupported and the
// interface offers the .json download instead, which is the same file arrived
// at by hand.

import * as Doc from './doc.js';

const HANDLE_KEY = 'folder';

/**
 * The picked directory, and what we last wrote for each document.
 *
 * A mark is `{ name, updatedAt }`: the file a document lives in, and the
 * version of the document that file was last known to hold. The second half
 * is what makes it possible to tell "the folder is ahead of me" from "I am
 * ahead of the folder" from "we have both moved", which is the difference
 * between syncing and losing an afternoon.
 */
let dir = null;
let marks = {};
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
    // Before there was reading there was only a filename per document. An
    // upgraded install has those, and a mark with no version behind it is
    // treated as one we cannot vouch for, which is exactly what it is.
    marks = {};
    for (const [id, was] of Object.entries(saved.names || saved.marks || {})) {
      marks[id] = typeof was === 'string' ? { name: was, updatedAt: null } : was;
    }
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
  marks = {};
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
  marks = {};
  state = 'off';
  lastError = '';
  try { await Doc.deleteHandle(HANDLE_KEY); } catch {}
  return status();
}

/** The file a document is being written to, if it has one yet. */
export const fileNameFor = docId => marks[docId]?.name || null;

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
  const name = marks[docId]?.name;
  if (!name) return false;

  let gone = false;
  if (state === 'ready' && dir) {
    try { await dir.removeEntry(name); gone = true; }
    catch (err) { console.warn('could not remove the file', err); }
  }
  delete marks[docId];
  await remember();
  return gone;
}

async function remember() {
  try { await Doc.putHandle(HANDLE_KEY, { dir, marks }); } catch {}
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
    const had = marks[doc.id]?.name;
    if (had && had !== name) {
      try { await dir.removeEntry(had); } catch {}
    }
    // The version that is now on disk. Every later scan reads this to decide
    // whether a file has moved on without us.
    marks[doc.id] = { name, updatedAt: doc.updatedAt || null };
    await remember();

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

// ---------------------------------------------------------------------------
// Reading the folder
//
// A folder in iCloud Drive or Dropbox is the same folder on two machines, so
// what is in it is not only what this browser put there. Connecting to one has
// to mean taking in what is already there, and looking again afterwards.
// ---------------------------------------------------------------------------

const SUFFIX = '.writing-desk.json';

async function readBundle(handle) {
  try {
    const bundle = JSON.parse(await (await handle.getFile()).text());
    // Anything else in the folder is somebody else's business.
    return bundle?.doc?.id ? bundle : null;
  } catch (err) {
    console.warn(`could not read ${handle.name}`, err);
    return null;
  }
}

/**
 * Bring the folder and the shelf into line.
 *
 * For each file, three timestamps decide what happens: the version in the
 * file, the version on this desk, and the version this desk last wrote to
 * that file. The third is the one that matters. Without it you can only ask
 * which copy is newer, and answering that question alone is how sync tools
 * quietly delete work: the older copy is not always the one with less in it.
 *
 *   nothing here with that id   the file is a document this desk has not seen
 *   same version both sides     nothing to do
 *   only the file has moved     take it
 *   only this desk has moved    write it out
 *   both have moved             leave both alone and say so
 *
 * The last case is a genuine fork and is not resolved here. Two people, or
 * one person on two machines, have written two different documents that used
 * to be one, and picking a winner by clock is a coin toss with somebody's
 * afternoon. Both files stay, both desks keep what they have, and the strip
 * on the desk says which documents are in that state.
 */
export async function scan({ current = null } = {}) {
  if (state !== 'ready' || !dir) return null;
  if (writing) return null;
  writing = true;

  const out = { added: 0, pulled: 0, pushed: 0, conflicts: [], touched: new Set() };
  try {
    const local = new Map((await Doc.listDocuments()).map(d => [d.id, d]));
    // The open document is up to four seconds ahead of its own record.
    if (current) local.set(current.id, current);

    const seen = new Set();

    for await (const handle of dir.values()) {
      if (handle.kind !== 'file' || !handle.name.endsWith(SUFFIX)) continue;

      const bundle = await readBundle(handle);
      if (!bundle) continue;

      const id = bundle.doc.id;
      seen.add(id);
      const fileAt = bundle.doc.updatedAt || null;
      const mine = local.get(id);
      const markAt = marks[id]?.updatedAt ?? null;

      // Another desk may have retitled it, which renames the file. Believe
      // the folder about where the document lives before writing anything,
      // or the next write lands beside it instead of on it.
      if (mine) marks[id] = { name: handle.name, updatedAt: markAt };

      if (!mine) {
        const doc = await Doc.deserialize(bundle);
        await Doc.writeDocument(doc, { restamp: false });
        marks[id] = { name: handle.name, updatedAt: doc.updatedAt || fileAt };
        out.added++;
        out.touched.add(id);
        continue;
      }

      if (fileAt && mine.updatedAt && fileAt === mine.updatedAt) continue;

      const theyMoved = fileAt !== markAt;
      const weMoved = (mine.updatedAt || null) !== markAt;

      if (theyMoved && weMoved) {
        out.conflicts.push({ id, title: mine.title || 'Untitled', file: handle.name });
      } else if (theyMoved) {
        const doc = await Doc.deserialize(bundle);
        await Doc.writeDocument(doc, { restamp: false });
        marks[id] = { name: handle.name, updatedAt: doc.updatedAt || fileAt };
        out.pulled++;
        out.touched.add(id);
      } else if (weMoved) {
        if (await writeOne(mine)) out.pushed++;
      }
    }

    // Anything on the shelf the folder has no file for. Two ways to get here:
    // a document made since the last write, and a file somebody deleted from
    // the folder by hand or from another machine.
    //
    // Both are written out, which means a deletion made elsewhere does not
    // travel — the other desk will simply be given the document back. That is
    // the deliberate choice. A folder whose files have not finished syncing
    // down is indistinguishable from a folder somebody emptied, and a rule
    // that deleted to match would clear the shelf on a slow morning.
    for (const [id, mine] of local) {
      if (seen.has(id)) continue;
      if (await writeOne(mine)) out.pushed++;
    }

    await remember();
    return out;
  } catch (err) {
    console.warn('could not read the folder', err);
    lastError = err?.message || String(err);
    if (err?.name === 'NotAllowedError') state = 'blocked';
    return out;
  } finally {
    writing = false;
  }
}
