// Turning laid-out DOM into something a PDF writer can draw.
//
// Rather than re-implementing text layout for the PDF, we ask the browser
// where every word ended up and copy those positions down. Each word is
// placed individually, so justification, tracking and mixed styling all come
// out exactly as measured instead of drifting a little further along the line
// with every space.
//
// Coordinates are galley pixels: x from the left edge of the content column,
// y down from the top of the whole column.

import { FAMILY_NAMES } from './fonts.js';
import { LIST_INDENT_EM } from './flow.js';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);

/** Match a computed font-family stack back to a family we can embed. */
function resolveFamily(css) {
  const first = (css || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  if (FAMILY_NAMES.includes(first)) return first;
  const hit = FAMILY_NAMES.find(n => n.toLowerCase() === first.toLowerCase());
  return hit || FAMILY_NAMES[0];
}

function parseColor(css) {
  const m = /rgba?\(([^)]+)\)/.exec(css || '');
  if (!m) return { r: 0, g: 0, b: 0, a: 1 };
  const [r, g, b, a] = m[1].split(',').map(s => parseFloat(s));
  return { r: r / 255, g: g / 255, b: b / 255, a: a === undefined ? 1 : a };
}

// ---------------------------------------------------------------------------
// Baselines
//
// A Range rect tells us the top of a word's inline box, not where it sits on
// its line. The distance between the two is the font's ascent at that size —
// constant for a given face, and independent of line-height — so it is
// measured once per face and size with a zero-height inline-block, whose top
// edge *is* the baseline.
// ---------------------------------------------------------------------------

let probe = null;
const ascentCache = new Map();

function ascentFor(family, sizePx, weight, italic) {
  const key = `${family}|${sizePx}|${weight}|${italic}`;
  if (ascentCache.has(key)) return ascentCache.get(key);

  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:absolute;left:-99999px;top:0;visibility:hidden;' +
      'white-space:nowrap;line-height:normal;contain:layout style';
    document.body.appendChild(probe);
  }

  probe.style.fontFamily = `"${family}"`;
  probe.style.fontSize = `${sizePx}px`;
  probe.style.fontWeight = String(weight);
  probe.style.fontStyle = italic ? 'italic' : 'normal';
  probe.innerHTML = '<span style="display:inline-block;width:0;height:0;' +
                    'vertical-align:baseline"></span><span>Hxpg</span>';

  const strut = probe.firstChild;
  const text = probe.lastChild;
  const ascent = strut.getBoundingClientRect().top - text.getBoundingClientRect().top;

  ascentCache.set(key, ascent);
  return ascent;
}

export function clearMetricCache() { ascentCache.clear(); }

/** The ascent of a face at a size, in px. Used to place the folio exactly. */
export function ascentOf(family, sizePx, weight = 400, italic = false) {
  return ascentFor(family, sizePx, weight, italic);
}

function styleOf(el) {
  const cs = getComputedStyle(el);
  const weight = parseInt(cs.fontWeight, 10) || 400;
  return {
    family: resolveFamily(cs.fontFamily),
    size: parseFloat(cs.fontSize),
    weight: weight >= 600 ? 700 : 400,
    italic: cs.fontStyle !== 'normal',
    color: parseColor(cs.color),
    underline: cs.textDecorationLine.includes('underline'),
    strike: cs.textDecorationLine.includes('line-through'),
    caps: cs.textTransform === 'uppercase',
    // Tracking is added after every character, spaces included. The PDF has
    // its own control for this; without carrying it across, a tracked-out
    // heading would print narrower than it looks here.
    tracking: cs.letterSpacing === 'normal' ? 0 : (parseFloat(cs.letterSpacing) || 0),
  };
}

/**
 * Every drawable thing in the galley, in galley coordinates.
 * @returns {Array} words, markers, images and rules
 */
export function extract(flow) {
  const box = flow.getBoundingClientRect();
  const ox = box.left, oy = box.top;
  const items = [];

  const push = (st, text, rect) => {
    if (!text) return;
    const asc = ascentFor(st.family, st.size, st.weight, st.italic);
    items.push({
      type: 'text',
      x: rect.left - ox,
      baseline: rect.top - oy + asc,
      w: rect.width,
      text,
      family: st.family, size: st.size, weight: st.weight, italic: st.italic,
      color: st.color, underline: st.underline, strike: st.strike,
      tracking: st.tracking,
    });
  };

  // --- text ---------------------------------------------------------------
  const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.data || !/\S/.test(node.data)) return NodeFilter.FILTER_REJECT;
      let p = node.parentElement;
      while (p && p !== flow) {
        if (SKIP.has(p.tagName) || p.classList.contains('wd-break')) {
          return NodeFilter.FILTER_REJECT;
        }
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const st = styleOf(node.parentElement);
    const data = node.data;

    for (const m of data.matchAll(/\S+/g)) {
      const start = m.index, end = start + m[0].length;
      range.setStart(node, start);
      range.setEnd(node, end);
      const rects = Array.from(range.getClientRects()).filter(r => r.width > 0);
      if (!rects.length) continue;

      const word = st.caps ? m[0].toUpperCase() : m[0];

      if (rects.length === 1) {
        push(st, word, rects[0]);
      } else {
        // The word was broken across lines. Fall back to placing each
        // character where the browser actually put it.
        for (let k = 0; k < m[0].length; k++) {
          range.setStart(node, start + k);
          range.setEnd(node, start + k + 1);
          const r = range.getClientRects()[0];
          if (r && r.width > 0) push(st, word[k], r);
        }
      }
    }
  }
  range.detach?.();

  // --- list markers -------------------------------------------------------
  //
  // The bullet lives in a ::before, which has no node to measure. Its
  // position is fully determined by the rules in flow.js, so it is
  // reconstructed here from the list item's own box.
  for (const li of flow.querySelectorAll('li')) {
    const list = li.parentElement;
    if (!list) continue;
    const st = styleOf(li);
    const liRect = li.getBoundingClientRect();
    if (liRect.height <= 0) continue;

    const ordered = list.tagName === 'OL';
    let text = '•';
    if (ordered) {
      const idx = Array.from(list.children).filter(c => c.tagName === 'LI').indexOf(li);
      text = `${idx + 1}.`;
    }

    // The first line of the item, so the marker sits on the same baseline.
    const r = document.createRange();
    r.selectNodeContents(li);
    const first = Array.from(r.getClientRects())[0] || liRect;

    const asc = ascentFor(st.family, st.size, st.weight, st.italic);
    items.push({
      type: 'text',
      x: liRect.left - ox - LIST_INDENT_EM * st.size,
      baseline: first.top - oy + asc,
      text,
      family: st.family, size: st.size, weight: st.weight, italic: st.italic,
      color: st.color, underline: false, strike: false, tracking: 0,
    });
  }

  // --- pictures -----------------------------------------------------------
  for (const img of flow.querySelectorAll('img')) {
    const r = img.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    items.push({
      type: 'image',
      x: r.left - ox, y: r.top - oy, w: r.width, h: r.height,
      id: img.dataset.zimg || null,
      src: img.currentSrc || img.src,
    });
  }

  // --- rules --------------------------------------------------------------
  for (const hr of flow.querySelectorAll('hr')) {
    const r = hr.getBoundingClientRect();
    const cs = getComputedStyle(hr);
    const t = parseFloat(cs.borderTopWidth) || 1;
    items.push({
      type: 'rule',
      x: r.left - ox, y: r.top - oy + t / 2, w: r.width, thickness: t,
      color: parseColor(cs.borderTopColor),
    });
  }

  // Baseline first, then left to right, so runs on one line arrive in
  // reading order and can be joined back together by the PDF writer.
  items.sort((a, b) =>
    (a.baseline ?? a.y) - (b.baseline ?? b.y) || (a.x ?? 0) - (b.x ?? 0));
  return items;
}

/** Split the display list into pages using the offsets from paginate(). */
export function itemsByPage(items, offsets, contentH) {
  const pages = offsets.map(() => []);

  for (const it of items) {
    // A word belongs to the page its baseline falls on; a picture to the page
    // holding most of it. Breaks never cut through either, so this is exact.
    const y = it.type === 'text' ? it.baseline - it.size * 0.35
            : it.type === 'image' ? it.y + it.h / 2
            : it.y;

    let p = offsets.length - 1;
    for (let i = 0; i < offsets.length; i++) {
      const end = i + 1 < offsets.length ? offsets[i + 1] : Infinity;
      if (y >= offsets[i] - 0.5 && y < end - 0.5) { p = i; break; }
    }
    pages[p].push({ ...it, py: (it.baseline ?? it.y) - offsets[p] });
  }

  return pages;
}
