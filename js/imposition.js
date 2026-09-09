// Saddle-stitch imposition.
//
// A folded booklet is not printed in reading order. Every sheet carries four
// half pages — two on the front, two on the back — and the sheets nest inside
// one another, so the outermost sheet holds the first and last pages of the
// booklet and the innermost holds the two in the middle.
//
// For a 28-page booklet that gives, sheet by sheet:
//
//     28 |  1        2 | 27
//     26 |  3        4 | 25
//     24 |  5        6 | 23
//     22 |  7        8 | 21
//     20 |  9       10 | 19
//     18 | 11       12 | 17
//     16 | 13       14 | 15
//
// which is the pairing below with s counting sheets from the outside in.

/**
 * @param {number} pageCount pages of content, before padding
 * @returns {{sheets:Array, padded:number, blanks:number[]}}
 *   `sheets[s] = {front:[l,r], back:[l,r]}` in 1-based page numbers.
 *   Numbers greater than `pageCount` are the blanks added to reach a
 *   multiple of four.
 */
export function impose(pageCount) {
  const n = Math.max(4, Math.ceil(pageCount / 4) * 4);
  const sheets = [];
  for (let s = 0; s < n / 4; s++) {
    sheets.push({
      front: [n - 2 * s, 2 * s + 1],
      back: [2 * s + 2, n - 2 * s - 1],
    });
  }
  const blanks = [];
  for (let p = pageCount + 1; p <= n; p++) blanks.push(p);
  return { sheets, padded: n, blanks };
}

/**
 * Which content page sits at each position in the finished booklet.
 *
 * Padding a booklet out to a whole number of sheets means adding blank pages,
 * and normally they go on the end, where nobody minds them. A section pinned
 * as the back cover changes that: the blanks go in front of it instead, so
 * the pinned pages stay on the outside of the fold where a cover belongs and
 * the padding falls inside, before it.
 *
 * @param {number} pageCount pages of content, before padding
 * @param {number|null} backCoverFrom 1-based content page the back cover
 *   starts on, or null to leave the blanks at the end
 * @returns {number[]} `slots[i]` is the content page printed at booklet
 *   position i + 1, or 0 where the position is a blank
 */
export function bookletOrder(pageCount, backCoverFrom = null) {
  const n = Math.max(4, Math.ceil(pageCount / 4) * 4);
  const slots = [];
  for (let p = 1; p <= pageCount; p++) slots.push(p);

  const at = backCoverFrom === null ? slots.length
                                    : Math.min(Math.max(backCoverFrom - 1, 0), slots.length);
  slots.splice(at, 0, ...Array(n - pageCount).fill(0));
  return slots;
}

/**
 * The sheet faces in the order they must be sent to the printer: front of
 * sheet one, back of sheet one, front of sheet two, and so on. Duplex feeds
 * them off in pairs, so this order is what puts the right two pages back to
 * back on one piece of paper.
 */
export function pressOrder(pageCount) {
  const { sheets, padded, blanks } = impose(pageCount);
  const faces = [];
  sheets.forEach((sh, i) => {
    faces.push({ sheet: i, side: 'front', pages: sh.front });
    faces.push({ sheet: i, side: 'back', pages: sh.back });
  });
  return { faces, sheets, padded, blanks };
}

/**
 * Which margin sits where.
 *
 * On a folded sheet the left half's spine is on its right edge and the right
 * half's spine is on its left, so the two margins swap from page to page.
 * Getting that backwards is the classic booklet mistake: everything creeps
 * toward the fold and the outer edge grows a moat.
 *
 * A document printed one page to a sheet has no fold to lean away from, so
 * nothing swaps and `inside` is simply the left margin.
 */
export function marginsFor(halfSide, m) {
  if (!m.folded) return { left: m.marginInside, right: m.marginOutside };
  return halfSide === 'left'
    ? { left: m.marginOutside, right: m.marginInside }
    : { left: m.marginInside,  right: m.marginOutside };
}

/** Page numbers alternate sides so the folio always lands on the outer edge. */
export function folioSide(pageNumber) {
  // In a folded booklet page 1 is a right-hand page, so odd pages are recto.
  return pageNumber % 2 === 1 ? 'right' : 'left';
}

/** A quick check that the ordering is a real booklet, used by the self-test. */
export function verify(pageCount) {
  const { sheets, padded } = impose(pageCount);
  const seen = new Set();
  for (const sh of sheets) {
    for (const p of [...sh.front, ...sh.back]) {
      if (seen.has(p)) return `page ${p} imposed twice`;
      seen.add(p);
    }
    // Facing pages on one fold must always add up to n+1.
    if (sh.front[0] + sh.front[1] !== padded + 1) return 'front pair does not sum';
    if (sh.back[0] + sh.back[1] !== padded + 1) return 'back pair does not sum';
  }
  for (let p = 1; p <= padded; p++) if (!seen.has(p)) return `page ${p} missing`;
  return null;
}
