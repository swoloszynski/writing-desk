// Sending a draft somewhere, without sending it anywhere.
//
// There is no server behind this application, and adding one to let a friend
// leave a note on a paragraph would be the largest thing in the project by
// some distance. So the document travels in the link itself: compressed,
// base64'd, and hung off the fragment — the part of a URL a browser keeps to
// itself and never puts on the wire. Whoever you send it to gets the words
// out of the address bar, not out of a database.
//
// Notes come back the same way. A page of comments is a few kilobytes even
// before compression, so the return trip always fits in a link no matter how
// long the piece was.
//
// The honest limits, since they decide when to hand over a file instead:
//
//   - Pictures do not fit. A single photograph is larger than everything
//     else put together, so links carry the words and the file carries the
//     whole thing.
//   - A long piece makes a long link. Browsers cope with far more than this,
//     but chat applications and mail clients wrap and truncate, so past a
//     point a file is simply the more reliable object to send.

const GZIP = 'z';
const PLAIN = 'u';

/** Comfortable in a message; past this a link starts getting mangled in transit. */
export const LINK_COMFORTABLE = 14000;
/** Past this, stop offering the link at all and hand over the file. */
export const LINK_LIMIT = 90000;

const toBase64URL = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64URL = str => {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

async function squeeze(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function unsqueeze(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @returns a fragment-safe string, prefixed with the codec that made it. */
export async function encode(payload) {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const packed = await squeeze(raw);
  return packed && packed.length < raw.length
    ? `${GZIP}.${toBase64URL(packed)}`
    : `${PLAIN}.${toBase64URL(raw)}`;
}

export async function decode(str) {
  const dot = str.indexOf('.');
  if (dot < 0) throw new Error('That link is missing its payload.');
  const codec = str.slice(0, dot);
  const bytes = fromBase64URL(str.slice(dot + 1));
  const raw = codec === GZIP ? await unsqueeze(bytes)
            : codec === PLAIN ? bytes
            : null;
  if (!raw) throw new Error('That link was made by a newer version of Writing Desk.');
  return JSON.parse(new TextDecoder().decode(raw));
}

// ---------------------------------------------------------------------------
// What goes in one
// ---------------------------------------------------------------------------

const FORMAT = 'writing-desk/share/1';

/**
 * A draft to read and comment on.
 *
 * The settings ride along so the reader sees the piece set the way it is
 * written, not in whatever the defaults happen to be. Pictures do not, which
 * is what `images` is for when this goes out as a file instead.
 */
export function readingPayload(doc, { images = null } = {}) {
  return {
    format: FORMAT,
    kind: 'read',
    sentAt: new Date().toISOString(),
    title: doc.title,
    author: doc.author,
    settings: doc.settings,
    sections: doc.sections.map(s => ({
      id: s.id, name: s.name, startsNewPage: s.startsNewPage, html: s.html,
    })),
    // Notes already on the piece, so a second reader is not told the same
    // thing twice. Resolved ones are settled and stay behind.
    comments: doc.comments.filter(c => !c.resolved),
    ...(images ? { images } : {}),
  };
}

/** Notes on their way back. Small enough that this is always a link. */
export function notesPayload(doc, { author = '' } = {}) {
  return {
    format: FORMAT,
    kind: 'notes',
    sentAt: new Date().toISOString(),
    title: doc.title,
    author,
    docId: doc.shareId || null,
    comments: doc.comments,
  };
}

export function checkPayload(payload, kind) {
  if (!payload || payload.format !== FORMAT) {
    throw new Error('That does not look like a Writing Desk link.');
  }
  if (kind && payload.kind !== kind) {
    throw new Error(`That link carries ${payload.kind}, not ${kind}.`);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export const PARAM = { read: 'read', notes: 'notes' };

export function linkFor(kind, encoded) {
  const { origin, pathname } = location;
  return `${origin}${pathname}#${PARAM[kind]}=${encoded}`;
}

/** What the address bar is carrying, if anything. @returns {{kind,data}|null} */
export function incoming(hash = location.hash) {
  const m = /^#(read|notes)=(.+)$/.exec(hash);
  return m ? { kind: m[1], data: m[2] } : null;
}

/** Take the payload out of the address bar without reloading or leaving history. */
export function clearHash() {
  history.replaceState(null, '', location.pathname + location.search);
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard access needs a secure context and a recent gesture, and a
    // link opened from a file:// URL has neither. Falling back to a hidden
    // textarea and execCommand still works in exactly those cases.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }
}
