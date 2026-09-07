// Where the pages break.
//
// The document is laid out once, as a single tall column exactly as wide as
// a half page's content box. Pagination then never moves anything: it only
// decides which horizontal slices of that column each page shows. A page is
// an offset into the galley, and the previews and the PDF both read those
// same offsets, so what you see is what gets printed.
//
// Measuring real line boxes rather than guessing at line heights is what
// makes this hold up for mixed type sizes, lists, images and headings.

/** One line box, or one unbreakable object, positioned in galley space. */
function atomsIn(flow) {
  const base = flow.getBoundingClientRect().top;
  const atoms = [];

  const walk = el => {
    for (const child of el.children) {
      const cls = child.classList;

      if (cls.contains('wd-break')) {
        const r = child.getBoundingClientRect();
        // The break carries the leftover of its page as height (set by the
        // caller after the first pass), so its bottom is the page boundary.
        atoms.push({ top: r.top - base, bottom: r.bottom - base, kind: 'break', el: child });
        continue;
      }

      const tag = child.tagName;

      if (tag === 'IMG' || tag === 'HR' || tag === 'FIGURE' || tag === 'TABLE') {
        const r = child.getBoundingClientRect();
        // A figure is atomic: splitting a picture across a fold is never what
        // anyone meant. Its caption rides along with it.
        atoms.push({
          top: r.top - base, bottom: r.bottom - base,
          kind: 'atomic', el: child, block: child, index: 0, count: 1,
        });
        continue;
      }

      if (tag === 'UL' || tag === 'OL' || tag === 'BLOCKQUOTE' ||
          tag === 'DIV' || tag === 'LI' || cls.contains('wd-section')) {
        // Containers: recurse, but an LI also carries its own lines.
        if (tag === 'LI') lines(child, base, atoms, 'li');
        else walk(child);
        continue;
      }

      const kind = /^H[1-6]$/.test(tag) ? 'heading'
                 : tag === 'FIGCAPTION' ? 'caption'
                 : 'text';
      lines(child, base, atoms, kind);
    }
  };

  walk(flow);
  atoms.sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  return atoms;
}

/**
 * Split one block into its line boxes.
 *
 * A Range over the block's contents hands back one rect per line fragment,
 * which is the only way to learn where the browser actually wrapped. Several
 * fragments can share a line when the styling changes mid-line, so they are
 * merged back together by vertical position.
 */
function lines(block, base, atoms, kind) {
  const range = document.createRange();
  range.selectNodeContents(block);
  const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0);
  range.detach?.();

  if (!rects.length) {
    // An empty paragraph is still a line you can see and stand on.
    const r = block.getBoundingClientRect();
    if (r.height <= 0) return;
    atoms.push({ top: r.top - base, bottom: r.bottom - base, kind,
                 el: block, block, index: 0, count: 1 });
    return;
  }

  const merged = [];
  for (const r of rects) {
    const last = merged[merged.length - 1];
    // Fragments overlapping vertically by more than half their height are the
    // same line. Comparing tops alone breaks on mixed sizes within a line.
    if (last && r.top < last.bottom - Math.min(r.height, last.bottom - last.top) * 0.5) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
    } else {
      merged.push({ top: r.top, bottom: r.bottom });
    }
  }

  merged.forEach((m, i) => atoms.push({
    top: m.top - base, bottom: m.bottom - base,
    kind, el: block, block, index: i, count: merged.length,
  }));
}

/**
 * Nudge a break away from the ugly places.
 *
 * `i` is the first atom that did not fit. Moving it earlier pushes more onto
 * the next page; it can never move past `floor`, which would leave a page
 * with nothing on it.
 */
function tidy(atoms, i, floor) {
  const at = k => atoms[k];
  let j = i;

  // Never strand a heading at the foot of a page with its text overleaf.
  // Walk the whole heading back, not just its last line.
  let guard = 0;
  while (j - 1 > floor && at(j - 1).kind === 'heading' && guard++ < 12) {
    const h = at(j - 1).block;
    while (j - 1 > floor && at(j - 1).block === h) j--;
  }

  if (j <= floor + 1) return Math.max(i, floor + 1);

  const cur = at(j);
  const prev = at(j - 1);

  // Orphan: one lonely first line left behind at the bottom.
  if (cur.kind === 'text' && prev.block === cur.block && cur.index === 1 && cur.count > 2) {
    if (j - 1 > floor) j -= 1;
  }
  // Widow: one lonely last line carried over to the top.
  else if (cur.kind === 'text' && prev.block === cur.block &&
           cur.index === cur.count - 1 && cur.count > 2) {
    if (j - 1 > floor) j -= 1;
  }

  // A caption must not be parted from the picture above it.
  if (at(j).kind === 'caption' && j - 1 > floor && at(j - 1).kind === 'atomic') {
    let k = j - 1;
    while (k > floor && at(k).kind === 'atomic') k--;
    if (k + 1 > floor) j = k + 1;
  }

  return Math.max(Math.min(j, i), floor + 1);
}

/**
 * @returns {{offsets:number[], height:number, atoms:Array}}
 *   `offsets[p]` is the galley y-coordinate shown at the top of page p.
 */
export function paginate(flow, contentH) {
  const atoms = atomsIn(flow);
  const height = flow.scrollHeight;

  if (!atoms.length) return { offsets: [0], height, atoms };

  const offsets = [0];
  let start = 0;        // galley y at the top of the current page
  let floor = -1;       // index of the last atom before this page began
  let i = 0;
  let spins = 0;

  while (i < atoms.length) {
    if (spins++ > atoms.length * 4 + 64) {
      console.warn('pagination gave up; the page may be too small for the type');
      break;
    }

    const a = atoms[i];

    if (a.kind === 'break') {
      // A forced break: this page ends here, the next starts just after.
      if (i > floor + 1 || offsets.length === 1) {
        start = a.bottom;
        offsets.push(start);
        floor = i;
      }
      i++;
      continue;
    }

    if (a.bottom - start <= contentH + 0.5) { i++; continue; }

    if (i === floor + 1) {
      // One object taller than the page. Give it a page of its own and move
      // on rather than spinning forever trying to make it fit.
      start = a.bottom;
      offsets.push(start);
      floor = i;
      i++;
      continue;
    }

    const brk = tidy(atoms, i, floor);
    start = atoms[brk].top;
    offsets.push(start);
    floor = brk - 1;
    i = brk;
  }

  // A trailing forced break can open a page with nothing after it.
  while (offsets.length > 1 && offsets[offsets.length - 1] >= height - 0.5) offsets.pop();

  return { offsets, height, atoms };
}

/** The slice of galley shown on page `p`: [top, bottom). */
export function pageRange(offsets, p, contentH, height) {
  const top = offsets[p] ?? 0;
  const next = offsets[p + 1];
  return { top, bottom: next !== undefined ? Math.min(next, top + contentH)
                                           : Math.min(height, top + contentH) };
}
