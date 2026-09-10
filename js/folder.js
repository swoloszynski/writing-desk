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

/**
 * Ask again for a folder already chosen. Must be called from a click.
 *
 * The obvious way to do this is requestPermission() on the handle we already
 * have, and it is wrong. Chromium answers that with its restore prompt, and
 * that prompt lists every folder this origin was ever given — including the
 * one somebody changed away from months ago, which the browser goes on
 * remembering and no page can make it forget. Offering to reopen a folder
 * nobody asked about, at the moment they asked about a different one, reads
 * as the desk having quietly kept it.
 *
 * So: open the picker on the folder we mean. It asks about that folder and no
 * others, and picking it is itself the grant. Cancelling throws AbortError,
 * which is a reader saying no and not a fault. If a different folder comes
 * back they have changed their mind, which is choose() by another door — the
 * marks belong to the old folder and go with it.
 */
export async function reconnect() {
  if (!dir) return status();

  const was = dir;
  const picked = await window.showDirectoryPicker({
    id: 'writing-desk',
    mode: 'readwrite',
    startIn: was,
  });
  let same = false;
  try { same = await was.isSameEntry(picked); } catch {}

  dir = picked;
  if (!same) marks = {};
  // Freshly picked, so this handle is not one of the dormant ones and asking
  // again — should the pick alone not have carried write access — brings up
  // the ordinary single-folder prompt.
  let granted = await picked.queryPermission({ mode: 'readwrite' });
  if (granted !== 'granted') granted = await picked.requestPermission({ mode: 'readwrite' });
  state = granted === 'granted' ? 'ready' : 'blocked';
  lastError = '';
  await remember();
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

    // The bytes, and the version the bytes are of, read in one breath.
    //
    // The document being written is the live one — the same object the editor
    // types into and the 400ms save restamps — and everything below this line
    // waits on a disk. Ask it for its version again after the file has closed
    // and the answer can be a version that never went out, which leaves the
    // mark vouching for something the folder does not hold. The next scan
    // finds the file behind the mark, calls that a change made somewhere else,
    // and hands back a document edited in two places by one person sitting at
    // one machine.
    const text = JSON.stringify(bundle, null, 1);
    const stamp = bundle.doc.updatedAt || null;

    // createWritable writes to a scratch file and swaps it in on close, so a
    // crash halfway through leaves the previous copy rather than half of this
    // one.
    const file = await dir.getFileHandle(name, { create: true });
    const out = await file.createWritable();
    await out.write(text);
    await out.close();

    // A retitled document is a differently named file, and leaving the old one
    // behind would quietly turn one document into two.
    const had = marks[doc.id]?.name;
    if (had && had !== name) {
      try { await dir.removeEntry(had); } catch {}
    }
    // The version that is now on disk. Every later scan reads this to decide
    // whether a file has moved on without us.
    marks[doc.id] = { name, updatedAt: stamp };
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

/**
 * The parts of a document that are the writing, rather than a note about it.
 *
 * `updatedAt` and `words` are about the document and not in it; `stage` is
 * where somebody was sitting when they left, which is worth restoring and not
 * worth keeping a second copy of a novel over.
 */
const WRITING = ['title', 'author', 'status', 'settings', 'draft', 'comments',
                 'sections'];

/** Two documents flattened for comparison. Key order is nobody's business,
 *  and two desks need not have arrived at the same one, so it is sorted away. */
const plainly = doc => JSON.stringify(
  Object.fromEntries(WRITING.map(k => [k, doc[k]])),
  (_, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
    : v));

/**
 * Do these two say the same thing, and differ only in when they were stamped?
 *
 * The fork test below is a test of clocks, and the clocks are the part of this
 * that goes wrong. A mark not written down before the tab was closed, a mark
 * cleared by picking the folder again, a mark for a document that predates
 * marks having versions at all — each of those leaves two timestamps
 * disagreeing about a document that nobody has edited twice, and answering
 * that with a second copy is how one document becomes six by Thursday.
 *
 * So before keeping both, read both. Two versions that say the same thing are
 * one version, whatever their clocks claim.
 */
const sameWriting = (a, b) => plainly(a) === plainly(b);

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
 *   both have moved             keep both, as two documents
 *
 * The last case is a genuine fork: two people, or one person on two machines,
 * have written two different documents that used to be one. Picking a winner
 * by clock is a coin toss with somebody's afternoon, so nothing is thrown
 * away — the folder's version continues as the document, and what was on this
 * desk is kept beside it under its own name. Messy, and better than the
 * alternative, which is tidy and loses an afternoon.
 */
export async function scan({ current = null } = {}) {
  if (state !== 'ready' || !dir) return null;
  if (writing) return null;
  writing = true;

  const out = { added: 0, pulled: 0, pushed: 0, copies: [], touched: new Set() };
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
        const doc = await Doc.deserialize(bundle);

        // Both clocks have moved and neither document has. Nothing happened
        // here worth a second copy; the two sides only lost track of which
        // version the file held. Write ours out, which settles the file and
        // the mark on one version again, and say nothing about it.
        if (sameWriting(doc, mine)) {
          if (await writeOne(mine)) out.pushed++;
          continue;
        }

        // A fork: two documents that used to be one. Both are kept, and which
        // one keeps the original identity is not a matter of taste — it is
        // what stops the two desks trading copies for ever.
        //
        // The folder's version is taken into the existing document, so this
        // desk and the file agree again and the next look finds nothing to
        // do. What was here is preserved as a new document with a new id,
        // which is written out as a new file the other desk will simply take
        // in. Do it the other way round — keep ours under the old id and push
        // it — and the other desk sees its own document overwritten, forks in
        // turn, and the two of them make copies until somebody closes a lid.
        const kept = structuredClone(mine);
        kept.id = Doc.newDocument().id;
        kept.title = `${mine.title || 'Untitled'} (other version)`;
        await Doc.writeDocument(kept, { restamp: false });
        out.copies.push({ title: kept.title, from: mine.title || 'Untitled' });
        out.touched.add(kept.id);

        await Doc.writeDocument(doc, { restamp: false });
        marks[id] = { name: handle.name, updatedAt: doc.updatedAt || fileAt };
        out.touched.add(id);
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
