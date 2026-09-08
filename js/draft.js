// Drafting: a room with no back door.
//
// The rule is that text only ever gets longer. There is no backspace, no
// undo, no arrow keys and no caret to move — the caret is wherever the last
// character landed, which is the end. A bad sentence is not fixed here; it is
// left behind and followed by a better one. That is the whole point, and
// every other decision in this file falls out of enforcing it.
//
// The typing surface is an invisible textarea laid over the rendered text.
// Capturing raw keydown would have been simpler, but a textarea is what the
// operating system knows how to talk to: dead keys, dictation, an IME and a
// phone keyboard all work because a real text field is focused. What we take
// away from it, we take away in `beforeinput` — the one place a browser lets
// you refuse an edit before it happens, whatever caused it.

/** Lines above the one being typed that keep their full contrast. */
const KEEP_CLEAR_LINES = 7;

/** How often the page flinches at a refusal before it takes the point. */
const SHAKE_TIMES = 2;

const DELETING = /^delete/;
const UNDOING = /^history/;

const HEADING = /^(#{1,6})\s+/;
const BULLET = /^(\s*)([-*+])\s+/;
const ORDERED = /^(\s*)(\d+)([.)])\s+/;
const QUOTE = /^>\s?/;

const escapeHtml = s =>
  s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/**
 * Show emphasis as emphasis while leaving the markup on the page.
 *
 * The draft is plain text and stays plain text, so the asterisks are real
 * characters that will still be there in the morning. They are dimmed rather
 * than hidden: seeing that a `**` is still open is the only way to know you
 * have to close it, and closing it is the only way out.
 */
function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/(\*\*)(?=\S)([\s\S]*?\S)(\*\*)/g,
    (_, a, body, b) => `<b><i class="mk">${a}</i>${body}<i class="mk">${b}</i></b>`);
  out = out.replace(/(?<![*\w])(\*|_)(?=\S)([^*_]*?\S)\1(?![*\w])/g,
    (_, a, body) => `<em><i class="mk">${a}</i>${body}<i class="mk">${a}</i></em>`);
  return out;
}

/** One line of the draft, as something to look at. */
function renderLine(raw) {
  const el = document.createElement('div');
  el.className = 'dline';

  if (!raw.trim()) { el.classList.add('is-blank'); el.innerHTML = '&nbsp;'; return el; }

  let m;
  if ((m = HEADING.exec(raw))) {
    el.classList.add('is-h', `is-h${m[1].length}`);
    el.innerHTML = `<i class="mk">${m[0]}</i>${inline(raw.slice(m[0].length))}`;
  } else if ((m = BULLET.exec(raw))) {
    el.classList.add('is-li');
    el.innerHTML = `<i class="mk">${escapeHtml(m[0])}</i>${inline(raw.slice(m[0].length))}`;
  } else if ((m = ORDERED.exec(raw))) {
    el.classList.add('is-li');
    el.innerHTML = `<i class="mk">${escapeHtml(m[0])}</i>${inline(raw.slice(m[0].length))}`;
  } else if ((m = QUOTE.exec(raw))) {
    el.classList.add('is-quote');
    el.innerHTML = `<i class="mk">${escapeHtml(m[0])}</i>${inline(raw.slice(m[0].length))}`;
  } else {
    el.innerHTML = inline(raw);
  }
  return el;
}

export const countWords = text => (text.match(/\S+/g) || []).length;

// ---------------------------------------------------------------------------
// The sound of a key
//
// Synthesised rather than sampled: a click is a burst of filtered noise and a
// short thump, which is a handful of nodes and no files to fetch. Off by
// default, because typing that makes a noise you did not ask for is rude.
// ---------------------------------------------------------------------------

class Clicker {
  constructor() { this.ctx = null; }

  resume() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  click(kind = 'key') {
    const ctx = this.resume();
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const noise = ctx.createBufferSource();
    const len = Math.floor(ctx.sampleRate * 0.04);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    noise.buffer = buf;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = kind === 'return' ? 1500 : 2600;
    band.Q.value = 0.8;

    noise.connect(band).connect(gain);
    const peak = kind === 'return' ? 0.16 : 0.07;
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'return' ? 0.16 : 0.05));
    noise.start(t);
    noise.stop(t + 0.2);

    if (kind === 'return') {
      const thump = ctx.createOscillator();
      const tg = ctx.createGain();
      thump.frequency.setValueAtTime(180, t);
      thump.frequency.exponentialRampToValueAtTime(60, t + 0.12);
      tg.gain.setValueAtTime(0.1, t);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      thump.connect(tg).connect(ctx.destination);
      thump.start(t);
      thump.stop(t + 0.2);
    }
  }
}

// ---------------------------------------------------------------------------

export class Draft extends EventTarget {
  /**
   * @param scroller the box that scrolls, and wears the mood classes
   * @param column   the measure the text is drawn into
   * @param input    the invisible textarea laid over both
   * @param doc      the document, whose `draft` this reads and writes
   */
  constructor(scroller, column, input, doc) {
    super();
    this.scroller = scroller;
    this.column = column;
    this.input = input;
    this.doc = doc;
    this.lines = document.createElement('div');
    this.lines.className = 'dlines';
    this.column.appendChild(this.lines);
    // Emphasis is opened and closed by the same shortcut, because with no
    // selection there is nothing to wrap — you turn bold on, type, turn it off.
    this.open = { bold: false, italic: false };
    // How many times each kind of refusal has happened, this session.
    this.refusals = {};
    this.clicker = new Clicker();
    this.tick = null;
    this._bind();
    this.render();
    this.watchHeight();
  }

  get text() { return this.doc.draft.text; }
  set text(v) { this.doc.draft.text = v; }

  focus() {
    this.input.focus({ preventScroll: true });
    this.toEnd();
  }

  /** The caret has exactly one legal position, and this is how it gets there. */
  toEnd() {
    const n = this.input.value.length;
    if (this.input.selectionStart !== n || this.input.selectionEnd !== n) {
      this.input.setSelectionRange(n, n);
    }
  }

  /** Add text at the end. The only way anything ever gets in. */
  append(str) {
    if (!str) return;
    this.input.value += str;
    this.commit();
  }

  /** Pull the textarea's value into the model and repaint. */
  commit() {
    this.text = this.input.value;
    this.toEnd();
    this.render();
    this.started();
    this.dispatchEvent(new CustomEvent('change'));
  }

  started() {
    if (!this.doc.draft.startedAt) this.doc.draft.startedAt = new Date().toISOString();
  }

  // --- painting -----------------------------------------------------------

  render() {
    const text = this.text;
    if (this.input.value !== text) this.input.value = text;

    const rows = text.split('\n');
    this.lines.textContent = '';
    for (const row of rows) this.lines.appendChild(renderLine(row));

    // The caret rides on the last line, because that is the only place a
    // caret can be. An empty trailing line still gets one.
    const last = this.lines.lastElementChild;
    if (last) {
      last.classList.add('is-current');
      if (last.classList.contains('is-blank')) last.textContent = '';
      const caret = document.createElement('span');
      caret.className = 'dcaret';
      last.appendChild(caret);
    }

    this.scroller.classList.toggle('is-focusmode', !!this.doc.settings.draft.focus);
    this.pin();
    this.paintFade();
    this.paintStats();
  }

  /**
   * Keep the line being typed on the screen.
   *
   * Pinning to the bottom of the content is what puts it there: the canvas
   * carries most of a screen of padding below the text, so the end of the
   * content sitting at the bottom of the window leaves the line you are on
   * comfortably above the middle.
   *
   * The height read here is only right if the browser has finished laying the
   * column out, and there are ordinary reasons it has not: a paragraph that
   * has just wrapped onto one more line, a webfont arriving, the panel opening
   * and narrowing the measure. A pin computed against a height that is about
   * to change lands short — and it stays short, because every later keystroke
   * pins against the same stale height. That is the shape of the bug this
   * exists to prevent: the line being typed sits below the bottom of the
   * window, and scrolling back up to it does nothing, because the next
   * character puts it back down again.
   *
   * So the column is watched as well. Whenever its height actually changes,
   * whatever the reason and whenever it lands, the pin is done again against
   * the height it really has.
   */
  pin() {
    this.scroller.scrollTop = this.scroller.scrollHeight;
  }

  /** Re-pin whenever the rendered column changes height for any reason. */
  watchHeight() {
    if (typeof ResizeObserver !== 'function') return;
    this.watcher = new ResizeObserver(() => this.pin());
    this.watcher.observe(this.lines);
  }

  /**
   * Fade only what is actually behind you.
   *
   * A fixed gradient over the top third of the window dims the opening lines
   * of a draft that has no opening behind it — you start writing and the first
   * thing you type is already half gone. So the fade is measured from the line
   * being typed rather than from the top of the screen: the last handful of
   * lines are left alone, and the gradient covers only whatever sits above
   * them. On a short draft that is nothing, and no fade is drawn at all.
   *
   * The far end stops at a low opacity rather than at nothing. Text you wrote
   * ten minutes ago should be quiet, not deleted.
   */
  paintFade() {
    const style = this.scroller.style;
    if (!this.doc.settings.draft.focus) {
      style.removeProperty('--fade-end');
      return;
    }
    const current = this.lines.lastElementChild;
    if (!current) { style.setProperty('--fade-end', '0px'); return; }

    const box = this.scroller.getBoundingClientRect();
    const line = current.getBoundingClientRect();
    const lineH = Math.max(18, line.height);
    const clear = lineH * KEEP_CLEAR_LINES;
    const end = Math.max(0, line.bottom - box.top - clear);
    style.setProperty('--fade-end', `${Math.round(end)}px`);
  }

  paintStats() {
    const words = countWords(this.text);
    this.dispatchEvent(new CustomEvent('stats', {
      detail: { words, chars: this.text.length, lines: this.text.split('\n').length },
    }));
  }

  // --- shortcuts ----------------------------------------------------------

  /** The text of the line the caret is on — always the last one. */
  lastLine() {
    const i = this.text.lastIndexOf('\n');
    return i < 0 ? this.text : this.text.slice(i + 1);
  }

  atLineStart() { return this.lastLine().length === 0; }

  /**
   * Open a fresh block.
   *
   * A heading or a list that starts on the line directly under a paragraph is
   * still part of that paragraph as far as markdown is concerned, so anything
   * block-shaped needs a blank line in front of it. Adds however much of one
   * is missing, and nothing at all at the very top of an empty draft.
   */
  ensureBlockStart() {
    const t = this.text;
    if (!t) return;
    if (t.endsWith('\n\n')) return;
    this.append(t.endsWith('\n') ? '\n' : '\n\n');
  }

  heading(level) {
    this.ensureBlockStart();
    this.append('#'.repeat(level) + ' ');
  }

  list(kind) {
    this.ensureBlockStart();
    this.append(kind === 'ordered' ? '1. ' : '- ');
  }

  quote() {
    this.ensureBlockStart();
    this.append('> ');
  }

  emphasis(which) {
    const mark = which === 'bold' ? '**' : '*';
    this.append(mark);
    this.open[which] = !this.open[which];
    this.dispatchEvent(new CustomEvent('marks', { detail: { ...this.open } }));
  }

  /**
   * Return: a new paragraph, or the next item of a list.
   *
   * One press, one paragraph — the thing every other editor does. The draft is
   * plain text and has to stay valid markdown, where paragraphs are separated
   * by a blank line, so return writes two newlines rather than one. Inside a
   * list it writes one and carries the marker on, because blank lines between
   * bullets would take the list apart.
   *
   * Leaving a list is the one place something gets shorter, and it is worth
   * being clear about why that is allowed: the `- ` being taken away was put
   * there by this function a moment ago, not typed by anyone. Return on an
   * empty bullet means "I am done with the list", and the marker the machine
   * volunteered goes back where it came from. No word anyone wrote is touched.
   */
  newline() {
    const line = this.lastLine();
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    const marker = bullet || ordered;

    if (marker && !line.slice(marker[0].length).trim()) {
      this.input.value = this.input.value.slice(0, this.input.value.length - line.length);
      this.commit();
      // Taking the marker off already left the newline it sat on, so top the
      // gap up to a paragraph break rather than adding a whole one.
      this.ensureBlockStart();
    } else if (bullet) {
      this.append(`\n${bullet[1]}${bullet[2]} `);
    } else if (ordered) {
      this.append(`\n${ordered[1]}${+ordered[2] + 1}${ordered[3]} `);
    } else {
      this.append('\n\n');
    }

    this.open = { bold: false, italic: false };
    this.dispatchEvent(new CustomEvent('marks', { detail: { ...this.open } }));
  }

  /** Shift-return: a new line without leaving the paragraph. */
  softline() {
    this.append('\n');
  }

  /**
   * Refuse something, and say so.
   *
   * The column shakes its head the first couple of times and then stops,
   * while the message goes on appearing every time. Reaching for delete is a
   * twenty-year habit and it does not unlearn itself in an afternoon — so the
   * refusal has to survive being hit over and over without becoming a
   * scolding. A line of text you can ignore does that; the whole page
   * flinching does not.
   *
   * Counted per reason, because knowing there is no delete tells you nothing
   * about the arrow keys.
   */
  nudge(reason) {
    const seen = (this.refusals[reason] = (this.refusals[reason] || 0) + 1);

    if (seen <= SHAKE_TIMES) {
      this.column.classList.remove('is-nudged');
      void this.column.offsetWidth;   // restart the animation
      this.column.classList.add('is-nudged');
    } else {
      this.column.classList.remove('is-nudged');
    }

    this.dispatchEvent(new CustomEvent('refused', { detail: { reason, seen } }));
  }

  sound(kind) {
    if (!this.doc.settings.draft.sound) return;
    try { this.clicker.click(kind); } catch {}
  }

  // --- events -------------------------------------------------------------

  _bind() {
    const ta = this.input;

    // The refusal. Everything else in this file is bookkeeping; this is the
    // rule. `beforeinput` catches every route into the field — the key, the
    // menu, the trackpad gesture, the phone's own delete — before it lands.
    ta.addEventListener('beforeinput', e => {
      if (DELETING.test(e.inputType)) { e.preventDefault(); this.nudge('delete'); return; }
      if (UNDOING.test(e.inputType)) { e.preventDefault(); this.nudge('undo'); return; }
      if (e.inputType === 'insertFromDrop') { e.preventDefault(); this.nudge('drop'); return; }
      // An insertion anywhere but the end is an edit wearing a hat.
      this.toEnd();
    });

    ta.addEventListener('input', () => {
      // A composition (dead key, IME) can replace what it provisionally
      // inserted, which arrives as a deletion this side of `beforeinput`. If
      // the value ever shrinks below what we have, put it back.
      if (!ta.value.startsWith(this.text.slice(0, Math.min(this.text.length, ta.value.length)))
          && ta.value.length < this.text.length) {
        ta.value = this.text;
        this.toEnd();
        return;
      }
      this.doc.draft.keystrokes++;
      this.commit();
    });

    ta.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey;

      if (BLOCKED_KEYS.has(e.key) && !mod) {
        e.preventDefault();
        this.nudge(e.key === 'Backspace' || e.key === 'Delete' ? 'delete' : 'move');
        return;
      }

      if (e.key === 'Enter' && !mod) {
        e.preventDefault();
        if (e.shiftKey) this.softline(); else this.newline();
        this.sound('return');
        return;
      }

      if (e.key === 'Tab') {
        e.preventDefault();
        this.append('    ');
        return;
      }

      if (mod) {
        const k = e.key.toLowerCase();
        if (k === 'z' || k === 'y') { e.preventDefault(); this.nudge('undo'); return; }
        if (k === 'b') { e.preventDefault(); this.emphasis('bold'); return; }
        if (k === 'i') { e.preventDefault(); this.emphasis('italic'); return; }
        if (k === '1' || k === '2' || k === '3') { e.preventDefault(); this.heading(+k); return; }
        if (e.shiftKey && (k === '8' || k === '*')) { e.preventDefault(); this.list('bullet'); return; }
        if (e.shiftKey && (k === '7' || k === '&')) { e.preventDefault(); this.list('ordered'); return; }
        if (e.shiftKey && (k === '9' || k === '(')) { e.preventDefault(); this.quote(); return; }
        return;
      }

      if (e.key.length === 1) this.sound('key');
    });

    // Clicking is not a way of getting anywhere. It puts the keyboard back
    // where it belongs and leaves the caret where it was. The textarea is the
    // thing on top, so it is the thing that has to refuse the click.
    const stay = e => { e.preventDefault(); this.focus(); };
    ta.addEventListener('mousedown', stay);
    this.scroller.addEventListener('mousedown', stay);
    ta.addEventListener('select', () => this.toEnd());
    ta.addEventListener('click', () => this.toEnd());
    ta.addEventListener('focus', () => this.toEnd());
  }

  // --- the session clock --------------------------------------------------

  startClock() {
    this.stopClock();
    this.tick = setInterval(() => {
      if (document.hidden) return;
      this.doc.draft.seconds++;
      this.dispatchEvent(new CustomEvent('tick', { detail: { seconds: this.doc.draft.seconds } }));
    }, 1000);
  }

  stopClock() { clearInterval(this.tick); this.tick = null; }
}

const BLOCKED_KEYS = new Set([
  'Backspace', 'Delete',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown',
]);

/**
 * Turn a finished draft into sections.
 *
 * A level-one heading is where a new section starts, because that is what a
 * writer means by typing one. Anything before the first is the opening, and a
 * draft with no headings at all arrives as a single section — which is
 * correct, and is what most drafts are.
 */
export function draftToSections(text) {
  const out = [];
  let current = null;

  for (const line of text.split('\n')) {
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1 || !current) {
      // Writing that arrives without a heading has no name of its own, and a
      // guess dressed up as one is worse than an obvious placeholder.
      current = { name: h1 ? h1[1].trim() : 'New section', lines: [] };
      out.push(current);
    }
    current.lines.push(line);
  }

  return out
    .map(s => ({ name: s.name, text: s.lines.join('\n').trim() }))
    .filter(s => s.text);
}
