// The writing surface.
//
// Each section is its own contenteditable, stacked with no gaps inside one
// `.wd-flow` column. That gives sections something to be — a thing you can
// drag, name and start a page with — while the column as a whole is still a
// single continuous galley for the paginator to slice up.

import { uid, putImage, imageURL, cachedImageURL } from './doc.js';
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
  const box = document.createElement('div');
  box.innerHTML = html;

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

      if (!BLOCK_TAGS.has(tag) && !INLINE_KEEP.has(tag)) {
        // Unwrap rather than delete, so the words inside survive.
        const frag = document.createDocumentFragment();
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
        const p = document.createElement('p');
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
  const out = document.createElement('div');
  let run = null;
  for (const child of Array.from(box.childNodes)) {
    const isBlock = child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(child.tagName);
    if (isBlock) { run = null; out.appendChild(child); }
    else {
      if (child.nodeType === Node.TEXT_NODE && !/\S/.test(child.data)) continue;
      if (!run) { run = document.createElement('p'); out.appendChild(run); }
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
      el.innerHTML = s.html || '<p><br></p>';
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
      if (s) s.html = el.innerHTML;
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
    await putImage(id, { blob: file, w: dims.w, h: dims.h, name: file.name || '' });
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

      document.execCommand('insertHTML', false, clean);
      this.after();
    });

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

  /** Backspace at the very top of a section folds it into the one above. */
  _maybeMergeBack(e) {
    const sel = getSelection();
    if (!sel || !sel.isCollapsed) return;
    const sec = this.sectionAt(sel.anchorNode);
    if (!sec) return;

    const probe = document.createRange();
    probe.selectNodeContents(sec);
    probe.setEnd(sel.anchorNode, sel.anchorOffset);
    if (probe.toString().length !== 0) return;

    const idx = this.doc.sections.findIndex(s => s.id === sec.dataset.id);
    if (idx <= 0) return;

    e.preventDefault();
    const prev = this.doc.sections[idx - 1];
    const cur = this.doc.sections[idx];
    this.harvest();
    prev.html = (prev.html || '') + (cur.html || '');
    this.doc.sections.splice(idx, 1);
    this.render();
    const el = this.flow.querySelector(`[data-id="${prev.id}"]`);
    this.focusIn(el, true);
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
