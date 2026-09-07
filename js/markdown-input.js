// Typing markdown and getting the thing itself.
//
// These are input rules, not a parser: they watch for a prefix at the head of
// a block and swap it for real formatting the moment you hit space. Nothing is
// stored as markdown — the document is still the same blocks it always was —
// so this is purely a way of typing, and it costs nothing anywhere else.
//
// Reading a markdown *file* is a different job with a different answer; that
// wants an actual parser, and it lives with import/export.

const BLOCK_RULES = [
  [/^#$/,             ed => ed.setBlock('h1')],
  [/^##$/,            ed => ed.setBlock('h2')],
  [/^###$/,           ed => ed.setBlock('h3')],
  [/^>$/,             ed => ed.setBlock('quote')],
  [/^[-*+]$/,         ed => ed.exec('insertUnorderedList')],
  [/^\d{1,3}[.)]$/,   ed => ed.exec('insertOrderedList')],
];

/** A whole line of dashes or asterisks becomes a rule when you leave it. */
const HR_LINE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

// Emphasis closes on its final delimiter. Both sides must sit against a
// non-space, which is what stops arithmetic and footnote stars from turning
// into italics halfway through a sentence.
//
// The emphasised run may not *begin* with a delimiter either, and that is the
// load-bearing part: halfway through typing `**bold**` the line reads
// `**bold*`, which the italic rule would otherwise read as a pair of stars
// around `*bold` and close early — bold could never be typed at all.
const EMPHASIS_RULES = [
  { close: '*', pattern: /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, command: 'bold', marks: 2 },
  { close: '*', pattern: /(?:^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*$/, command: 'italic', marks: 1 },
  { close: '_', pattern: /(?:^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_$/, command: 'italic', marks: 1 },
];

const blockOf = node => {
  const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return el?.closest('p, h1, h2, h3, blockquote, li, figcaption') || null;
};

/** The text of the current block from its start up to the caret. */
function textBeforeCaret(block, sel) {
  const r = document.createRange();
  r.selectNodeContents(block);
  try { r.setEnd(sel.anchorNode, sel.anchorOffset); } catch { return null; }
  return { text: r.toString(), range: r };
}

/** Select `range` and remove it, so the markup itself never survives. */
function cut(range) {
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('delete');
}

function tryBlockRule(e, editor) {
  const sel = getSelection();
  if (!sel || !sel.isCollapsed) return;

  const block = blockOf(sel.anchorNode);
  // Inside a list item or a caption the prefixes are almost certainly meant
  // literally — nobody types "## " into a bullet hoping for a heading.
  if (!block || block.tagName === 'LI' || block.tagName === 'FIGCAPTION') return;

  const before = textBeforeCaret(block, sel);
  if (!before) return;

  for (const [pattern, apply] of BLOCK_RULES) {
    if (!pattern.test(before.text)) continue;
    e.preventDefault();
    cut(before.range);
    apply(editor);
    return;
  }
}

function tryHorizontalRule(e, editor) {
  const sel = getSelection();
  if (!sel || !sel.isCollapsed) return;

  const block = blockOf(sel.anchorNode);
  if (!block || block.tagName !== 'P') return;
  if (!HR_LINE.test(block.textContent)) return;

  e.preventDefault();
  const r = document.createRange();
  r.selectNodeContents(block);
  cut(r);
  editor.insertHTML('<hr><p><br></p>');
}

function tryEmphasis(e, editor, ch) {
  const sel = getSelection();
  if (!sel || !sel.isCollapsed) return;

  const block = blockOf(sel.anchorNode);
  if (!block) return;

  const before = textBeforeCaret(block, sel);
  if (!before) return;

  // The closing character has not been inserted yet, so test the line as it
  // will read once it has.
  const line = before.text + ch;

  for (const rule of EMPHASIS_RULES) {
    if (rule.close !== ch) continue;
    const hit = rule.pattern.exec(line);
    if (!hit) continue;

    const inner = hit[1];
    const span = inner.length + rule.marks * 2 - 1;   // the closing mark is not there yet

    const start = document.createRange();
    start.selectNodeContents(block);
    try {
      start.setEnd(sel.anchorNode, sel.anchorOffset);
      start.setStart(sel.anchorNode, sel.anchorOffset - span);
    } catch { return; }
    // Compare against what is in the document, which is the finished line
    // minus the character that has not been inserted yet.
    if (start.toString() !== before.text.slice(-span)) return;

    e.preventDefault();
    cut(start);
    document.execCommand(rule.command, false, null);
    document.execCommand('insertText', false, inner);
    document.execCommand(rule.command, false, null);
    editor.after();
    return;
  }
}

/**
 * Hung on `beforeinput` rather than `keydown` on purpose.
 *
 * A key press is not the only way a character arrives. Dictation, an IME,
 * autocomplete and most Android keyboards insert text without ever reporting
 * a useful key, and a rule listening for keys would simply not fire for any
 * of them. `beforeinput` describes the edit itself, which is the thing we
 * actually care about, and it is cancellable in the same way.
 *
 * It also means a bulk insert — a paste, or a whole line arriving at once —
 * carries no trigger, which is right: pasted markdown is a job for the
 * importer, not for something watching you type.
 */
export function installMarkdownInput(editor) {
  editor.flow.addEventListener('beforeinput', e => {
    if (e.inputType === 'insertParagraph') { tryHorizontalRule(e, editor); return; }
    if (e.inputType !== 'insertText') return;

    if (e.data === ' ') tryBlockRule(e, editor);
    else if (e.data === '*' || e.data === '_') tryEmphasis(e, editor, e.data);
  });
}
