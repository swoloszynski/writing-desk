// The type library.
//
// Every face is a real static TTF in fonts/. Nothing here is a variable font
// on purpose: the browser is happy to synthesise a weight out of a variable
// axis, but the PDF writer embeds a file, and an embedded variable font
// arrives at its default instance. Bold would silently come out regular.
// Instancing the axes to fixed weights up front is what keeps the screen and
// the printed sheet showing the same thing.
//
// The same TTF is served to `@font-face` and to pdf-lib, so line breaks
// measured in the browser hold in the PDF.

export const FAMILIES = [
  {
    name: 'EB Garamond',
    role: 'serif',
    note: 'Old-style serif. Small and quiet — the default body face.',
    faces: {
      '400normal': 'EBGaramond-Regular.ttf',
      '700normal': 'EBGaramond-Bold.ttf',
      '400italic': 'EBGaramond-Italic.ttf',
      '700italic': 'EBGaramond-BoldItalic.ttf',
    },
    fallback: 'Georgia, "Times New Roman", serif',
  },
  {
    name: 'Libre Baskerville',
    role: 'serif',
    note: 'Sturdier serif, large on the body. Reads well at small sizes.',
    faces: {
      '400normal': 'LibreBaskerville-Regular.ttf',
      '700normal': 'LibreBaskerville-Bold.ttf',
      '400italic': 'LibreBaskerville-Italic.ttf',
      '700italic': 'LibreBaskerville-BoldItalic.ttf',
    },
    fallback: 'Georgia, serif',
  },
  {
    name: 'Inter',
    role: 'sans',
    note: 'Neutral sans. Good for captions, page numbers, running heads.',
    faces: {
      '400normal': 'Inter-Regular.ttf',
      '700normal': 'Inter-Bold.ttf',
      '400italic': 'Inter-Italic.ttf',
      '700italic': 'Inter-BoldItalic.ttf',
    },
    fallback: 'system-ui, -apple-system, sans-serif',
  },
  {
    name: 'Space Grotesk',
    role: 'display',
    note: 'Geometric display sans. Headings that want to shout a little.',
    faces: {
      '400normal': 'SpaceGrotesk-Regular.ttf',
      '700normal': 'SpaceGrotesk-Bold.ttf',
    },
    fallback: 'system-ui, sans-serif',
  },
  {
    name: 'Courier Prime',
    role: 'mono',
    note: 'Typewriter monospace. Fixed pitch, for the photocopied look.',
    faces: {
      '400normal': 'CourierPrime-Regular.ttf',
      '700normal': 'CourierPrime-Bold.ttf',
      '400italic': 'CourierPrime-Italic.ttf',
      '700italic': 'CourierPrime-BoldItalic.ttf',
    },
    fallback: 'ui-monospace, Menlo, monospace',
  },
];

export const FAMILY_NAMES = FAMILIES.map(f => f.name);

const byName = new Map(FAMILIES.map(f => [f.name, f]));

export function family(name) {
  return byName.get(name) || FAMILIES[0];
}

/** The CSS `font-family` value for a family, fallbacks included. */
export function stackFor(name) {
  const f = family(name);
  return `"${f.name}", ${f.fallback}`;
}

/**
 * The file a given family/weight/style resolves to.
 *
 * Space Grotesk ships no italic. Rather than pretend, we hand back the
 * upright face and a `synthetic` flag; the browser slants it, and the PDF
 * writer applies the same shear so the two agree.
 */
export function faceFor(name, weight, italic) {
  const f = family(name);
  const w = weight >= 600 ? '700' : '400';
  const want = w + (italic ? 'italic' : 'normal');
  if (f.faces[want]) return { file: f.faces[want], synthetic: false };
  const upright = f.faces[w + 'normal'] || f.faces['400normal'];
  return { file: upright, synthetic: !!italic };
}

/** Inject one `@font-face` per file. Called once, before anything is measured. */
export function installFontFaces(base = 'fonts/') {
  const rules = [];
  for (const f of FAMILIES) {
    for (const [key, file] of Object.entries(f.faces)) {
      const weight = key.slice(0, 3);
      const style = key.slice(3);
      rules.push(
        `@font-face{font-family:"${f.name}";font-weight:${weight};` +
        `font-style:${style};font-display:block;` +
        `src:url("${base}${file}") format("truetype")}`
      );
    }
  }
  const el = document.createElement('style');
  el.id = 'wd-font-faces';
  el.textContent = rules.join('\n');
  document.head.appendChild(el);
}

/**
 * Force every face to actually download.
 *
 * `document.fonts.ready` alone is not enough: a face nobody has asked for is
 * never fetched, so the first pagination would measure a fallback and every
 * page break would move the moment the real font landed.
 */
export async function loadAllFonts() {
  const jobs = [];
  for (const f of FAMILIES) {
    for (const key of Object.keys(f.faces)) {
      const weight = key.slice(0, 3);
      const style = key.slice(3);
      jobs.push(
        document.fonts.load(`${style} ${weight} 16px "${f.name}"`).catch(() => {})
      );
    }
  }
  await Promise.all(jobs);
  await document.fonts.ready;
}

/** Raw bytes of one face, for embedding. Cached — a face is fetched once. */
const fileCache = new Map();
export async function fontBytes(file, base = 'fonts/') {
  if (!fileCache.has(file)) {
    fileCache.set(
      file,
      fetch(base + file).then(r => {
        if (!r.ok) throw new Error(`could not load ${file}`);
        return r.arrayBuffer();
      })
    );
  }
  return fileCache.get(file);
}
