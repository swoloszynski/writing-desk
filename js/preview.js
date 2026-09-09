// Drawing pages you can look at.
//
// A page preview is a window onto the galley, not a re-flow of it: the whole
// column is cloned, shifted up by that page's offset, and clipped to the
// content box. Nothing can disagree with the editor, because it is the same
// layout seen through a smaller hole. The PDF reads the same offsets.

import { metrics, folioBaseline, PT_TO_PX } from './doc.js';
import { marginsFor, impose, bookletOrder } from './imposition.js';
import { ascentOf } from './extract.js';

/** A non-editable copy of the galley, safe to position freely. */
export function cloneFlow(flow) {
  const c = flow.cloneNode(true);
  c.removeAttribute('id');
  c.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
  c.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));
  c.classList.add('wd-flow-clone');
  return c;
}

function folioText(pageNo, folio) {
  return folio.format.replace('#', String(pageNo + folio.startAt - 1));
}

/**
 * One page.
 * @param side 'left' | 'right' — recto or verso, which on a folded sheet
 *   decides which margin is at the fold. Ignored on unfolded paper.
 */
export function renderPage(flowClone, offset, settings, pageNo, {
  side = 'right', blank = false, label = null, scale = 1, height = null,
} = {}) {
  const m = metrics(settings);
  const mg = marginsFor(side, m);

  const page = document.createElement('div');
  page.className = 'wd-page';
  page.style.width = `${m.pageW}px`;
  page.style.height = `${m.pageH}px`;
  page.dataset.page = pageNo;
  if (blank) page.classList.add('is-blank');

  if (!blank) {
    const win = document.createElement('div');
    win.className = 'wd-page-window';
    win.style.left = `${mg.left}px`;
    win.style.top = `${m.marginTop}px`;
    win.style.width = `${m.contentW}px`;
    // A page ends either when the content box is full or at a forced break,
    // whichever comes first — otherwise the next page's text bleeds in.
    win.style.height = `${Math.max(0, Math.min(m.contentH, height ?? m.contentH))}px`;

    const inner = flowClone.cloneNode(true);
    inner.style.position = 'absolute';
    inner.style.left = '0';
    inner.style.top = `${-offset}px`;
    win.appendChild(inner);
    page.appendChild(win);

    const folio = settings.folio;
    const show = folio.on && !(pageNo === 1 && folio.hideOnFirst);
    if (show) {
      const f = document.createElement('div');
      f.className = 'wd-folio';
      f.textContent = folioText(pageNo, folio);
      const sizePx = folio.size * PT_TO_PX;
      f.style.fontFamily = `"${folio.font}"`;
      f.style.fontSize = `${sizePx}px`;
      // Positioned by its baseline, the same number the PDF uses. With
      // line-height:normal the line box is the font's own content area, so
      // the baseline sits exactly `ascent` below the top of the box.
      f.style.top = `${folioBaseline(settings, m) - ascentOf(folio.font, sizePx)}px`;
      if (folio.position === 'bottom-center') {
        f.style.left = '0'; f.style.right = '0'; f.style.textAlign = 'center';
      } else if (m.folded ? side === 'left' : pageNo % 2 === 0) {
        f.style.left = `${mg.left}px`; f.style.textAlign = 'left';
      } else {
        f.style.right = `${mg.right}px`; f.style.textAlign = 'right';
      }
      page.appendChild(f);
    }
  }

  if (label !== null) {
    const tag = document.createElement('div');
    tag.className = 'wd-page-tag';
    tag.textContent = label;
    page.appendChild(tag);
  }

  if (scale !== 1) return scaled(page, m.pageW, m.pageH, scale);
  return page;
}

function scaled(el, w, h, scale) {
  const box = document.createElement('div');
  box.className = 'wd-scaled';
  box.style.width = `${w * scale}px`;
  box.style.height = `${h * scale}px`;
  el.style.transform = `scale(${scale})`;
  el.style.transformOrigin = 'top left';
  box.appendChild(el);
  return box;
}

/** How much of the galley page `i` actually shows. */
function pageHeight(offsets, i) {
  const next = offsets[i + 1];
  return next === undefined ? Infinity : next - offsets[i];
}

/** Every page in reading order. */
export function renderReadingOrder(flow, offsets, settings, scale) {
  const clone = cloneFlow(flow);
  const frag = document.createDocumentFragment();
  offsets.forEach((off, i) => {
    const pageNo = i + 1;
    const side = pageNo % 2 === 1 ? 'right' : 'left';
    const cell = document.createElement('div');
    cell.className = 'wd-cell';
    cell.dataset.page = pageNo;
    cell.appendChild(renderPage(clone, off, settings, pageNo,
      { side, scale, height: pageHeight(offsets, i) }));
    const cap = document.createElement('div');
    cap.className = 'wd-cell-cap';
    cap.textContent = `page ${pageNo}`;
    cell.appendChild(cap);
    frag.appendChild(cell);
  });
  return frag;
}

/**
 * The sheets as they will be printed, front and back.
 *
 * @param backCoverFrom 1-based content page the pinned back cover starts on,
 *   or null to leave the padding at the end of the booklet.
 */
export function renderSheets(flow, offsets, settings, scale, backCoverFrom = null) {
  const clone = cloneFlow(flow);
  const m = metrics(settings);
  const { sheets, padded } = impose(offsets.length);
  const slots = bookletOrder(offsets.length, backCoverFrom);
  const frag = document.createDocumentFragment();

  sheets.forEach((sh, i) => {
    const group = document.createElement('div');
    group.className = 'wd-sheet-group';

    const head = document.createElement('div');
    head.className = 'wd-sheet-head';
    head.innerHTML =
      `<b>Sheet ${i + 1}</b> of ${sheets.length}` +
      `<span class="wd-sheet-pages">${sh.front[0]}&nbsp;·&nbsp;${sh.front[1]}` +
      `&nbsp;&nbsp;/&nbsp;&nbsp;${sh.back[0]}&nbsp;·&nbsp;${sh.back[1]}</span>`;
    group.appendChild(head);

    for (const side of ['front', 'back']) {
      const sheet = document.createElement('div');
      sheet.className = 'wd-sheet';
      sheet.style.width = `${m.sheetW}px`;
      sheet.style.height = `${m.sheetH}px`;

      sh[side].forEach((pageNo, half) => {
        const which = half === 0 ? 'left' : 'right';
        // `pageNo` is a position in the folded booklet; what it shows is
        // whatever content page the padding has left sitting there.
        const content = slots[pageNo - 1] ?? 0;
        const blank = content === 0;
        const p = renderPage(clone, offsets[content - 1] ?? 0, settings, pageNo,
                             { side: which, blank, label: String(pageNo),
                               height: pageHeight(offsets, content - 1) });
        p.classList.add('wd-sheet-half', `is-${which}`);
        sheet.appendChild(p);
      });

      if (settings.press.foldLine) {
        const fold = document.createElement('div');
        fold.className = 'wd-fold';
        sheet.appendChild(fold);
      }

      const wrap = document.createElement('div');
      wrap.className = 'wd-sheet-wrap';
      wrap.appendChild(scaled(sheet, m.sheetW, m.sheetH, scale));
      const cap = document.createElement('div');
      cap.className = 'wd-cell-cap';
      cap.textContent = side === 'front' ? 'front' : 'back';
      wrap.appendChild(cap);
      group.appendChild(wrap);
    }

    frag.appendChild(group);
  });

  return { frag, sheets: sheets.length, padded };
}

/** Seam markers over the editor, showing where each page ends. */
export function renderSeams(layer, offsets, settings) {
  const m = metrics(settings);
  layer.innerHTML = '';
  offsets.forEach((off, i) => {
    if (i === 0) return;
    const seam = document.createElement('div');
    seam.className = 'wd-seam';
    seam.style.top = `${off}px`;
    seam.innerHTML = `<span class="wd-seam-label">page ${i + 1}</span>`;
    layer.appendChild(seam);
  });

  // A ghost of the bottom margin on the last page, so the end of the
  // document does not look like it simply ran out of paper.
  const last = offsets[offsets.length - 1];
  const tail = document.createElement('div');
  tail.className = 'wd-seam is-end';
  tail.style.top = `${last + m.contentH}px`;
  tail.innerHTML = `<span class="wd-seam-label">end of page ${offsets.length}</span>`;
  layer.appendChild(tail);
}
