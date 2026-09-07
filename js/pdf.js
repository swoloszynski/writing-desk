// Writing the file.
//
// pdf-lib does the file format; everything about where things go comes from
// the measured DOM, so the PDF is a transcription of the preview rather than
// a second attempt at laying the document out.
//
// Fonts are embedded subset, from the same TTFs the browser rendered with.

import { PX_TO_PT, metrics, paperOf, getImage, folioBaseline } from './doc.js';
import { faceFor, fontBytes } from './fonts.js';
import { extract, itemsByPage } from './extract.js';
import { pressOrder, marginsFor } from './imposition.js';

const { PDFDocument, rgb, degrees, setCharacterSpacing } = window.PDFLib;

const faceKey = it => `${it.family}|${it.weight}|${it.italic ? 'i' : 'n'}`;

async function embedFonts(pdf, keys) {
  const fonts = new Map();
  for (const key of keys) {
    const [family, weight, style] = key.split('|');
    const { file } = faceFor(family, parseInt(weight, 10), style === 'i');
    const bytes = await fontBytes(file);
    fonts.set(key, await pdf.embedFont(bytes, { subset: true }));
  }
  return fonts;
}

/** PNG and JPEG go straight in; anything else is repainted as PNG first. */
async function embedImages(pdf, ids) {
  const images = new Map();
  for (const id of ids) {
    const rec = await getImage(id);
    if (!rec) continue;
    let blob = rec.blob;
    let type = blob.type;

    if (type !== 'image/png' && type !== 'image/jpeg') {
      blob = await repaintAsPng(blob);
      type = 'image/png';
    }
    const buf = await blob.arrayBuffer();
    try {
      images.set(id, type === 'image/jpeg' ? await pdf.embedJpg(buf)
                                           : await pdf.embedPng(buf));
    } catch (err) {
      console.warn('could not embed an image', id, err);
    }
  }
  return images;
}

function repaintAsPng(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('repaint failed'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

/**
 * A font cannot draw what it has no glyph for. Rather than let one stray
 * character abort the whole export, drop it and keep a tally to report.
 * Answers are memoised per font: a document is thousands of words drawn from
 * a few dozen distinct characters.
 */
const glyphCache = new WeakMap();

function hasGlyph(font, ch) {
  let seen = glyphCache.get(font);
  if (!seen) { seen = new Map(); glyphCache.set(font, seen); }
  if (seen.has(ch)) return seen.get(ch);
  let ok = true;
  try { font.widthOfTextAtSize(ch, 10); } catch { ok = false; }
  seen.set(ch, ok);
  return ok;
}

function safeText(font, text, dropped) {
  let bad = false;
  for (const ch of text) if (!hasGlyph(font, ch)) { bad = true; break; }
  if (!bad) return text;
  let out = '';
  for (const ch of text) {
    if (hasGlyph(font, ch)) out += ch;
    else dropped.add(ch);
  }
  return out;
}

/**
 * Join words back into lines where the font agrees with the browser.
 *
 * Words are measured and placed one at a time, which is exact but leaves the
 * PDF as a scatter of one-word text objects: selecting a sentence in a reader
 * gives back a column of single words. So each word is tested against where
 * the run would put it — using the embedded font's own metrics — and folded in
 * only when the two answers agree to within a fraction of a point. Justified
 * text, where every space is a different width, simply fails the test and
 * falls back to per-word placement.
 */
const JOIN_TOLERANCE = 0.35;   // points

/** Advance width including tracking, which is added after every character. */
export function runWidth(font, text, sizePt, trackingPt) {
  return font.widthOfTextAtSize(text, sizePt) + trackingPt * text.length;
}

function coalesce(items, fonts) {
  const out = [];
  let run = null;

  const flush = () => { if (run) { out.push(run); run = null; } };

  for (const it of items) {
    if (it.type !== 'text') { flush(); out.push(it); continue; }

    const font = fonts.get(faceKey(it));
    if (!font) { flush(); continue; }

    if (run && run.font === font &&
        Math.abs(run.py - it.py) < 0.25 &&
        run.underline === it.underline && run.strike === it.strike &&
        run.size === it.size && run.tracking === it.tracking &&
        sameColour(run.color, it.color)) {
      const size = it.size * PX_TO_PT;
      const tc = (it.tracking || 0) * PX_TO_PT;
      let lead = null;
      try {
        // Where the run would put this word. Measuring the joined string and
        // taking the word's own width back off leaves the kerning either side
        // of the space in — which is exactly what the browser applied when it
        // shaped the line, and the source of the sub-point drift that made
        // naive joining fail.
        lead = runWidth(font, `${run.text} ${it.text}`, size, tc)
             - runWidth(font, it.text, size, tc);
      } catch { lead = null; }

      if (lead !== null &&
          Math.abs((run.x + lead / PX_TO_PT) - it.x) * PX_TO_PT < JOIN_TOLERANCE) {
        run.text += ` ${it.text}`;
        continue;
      }
    }

    flush();
    run = { ...it, font };
  }

  flush();
  return out;
}

const sameColour = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/**
 * @param mode 'reading' for one page at a time, 'press' for folded sheets.
 */
export async function buildPDF({
  flow, settings, offsets, contentH, pageCount, title = '',
  mode = 'reading', onProgress,
}) {
  const m = metrics(settings);
  const paper = paperOf(settings);
  const sheetW = paper.sheetW * 72;
  const sheetH = paper.sheetH * 72;
  const pageW = paper.pageW * 72;
  const pageH = paper.pageH * 72;

  const items = extract(flow);
  const perPage = itemsByPage(items, offsets, contentH);

  const faceKeys = new Set(items.filter(i => i.type === 'text').map(faceKey));
  const folio = settings.folio;
  if (folio.on) faceKeys.add(`${folio.font}|400|n`);

  onProgress?.('embedding fonts');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(window.fontkit);
  const fonts = await embedFonts(pdf, faceKeys);

  onProgress?.('embedding images');
  const imageIds = [...new Set(items.filter(i => i.type === 'image' && i.id).map(i => i.id))];
  const images = await embedImages(pdf, imageIds);

  pdf.setTitle(title || 'Untitled');
  pdf.setProducer('writing-desk');
  pdf.setCreator('writing-desk');

  const dropped = new Set();
  const ctx = { m, settings, folio, fonts, images, dropped, pageW, pageH };

  let sheets = 0;
  let pdfPages;

  if (mode === 'press') {
    onProgress?.('imposing sheets');
    ({ sheets, pdfPages } = layoutPress(pdf, perPage, pageCount, sheetW, sheetH, ctx));
  } else {
    onProgress?.('laying out pages');
    pdfPages = layoutReading(pdf, perPage, pageCount, ctx);
  }

  onProgress?.('writing the file');
  const bytes = await pdf.save();
  return { bytes, dropped: [...dropped], sheets, pdfPages, mode };
}

/**
 * The folded booklet: one PDF page per side of a sheet, two half pages on
 * each, in the order the sheets have to go through the printer.
 */
function layoutPress(pdf, perPage, pageCount, sheetW, sheetH, ctx) {
  const { settings, pageW } = ctx;
  const { faces } = pressOrder(pageCount);

  for (const face of faces) {
    const sheet = pdf.addPage([sheetW, sheetH]);

    if (settings.press.foldLine) {
      sheet.drawLine({
        start: { x: sheetW / 2, y: 0 }, end: { x: sheetW / 2, y: sheetH },
        thickness: 0.4, color: rgb(0.78, 0.78, 0.78), dashArray: [3, 5],
      });
    }
    if (settings.press.cropMarks) drawCropMarks(sheet, sheetW, sheetH, pageW);

    ['left', 'right'].forEach((side, i) => {
      placePage(sheet, face.pages[i], side === 'left' ? 0 : pageW, side,
                sheetH, perPage, ctx);
    });

    if (face.side === 'back' && settings.press.flipBack) sheet.setRotation(degrees(180));
  }

  return { sheets: faces.length / 2, pdfPages: faces.length };
}

/**
 * One page to a PDF page, in the order you read them.
 *
 * This is the ordinary case, and the only one on offer for paper that is not
 * folded. On a booklet it is the screen proof: press marks left off, and the
 * blanks that only exist to round the count up to a multiple of four not
 * written at all. The inside and outside margins still alternate, because
 * that is how the document is set and a proof that quietly centred them would
 * not be showing you your document.
 */
function layoutReading(pdf, perPage, pageCount, ctx) {
  const { pageW, pageH } = ctx;

  for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
    const page = pdf.addPage([pageW, pageH]);
    placePage(page, pageNo, 0, pageNo % 2 === 1 ? 'right' : 'left', pageH, perPage, ctx);
  }

  return pageCount;
}

/** One page, wherever on the sheet it happens to be landing. */
function placePage(target, pageNo, X0, side, topY, perPage, ctx) {
  const { m, folio, fonts, images, dropped, pageW, settings } = ctx;
  const mg = marginsFor(side, m);
  const isBlank = pageNo - 1 >= perPage.length;

  if (!isBlank) {
    drawPage(target, perPage[pageNo - 1] || [], { X0, topY, mg, m, fonts, images, dropped });
  }
  if (folio.on && shouldNumber(pageNo, isBlank, folio)) {
    drawFolio(target, pageNo,
      { X0, topY, pageW, mg, m, side, folio, fonts, dropped, settings });
  }
}

function shouldNumber(pageNo, isBlank, folio) {
  if (isBlank && folio.hideOnBlank) return false;
  if (pageNo === 1 && folio.hideOnFirst) return false;
  return true;
}

function drawPage(sheet, items, ctx) {
  const { X0, topY, mg, m, fonts, images, dropped } = ctx;
  const toX = px => X0 + (mg.left + px) * PX_TO_PT;
  const toY = px => topY - (m.marginTop + px) * PX_TO_PT;

  for (const it of coalesce(items, fonts)) {
    if (it.type === 'text') {
      const font = it.font || fonts.get(faceKey(it));
      if (!font) continue;
      const text = safeText(font, it.text, dropped);
      if (!text) continue;

      const size = it.size * PX_TO_PT;
      const tc = (it.tracking || 0) * PX_TO_PT;
      const x = toX(it.x);
      const y = toY(it.py);
      const c = it.color;

      // Character spacing is text state, so it survives the BT/ET that
      // drawText writes and has to be put back afterwards.
      if (tc) sheet.pushOperators(setCharacterSpacing(tc));
      sheet.drawText(text, {
        x, y, size, font, color: rgb(c.r, c.g, c.b),
        opacity: c.a === 1 ? undefined : c.a,
      });
      if (tc) sheet.pushOperators(setCharacterSpacing(0));

      if (it.underline || it.strike) {
        const w = runWidth(font, text, size, tc);
        const rule = (dy, th) => sheet.drawLine({
          start: { x, y: y + dy }, end: { x: x + w, y: y + dy },
          thickness: th, color: rgb(c.r, c.g, c.b),
        });
        if (it.underline) rule(-size * 0.12, size * 0.055);
        if (it.strike) rule(size * 0.26, size * 0.05);
      }
    }

    else if (it.type === 'image') {
      const img = it.id && images.get(it.id);
      if (!img) continue;
      const w = it.w * PX_TO_PT;
      const h = it.h * PX_TO_PT;
      sheet.drawImage(img, { x: toX(it.x), y: toY(it.py) - h, width: w, height: h });
    }

    else if (it.type === 'rule') {
      const c = it.color;
      const y = toY(it.py);
      sheet.drawLine({
        start: { x: toX(it.x), y }, end: { x: toX(it.x + it.w), y },
        thickness: Math.max(0.4, it.thickness * PX_TO_PT), color: rgb(c.r, c.g, c.b),
      });
    }
  }
}

function drawFolio(sheet, pageNo, ctx) {
  const { X0, topY, pageW, mg, m, side, folio, fonts, dropped } = ctx;
  const font = fonts.get(`${folio.font}|400|n`);
  if (!font) return;

  const label = safeText(font, folio.format.replace('#', String(pageNo + folio.startAt - 1)), dropped);
  if (!label) return;

  const size = folio.size;   // already in points
  const w = runWidth(font, label, size, 0);
  const y = topY - folioBaseline(ctx.settings, m) * PX_TO_PT;

  let x;
  if (folio.position === 'bottom-center') {
    x = X0 + pageW / 2 - w / 2;
  } else if (side === 'left') {
    x = X0 + mg.left * PX_TO_PT;                     // outer edge is the left
  } else {
    x = X0 + pageW - mg.right * PX_TO_PT - w;        // outer edge is the right
  }

  sheet.drawText(label, { x, y, size, font, color: rgb(0, 0, 0) });
}

function drawCropMarks(sheet, sheetW, sheetH, pageW) {
  const L = 12, gap = 6, c = rgb(0.5, 0.5, 0.5), t = 0.4;
  const mark = (x1, y1, x2, y2) =>
    sheet.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color: c });

  for (const y of [0, sheetH]) {
    const dir = y === 0 ? 1 : -1;
    mark(pageW, y + dir * gap, pageW, y + dir * (gap + L));
  }
  for (const [x, dx] of [[0, 1], [sheetW, -1]]) {
    mark(x + dx * gap, 0, x + dx * (gap + L), 0);
    mark(x + dx * gap, sheetH, x + dx * (gap + L), sheetH);
  }
}

export function download(bytes, filename) {
  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), filename);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
