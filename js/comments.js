// Comments, and the problem of holding on to a piece of text.
//
// A comment points at a passage. The passage is stored twice: as a pair of
// character offsets into its section, which is exact but goes stale the
// moment anyone types above it, and as the words themselves, which never go
// stale but might appear more than once. Neither is enough on its own. The
// offsets are the fast answer and the quote is how the comment finds its way
// home when the offsets turn out to be wrong.
//
// Highlights are drawn as rectangles in a layer over the text rather than by
// wrapping it in tags. Wrapping would put markup inside the editable content,
// where it would be saved, exported, and eventually mangled by someone
// selecting across it. A comment is a thing said *about* the document; it has
// no business being in it.

import { uid } from './doc.js';

const WHO_KEY = 'writing-desk/who';

export function whoAmI() {
  try { return localStorage.getItem(WHO_KEY) || ''; } catch { return ''; }
}
export function setWhoAmI(name) {
  try { localStorage.setItem(WHO_KEY, name); } catch {}
}

// ---------------------------------------------------------------------------
// Offsets and ranges
// ---------------------------------------------------------------------------

/** Every text node under `root`, in document order. */
function textNodes(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n);
  return out;
}

/** Character offset of a (node, offset) point, counted from `root`. */
export function offsetOf(root, node, nodeOffset) {
  if (!root.contains(node)) return null;
  let total = 0;
  for (const t of textNodes(root)) {
    if (t === node) return total + nodeOffset;
    total += t.data.length;
  }
  // A point sitting on an element rather than inside a text node.
  const probe = document.createRange();
  probe.selectNodeContents(root);
  try { probe.setEnd(node, nodeOffset); } catch { return null; }
  return probe.toString().length;
}

/** The DOM range covering [start, end) of `root`'s text. */
export function rangeForOffsets(root, start, end) {
  const range = document.createRange();
  let seen = 0;
  let startSet = false;
  range.setStart(root, 0);
  range.setEnd(root, 0);

  for (const t of textNodes(root)) {
    const next = seen + t.data.length;
    if (!startSet && start <= next) {
      range.setStart(t, Math.max(0, Math.min(t.data.length, start - seen)));
      startSet = true;
    }
    if (startSet && end <= next) {
      range.setEnd(t, Math.max(0, Math.min(t.data.length, end - seen)));
      return range;
    }
    seen = next;
  }
  if (!startSet) return null;
  const last = textNodes(root).pop();
  if (last) range.setEnd(last, last.data.length);
  return range;
}

const squash = s => s.replace(/\s+/g, ' ').trim();

/**
 * Put a comment back on the passage it was written about.
 *
 * Tried in order: the offsets it was saved with, the nearest occurrence of
 * the quoted words to where they used to be, and the same with whitespace
 * flattened — which is what catches a passage that has been reflowed but not
 * rewritten. When none of those find it, the comment is not thrown away; it
 * is marked orphaned and shown on its own, because "somebody said something
 * about a sentence you have since deleted" is information.
 */
export function reanchor(comment, sectionEl) {
  if (!sectionEl) { comment.orphaned = true; return comment; }

  const text = sectionEl.textContent;
  const quote = comment.quote;

  if (!quote) { comment.orphaned = true; return comment; }
  if (text.slice(comment.start, comment.end) === quote) {
    comment.orphaned = false;
    return comment;
  }

  const near = nearestIndex(text, quote, comment.start);
  if (near >= 0) {
    comment.start = near;
    comment.end = near + quote.length;
    comment.orphaned = false;
    return comment;
  }

  const flat = squash(quote);
  if (flat) {
    const loose = nearestIndex(squash(text), flat, comment.start);
    if (loose >= 0) {
      // Offsets in the flattened copy are not offsets in the real one, so
      // walk the real text until the same number of non-space characters has
      // gone by. Cheap, and exact for the only case that matters.
      const mapped = mapFlatIndex(text, loose);
      if (mapped >= 0) {
        comment.start = mapped;
        comment.end = mapped + quote.length;
        comment.orphaned = false;
        return comment;
      }
    }
  }

  comment.orphaned = true;
  return comment;
}

/** Occurrence of `needle` closest to `from`. -1 if there is none. */
function nearestIndex(hay, needle, from) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const d = Math.abs(i - from);
    if (d < bestDist) { best = i; bestDist = d; }
  }
  return best;
}

function mapFlatIndex(text, flatIndex) {
  let flat = 0;
  let lastWasSpace = true;
  for (let i = 0; i < text.length; i++) {
    const isSpace = /\s/.test(text[i]);
    if (isSpace && lastWasSpace) continue;
    if (flat === flatIndex) return i;
    flat++;
    lastWasSpace = isSpace;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Making one
// ---------------------------------------------------------------------------

/** The section element a selection sits in, if it sits in exactly one. */
export function selectionSection(flow) {
  const sel = getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const of = node => {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (el && el !== flow && !el.classList?.contains('wd-section')) el = el.parentElement;
    return el?.classList?.contains('wd-section') ? el : null;
  };
  const a = of(range.startContainer);
  const b = of(range.endContainer);
  // A comment spanning two sections has no single anchor, and quietly
  // truncating it to the first would attach the note to half the sentence.
  return a && a === b ? a : null;
}

export function commentFromSelection(flow, { author = '' } = {}) {
  const sectionEl = selectionSection(flow);
  if (!sectionEl) return null;
  const range = getSelection().getRangeAt(0);
  const start = offsetOf(sectionEl, range.startContainer, range.startOffset);
  const end = offsetOf(sectionEl, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) return null;

  return {
    id: uid('c'),
    sectionId: sectionEl.dataset.id,
    start, end,
    quote: sectionEl.textContent.slice(start, end),
    author: author || 'Anonymous',
    text: '',
    // Absent on an ordinary note. On a suggestion it is the wording proposed
    // in place of `quote` — plain text, because a passage is anchored by
    // character offsets into the section's text and a replacement carrying
    // its own markup could not be put back at one.
    suggestion: null,
    createdAt: new Date().toISOString(),
    resolved: false,
    orphaned: false,
    replies: [],
  };
}

export const isSuggestion = c => typeof c.suggestion === 'string';

/**
 * Put a suggestion's wording in place of the passage it was written about.
 *
 * Done against the live section rather than its stored HTML, which is what
 * makes it safe: the range comes from the same offsets the highlight is drawn
 * from, so what is replaced is exactly what the reader saw struck through.
 * The markup around the passage is untouched; markup *inside* it does not
 * survive, because the replacement is text.
 *
 * The caller re-anchors first. A suggestion written on Tuesday about a
 * sentence that moved on Wednesday still knows its words, and applying it at
 * the offsets it was written with would drop it into the middle of another
 * one.
 */
export function applySuggestion(sectionEl, c) {
  if (!isSuggestion(c) || !sectionEl || c.orphaned) return false;
  const range = rangeForOffsets(sectionEl, c.start, c.end);
  if (!range) return false;

  // Look before writing. Offsets are the fast answer and they are sometimes
  // the wrong one — re-anchoring by flattened whitespace lands close rather
  // than exact, and a comment carried in from a link was written against
  // somebody else's copy of the piece. Everywhere else in this file being
  // approximate costs a highlight a pixel; here it would rewrite whatever
  // sentence happened to be sitting at those numbers. So the words under the
  // range have to be the words the suggestion was written about.
  const here = range.toString();
  if (here !== c.quote && squash(here) !== squash(c.quote)) return false;

  range.deleteContents();
  if (c.suggestion) range.insertNode(document.createTextNode(c.suggestion));
  return true;
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

/**
 * Draw every comment's highlight into `layer`.
 *
 * The layer sits *under* the text rather than over it, and takes no pointer
 * events at all. Over the top it would have swallowed the click that puts the
 * caret in a highlighted sentence, which is the one place you are most likely
 * to want to type. Clicking a highlight still selects its comment; see
 * `markAt`, which finds the mark by where the click landed instead.
 */
export function paintHighlights(flow, layer, comments, { activeId = null } = {}) {
  layer.textContent = '';
  // Against the layer, not the galley: the two are siblings inside a padded
  // sheet, and measuring from the wrong one offsets every mark by the margin.
  const base = layer.getBoundingClientRect();

  for (const c of comments) {
    if (c.resolved || c.orphaned) continue;
    const sectionEl = flow.querySelector(`.wd-section[data-id="${c.sectionId}"]`);
    if (!sectionEl) continue;
    const range = rangeForOffsets(sectionEl, c.start, c.end);
    if (!range) continue;

    for (const r of range.getClientRects()) {
      if (r.width < 0.5 && r.height < 0.5) continue;
      const mark = document.createElement('div');
      mark.className = 'wd-mark';
      if (c.id === activeId) mark.classList.add('is-active');
      mark.dataset.comment = c.id;
      mark.style.left = `${r.left - base.left}px`;
      mark.style.top = `${r.top - base.top}px`;
      mark.style.width = `${r.width}px`;
      mark.style.height = `${r.height}px`;
      layer.appendChild(mark);
    }
  }
}

/** Comments in the order a reader meets them. */
export function inReadingOrder(doc) {
  const rank = new Map(doc.sections.map((s, i) => [s.id, i]));
  return doc.comments.slice().sort((a, b) =>
    (rank.get(a.sectionId) ?? 1e9) - (rank.get(b.sectionId) ?? 1e9) || a.start - b.start);
}

/** Fold incoming comments in by id, keeping whichever version says more. */
export function merge(doc, incoming) {
  const byId = new Map(doc.comments.map(c => [c.id, c]));
  let added = 0;
  let updated = 0;

  for (const raw of incoming) {
    const existing = byId.get(raw.id);
    if (!existing) {
      doc.comments.push(raw);
      byId.set(raw.id, raw);
      added++;
      continue;
    }
    // Replies are the part that grows on the other side, so they are merged
    // rather than replaced. Resolving is the author's call and stays theirs.
    const seen = new Set(existing.replies.map(r => r.id));
    const fresh = (raw.replies || []).filter(r => !seen.has(r.id));
    const newWording = typeof raw.suggestion === 'string'
      && raw.suggestion !== existing.suggestion;
    if (fresh.length || existing.text !== raw.text || newWording) updated++;
    existing.replies.push(...fresh);
    if (!existing.text && raw.text) existing.text = raw.text;
    // A reader who turned a note into a suggestion, or reworded one, is
    // saying the thing the round trip exists to carry.
    if (newWording) existing.suggestion = raw.suggestion;
  }

  return { added, updated };
}

export const openCount = doc => doc.comments.filter(c => !c.resolved).length;

export function relativeTime(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** The comment whose highlight is under a point, if any. */
export function markAt(layer, x, y) {
  for (const mark of layer.children) {
    const r = mark.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return mark.dataset.comment;
    }
  }
  return null;
}
