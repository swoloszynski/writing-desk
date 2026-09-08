// Wiring.
//
// Two rules hold this together.
//
// The first is inherited from the press it grew out of: there is exactly one
// laid-out copy of the document — the editor's galley — and the seams, the
// page grid, the sheets and the PDF are all that column plus a list of page
// offsets. Nothing lays the text out twice, so nothing can disagree.
//
// The second is that the six stages along the top are views of one document,
// not six documents. Drafting writes into `doc.draft`; taking a draft to Edit
// turns it into sections and empties the buffer; commenting adds notes beside
// the sections without touching them. Whatever stage you are looking at, the
// thing being saved is the same object.

import * as Doc from './doc.js';
import { installFontFaces, loadAllFonts } from './fonts.js';
import { applyFlowCSS, flowCSS } from './flow.js';
import { paginate } from './paginate.js';
import { Editor, sanitize } from './editor.js';
import { installMarkdownInput } from './markdown-input.js';
import { renderSeams, renderReadingOrder, renderSheets } from './preview.js';
import { buildSettingsRail, buildFields, PRESS_SCHEMA, DRAFT_SCHEMA } from './settings-ui.js';
import { impose } from './imposition.js';
import { clearMetricCache } from './extract.js';
import { buildPDF, download, downloadBlob } from './pdf.js';
import { zip } from './zip.js';
import { toMarkdown, fromMarkdown, lossyParts, blocksFromMarkdown } from './markdown.js';
import { Draft, draftToSections, countWords } from './draft.js';
import * as Notes from './comments.js';
import * as Share from './share.js';

const $ = sel => document.querySelector(sel);

/** What the browser tab says. The application first, so a row of tabs is
 *  scannable by what they are before it is scannable by which one. */
const pageTitle = title => `Writing Desk: ${(title || 'Untitled').trim() || 'Untitled'}`;
const $$ = sel => Array.from(document.querySelectorAll(sel));

const doc = Doc.defaultDoc();
let offsets = [0];
let view = 'edit';
let reviewing = false;
let activeComment = null;
let commentFilter = 'open';
let syncSettings = () => {};

/**
 * Write to disk — unless this is somebody else's draft.
 *
 * A borrowed draft is opened into the same objects the editor already uses,
 * which is what makes it render, paginate and export like any other. What it
 * must not do is land in localStorage on top of the reader's own work, so the
 * one route to storage goes through here.
 */
function save(opts) {
  if (!reviewing) Doc.save(doc, opts);
}

const flow = $('#flow');
const paper = $('#paper');
const seams = $('#seams');
const marks = $('#marks');
const editor = new Editor(flow, doc);

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Size the paper column so the galley sits inside real margins. */
function layoutPaper() {
  const m = Doc.metrics(doc.settings);
  // On folded paper the spine alternates sides, and a single continuous
  // column cannot do that, so the editor splits the difference and the true
  // inside and outside margins show up in the page previews. On unfolded
  // paper there is nothing to split: the margins are simply the margins.
  const padX = m.folded ? (m.marginInside + m.marginOutside) / 2 : null;
  paper.style.width = `${m.pageW}px`;
  paper.style.padding = padX === null
    ? `${m.marginTop}px ${m.marginOutside}px ${m.marginBottom}px ${m.marginInside}px`
    : `${m.marginTop}px ${padX}px ${m.marginBottom}px`;
  seams.style.top = `${m.marginTop}px`;
  seams.style.bottom = `${m.marginBottom}px`;
}

let paginateTimer = null;
function schedule({ structural = false } = {}) {
  clearTimeout(paginateTimer);
  paginateTimer = setTimeout(repaginate, structural ? 0 : 110);
}

/**
 * Where the pages break.
 *
 * A forced break used to swell to the whole unused rest of its page, so the
 * editor showed that empty space exactly as it would be printed. It was
 * truthful and it read badly: half a page of nothing in the middle of the
 * column you are writing in cuts the thread, and you have to scroll past your
 * own blank paper to reach the next paragraph. So the break is a modest gap
 * here, and Format is where the real space is shown — looking at pages is
 * that stage's whole job.
 *
 * Pagination is unaffected either way. A break ends its page because it is a
 * break, not because of how tall it is, and the previews window into the
 * galley by offset — so a page that ended early simply has less in its
 * window, which is what an early ending means.
 */
function repaginate() {
  const m = Doc.metrics(doc.settings);
  offsets = paginate(flow, m.contentH).offsets;

  renderSeams(seams, offsets, doc.settings);
  paintMarks();
  paintStats();
  paintSectionPages();

  if (view === 'format') paintPageGrid();
  if (view === 'save') paintSave();

  save();
}

function wordCount() {
  return doc.sections.reduce((n, s) => {
    const probe = document.createElement('div');
    probe.innerHTML = s.html;
    return n + countWords(probe.textContent);
  }, 0);
}

function paintStats() {
  const open = Notes.openCount(doc);
  const pages = offsets.length;
  const words = wordCount();
  const bits = [
    `<b>${words.toLocaleString()}</b> word${words === 1 ? '' : 's'}`,
    `<b>${pages}</b> page${pages === 1 ? '' : 's'}`,
  ];
  if (Doc.isFolded(doc.settings)) {
    const { padded } = impose(pages);
    bits.push(`<b>${padded / 4}</b> sheet${padded / 4 === 1 ? '' : 's'}`);
  }
  $('#stats').innerHTML = bits.join(' · ');

  const badge = $('#tab-comments');
  badge.hidden = open === 0;
  badge.textContent = String(open);
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function sectionPageRange(id) {
  const el = flow.querySelector(`.wd-section[data-id="${id}"]`);
  if (!el) return null;
  const base = flow.getBoundingClientRect().top;
  const r = el.getBoundingClientRect();
  const pageOf = y => {
    let p = 0;
    for (let i = 0; i < offsets.length; i++) if (y >= offsets[i] - 0.5) p = i;
    return p + 1;
  };
  const top = pageOf(r.top - base);
  return [top, Math.max(top, pageOf(r.bottom - base - 1))];
}

function paintSectionPages() {
  for (const el of $$('.sec')) {
    const range = sectionPageRange(el.dataset.id);
    const out = el.querySelector('.sec-pages');
    if (!out) continue;
    out.textContent = !range ? ''
      : range[0] === range[1] ? `p. ${range[0]}` : `pp. ${range[0]}–${range[1]}`;
  }
}

let dragId = null;

function sectionCard(s, { where = 'edit' } = {}) {
  const el = document.createElement('div');
  el.className = 'sec';
  el.dataset.id = s.id;
  el.draggable = !reviewing;
  el.innerHTML = `
    <div class="sec-top">
      <span class="sec-grip">⣿</span>
      <input class="sec-name" value="" spellcheck="false">
      <button class="sec-del" title="Delete section">✕</button>
    </div>
    <div class="sec-meta">
      <label><input type="checkbox" class="sec-new"> Start on a new page</label>
      <span class="sec-pages"></span>
    </div>`;

  const name = el.querySelector('.sec-name');
  name.value = s.name;
  name.readOnly = reviewing;
  name.addEventListener('input', () => { s.name = name.value; save(); });
  name.addEventListener('pointerdown', () => { el.draggable = false; });
  name.addEventListener('blur', () => { el.draggable = !reviewing; });

  const nu = el.querySelector('.sec-new');
  nu.checked = s.startsNewPage;
  nu.addEventListener('change', () => {
    s.startsNewPage = nu.checked;
    renderGalley();
    renderSectionLists();
  });

  el.querySelector('.sec-del').addEventListener('click', async e => {
    e.stopPropagation();
    if (doc.sections.length === 1) return toast('A document needs at least one section.');
    const words = countWords(new DOMParser()
      .parseFromString(s.html, 'text/html').body.textContent);
    const ok = await ask({
      title: `Delete “${s.name}”?`,
      body: `${words} word${words === 1 ? '' : 's'} go with it, and there is no undo. ` +
            'Comments on this section are kept, marked as pointing at writing that ' +
            'is no longer here.',
      yes: 'Delete the section', danger: true,
    });
    if (!ok) return;
    doc.sections = doc.sections.filter(x => x.id !== s.id);
    // Notes on a section that no longer exists have nothing to point at. They
    // are kept and marked, not deleted: somebody wrote them.
    doc.comments.forEach(c => { if (c.sectionId === s.id) c.orphaned = true; });
    renderGalley();
    renderSectionLists();
    paintThreads();
    Doc.collectGarbage(doc);
  });

  el.addEventListener('click', e => {
    // A click on one of the card's own controls is not a click on the card.
    // Without this, clicking into the name field selected the text and then
    // lost it half a frame later: the click bubbled up here, and focusing the
    // galley took the selection with it.
    if (e.target.closest('input, button, select, label')) return;

    markActive(s.id);

    // In Format you are looking at pages, and a click here is asking which
    // ones this section is on — not asking to be taken away to the editor.
    if (where === 'format') { showSectionPages(s.id); return; }

    const target = flow.querySelector(`.wd-section[data-id="${s.id}"]`);
    if (!target) return;
    switchView('edit');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (!reviewing) editor.focusIn(target);
  });

  el.addEventListener('dragstart', e => {
    dragId = s.id;
    el.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', s.id);
  });
  el.addEventListener('dragend', () => {
    dragId = null;
    $$('.sec').forEach(x => x.classList.remove('is-dragging', 'is-over'));
  });
  el.addEventListener('dragover', e => {
    if (!dragId || dragId === s.id) return;
    e.preventDefault();
    el.classList.add('is-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('is-over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('is-over');
    if (!dragId || dragId === s.id) return;
    const from = doc.sections.findIndex(x => x.id === dragId);
    const to = doc.sections.findIndex(x => x.id === s.id);
    if (from < 0 || to < 0) return;
    const [moved] = doc.sections.splice(from, 1);
    doc.sections.splice(to, 0, moved);
    renderGalley();
    renderSectionLists();
  });

  return el;
}

function renderSectionLists() {
  for (const [host, where] of [[$('#section-list'), 'edit'],
                               [$('#section-list-2'), 'format']]) {
    host.textContent = '';
    doc.sections.forEach(s => host.appendChild(sectionCard(s, { where })));
  }
  paintSectionPages();
}

function markActive(id) {
  $$('.sec').forEach(el => el.classList.toggle('is-active', el.dataset.id === id));
}

function addSection() {
  const s = {
    id: Doc.uid('s'),
    name: `Section ${doc.sections.length + 1}`,
    startsNewPage: true,
    html: '<p><br></p>',
  };
  doc.sections.push(s);
  renderGalley();
  renderSectionLists();
  editor.focusIn(flow.querySelector(`.wd-section[data-id="${s.id}"]`));
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

function reanchorAll() {
  for (const c of doc.comments) {
    Notes.reanchor(c, flow.querySelector(`.wd-section[data-id="${c.sectionId}"]`));
  }
}

/** Whether Edit has been asked for the notes. Absent means no. */
const notesOn = () => doc.settings.showComments === true;

/** Comment is always annotating; Edit only when you have asked it to. */
const notesShown = () => view === 'comment' || notesOn();

/** Where the thread cards for the current stage live. */
const threadHost = () => (view === 'comment' ? '#thread-list' : '#edit-thread-list');

function paintNotesToggle() {
  const on = notesOn();
  $('#toggle-notes').classList.toggle('is-on', on);
  // The button says what pressing it does, not what the state is.
  $('#toggle-notes-label').textContent = on ? 'Hide Comments' : 'Show Comments';
  $('#toggle-notes').title = on ? 'Hide comments' : 'Show comments';
  $('#edit-notes').hidden = !on;
  marks.hidden = !notesShown();
}

// Which comments are currently adrift. Repainting the thread list on every
// keystroke would take the box somebody is typing a note into away from them,
// so it is only rebuilt when this actually changes.
let orphanSignature = '';

function paintMarks() {
  reanchorAll();
  marks.hidden = !notesShown();
  Notes.paintHighlights(flow, marks, doc.comments, { activeId: activeComment });

  const now = doc.comments.filter(c => c.orphaned).map(c => c.id).join(',');
  if (now !== orphanSignature) {
    orphanSignature = now;
    paintThreads();
  }
}

function visibleThreads() {
  const all = Notes.inReadingOrder(doc);
  if (commentFilter === 'resolved') return all.filter(c => c.resolved);
  if (commentFilter === 'all') return all;
  return all.filter(c => !c.resolved);
}

function threadCard(c, { compact = false } = {}) {
  const el = document.createElement('div');
  el.className = 'thread';
  el.dataset.id = c.id;
  if (c.id === activeComment) el.classList.add('is-active');
  if (c.resolved) el.classList.add('is-resolved');
  if (c.orphaned) el.classList.add('is-orphaned');

  const quote = document.createElement('div');
  quote.className = 'thread-quote';
  quote.textContent = c.quote || '(no passage)';
  el.appendChild(quote);

  if (c.orphaned) {
    const lost = document.createElement('div');
    lost.className = 'thread-lost';
    lost.textContent = 'The passage this was written about has been changed or removed.';
    el.appendChild(lost);
  }

  const by = document.createElement('div');
  by.className = 'thread-by';
  by.innerHTML = `<b></b><span></span>`;
  by.querySelector('b').textContent = c.author;
  by.querySelector('span').textContent = Notes.relativeTime(c.createdAt);
  el.appendChild(by);

  if (c.text) {
    const note = document.createElement('div');
    note.className = 'thread-note';
    note.textContent = c.text;
    el.appendChild(note);
  }

  for (const r of c.replies) {
    const rep = document.createElement('div');
    rep.className = 'reply';
    rep.innerHTML = `<div class="thread-by"><b></b><span></span></div><div class="thread-note"></div>`;
    rep.querySelector('b').textContent = r.author;
    rep.querySelector('span').textContent = Notes.relativeTime(r.createdAt);
    rep.querySelector('.thread-note').textContent = r.text;
    el.appendChild(rep);
  }

  // A comment with nothing said in it is one that has just been made, and the
  // box to say it in is the whole reason the card is on screen.
  if (!c.text) el.appendChild(composer(c, 'note'));

  const actions = document.createElement('div');
  actions.className = 'thread-actions';

  if (c.text) {
    const reply = document.createElement('button');
    reply.textContent = 'Reply';
    reply.addEventListener('click', () => {
      if (el.querySelector('.reply-box')) return;
      el.insertBefore(composer(c, 'reply'), actions);
      el.querySelector('.reply-box').focus();
    });
    actions.appendChild(reply);
  }

  if (!reviewing) {
    const res = document.createElement('button');
    res.textContent = c.resolved ? 'Reopen' : 'Resolve';
    res.addEventListener('click', () => {
      c.resolved = !c.resolved;
      save();
      paintThreads();
      paintMarks();
      paintStats();
    });
    actions.appendChild(res);
  }

  if (!reviewing || c.author === Notes.whoAmI()) {
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      const ok = await ask({
        title: 'Delete this comment?',
        body: c.replies.length
          ? `Its ${c.replies.length} repl${c.replies.length === 1 ? 'y' : 'ies'} go with it.`
          : '',
        yes: 'Delete', danger: true,
      });
      if (!ok) return;
      doc.comments = doc.comments.filter(x => x.id !== c.id);
      if (activeComment === c.id) activeComment = null;
      save();
      paintThreads();
      paintMarks();
      paintStats();
    });
    actions.appendChild(del);
  }

  if (!compact && !c.orphaned) {
    const go = document.createElement('button');
    go.className = 'go';
    go.textContent = 'Show in text';
    go.addEventListener('click', () => jumpTo(c.id));
    actions.appendChild(go);
  }

  el.appendChild(actions);
  el.addEventListener('click', e => {
    if (e.target.closest('button, textarea')) return;
    setActive(c.id);
  });
  return el;
}

/** A box for a first note or a reply, with the same manners either way. */
function composer(c, kind) {
  const box = document.createElement('textarea');
  box.className = 'reply-box';
  box.rows = kind === 'note' ? 2 : 2;
  box.placeholder = kind === 'note' ? 'What do you want to say about this?' : 'Reply…';

  const send = () => {
    const text = box.value.trim();
    if (!text) return;
    const author = Notes.whoAmI() || (reviewing ? 'Anonymous' : doc.author || 'You');
    if (kind === 'note') c.text = text;
    else c.replies.push({ id: Doc.uid('r'), author, text, createdAt: new Date().toISOString() });
    box.value = '';
    save();
    paintThreads();
    paintStats();
  };

  box.addEventListener('keydown', e => {
    // Return sends, because a comment is a remark rather than a document.
    // Shift-return is there for the ones that turn out to be paragraphs.
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') box.blur();
  });
  box.addEventListener('blur', send);
  return box;
}

function paintThreads() {
  const list = visibleThreads();
  const open = Notes.openCount(doc);

  $('#comment-count').textContent = doc.comments.length === 0
    ? 'none yet'
    : `${open} open · ${doc.comments.length - open} resolved`;

  for (const [host, compact] of [[$('#thread-list'), true], [$('#edit-thread-list'), true]]) {
    host.textContent = '';
    const shown = host.id === 'edit-thread-list'
      ? Notes.inReadingOrder(doc).filter(c => showResolved() || !c.resolved)
      : list;
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = doc.comments.length
        ? 'Nothing to show here.'
        : 'Select a passage to leave the first note.';
      host.appendChild(empty);
      continue;
    }
    for (const c of shown) host.appendChild(threadCard(c, { compact }));
  }
}

const showResolved = () => $('#show-resolved').checked;

function setActive(id) {
  activeComment = id;
  paintMarks();
  $$('.thread').forEach(el => el.classList.toggle('is-active', el.dataset.id === id));
}

/** Scroll the writing a note is about into view, wherever you are reading it. */
function jumpTo(id) {
  if (!doc.comments.some(x => x.id === id)) return;
  if (view !== 'comment' && view !== 'edit') switchView('comment');
  setActive(id);
  requestAnimationFrame(() => {
    marks.querySelector(`.wd-mark[data-comment="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

/** The floating Comment button that follows a selection. */
function bindCommentBar() {
  const bar = $('#commentbar');

  const place = () => {
    const sel = getSelection();
    // Comments hidden means you are not commenting, so the button that makes
    // one has no business appearing over a selection.
    const here = view === 'comment' || (view === 'edit' && notesShown());
    if (!sel || sel.isCollapsed || !sel.rangeCount || !here
        || !Notes.selectionSection(flow)) {
      bar.classList.remove('is-on');
      return;
    }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) { bar.classList.remove('is-on'); return; }
    bar.classList.add('is-on');
    const w = bar.offsetWidth;
    bar.style.left = `${Math.max(10, Math.min(innerWidth - w - 10, r.left + r.width / 2 - w / 2))}px`;
    bar.style.top = `${Math.max(10, r.top - bar.offsetHeight - 8)}px`;
  };

  document.addEventListener('selectionchange', () => requestAnimationFrame(place));
  for (const c of [$('#canvas'), $('#comment-canvas')]) c.addEventListener('scroll', place);

  $('#add-comment').addEventListener('mousedown', e => e.preventDefault());
  $('#add-comment').addEventListener('click', async () => {
    // Take the passage first. Opening a dialog moves the focus and the
    // selection goes with it, and the selection is what the comment is made of.
    const c = Notes.commentFromSelection(flow, { author: Notes.whoAmI() });
    if (!c) return toast('Select a passage inside one section first.');

    if (!Notes.whoAmI()) {
      const name = await ask({
        title: 'What should your notes be signed?',
        body: 'Kept in this browser only, so whoever reads them knows who wrote them.',
        yes: 'Save', input: true, placeholder: 'Your name',
      });
      if (name) Notes.setWhoAmI(name);
      $('#who').value = Notes.whoAmI();
      c.author = Notes.whoAmI() || 'Anonymous';
    }
    doc.comments.push(c);
    activeComment = c.id;
    bar.classList.remove('is-on');
    getSelection().removeAllRanges();
    save();
    paintMarks();
    paintThreads();
    paintStats();
    const box = $(`${threadHost()} .thread[data-id="${c.id}"] .reply-box`);
    box?.focus();
    box?.scrollIntoView({ block: 'center' });
  });

  // The highlights are painted under the text and are not clickable, so that
  // a click in a commented sentence still puts the caret there. Finding the
  // comment is done by where the click landed instead.
  flow.addEventListener('click', e => {
    if (!getSelection()?.isCollapsed) return;
    const id = Notes.markAt(marks, e.clientX, e.clientY);
    if (!id) return;
    setActive(id);
    $(`${threadHost()} .thread[data-id="${id}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

function showLink(title, hint, url) {
  const dlg = $('#link-dialog');
  $('#link-title').textContent = title;
  $('#link-hint').textContent = hint;
  $('#link-text').value = url;
  dlg.showModal();
  $('#link-text').select();
}

async function shareLink() {
  editor.harvest();
  const encoded = await Share.encode(Share.readingPayload(doc));
  const url = Share.linkFor('read', encoded);
  const { images } = lossyParts(doc);

  if (url.length > Share.LINK_LIMIT) {
    toast('This piece is too long to travel in a link. Send the file instead.', true);
    return;
  }

  const parts = [];
  if (url.length > Share.LINK_COMFORTABLE) {
    parts.push('This link is long enough that some chat and mail clients will ' +
               'break it across lines. If it arrives broken, send the file instead.');
  }
  if (images) {
    parts.push(`${images} picture${images === 1 ? '' : 's'} could not come along — ` +
               'a link carries the words. The file carries everything.');
  }
  parts.push('Nothing was uploaded. The whole draft is inside the link itself.');

  showLink('Reading link', parts.join(' '), url);
  if (await Share.copyToClipboard(url)) toast('Reading link copied.');
}

async function shareFile() {
  editor.harvest();
  const payload = Share.readingPayload(doc, { images: await Doc.packImages(doc) });
  downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }),
               `${slug()}-to-read.json`);
  toast('Saved a reading file. Send it however you like; it opens with “Open a copy”.');
}

async function sendNotesBack() {
  const payload = Share.notesPayload(doc, { author: Notes.whoAmI() });
  const url = Share.linkFor('notes', await Share.encode(payload));
  showLink(
    'Your notes',
    `${doc.comments.length} note${doc.comments.length === 1 ? '' : 's'}, packed into this ` +
    'link. Send it back to whoever shared the draft with you. Nothing was uploaded.',
    url,
  );
  if (await Share.copyToClipboard(url)) toast('Notes link copied.');
}

async function applyNotes(text) {
  const raw = (text || '').trim();
  if (!raw) return toast('Paste the link they sent back first.', true);
  try {
    const data = Share.incoming(raw.slice(raw.indexOf('#'))) ||
                 (raw.startsWith('#') ? Share.incoming(raw) : null);
    const payload = Share.checkPayload(
      await Share.decode(data ? data.data : raw), 'notes');
    const { added, updated } = Notes.merge(doc, payload.comments.map(Doc.normalizeComment));
    save();
    paintMarks();
    paintThreads();
    paintStats();
    $('#notes-paste').value = '';
    toast(added || updated
      ? `${added} new note${added === 1 ? '' : 's'}${updated ? `, ${updated} updated` : ''}` +
        ` from ${payload.author || 'someone'}.`
      : 'Those notes were already here.');
  } catch (err) {
    console.error(err);
    toast(err.message || 'That did not look like a notes link.', true);
  }
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function switchView(next) {
  if (reviewing && !['edit', 'comment'].includes(next)) return;

  // Leaving the drafting room with writing still in it. A draft is invisible
  // from every other stage, so walking away from one unasked is how it gets
  // forgotten — the dot on the tab is a reminder, not a question. Asking has
  // to wait for an answer, so the switch itself happens on the other side.
  if (view === 'draft' && next !== 'draft' && doc.draft.text.trim()) {
    askDraftHandoff(next);
    return;
  }
  applyView(next);
}

async function askDraftHandoff(next) {
  const words = countWords(doc.draft.text);
  const yes = await ask({
    title: `You drafted ${words} word${words === 1 ? '' : 's'}!`,
    body: 'Bring them into edit mode, or leave them where they are and come ' +
          'back later?',
    yes: 'Take it to Edit', no: 'Leave in draft',
  });
  if (yes) takeDraftToEdit({ then: next });
  // Declining moves on anyway. The question was whether to carry the draft,
  // not whether to leave the room, and asking again on the way out of every
  // stage would be nagging.
  else applyView(next);
}

function applyView(next) {
  view = next;
  doc.stage = next;
  save();
  holdGalley(next);
  $$('.view').forEach(v => v.classList.toggle('is-on', v.id === `view-${next}`));
  $$('#tabs button').forEach(b => b.classList.toggle('is-on', b.dataset.view === next));
  paintNotesToggle();
  if (next === 'format') paintPageGrid();
  if (next === 'save') paintSave();
  if (next === 'comment') paintThreads();
  if (next === 'draft') requestAnimationFrame(() => draft.focus());
  if (next !== 'edit' && next !== 'comment') $('#commentbar').classList.remove('is-on');
}

/** Whichever canvas is holding the galley at the moment. */
const canvasOf = () => paper.parentElement;

/**
 * Move the document to the stage that is about to show it.
 *
 * Edit and Comment are the same page with different jobs in mind, and both
 * have to show the real thing rather than a picture of it. There is exactly
 * one laid-out galley in this application and everything else is derived from
 * it, so a second rendered copy in the Comment stage would be a second set of
 * line breaks — and a comment anchored against the wrong one. Moving the one
 * that exists is both cheaper and more honest.
 *
 * Nothing about the layout changes on the way across: the sheet has an
 * explicit width and both canvases centre it, so not one line rewraps. What
 * does change is whether the sections can be typed into.
 */
function holdGalley(stage) {
  const wanted = stage === 'comment' ? $('#comment-canvas') : $('#canvas');
  const from = paper.parentElement;
  if (from && from !== wanted) {
    const top = from.scrollTop;
    wanted.appendChild(paper);
    wanted.scrollTop = top;
  }
  // Comment is for reading and annotating. Switching the sections off here,
  // rather than re-rendering them read-only, keeps the caret, the scroll
  // position and the undo history of whatever you were in the middle of.
  const editable = stage !== 'comment' && !reviewing;
  flow.querySelectorAll('.wd-section').forEach(el => {
    el.contentEditable = editable ? 'true' : 'false';
    el.spellcheck = editable;
  });
}

/** Re-render the galley, then put it back into the state its stage wants. */
function renderGalley() {
  editor.render();
  holdGalley(view);
}

/**
 * A scale that puts `across` of something side by side in the room available.
 *
 * The sliders used to open at a number somebody typed into the markup, which
 * was right on one screen and wrong on every other. Two pages side by side is
 * the view worth opening on — enough to see a spread, and enough to see the
 * shape of the type — so the number is worked out from the width there
 * actually is.
 */
function fitScale(host, unitW, across) {
  const wrap = host.parentElement;
  const box = getComputedStyle(wrap);
  // The scrollbar is not there yet. It appears once the pages are in, and it
  // takes its width out of the room they were measured against — so leave it.
  const inner = wrap.clientWidth - SCROLLBAR_SLACK
    - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
  const gap = across > 1 ? 18 : 0;   // .pgrid column-gap
  if (!(inner > 0)) return null;
  return ((inner - gap * (across - 1)) / across) / unitW;
}

const SCROLLBAR_SLACK = 14;

/** Sliders keep their opening value until somebody moves one. */
const zoomTouched = { format: false, save: false };

function applyDefaultZoom(which) {
  if (zoomTouched[which]) return;
  const m = Doc.metrics(doc.settings);
  const slider = $(which === 'format' ? '#format-zoom' : '#save-zoom');
  const host = $(which === 'format' ? '#page-grid' : '#save-preview');
  // A sheet already carries two pages, so a booklet fits one of those across
  // and an ordinary document fits two pages. Both come to the same width.
  const press = which === 'save' && exportMode() === 'press';
  const fit = fitScale(host, press ? m.sheetW : m.pageW, press ? 1 : 2);
  if (fit === null) return;
  // Down to the slider's own step, never up. A range input snaps whatever it
  // is given, and snapping upwards is what turns two pages across into one.
  const step = +slider.step || 0.01;
  const snapped = Math.floor(fit / step) * step;
  slider.value = String(Math.min(+slider.max, Math.max(+slider.min, snapped)));
}

function paintPageGrid() {
  applyDefaultZoom('format');
  const scale = +$('#format-zoom').value;
  const host = $('#page-grid');
  host.textContent = '';
  host.style.gridTemplateColumns =
    `repeat(auto-fill, minmax(${Math.round(Doc.metrics(doc.settings).pageW * scale)}px, max-content))`;
  host.appendChild(renderReadingOrder(flow, offsets, doc.settings, scale));
}

/** The section a page belongs to: the one that starts on it, or covers it. */
function sectionAtPage(pageNo) {
  let covering = null;
  for (const s of doc.sections) {
    const range = sectionPageRange(s.id);
    if (!range) continue;
    if (range[0] === pageNo) return s.id;
    if (pageNo > range[0] && pageNo <= range[1] && !covering) covering = s.id;
  }
  return covering;
}

/**
 * Show which pages a section is on.
 *
 * An outline around them for a moment, and a scroll to the first if it is out
 * of sight. A section can run to a dozen pages, so the answer to "where is
 * this?" has to be visible without hunting for it.
 */
function showSectionPages(id) {
  const range = sectionPageRange(id);
  if (!range) return;
  const host = $('#page-grid');
  host.querySelectorAll('.wd-cell.is-lit').forEach(c => c.classList.remove('is-lit'));

  let first = null;
  for (let p = range[0]; p <= range[1]; p++) {
    const cell = host.querySelector(`.wd-cell[data-page="${p}"]`);
    if (!cell) continue;
    cell.classList.add('is-lit');
    first ??= cell;
  }
  clearTimeout(showSectionPages.timer);
  showSectionPages.timer = setTimeout(
    () => host.querySelectorAll('.wd-cell.is-lit').forEach(c => c.classList.remove('is-lit')),
    1800);

  const wrap = host.parentElement;
  if (!first) return;
  const top = first.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
  if (top < 0 || top > wrap.clientHeight - 60) wrap.scrollTop += top - 26;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

const EXPORT_MODES = {
  reading: {
    label: 'Export PDF',
    note: 'One page at a time, in the order a reader meets them.',
  },
  press: {
    label: 'Export PDF',
    note: 'Two pages to a sheet, in the order the printer needs them. ' +
          'Print double-sided, fold, staple.',
  },
  both: {
    label: 'Export both  ·  .zip',
    note: 'One of each, zipped: the sheets to print, and the pages to read.',
  },
};

function exportMode() {
  const wanted = doc.settings.press.exportMode;
  // Imposition is a property of folded paper. On anything else the only
  // honest answer is one page at a time, whatever the setting last said.
  if (!Doc.isFolded(doc.settings)) return 'reading';
  return EXPORT_MODES[wanted] ? wanted : 'reading';
}

function paintExportMode() {
  const folded = Doc.isFolded(doc.settings);
  const mode = exportMode();
  // Both orders are always on offer, because "can I print this as a folded
  // booklet" is a question about the document, not about a setting you are
  // expected to have found first. Choosing one on paper that does not fold
  // asks to change the paper; see chooseExportMode.
  $('#press-head').hidden = !folded;
  $('#press-fields').hidden = !folded;
  $('#press-hint').hidden = !folded;
  $$('#export-mode button').forEach(b => b.classList.toggle('is-on', b.dataset.mode === mode));
  $('#export-note').textContent = EXPORT_MODES[mode].note;
  $('#export-pdf').textContent = EXPORT_MODES[mode].label;
}

function paintSave() {
  paintExportMode();
  applyDefaultZoom('save');
  const scale = +$('#save-zoom').value;
  const host = $('#save-preview');
  const mode = exportMode();
  host.textContent = '';

  if (mode === 'reading') {
    host.className = 'pgrid';
    host.style.gridTemplateColumns =
      `repeat(auto-fill, minmax(${Math.round(Doc.metrics(doc.settings).pageW * scale)}px, max-content))`;
    host.appendChild(renderReadingOrder(flow, offsets, doc.settings, scale));
    $('#save-stage-label').textContent = 'Pages';
    $('#save-stage-note').textContent = 'Exactly what the PDF will contain.';
  } else {
    host.className = 'sheets';
    host.style.gridTemplateColumns = '';
    const { frag } = renderSheets(flow, offsets, doc.settings, scale);
    host.appendChild(frag);
    $('#save-stage-label').textContent = 'Sheets';
    $('#save-stage-note').textContent = 'What comes out of the printer, before folding.';
  }

  const rows = [
    ['Words', wordCount().toLocaleString()],
    ['Pages', offsets.length],
    ['Sections', doc.sections.length],
  ];
  if (Doc.isFolded(doc.settings)) {
    const { padded } = impose(offsets.length);
    rows.push(['Blank pages added', padded - offsets.length]);
    rows.push(['Sheets of paper', padded / 4]);
  }
  const open = Notes.openCount(doc);
  if (open) rows.push(['Comments still open', open]);
  $('#save-summary').innerHTML = rows
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

/** Folding this paper in half gives you these pages. */
const FOLDS_INTO = {
  letter: 'zine-letter', digest: 'zine-letter',
  a4: 'zine-a4', a5: 'zine-a4',
};

/**
 * Choose an export order, changing the paper if the order requires it.
 *
 * A booklet is set in half pages: fold a sheet down the middle and you have
 * two pages, each half the width. So imposition is not a thing that can be
 * applied to a finished US Letter document on the way out — the text has to
 * have been laid out at the size it will print, or the preview is showing
 * something the PDF will not contain. Rather than hide the option until the
 * paper happens to be right, it is offered and it says what it costs.
 */
async function chooseExportMode(mode) {
  if ((mode === 'press' || mode === 'both') && !Doc.isFolded(doc.settings)) {
    const target = FOLDS_INTO[doc.settings.paper] || 'zine-letter';
    const ok = await ask({
      title: 'A booklet is set in half pages',
      body: `Folding a sheet in half makes two pages out of it, so the paper has to ` +
            `be ${Doc.PAPER[target].name} for the text to be laid out at the size it ` +
            `will actually print. Your margins and type settings are kept — the text ` +
            `reflows and the page count changes. You can switch back in Format.`,
      yes: 'Switch the paper',
    });
    if (!ok) return;
    doc.settings.paper = target;
    onSettingChange({ path: 'paper' });
  }
  doc.settings.press.exportMode = mode;
  save();
  paintSave();
}

function bindExportMode() {
  $$('#export-mode button').forEach(b =>
    b.addEventListener('click', () => chooseExportMode(b.dataset.mode)));
}

const slug = () => (doc.title || 'document').trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';

let exporting = false;

async function exportPDF() {
  if (exporting) return;
  exporting = true;
  const status = $('#export-status');
  const button = $('#export-pdf');
  button.disabled = true;

  const say = msg => { status.classList.remove('err'); status.textContent = msg; };

  try {
    say('measuring…');
    editor.harvest();
    repaginate();
    await document.fonts.ready;

    const mode = exportMode();
    const m = Doc.metrics(doc.settings);
    const common = {
      flow, settings: doc.settings, offsets, title: doc.title,
      contentH: m.contentH, pageCount: offsets.length,
    };

    const wanted = mode === 'both' ? ['press', 'reading'] : [mode];
    const built = [];
    for (const which of wanted) {
      const prefix = wanted.length > 1 ? `${which === 'press' ? 'print' : 'reading'} order: ` : '';
      built.push(await buildPDF({ ...common, mode: which, onProgress: msg => say(prefix + msg) }));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const file = which =>
      `${slug()}-${which === 'press' ? 'print' : 'reading'}-${stamp}.pdf`;

    if (built.length === 1) {
      download(built[0].bytes, mode === 'reading' ? `${slug()}-${stamp}.pdf` : file(wanted[0]));
    } else {
      // Two PDFs are two downloads, and a browser will only reliably grant
      // one. Zipping keeps it a single click and keeps the pair together.
      say('zipping');
      downloadBlob(zip(built.map((b, i) => ({ name: file(wanted[i]), bytes: b.bytes }))),
                   `${slug()}-${stamp}.zip`);
    }

    const dropped = [...new Set(built.flatMap(b => b.dropped))];
    const press = built.find(b => b.mode === 'press');
    const read = built.find(b => b.mode === 'reading');
    const parts = [];
    if (press) parts.push(`${press.sheets} sheet${press.sheets === 1 ? '' : 's'} to print`);
    if (read) parts.push(`${read.pdfPages} page${read.pdfPages === 1 ? '' : 's'}`);
    say(`${parts.join(', ')}.`);

    toast(dropped.length
      ? `Exported. ${dropped.length} character${dropped.length === 1 ? '' : 's'} had no ` +
        `glyph in the chosen font and were left out: ${dropped.join(' ')}`
      : `Exported ${parts.join(' and ')}.`,
      dropped.length > 0);
  } catch (err) {
    console.error(err);
    status.classList.add('err');
    status.textContent = err.message || 'Export failed.';
    toast(`Export failed: ${err.message}`, true);
  } finally {
    exporting = false;
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// The other formats
// ---------------------------------------------------------------------------

function exportMarkdown() {
  editor.harvest();
  const { images } = lossyParts(doc);
  downloadBlob(new Blob([toMarkdown(doc)], { type: 'text/markdown;charset=utf-8' }),
               `${slug()}.md`);
  toast(images
    ? `Exported the words. ${images} picture${images === 1 ? '' : 's'} could not come with ` +
      'them — markdown has nowhere to put one. Save a copy for the whole thing.'
    : 'Exported as Markdown.');
}

/** Markdown with the markup taken back out: the words and nothing else. */
function toPlainText() {
  const probe = document.createElement('div');
  const out = [];
  for (const s of doc.sections) {
    probe.innerHTML = s.html;
    for (const block of probe.children) {
      if (block.tagName === 'FIGURE') {
        const cap = block.querySelector('figcaption')?.textContent.trim();
        out.push(cap ? `[picture: ${cap}]` : '[picture]');
      } else if (block.tagName === 'HR') {
        out.push('* * *');
      } else if (block.tagName === 'UL' || block.tagName === 'OL') {
        Array.from(block.children).forEach((li, i) => {
          out.push(`${block.tagName === 'OL' ? `${i + 1}.` : '-'} ${li.textContent.trim()}`);
        });
      } else {
        const t = block.textContent.trim();
        if (t) out.push(t);
      }
    }
  }
  return out.join('\n\n') + '\n';
}

function exportText() {
  editor.harvest();
  downloadBlob(new Blob([toPlainText()], { type: 'text/plain;charset=utf-8' }), `${slug()}.txt`);
  toast('Exported as plain text.');
}

/**
 * A web page that stands on its own.
 *
 * The same flow rules the editor and the PDF use, inlined, so the type is the
 * type you set. Fonts are not embedded — that would be megabytes for a file
 * meant to be small and readable anywhere — so the families are named with
 * their fallbacks and a machine without them substitutes, which is what the
 * web has always done.
 */
async function exportHTML() {
  editor.harvest();
  const images = await Doc.packImages(doc);
  const body = document.createElement('div');
  body.className = 'wd-flow';
  for (const s of doc.sections) {
    const sec = document.createElement('section');
    sec.innerHTML = s.html;
    sec.querySelectorAll('img[data-zimg]').forEach(img => {
      const rec = images[img.dataset.zimg];
      if (rec) img.setAttribute('src', rec.data);
      else img.closest('figure')?.remove();
    });
    body.appendChild(sec);
  }

  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.title || 'Untitled')}</title>
<style>
body{ margin:0; background:#f6f5f3; color:#000; }
.wd-wrap{ max-width:none; padding:6vh 24px 14vh; display:flex; justify-content:center; }
${flowCSS(doc.settings)}
.wd-flow{ max-width:100%; }
.wd-flow img{ max-width:100%; height:auto; }
@media print{ body{ background:#fff; } .wd-wrap{ padding:0; } }
</style>
</head>
<body><div class="wd-wrap">${body.outerHTML}</div></body>
</html>
`;
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${slug()}.html`);
  toast('Exported as a web page. Fonts are named, not embedded.');
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

let draft = null;

const KEYS = [
  ['⌘1 ⌘2 ⌘3', 'Heading one, two, three'],
  ['⌘B', 'Open or close bold'],
  ['⌘I', 'Open or close italic'],
  ['⌘⇧8', 'Bullet'],
  ['⌘⇧7', 'Numbered'],
  ['⌘⇧9', 'Quote'],
  ['↵', 'New paragraph, or the next item of a list'],
  ['⇧↵', 'New line inside the same paragraph'],
  ['⌫', 'Nothing. That is the point.'],
];

function paintKeys() {
  const host = $('#draft-keys');
  host.textContent = '';
  for (const [key, what] of KEYS) {
    const k = document.createElement('kbd');
    k.textContent = key;
    const s = document.createElement('span');
    s.textContent = what;
    host.append(k, s);
  }
}

function paintDraftPanel() {
  const open = doc.settings.draft.panel !== false;
  $('#draft-rail').hidden = !open;
  $('#draft-panel').textContent = open ? 'Hide panel' : 'Show panel';
}

function paintDraftMeter() {
  const words = countWords(doc.draft.text);
  const goal = doc.settings.draft.goal | 0;
  const mins = Math.floor(doc.draft.seconds / 60);
  const bar = goal > 0
    ? `<span class="draft-bar"><i style="width:${Math.min(100, (words / goal) * 100).toFixed(1)}%"></i></span>`
    : '';
  // A draft left in the room is invisible from every other stage, so the tab
  // says so. Quiet rather than a count: it is a reminder, not a queue.
  const pending = $('#tab-draft');
  pending.hidden = words === 0;
  pending.textContent = '·';

  $('#draft-meter').innerHTML =
    `<span><b>${words.toLocaleString()}</b>${goal ? ` / ${goal.toLocaleString()}` : ''} words</span>` +
    bar +
    `<span>${mins}m</span>`;

  $('#draft-session').innerHTML = `
    <div class="field"><label>Words</label><span>${words.toLocaleString()}</span></div>
    <div class="field"><label>Lines</label><span>${doc.draft.text.split('\n').length}</span></div>
    <div class="field"><label>Time at the keys</label><span>${mins}m ${doc.draft.seconds % 60}s</span></div>
    <div class="field"><label>Started</label><span>${
      doc.draft.startedAt ? new Date(doc.draft.startedAt).toLocaleDateString() : '—'}</span></div>`;
}

const REFUSALS = {
  delete: 'In draft mode, there is no delete. Write your way out!',
  undo: 'Nothing to undo — nothing has been taken away.',
  move: 'The cursor stays at the end. Keep going.',
  drop: 'Text can only arrive at the end.',
};

function bindDraft() {
  draft = new Draft($('#draft-canvas'), $('#draft-column'), $('#draft-input'), doc);

  let refusalTimer = null;
  draft.addEventListener('refused', e => {
    const el = $('#draft-refusal');
    el.textContent = REFUSALS[e.detail.reason] || '';

    // Beside the line you are on, not at the foot of the window. The eye is
    // at the caret — that is the whole point of the room — so a notice
    // anywhere else is a notice nobody reads.
    const line = $('#draft-column .dline.is-current');
    const stage = $('.draft-stage');
    if (line && stage) {
      const r = line.getBoundingClientRect();
      const box = stage.getBoundingClientRect();
      el.style.left = `${Math.round(r.left - box.left)}px`;
      el.style.top =
        `${Math.round(Math.min(r.bottom - box.top + 12, box.height - 56))}px`;
    }

    el.classList.add('is-on');
    clearTimeout(refusalTimer);
    refusalTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
  });

  draft.addEventListener('change', () => { paintDraftMeter(); save(); });
  draft.addEventListener('tick', () => { if (view === 'draft') paintDraftMeter(); });
  draft.startClock();

  buildFields($('#draft-fields'), DRAFT_SCHEMA, doc.settings, () => {
    save();
    draft.render();
    paintDraftMeter();
  });
  paintKeys();
  paintDraftMeter();
  addEventListener('resize', () => { if (view === 'draft') draft.paintFade(); });

  $('#draft-done').addEventListener('click', () => takeDraftToEdit());

  $('#draft-panel').addEventListener('click', () => {
    doc.settings.draft.panel = !doc.settings.draft.panel;
    save();
    paintDraftPanel();
    // The column re-centres in the wider stage, so the fade has to be
    // measured again against a line that is now somewhere else.
    requestAnimationFrame(() => draft.paintFade());
  });
  paintDraftPanel();
}

/**
 * Move a finished draft into the editor.
 *
 * It is added, never substituted: whatever is already in Edit was put there
 * on purpose, and a draft is the next part of it far more often than it is a
 * replacement for it. The one exception is the sample text this application
 * ships with, which nobody wrote and nobody wants underneath their first
 * chapter.
 */
function takeDraftToEdit({ then = 'edit' } = {}) {
  const text = doc.draft.text.trim();
  if (!text) { toast('Nothing drafted yet.'); return false; }

  const parts = draftToSections(text);
  if (!parts.length) { toast('Nothing drafted yet.'); return false; }

  // Added, never substituted. Whatever is in Edit was put there on purpose —
  // including the introduction this application ships with, which is ours to
  // have written and yours to delete. Nothing here removes writing on its own.
  const first = doc.sections.length;

  parts.forEach((part, i) => {
    doc.sections.push({
      id: Doc.uid('s'),
      name: part.name,
      startsNewPage: first + i > 0,
      html: sanitize(blocksFromMarkdown(part.text)),
    });
  });

  const arrivedId = doc.sections[first].id;
  doc.draft = Doc.defaultDraft();
  draft.render();
  paintDraftMeter();
  renderGalley();
  renderSectionLists();
  switchView(then);
  save({ now: true });
  if (then === 'edit') showArrival(arrivedId);
  toast(`Moved ${parts.length} section${parts.length === 1 ? '' : 's'} into Edit. ` +
        'The drafting room is empty again.');
  return true;
}

/**
 * Put the writing that just arrived in front of the reader.
 *
 * Landing at the top of a document that has grown by three sections is no
 * better than landing nowhere: the whole point of the move is that there is
 * something new to look at. `scrollIntoView` is no good here because the
 * canvas has padding it would happily scroll past, so the offset is worked
 * out against the canvas itself.
 *
 * Pagination has to have finished first. A section that starts a new page
 * carries a forced break, and a forced break has no height until the page it
 * ends has been measured — so the galley grows by most of a page for every
 * one of them, *after* the sections are in the DOM. Measuring before that
 * lands you somewhere in the middle of the document that was already there.
 */
function showArrival(id) {
  repaginate();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const el = flow.querySelector(`.wd-section[data-id="${id}"]`);
    if (!el) return;
    const canvas = canvasOf();
    canvas.scrollTop +=
      el.getBoundingClientRect().top - canvas.getBoundingClientRect().top - 40;
    el.classList.add('is-arrived');
    setTimeout(() => el.classList.remove('is-arrived'), 1600);
    markActive(id);
  }));
}

// ---------------------------------------------------------------------------
// Toolbar and figures
// ---------------------------------------------------------------------------

function bindToolbar() {
  $$('[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => editor.exec(btn.dataset.cmd));
  });

  $('#block-style').addEventListener('change', e => {
    editor.setBlock(e.target.value);
    e.target.blur();
  });

  $('#ins-rule').addEventListener('click', () => editor.insertRule());
  $('#ins-break').addEventListener('click', () =>
    editor.insertHTML('<div class="wd-break"></div><p><br></p>'));

  const file = $('#image-file');
  $('#ins-image').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    for (const f of file.files) await editor.insertImage(f);
    file.value = '';
  });

  $('#add-section').addEventListener('click', addSection);
  $('#add-section-2').addEventListener('click', addSection);

  // Format is for looking. Going from a page to the words on it is a
  // deliberate act, so it takes a deliberate gesture.
  $('#page-grid').addEventListener('dblclick', e => {
    const pageNo = +e.target.closest('.wd-cell')?.dataset.page;
    if (!pageNo) return;
    const id = sectionAtPage(pageNo);
    if (!id) return;
    switchView('edit');
    markActive(id);
    showArrival(id);
  });
  $('#toggle-notes').addEventListener('click', () => {
    doc.settings.showComments = !notesOn();
    save();
    paintNotesToggle();
    paintMarks();
  });

  document.addEventListener('selectionchange', paintToolbarState);
}

function paintToolbarState() {
  if (view !== 'edit' || reviewing) return;
  const sel = getSelection();
  if (!sel || !sel.rangeCount || !flow.contains(sel.anchorNode)) return;

  for (const [cmd, el] of [['bold', '.tbtn.b'], ['italic', '.tbtn.i'], ['underline', '.tbtn.u']]) {
    try { $(el).classList.toggle('is-on', document.queryCommandState(cmd)); } catch {}
  }

  let node = sel.anchorNode;
  node = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const block = node?.closest('h1,h2,h3,blockquote,p,li');
  if (block) {
    const tag = block.tagName.toLowerCase();
    $('#block-style').value =
      tag === 'blockquote' ? 'quote'
      : block.classList.contains('wd-caption') ? 'caption'
      : (tag === 'li' ? 'p' : tag);
  }

  const sec = editor.sectionAt(sel.anchorNode);
  if (sec) markActive(sec.dataset.id);
}

function bindFigureBar() {
  const bar = $('#figbar');
  const width = $('#fig-width');
  const val = $('#fig-width-val');

  const place = fig => {
    if (!fig || reviewing) { bar.classList.remove('is-on'); return; }
    const r = fig.getBoundingClientRect();
    bar.classList.add('is-on');
    const w = bar.offsetWidth;
    bar.style.left = `${Math.max(10, Math.min(innerWidth - w - 10, r.left + r.width / 2 - w / 2))}px`;
    bar.style.top = `${Math.min(innerHeight - 60, r.bottom + 9)}px`;

    const pct = parseFloat(fig.style.width) || 70;
    width.value = pct;
    val.textContent = `${Math.round(pct)}%`;
    bar.querySelectorAll('[data-align]').forEach(b =>
      b.classList.toggle('is-on', b.dataset.align === (fig.dataset.align || 'center')));
    $('#fig-caption').classList.toggle('is-on', !!fig.querySelector('figcaption'));
  };

  editor.addEventListener('figure', e => place(e.detail.figure));
  for (const c of [$('#canvas'), $('#comment-canvas')]) {
    c.addEventListener('scroll', () => place(editor.selectedFigure));
  }

  width.addEventListener('input', () => {
    val.textContent = `${width.value}%`;
    editor.updateFigure(editor.selectedFigure, { width: +width.value });
    place(editor.selectedFigure);
  });
  bar.querySelectorAll('[data-align]').forEach(b =>
    b.addEventListener('click', () => {
      editor.updateFigure(editor.selectedFigure, { align: b.dataset.align });
      place(editor.selectedFigure);
    }));
  $('#fig-caption').addEventListener('click', () => {
    const fig = editor.selectedFigure;
    editor.updateFigure(fig, { caption: !fig?.querySelector('figcaption') });
    place(fig);
  });
  $('#fig-delete').addEventListener('click', () => editor.removeFigure(editor.selectedFigure));
}

// ---------------------------------------------------------------------------
// Documents in and out
// ---------------------------------------------------------------------------

/**
 * Swap in a different document without swapping the object.
 *
 * The settings rail was built around this exact `doc.settings` object and
 * every control writes straight into it. Replacing the object would leave the
 * whole panel wired to something the document no longer uses — the controls
 * would still move, and nothing on the page would change.
 */
function adopt(next) {
  doc.version = next.version;
  doc.id = next.id || doc.id;
  doc.status = next.status || 'drafting';
  doc.updatedAt = next.updatedAt || new Date().toISOString();
  doc.words = next.words || 0;
  doc.title = next.title;
  doc.author = next.author ?? '';
  doc.sections = next.sections;
  doc.comments = next.comments ?? [];
  doc.draft = next.draft ?? Doc.defaultDraft();
  doc.stage = Doc.STAGES.has(next.stage) ? next.stage : 'edit';
  for (const key of Object.keys(doc.settings)) delete doc.settings[key];
  Object.assign(doc.settings, next.settings);
}

/** Everything that has to happen after the document underneath us changes. */
function reload() {
  $('#doc-title').value = doc.title;
  $('#doc-status').value = doc.status;
  document.title = pageTitle(doc.title);
  applyFlowCSS(doc.settings);
  clearMetricCache();
  layoutPaper();
  buildRail();
  $('#export-status').textContent = '';
  renderGalley();
  renderSectionLists();
  paintThreads();
  draft?.render();
  paintDraftPanel();
  paintDraftMeter();
  applyView(reviewing ? 'edit' : (doc.stage || 'edit'));
  save({ now: true });
}

async function saveCopy() {
  editor.harvest();
  const bundle = await Doc.serialize(doc);
  downloadBlob(new Blob([JSON.stringify(bundle, null, 1)], { type: 'application/json' }),
               `${slug()}.writing-desk.json`);
  toast('Saved a copy. Keep it somewhere other than this browser.');
}

async function openCopy(file) {
  try {
    const parsed = JSON.parse(await file.text());

    // The same button opens both kinds of file, because from where you are
    // standing they are both "the thing somebody sent me".
    if (parsed?.kind === 'notes') return applyNotes(JSON.stringify(parsed));
    if (parsed?.kind === 'read') {
      Share.checkPayload(parsed, 'read');
      if (!await ask({
        title: `Read “${parsed.title}”?`,
        body: 'This replaces what is on screen. Your own document stays saved in ' +
              'this browser and comes back when you reload.',
        yes: 'Open it',
      })) return;
      await Doc.unpackImages(parsed.images);
      enterReview(parsed);
      return;
    }

    const restored = await Doc.deserialize(parsed);
    restored.sections = sectionsFromOutside(restored.sections);
    if (!await ask({
      title: `Open “${restored.title}”?`,
      body: 'This replaces what is open now. Save a copy first if you have not.',
      yes: 'Open it', danger: true,
    })) return;
    adopt(restored);
    reload();
    Doc.collectGarbage(doc);
    toast(`Opened “${doc.title}”.`);
  } catch (err) {
    console.error(err);
    toast(err.message || 'That file could not be opened.', true);
  }
}

/**
 * Read markdown into the document, replacing what is open.
 *
 * Settings are deliberately left alone: markdown says nothing about margins or
 * type, so the sensible reading of a file that is silent on them is that they
 * do not change, rather than that they should snap back to the defaults.
 */
async function importMarkdownText(text, { name = 'Markdown', confirmFirst = true } = {}) {
  const parsed = fromMarkdown(text);
  const title = parsed.title || name.replace(/\.(md|markdown|txt)$/i, '') || doc.title;

  if (confirmFirst && !await ask({
    title: `Open “${title}”?`,
    body: 'This replaces what is open now. Save a copy first if you have not.',
    yes: 'Open it', danger: true,
  })) {
    return false;
  }

  const referenced = (text.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;

  adopt({
    version: doc.version,
    title,
    author: doc.author,
    // Settings are not in the file, so carry the current ones across. They
    // have to be a snapshot: adopt() empties the live object before refilling
    // it, and handing it its own contents would leave nothing behind.
    settings: JSON.parse(JSON.stringify(doc.settings)),
    draft: doc.draft,
    comments: [],
    sections: parsed.sections.map(section => ({
      id: Doc.uid('s'),
      name: section.name,
      startsNewPage: section.startsNewPage,
      html: sanitize(section.html),
    })),
  });

  const kept = doc.sections.reduce(
    (n, section) => n + (section.html.match(/data-zimg/g) || []).length, 0);

  reload();
  Doc.collectGarbage(doc);

  const lost = Math.max(0, referenced - kept);
  toast(lost
    ? `Opened “${title}”. ${lost} picture${lost === 1 ? '' : 's'} could not be found — ` +
      'markdown carries the reference, not the bytes.'
    : `Opened “${title}”.`);
  return true;
}

async function importMarkdownFile(file) {
  try {
    importMarkdownText(await file.text(), { name: file.name });
  } catch (err) {
    console.error(err);
    toast(err.message || 'That file could not be read.', true);
  }
}

async function startOver() {
  if (!await ask({
    title: `Empty “${doc.title}” and start again?`,
    body: 'The writing, the draft, the comments and the settings of this ' +
          'document all go. Your other documents are not touched. There is no ' +
          'undo.',
    yes: 'Throw it away', danger: true,
  })) return;
  const fresh = Doc.newDocument({ title: doc.title });
  fresh.id = doc.id;          // the same sheet of paper, wiped
  adopt(fresh);
  reload();
  Doc.collectGarbage(doc);
}

function bindDocumentActions() {
  const openFile = $('#open-file');
  const mdFile = $('#md-file');
  const notesFile = $('#notes-file');

  document.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'save-copy') saveCopy();
    else if (action === 'open-copy') openFile.click();
    else if (action === 'export-md') exportMarkdown();
    else if (action === 'export-txt') exportText();
    else if (action === 'export-html') exportHTML();
    else if (action === 'import-md') mdFile.click();
    else if (action === 'start-over') startOver();
  });

  openFile.addEventListener('change', () => {
    if (openFile.files[0]) openCopy(openFile.files[0]);
    openFile.value = '';
  });
  mdFile.addEventListener('change', () => {
    if (mdFile.files[0]) importMarkdownFile(mdFile.files[0]);
    mdFile.value = '';
  });
  notesFile.addEventListener('change', async () => {
    if (notesFile.files[0]) applyNotes(await notesFile.files[0].text());
    notesFile.value = '';
  });
  $('#notes-open').addEventListener('click', () => notesFile.click());
}

/** Rebuild the settings panel from scratch, and remember how to re-read it. */
function buildRail() {
  syncSettings = buildSettingsRail($('#settings-rail'), doc.settings, onSettingChange);
}

function onSettingChange(field) {
  applyFlowCSS(doc.settings);
  clearMetricCache();
  layoutPaper();
  save();
  // The paper decides what two of the margin controls are called, so changing
  // it has to rebuild the panel that names them.
  if (field?.path === 'paper') { buildRail(); paintExportMode(); }
  // Wait for the new rules to take effect before measuring against them.
  requestAnimationFrame(() => requestAnimationFrame(repaginate));
}

// ---------------------------------------------------------------------------
// Reading somebody else's draft
// ---------------------------------------------------------------------------

/**
 * Sections that came from somewhere other than this browser.
 *
 * A shared link and a file somebody sent are both markup written by whoever
 * built them, and it goes straight into the page with `innerHTML`. A `<script>`
 * tag will not run that way, but an element carrying an event handler will —
 * and it would be running on this origin, with the reader's own document in
 * localStorage sitting next to it. Everything from outside is cleaned first.
 */
function sectionsFromOutside(sections) {
  return (sections || []).map(section => ({
    ...Doc.normalizeSection(section),
    html: sanitize(section.html || ''),
  }));
}

function enterReview(payload) {
  reviewing = true;
  document.body.classList.add('is-reviewing');
  editor.readOnly = true;

  adopt({
    version: 1,
    title: payload.title || 'Untitled',
    author: payload.author || '',
    settings: JSON.parse(JSON.stringify(payload.settings || Doc.defaultSettings())),
    draft: Doc.defaultDraft(),
    comments: (payload.comments || []).map(Doc.normalizeComment),
    sections: sectionsFromOutside(payload.sections),
  });

  $('#review-banner').hidden = false;
  $('#review-who').textContent = payload.author || 'Somebody';
  reload();
  requestAnimationFrame(() => requestAnimationFrame(repaginate));
}

/**
 * A link that arrives while the application is already open.
 *
 * Pasting a link into a tab that is already on this page changes the fragment
 * and nothing else — no navigation, no reload, no boot. Without this the
 * address bar would show a draft the page was not displaying, which is the
 * kind of thing people reasonably conclude is broken.
 */
function watchHash() {
  window.addEventListener('hashchange', () => {
    if (Share.incoming()) handleIncoming();
  });
}

async function handleIncoming() {
  const found = Share.incoming();
  if (!found) return false;
  Share.clearHash();

  try {
    const payload = await Share.decode(found.data);
    Share.checkPayload(payload, found.kind);

    if (found.kind === 'read') {
      enterReview(payload);
      toast(`Reading “${payload.title}”. Nothing here was uploaded anywhere.`);
      return true;
    }

    const { added } = Notes.merge(doc, payload.comments.map(Doc.normalizeComment));
    save({ now: true });
    toast(`${added} note${added === 1 ? '' : 's'} from ${payload.author || 'someone'}.`);
    return false;
  } catch (err) {
    console.error(err);
    toast(err.message || 'That link could not be read.', true);
    return false;
  }
}

// ---------------------------------------------------------------------------

/**
 * Ask a question and wait for the answer.
 *
 * `confirm` and `prompt` are not dependable surfaces any more: an embedded
 * browser view, a page the user has told the browser to stop showing dialogs
 * for, and several mobile browsers all return false without drawing anything
 * at all. A destructive action that silently does nothing is worse than one
 * that asks twice, so the asking is done in the page.
 *
 * @returns {Promise<boolean|string|null>} with `input: true`, the text typed
 *   or null if it was cancelled; otherwise a plain yes or no.
 */
function ask({ title, body, yes = 'OK', no = 'Cancel', danger = false,
               input = false, placeholder = '', value = '' } = {}) {
  const dlg = $('#ask-dialog');
  const field = $('#ask-input');

  $('#ask-title').textContent = title;
  $('#ask-body').textContent = body || '';
  $('#ask-body').hidden = !body;
  $('#ask-yes').textContent = yes;
  $('#ask-no').textContent = no;
  $('#ask-yes').classList.toggle('danger', danger);
  field.hidden = !input;
  field.value = value;
  field.placeholder = placeholder;

  return new Promise(resolve => {
    let answered = false;
    const finish = ok => {
      if (answered) return;
      answered = true;
      const text = field.value.trim();
      cleanup();
      dlg.close();
      resolve(input ? (ok ? text : null) : ok);
    };
    const onYes = () => finish(true);
    const onNo = () => finish(false);
    const onKey = e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } };
    // Escape closes a dialog without going through either button.
    const onCancel = () => finish(false);
    const cleanup = () => {
      $('#ask-yes').removeEventListener('click', onYes);
      $('#ask-no').removeEventListener('click', onNo);
      field.removeEventListener('keydown', onKey);
      dlg.removeEventListener('cancel', onCancel);
      dlg.removeEventListener('close', onCancel);
    };

    $('#ask-yes').addEventListener('click', onYes);
    $('#ask-no').addEventListener('click', onNo);
    field.addEventListener('keydown', onKey);
    dlg.addEventListener('cancel', onCancel);
    dlg.addEventListener('close', onCancel);

    dlg.showModal();
    (input ? field : $('#ask-yes')).focus();
    if (input) field.select();
  });
}

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

/**
 * A small, fixed tilt for a sheet, derived from its id.
 *
 * Paper does not land square on a desk, and a grid of perfectly aligned
 * rectangles is a list wearing a costume. Derived rather than random so a
 * given document always lies the same way round — a sheet that reshuffles
 * itself every time you look at the desk is a distraction, not a detail.
 */
function tiltOf(id) {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) % 1000;
  return ((n / 1000) * 2.2 - 1.1).toFixed(2);
}

/**
 * The opening words of a document, for the face of its card.
 *
 * Headings are skipped. The card already shows the title, and a preview that
 * starts by repeating it tells you nothing you did not have a moment ago.
 */
function peekAt(d) {
  const probe = document.createElement('div');
  const out = [];
  let length = 0;
  for (const section of d.sections) {
    probe.innerHTML = section.html;
    for (const block of probe.children) {
      if (/^H[1-6]$/.test(block.tagName)) continue;
      const text = block.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      out.push(text);
      length += text.length;
      if (length > 240) return out.join(' ');
    }
  }
  return out.join(' ');
}

function sheetCard(d, { current = false } = {}) {
  const el = document.createElement('div');
  el.className = 'sheet-card';
  el.tabIndex = 0;
  el.style.setProperty('--tilt', `${tiltOf(d.id)}deg`);
  if (current) el.style.setProperty('--tilt', '0deg');

  const title = document.createElement('h2');
  title.className = 'sheet-title';
  title.textContent = d.title || 'Untitled';

  const peek = document.createElement('p');
  peek.className = 'sheet-peek';
  const words = peekAt(d);
  if (words) peek.textContent = words;
  else { peek.classList.add('is-empty'); peek.textContent = 'Nothing written yet.'; }

  const foot = document.createElement('div');
  foot.className = 'sheet-foot';
  const n = d.words || 0;
  foot.innerHTML = '<span></span><span class="dot">·</span><span></span>';
  foot.children[0].textContent = `${n.toLocaleString()} word${n === 1 ? '' : 's'}`;
  foot.children[2].textContent = Notes.relativeTime(d.updatedAt);

  const menu = document.createElement('div');
  menu.className = 'sheet-menu';

  const move = document.createElement('select');
  move.title = 'Where this piece has got to';
  for (const st of Doc.STATUSES) {
    const o = document.createElement('option');
    o.value = st.id; o.textContent = st.label;
    move.appendChild(o);
  }
  move.value = d.status;
  move.addEventListener('click', e => e.stopPropagation());
  move.addEventListener('change', async e => {
    e.stopPropagation();
    await setStatus(d, move.value);
  });

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '✕';
  del.title = 'Delete this document';
  del.addEventListener('click', async e => {
    e.stopPropagation();
    await removeDocument(d);
  });

  menu.append(move, del);
  el.append(menu, title, peek, foot);

  const open = () => openDocument(d.id);
  el.addEventListener('click', open);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return el;
}

async function paintDesk() {
  const all = await Doc.listDocuments();
  const host = $('#piles');
  host.textContent = '';

  const n = all.length;
  $('#desk-sub').textContent = n === 0
    ? 'Nothing on the desk yet.'
    : `${n} document${n === 1 ? '' : 's'}, most recent first.`;
  $('#desk-close').hidden = n === 0;

  for (const status of Doc.STATUSES) {
    const mine = all.filter(d => d.status === status.id);
    // Empty piles are not drawn. Five labelled trays with nothing in four of
    // them is a filing system telling you off.
    if (!mine.length) continue;

    const pile = document.createElement('section');
    pile.className = 'pile';
    const label = document.createElement('h2');
    label.className = 'pile-label';
    label.innerHTML = '<span></span><i class="rule"></i><span class="pile-count"></span>';
    label.children[0].textContent = status.label;
    label.children[2].textContent = mine.length;
    pile.appendChild(label);

    const sheets = document.createElement('div');
    sheets.className = 'pile-sheets';
    for (const d of mine) sheets.appendChild(sheetCard(d, { current: d.id === doc.id }));

    if (status.id === Doc.STATUSES[0].id) sheets.appendChild(newSheet());
    pile.appendChild(sheets);
    host.appendChild(pile);
  }

  if (!n) {
    const empty = document.createElement('div');
    empty.className = 'pile-sheets';
    empty.appendChild(newSheet());
    host.appendChild(empty);
  }
}

function newSheet() {
  const el = document.createElement('div');
  el.className = 'sheet-card is-new';
  el.tabIndex = 0;
  el.innerHTML = '<span>Start something new</span>';
  const make = () => makeDocument();
  el.addEventListener('click', make);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); make(); }
  });
  return el;
}

function showDesk() {
  editor.harvest();
  save({ now: true });
  document.body.classList.add('is-desk');
  $('#desk').hidden = false;
  paintDesk();
}

function hideDesk() {
  document.body.classList.remove('is-desk');
  $('#desk').hidden = true;
}

/** Put the open document away and take another one out. */
async function openDocument(id) {
  if (id === doc.id) { hideDesk(); return; }
  editor.harvest();
  save({ now: true });
  const next = await Doc.readDocument(id);
  if (!next) return toast('That document could not be found.', true);
  Doc.setCurrentId(id);
  adopt(next);
  reload();
  hideDesk();
  await loadAllFonts();
  clearMetricCache();
  repaginate();
}

async function makeDocument() {
  editor.harvest();
  save({ now: true });
  const fresh = Doc.newDocument();
  await Doc.writeDocument(fresh);
  Doc.setCurrentId(fresh.id);
  adopt(fresh);
  reload();
  hideDesk();
  switchView('draft');
  $('#doc-title').focus();
  $('#doc-title').select();
}

async function setStatus(d, status) {
  if (d.id === doc.id) {
    doc.status = status;
    $('#doc-status').value = status;
    save({ now: true });
  } else {
    const target = await Doc.readDocument(d.id);
    if (!target) return;
    target.status = status;
    await Doc.writeDocument(target);
  }
  paintDesk();
}

async function removeDocument(d) {
  const n = d.words || 0;
  if (!await ask({
    title: `Delete “${d.title || 'Untitled'}”?`,
    body: `${n.toLocaleString()} word${n === 1 ? '' : 's'} and every picture in ` +
          'it go with it. There is no undo, and nothing is kept anywhere else.',
    yes: 'Delete it', danger: true,
  })) return;

  await Doc.deleteDocument(d.id);

  if (d.id === doc.id) {
    // The one that was open. Take out whichever is nearest to hand, or a
    // fresh sheet if the desk is now bare.
    const rest = await Doc.listDocuments();
    const next = rest[0] || Doc.newDocument();
    if (!rest.length) await Doc.writeDocument(next);
    Doc.setCurrentId(next.id);
    adopt(next);
    reload();
  }
  paintDesk();
  toast('Deleted.');
}

function buildStatusPicker() {
  const sel = $('#doc-status');
  for (const st of Doc.STATUSES) {
    const o = document.createElement('option');
    o.value = st.id; o.textContent = st.label;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    doc.status = sel.value;
    save({ now: true });
  });
}

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), isError ? 9000 : 4600);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  installFontFaces();

  // The library first: everything below is built around whichever document
  // comes out of it, and a shared link overrides it a moment later.
  try {
    adopt(await Doc.openCurrent());
  } catch (err) {
    console.warn('could not open the library; starting on a fresh sheet', err);
  }

  watchHash();
  const took = await handleIncoming();

  applyFlowCSS(doc.settings);
  layoutPaper();

  $('#doc-title').value = doc.title;
  $('#doc-status').value = doc.status;
  $('#doc-title').addEventListener('input', e => {
    doc.title = e.target.value;
    document.title = pageTitle(e.target.value);
    save();
  });
  document.title = pageTitle(doc.title);

  buildRail();
  buildFields($('#press-fields'), PRESS_SCHEMA, doc.settings, () => {
    save();
    if (view === 'save') paintSave();
  });

  bindToolbar();
  bindFigureBar();
  bindDocumentActions();
  bindExportMode();
  bindCommentBar();
  bindDraft();
  buildStatusPicker();
  paintNotesToggle();
  installMarkdownInput(editor);

  $('#to-desk').addEventListener('click', showDesk);
  $('#desk-close').addEventListener('click', hideDesk);
  $('#desk-new').addEventListener('click', makeDocument);
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#desk').hidden) hideDesk();
  });

  $('#who').value = Notes.whoAmI();
  $('#who').addEventListener('input', e => Notes.setWhoAmI(e.target.value.trim()));

  $$('#tabs button').forEach(b =>
    b.addEventListener('click', () => switchView(b.dataset.view)));
  $('#format-zoom').addEventListener('input', () => {
    zoomTouched.format = true;
    if (view === 'format') paintPageGrid();
  });
  $('#save-zoom').addEventListener('input', () => {
    zoomTouched.save = true;
    if (view === 'save') paintSave();
  });
  addEventListener('resize', () => {
    if (view === 'format') paintPageGrid();
    if (view === 'save') paintSave();
  });
  $('#export-pdf').addEventListener('click', exportPDF);
  $('#show-resolved').addEventListener('change', paintThreads);

  $$('#comment-filter button').forEach(b =>
    b.addEventListener('click', () => {
      commentFilter = b.dataset.filter;
      $$('#comment-filter button').forEach(x => x.classList.toggle('is-on', x === b));
      paintThreads();
    }));

  $('#share-link').addEventListener('click', shareLink);
  $('#share-file').addEventListener('click', shareFile);
  $('#notes-apply').addEventListener('click', () => applyNotes($('#notes-paste').value));
  $('#review-send').addEventListener('click', sendNotesBack);
  $('#notes-send').addEventListener('click', sendNotesBack);
  $('#link-close').addEventListener('click', () => $('#link-dialog').close());
  $('#link-copy').addEventListener('click', async () => {
    if (await Share.copyToClipboard($('#link-text').value)) toast('Copied.');
    else toast('Could not reach the clipboard — select the text and copy it.', true);
  });

  $('#share-note').textContent =
    'The link carries the whole draft inside itself, so it works with no ' +
    'server and no account — but a link that long can get mangled in transit, ' +
    'and it cannot carry pictures. The file can.';

  editor.addEventListener('change', e => schedule(e.detail));
  renderGalley();
  renderSectionLists();
  paintThreads();
  if (!took) applyView(doc.stage || 'edit');

  // Everything is measured, so nothing may be measured against a fallback
  // face: one wrong metric moves every page break in the document.
  await loadAllFonts();
  clearMetricCache();
  repaginate();

  // Getting the last few hundred milliseconds of typing onto disk.
  //
  // `beforeunload` is the obvious hook and the least dependable one: iOS
  // Safari never fires it, and neither does a tab the browser decides to
  // discard while it is in the background. `visibilitychange` to hidden is the
  // one event a browser will always deliver before it stops caring about you,
  // so that is the one that actually saves the work; the other two are belt
  // and braces.
  const persist = () => {
    if (reviewing) return;
    editor.harvest();
    save({ now: true });
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist();
  });
  window.addEventListener('pagehide', persist);
  window.addEventListener('beforeunload', persist);

  // A hook for poking at the internals from the console.
  window.desk = { doc, editor, draft, Doc, Notes, Share, paintDesk, showDesk,
                  get offsets() { return offsets; }, repaginate, importMarkdownText };
}

boot();
