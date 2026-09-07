// The one description of how type sits on a half page.
//
// The editor, the page previews and the PDF writer all read the same
// `.wd-flow` rules. That is deliberate: the PDF is produced by measuring the
// live DOM, so anything that changes layout has to change it in exactly one
// place or the printed sheet stops matching the screen.

import { PT_TO_PX, metrics } from './doc.js';
import { stackFor } from './fonts.js';

const pt = v => `${(v * PT_TO_PX).toFixed(3)}px`;

function headingRule(tag, h) {
  return `
.wd-flow ${tag}{
  font-family:${stackFor(h.font)};
  font-size:${pt(h.size)};
  font-weight:${h.weight};
  font-style:${h.italic ? 'italic' : 'normal'};
  text-align:${h.align};
  text-transform:${h.caps ? 'uppercase' : 'none'};
  letter-spacing:${h.tracking}em;
  line-height:1.16;
  margin:${h.before}em 0 ${h.after}em;
}`;
}

/** Every rule that decides where a line break falls, built from settings. */
export function flowCSS(settings) {
  const m = metrics(settings);
  const b = settings.body;
  const q = settings.quote;
  const c = settings.caption;

  return `
.wd-flow{
  width:${m.contentW}px;
  font-family:${stackFor(b.font)};
  font-size:${pt(b.size)};
  line-height:${b.lineHeight};
  text-align:${b.align};
  color:#000;
  hyphens:none;
  -webkit-hyphens:none;
  word-spacing:normal;
  /* Kerning is off, and that is a decision rather than an oversight.
     A PDF places glyphs by the advance widths in the embedded font's width
     table; there is nowhere in that table for a pair kern to live. Left on,
     the browser would quietly set every line a fraction narrower than the
     printed one — half a pixel a word, a couple of pixels a line — and the
     preview would stop being the truth. Ligatures stay on: a ligature is one
     glyph with one advance, so both sides already agree about it. */
  font-kerning:none;
  font-variant-ligatures:common-ligatures;
  font-synthesis:none;
  -webkit-font-synthesis:none;
}
.wd-flow p{ margin:0 0 ${b.paraSpace}em; text-indent:${b.indent}em; }
.wd-flow p:first-child{ text-indent:0; }
.wd-flow p.wd-noindent, .wd-flow h1+p, .wd-flow h2+p, .wd-flow h3+p,
.wd-flow blockquote+p, .wd-flow figure+p, .wd-flow hr+p{ text-indent:0; }
${headingRule('h1', settings.headings.h1)}
${headingRule('h2', settings.headings.h2)}
${headingRule('h3', settings.headings.h3)}
.wd-flow > *:first-child, .wd-flow .wd-section > *:first-child{ margin-top:0; }

.wd-flow ul, .wd-flow ol{
  margin:0 0 ${b.paraSpace}em;
  padding:0 0 0 ${LIST_INDENT_EM}em;
  list-style:none;
}
.wd-flow li{ position:relative; margin:0 0 .18em; text-indent:0; }
.wd-flow li::before{
  position:absolute; left:-${LIST_INDENT_EM}em; top:0;
  width:${LIST_INDENT_EM}em;
  display:inline-block;
  font-variant-numeric:tabular-nums;
  content:'\\2022';
}
.wd-flow ol{ counter-reset:wdol; }
.wd-flow ol > li{ counter-increment:wdol; }
.wd-flow ol > li::before{ content:counter(wdol) '.'; }

.wd-flow blockquote{
  margin:${b.paraSpace}em 0 ${b.paraSpace}em ${q.indent}em;
  font-family:${stackFor(q.font)};
  font-size:${pt(q.size)};
  font-style:${q.italic ? 'italic' : 'normal'};
}
.wd-flow blockquote p{ margin:0 0 .3em; text-indent:0; }
.wd-flow blockquote p:last-child{ margin-bottom:0; }

.wd-flow hr{
  border:0; height:0;
  border-top:${HR_WEIGHT_PX}px solid currentColor;
  margin:${b.paraSpace * 1.6}em auto;
  width:38%;
}

.wd-flow figure{ margin:${b.paraSpace}em 0; }
.wd-flow figure img{ display:block; width:100%; height:auto; }
.wd-flow figure[data-align="center"]{ margin-left:auto; margin-right:auto; }
.wd-flow figure[data-align="right"]{ margin-left:auto; margin-right:0; }
.wd-flow figure[data-align="left"]{ margin-left:0; margin-right:auto; }

.wd-flow figcaption, .wd-flow p.wd-caption{
  font-family:${stackFor(c.font)};
  font-size:${pt(c.size)};
  text-align:${c.align};
  line-height:1.3;
  text-indent:0;
  margin:.34em 0 0;
}
.wd-flow p.wd-caption{ margin:0 0 ${b.paraSpace}em; }

/* A forced page break: a gap you can see, rather than the whole unused rest
   of the page. The page still ends here — see repaginate() in js/app.js — and
   Format is where the real empty space gets shown. */
.wd-flow .wd-break{
  height:${BREAK_GAP_PX}px; margin:0; padding:0; border:0;
  display:block; overflow:visible; position:relative;
}
`;
}

export const LIST_INDENT_EM = 1.15;
/** How much room a forced break takes in the editor's column. Pixels. */
export const BREAK_GAP_PX = 54;
export const HR_WEIGHT_PX = 1;

let styleEl = null;
export function applyFlowCSS(settings) {
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'wd-flow-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = flowCSS(settings);
}
