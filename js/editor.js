// The writing surface.
//
// Each section is its own contenteditable, stacked with no gaps inside one
// `.wd-flow` column. That gives sections something to be — a thing you can
// drag, name and start a page with — while the column as a whole is still a
// single continuous galley for the paginator to slice up.

import { uid, putImage, getImage, imageURL, cachedImageURL, withoutImageSrc } from './doc.js';
import { blocksFromMarkdown, looksLikeMarkdown } from './markdown.js';

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI',
                            'BLOCKQUOTE', 'HR', 'FIGURE', 'FIGCAPTION', 'DIV']);
const INLINE_KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN', 'A']);
const KEEP_CLASS = new Set(['wd-caption', 'wd-noindent', 'wd-break']);

/**
 * Strip pasted or restored HTML back to the handful of things this document
 * knows how to lay out. Anything carrying its own fonts, colours or spacing
 * would quietly break the promise that the settings panel controls the page.
 */
export function sanitize(html) {
  // Parsed into an inert document, and this is the part that matters.
  //
  // Assigning to `innerHTML` on a detached <div> still belongs to the live
  // document, and a browser starts fetching an <img src> the moment the
  // element exists — so `<img src=x onerror=...>` fires while it is being
  // cleaned, and the sanitiser becomes the thing that runs the payload. A
  // document from DOMParser has no browsing context: nothing loads, nothing
  // executes, and the markup can be taken apart safely before any of it
  // reaches the page.
  const inert = new DOMParser().parseFromString(html, 'text/html');
  const box = inert.body;

  const walk = node => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }

      const tag = child.tagName;

      if (tag === 'IMG') {
        if (!child.dataset.zimg) { child.remove(); continue; }
        const id = child.dataset.zimg;
        for (const a of Array.from(child.attributes)) child.removeAttribute(a.name);
        child.dataset.zimg = id;
        continue;
      }

      if (tag === 'FIGURE') {
        const align = child.dataset.align || 'center';
        const width = /(\d+(?:\.\d+)?)%/.exec(child.style.width || '')?.[1] || '70';
        for (const a of Array.from(child.attributes)) child.removeAttribute(a.name);
        child.dataset.align = align;
        child.style.width = `${width}%`;
        walk(child);
        continue;
      }

      // Google Docs wraps a whole copy in <b style="font-weight:normal">, and
      // marks bold and italic text with spans. Styles are stripped below, so
      // read them first: drop the non-bold <b>, and turn styled spans into
      // <b> and <i>.
      const weight = child.style?.fontWeight || '';
      const bold = weight === 'bold' || parseInt(weight, 10) >= 600;
      const notBold = weight === 'normal' || parseInt(weight, 10) < 600;
      const unwrap = (!BLOCK_TAGS.has(tag) && !INLINE_KEEP.has(tag)) ||
                     ((tag === 'B' || tag === 'STRONG') && notBold);

      if (tag === 'SPAN' && (bold || child.style.fontStyle === 'italic')) {
        const outer = inert.createElement(bold ? 'b' : 'i');
        let inner = outer;
        if (bold && child.style.fontStyle === 'italic') {
          inner = inert.createElement('i');
          outer.appendChild(inner);
        }
        while (child.firstChild) inner.appendChild(child.firstChild);
        child.replaceWith(outer);
        walk(inner);
        continue;
      }

      if (unwrap) {
        // Unwrap rather than delete, so the words inside survive.
        const frag = inert.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        walk(node);
        return;
      }

      const cls = Array.from(child.classList).filter(c => KEEP_CLASS.has(c));
      for (const a of Array.from(child.attributes)) child.removeAttribute(a.name);
      if (cls.length) child.className = cls.join(' ');

      // A bare DIV from a paste is a paragraph in everything but name.
      if (tag === 'DIV' && !cls.includes('wd-break')) {
        const p = inert.createElement('p');
        while (child.firstChild) p.appendChild(child.firstChild);
        child.replaceWith(p);
        walk(p);
        continue;
      }

      walk(child);
    }
  };

  walk(box);

  // Top level must be blocks: loose text from a paste gets a paragraph.
  // Built inside the inert document too, so nothing crosses into the live
  // one until every attribute has been stripped.
  const out = inert.createElement('div');
  let run = null;
  for (const child of Array.from(box.childNodes)) {
    const isBlock = child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(child.tagName);
    if (isBlock) { run = null; out.appendChild(child); }
    else {
      if (child.nodeType === Node.TEXT_NODE && !/\S/.test(child.data)) continue;
      if (!run) { run = inert.createElement('p'); out.appendChild(run); }
      run.appendChild(child);
    }
  }

  return out.innerHTML || '<p><br></p>';
}

/** Plain text becomes one paragraph per blank-line-separated block. */
export function textToHtml(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(b => b.trim())
    .filter(Boolean)
    .map(b => `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`)
    .join('') || '<p><br></p>';
}

const escapeHtml = s =>
  s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ---------------------------------------------------------------------------

export class Editor extends EventTarget {
  constructor(flowEl, doc) {
    super();
    this.flow = flowEl;
    this.doc = doc;
    this.selectedFigure = null;
    // Set when the galley is somebody else's draft, opened to be read and
    // commented on. The sections still render and still measure — the page
    // previews and the PDF depend on that — they just cannot be typed into.
    this.readOnly = false;
    // Set by the app: async (prev, cur) => boolean, asked before Backspace at
    // the top of a section merges it into the one before.
    this.confirmMerge = null;
    this._bind();
  }

  /** Rebuild the galley from the model. Called on load and on reorder. */
  render() {
    this.flow.innerHTML = '';
    for (const s of this.doc.sections) {
      if (s.startsNewPage && this.flow.children.length) {
        const br = document.createElement('div');
        br.className = 'wd-break';
        br.contentEditable = 'false';
        this.flow.appendChild(br);
      }
      const el = document.createElement('div');
      el.className = 'wd-section';
      el.dataset.id = s.id;
      el.contentEditable = this.readOnly ? 'false' : 'true';
      el.spellcheck = !this.readOnly;
      // Older saves include a stale src; resolveImages() sets a current one.
      el.innerHTML = withoutImageSrc(s.html || '') || '<p><br></p>';
      this.flow.appendChild(el);
    }
    this.resolveImages();
    this.changed({ structural: true });
  }

  /** Point every <img> at its blob. Ids in the HTML, bytes in IndexedDB. */
  async resolveImages() {
    const imgs = Array.from(this.flow.querySelectorAll('img[data-zimg]'));
    let painted = false;
    await Promise.all(imgs.map(async img => {
      const cached = cachedImageURL(img.dataset.zimg);
      if (cached) { if (img.src !== cached) img.src = cached; return; }
      const url = await imageURL(img.dataset.zimg);
      if (url) { img.src = url; painted = true; }
      else img.closest('figure')?.remove();
    }));
    if (painted) this.changed({ structural: true });
  }

  // A paragraph cannot legally hold a list, a quote or a rule, but the
  // browser's own list command will happily leave one inside the paragraph it
  // was invoked on. It looks right until the document is saved and read back:
  // innerHTML round-trips through the parser, which pulls the block out of the
  // paragraph and splits it in two. So it is straightened out here, at the one
  // place the DOM becomes the model, rather than everywhere that edits it.
  static NESTED_BLOCK =
    'p > ul, p > ol, p > blockquote, p > h1, p > h2, p > h3, p > hr, p > figure, p > p';

  normalize() {
    for (const nested of [...this.flow.querySelectorAll(Editor.NESTED_BLOCK)]) {
      const p = nested.parentElement;
      if (!p || p.tagName !== 'P' || !this.flow.contains(p)) continue;

      // The placeholder <br> a browser leaves in an empty block is not content.
      p.querySelectorAll(':scope > br').forEach(br => br.remove());

      // Only lift it out if the paragraph held nothing else; anything more is
      // a shape this does not understand, and mangling it would be worse.
      const stray = Array.from(p.childNodes).some(n =>
        n !== nested && (n.nodeType !== Node.TEXT_NODE || /\S/.test(n.data)));
      if (stray) continue;

      p.replaceWith(nested);
    }

  }

  /** Pull the DOM back into the model. */
  harvest() {
    this.normalize();
    for (const el of this.flow.querySelectorAll('.wd-section')) {
      const s = this.doc.sections.find(x => x.id === el.dataset.id);
      if (s) s.html = withoutImageSrc(el.innerHTML);
    }
  }

  changed(detail = {}) {
    this.dispatchEvent(new CustomEvent('change', { detail }));
  }

  sectionAt(node) {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (el && el !== this.flow && !el.classList?.contains('wd-section')) el = el.parentElement;
    return el && el.classList?.contains('wd-section') ? el : null;
  }

  /** The section holding the caret, defaulting to the first one. */
  activeSection() {
    const sel = getSelection();
    const el = sel && sel.rangeCount ? this.sectionAt(sel.anchorNode) : null;
    return el || this.flow.querySelector('.wd-section');
  }

  focusIn(sectionEl, atEnd = false) {
    if (!sectionEl) return;
    sectionEl.focus();
    const r = document.createRange();
    r.selectNodeContents(sectionEl);
    r.collapse(!atEnd);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /**
   * Put the caret in the section nearest a click that missed every section.
   *
   * An empty section is one line tall, and the page break gap and paper
   * margins around it take no clicks, so getting the caret into it took a
   * precise click. A click within `reach` px above or below a section, or in
   * the margin beside it, goes to the nearest point inside it.
   * @returns {boolean} whether a section took the caret
   */
  focusNear(x, y, reach = 60) {
    let best = null;
    let dist = Infinity;
    for (const el of this.flow.querySelectorAll('.wd-section')) {
      const r = el.getBoundingClientRect();
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < dist) { dist = d; best = { el, r }; }
    }
    if (!best || dist > reach) return false;

    const { el, r } = best;
    const cx = Math.min(Math.max(x, r.left + 1), r.right - 1);
    const cy = Math.min(Math.max(y, r.top + 1), r.bottom - 1);
    const hit = document.caretRangeFromPoint?.(cx, cy);
    el.focus();
    if (hit && el.contains(hit.startContainer)) {
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(hit);
    } else {
      this.focusIn(el, y > r.top + r.height / 2);
    }
    return true;
  }

  // --- commands -----------------------------------------------------------

  exec(cmd, value = null) {
    this.activeSection()?.focus();
    document.execCommand(cmd, false, value);
    this.after();
  }

  setBlock(kind) {
    const sec = this.activeSection();
    if (!sec) return;
    sec.focus();

    if (kind === 'caption') {
      document.execCommand('formatBlock', false, 'p');
      this.currentBlocks().forEach(b => { b.className = 'wd-caption'; });
    } else if (kind === 'quote') {
      document.execCommand('formatBlock', false, 'blockquote');
    } else {
      document.execCommand('formatBlock', false, kind);
      this.currentBlocks().forEach(b => b.classList.remove('wd-caption'));
    }
    this.after();
  }

  /** The top-level blocks the selection touches. */
  currentBlocks() {
    const sel = getSelection();
    if (!sel || !sel.rangeCount) return [];
    const sec = this.sectionAt(sel.anchorNode);
    if (!sec) return [];
    const out = [];
    for (const b of sec.children) {
      const r = document.createRange();
      r.selectNode(b);
      if (sel.getRangeAt(0).intersectsNode(b)) out.push(b);
    }
    return out;
  }

  insertHTML(html) {
    this.activeSection()?.focus();
    document.execCommand('insertHTML', false, html);
    this.after();
  }

  insertRule() { this.insertHTML('<hr><p><br></p>'); }

  async insertImage(file) {
    const id = uid('img');
    const dims = await imageSize(file);
    // Filed under the document, so tidying one never reaches into another.
    await putImage(id, { blob: file, w: dims.w, h: dims.h,
                         name: file.name || '', docId: this.doc.id });
    const url = await imageURL(id);
    this.insertHTML(
      `<figure data-align="center" style="width:70%">` +
      `<img data-zimg="${id}" src="${url}"></figure><p><br></p>`
    );
    // The picture arrives with no intrinsic height until it decodes, so the
    // page breaks have to be recomputed once it has.
    const img = this.flow.querySelector(`img[data-zimg="${id}"]`);
    if (img && !img.complete) img.addEventListener('load', () => this.changed({ structural: true }));
  }

  selectFigure(fig) {
    if (this.selectedFigure) this.selectedFigure.classList.remove('is-selected');
    this.selectedFigure = fig;
    if (fig) fig.classList.add('is-selected');
    this.dispatchEvent(new CustomEvent('figure', { detail: { figure: fig } }));
  }

  updateFigure(fig, { width, align, caption }) {
    if (!fig) return;
    if (width !== undefined) fig.style.width = `${width}%`;
    if (align !== undefined) fig.dataset.align = align;
    if (caption !== undefined) {
      let cap = fig.querySelector('figcaption');
      if (caption && !cap) {
        cap = document.createElement('figcaption');
        cap.textContent = 'Caption';
        fig.appendChild(cap);
      } else if (!caption && cap) cap.remove();
    }
    this.after();
  }

  removeFigure(fig) {
    if (!fig) return;
    this.selectFigure(null);
    fig.remove();
    this.after();
  }

  after() {
    this.harvest();
    this.changed({ structural: true });
  }

  // --- events -------------------------------------------------------------

  _bind() {
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
    try { document.execCommand('styleWithCSS', false, false); } catch {}

    this.flow.addEventListener('input', () => {
      this.harvest();
      this.changed({ structural: false });
    });

    this.flow.addEventListener('paste', e => {
      e.preventDefault();
      const dt = e.clipboardData;
      const file = Array.from(dt.files || []).find(f => f.type.startsWith('image/'));
      if (file) { this.insertImage(file); return; }
      const html = dt.getData('text/html');
      const text = dt.getData('text/plain');

      // Pasting is the other way work arrives here, so markdown has to be
      // understood on the way in and not just from a file. Source text wins
      // over the rich flavour when both are offered: a clipboard carrying
      // literal `##` came from an editor showing markdown, and its HTML is a
      // syntax-highlighted rendering that would paste the hashes in as text.
      const clean = looksLikeMarkdown(text) ? sanitize(blocksFromMarkdown(text))
                  : html ? sanitize(html)
                  : textToHtml(text);

      this._adoptImages(clean).then(adopted => {
        this._insertPasted(adopted);
        this.after();
        // sanitize() strips src, so pasted pictures need their blob URLs set.
        this.resolveImages();
      });
    });

    // Copy and cut write the clipboard here rather than leaving it to the
    // browser. A picture clicked in the galley is outlined but not part of
    // the text selection, so the browser copied nothing for it. A selection
    // ending inside a figure was serialized without the figure, or without
    // the picture.
    this.flow.addEventListener('copy', e => this._copy(e, false));
    this.flow.addEventListener('cut', e => this._copy(e, true));

    this.flow.addEventListener('drop', e => {
      const file = Array.from(e.dataTransfer?.files || []).find(f => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      this.insertImage(file);
    });

    this.flow.addEventListener('click', e => {
      const fig = e.target.closest('figure');
      this.selectFigure(fig && this.flow.contains(fig) ? fig : null);
    });

    this.flow.addEventListener('keydown', e => {
      if (e.key === 'Backspace') this._maybeMergeBack(e);

      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        const map = { b: 'bold', i: 'italic', u: 'underline' };
        if (map[k]) { e.preventDefault(); this.exec(map[k]); }
        if (k === 'enter') { e.preventDefault(); this.insertHTML('<div class="wd-break"></div><p><br></p>'); }
      }
    });
  }

  /**
   * Insert sanitized HTML from a paste without changing any block's type.
   *
   * insertHTML merges the first and last pasted blocks into the block around
   * the caret. Pasting paragraphs into a heading made them part of the
   * heading, and Chrome added inline font-weight and font-size to hide it.
   * So a paste of one paragraph is inserted as inline content, and takes the
   * type of the block it lands in. A paste of several blocks replaces the
   * block at the caret with its own two halves around the pasted blocks.
   * Replacing the contents of a paragraph this way keeps every block intact,
   * so a heading is first turned into a paragraph. All steps go through
   * execCommand, so undo still works.
   */
  _insertPasted(html) {
    const sel = getSelection();
    if (!sel?.rangeCount) return this._insertWithoutStyles(html);
    this._trimSelection(sel);

    const blocks = Array.from(new DOMParser().parseFromString(html, 'text/html').body.children);
    if (blocks.length === 1 && blocks[0].tagName === 'P') {
      return this._insertWithoutStyles(blocks[0].innerHTML);
    }

    if (!sel.isCollapsed) document.execCommand('delete');
    let block = this._blockAt(sel.anchorNode);
    if (!block || !/^(P|H1|H2|H3)$/.test(block.tagName)) return this._insertWithoutStyles(html);

    const tag = block.tagName.toLowerCase();
    const caret = sel.getRangeAt(0);
    const half = (atStart) => {
      const r = document.createRange();
      r.selectNodeContents(block);
      if (atStart) r.setEnd(caret.startContainer, caret.startOffset);
      else r.setStart(caret.startContainer, caret.startOffset);
      const box = document.createElement('div');
      box.appendChild(r.cloneContents());
      return /\S/.test(box.textContent) ? `<${tag}>${box.innerHTML}</${tag}>` : '';
    };
    const replacement = half(true) + html + half(false);

    if (tag !== 'p') {
      document.execCommand('formatBlock', false, 'p');
      block = this._blockAt(sel.anchorNode);
    }
    const all = document.createRange();
    all.selectNodeContents(block);
    sel.removeAllRanges();
    sel.addRange(all);
    this._insertWithoutStyles(replacement);
  }

  /**
   * insertHTML, then remove the inline styles Chrome adds to make pasted text
   * look the way it did at its source. The settings panel sets the type, so
   * those styles would override it.
   */
  _insertWithoutStyles(html) {
    const before = new Set(this.flow.querySelectorAll('[style]'));
    document.execCommand('insertHTML', false, html);
    for (const el of this.flow.querySelectorAll('[style]')) {
      if (before.has(el) || el.tagName === 'FIGURE') continue;
      if (el.tagName === 'SPAN' || el.tagName === 'FONT') el.replaceWith(...el.childNodes);
      else el.removeAttribute('style');
    }
  }

  /**
   * A triple-click selects a paragraph up to the start of the next block.
   * Pasting over that would merge the next block into the paste, so the
   * selection is ended at the end of the paragraph instead.
   */
  _trimSelection(sel) {
    const r = sel.getRangeAt(0);
    if (r.collapsed) return;
    const end = this._blockAt(r.endContainer);
    if (!end || end === this._blockAt(r.startContainer)) return;
    const lead = document.createRange();
    lead.selectNodeContents(end);
    lead.setEnd(r.endContainer, r.endOffset);
    if (lead.toString() !== '' || !end.previousElementSibling) return;
    r.setEnd(end.previousElementSibling, end.previousElementSibling.childNodes.length);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  /**
   * Put the selection, or the selected picture, on the clipboard.
   * A selection that starts or ends inside a figure takes the whole figure.
   */
  _copy(e, cut) {
    const sel = getSelection();
    const fig = this.selectedFigure;
    let range = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const figOnly = !!fig && this.flow.contains(fig) &&
                    (!range || range.collapsed || fig.contains(range.startContainer));
    if (figOnly) {
      range = document.createRange();
      range.selectNode(fig);
    }
    if (!range || range.collapsed || !this.flow.contains(range.commonAncestorContainer)) return;

    const startFig = range.startContainer.parentElement?.closest('figure');
    const endFig = range.endContainer.parentElement?.closest('figure') ||
                   (range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer.closest('figure') : null);
    if (startFig && this.flow.contains(startFig)) range.setStartBefore(startFig);
    if (endFig && this.flow.contains(endFig)) range.setEndAfter(endFig);

    const box = document.createElement('div');
    box.appendChild(range.cloneContents());
    // Selection.toString() puts line breaks between blocks; Range.toString()
    // does not. So the plain text is read through the selection.
    const original = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    sel.removeAllRanges();
    sel.addRange(range);
    const text = sel.toString();
    if (!cut && original) {
      sel.removeAllRanges();
      sel.addRange(original);
    }
    e.preventDefault();
    e.clipboardData.setData('text/html', box.innerHTML);
    e.clipboardData.setData('text/plain', text);
    if (!cut || this.readOnly) return;

    if (figOnly) {
      this.removeFigure(fig);
      return;
    }
    document.execCommand('delete');
    this.after();
  }

  /** The top-level block inside a section that holds `node`. */
  _blockAt(node) {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    while (el && !el.parentElement?.classList.contains('wd-section')) {
      if (el.classList?.contains('wd-section') || el === this.flow) return null;
      el = el.parentElement;
    }
    return el || null;
  }

  /**
   * Copy pasted pictures that belong to another document into this one.
   *
   * Images are filed under one document, and deleting that document deletes
   * them. A picture pasted from another document gets a new id filed under
   * this one, so deleting the source does not remove it here.
   */
  async _adoptImages(html) {
    if (!html.includes('data-zimg')) return html;
    const box = new DOMParser().parseFromString(html, 'text/html').body;
    for (const img of box.querySelectorAll('img[data-zimg]')) {
      const rec = await getImage(img.dataset.zimg);
      if (!rec || rec.docId === this.doc.id) continue;
      const id = uid('img');
      await putImage(id, { ...rec, docId: this.doc.id });
      img.dataset.zimg = id;
    }
    return box.innerHTML;
  }

  /** Backspace at the very top of a section folds it into the one above. */
  _maybeMergeBack(e) {
    const sel = getSelection();
    if (!sel || !sel.isCollapsed) return;
    const sec = this.sectionAt(sel.anchorNode);
    if (!sec) return;

    // Only at the start of the first block. Checking for text alone treated
    // the start of any block below an empty paragraph or an uncaptioned
    // picture as the top of the section, so deleting that empty line merged
    // the whole section into the one before it.
    const atTop = sel.anchorNode === sec ? sel.anchorOffset === 0
                                         : this._blockAt(sel.anchorNode) === sec.firstElementChild;
    if (!atTop) return;
    const probe = document.createRange();
    probe.selectNodeContents(sec);
    probe.setEnd(sel.anchorNode, sel.anchorOffset);
    if (probe.toString().length !== 0 || probe.cloneContents().querySelector('img, hr')) return;

    const idx = this.doc.sections.findIndex(s => s.id === sec.dataset.id);
    if (idx <= 0) return;

    e.preventDefault();
    const prev = this.doc.sections[idx - 1];
    const cur = this.doc.sections[idx];
    const caret = sel.getRangeAt(0).cloneRange();

    // A merge cannot be undone, and it drops the section's name and its
    // "Start on a new page" setting, so the app is asked first.
    Promise.resolve(this.confirmMerge ? this.confirmMerge(prev, cur) : true).then(ok => {
      if (!ok) {
        sec.focus();
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(caret);
        return;
      }
      this.harvest();
      // Comments are anchored by character offset in their section, so the
      // app moves cur's comments along by the length of prev's text.
      const shift = new DOMParser().parseFromString(prev.html || '', 'text/html')
        .body.textContent.length;
      prev.html = (prev.html || '') + (cur.html || '');
      const at = this.doc.sections.indexOf(cur);
      if (at >= 0) this.doc.sections.splice(at, 1);
      this.render();
      const el = this.flow.querySelector(`[data-id="${prev.id}"]`);
      this.focusIn(el, true);
      this.dispatchEvent(new CustomEvent('merge', { detail: { prev, cur, shift } }));
    });
  }
}

function imageSize(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ w: 0, h: 0 }); };
    img.src = url;
  });
}
