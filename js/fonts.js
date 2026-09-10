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
//
// Lora is the exception: it is neither instanced nor subset. Its licence
// reserves the font name, and instancing or subsetting produces a Modified
// Version, which may not use that name. The upstream project publishes static
// TTFs, so those are used unchanged — larger than a subset, but the family
// keeps its name.

export const FAMILIES = [
  {
    name: 'Karla',
    role: 'sans',
    note: 'Grotesque with open shapes and some irregularity. The default body face.',
    faces: {
      '400normal': 'Karla-Regular.ttf',
      '700normal': 'Karla-Bold.ttf',
      '400italic': 'Karla-Italic.ttf',
      '700italic': 'Karla-BoldItalic.ttf',
    },
    fallback: 'system-ui, -apple-system, sans-serif',
  },
  {
    name: 'Work Sans',
    role: 'sans',
    note: 'Neutral sans. For captions, page numbers and running heads.',
    faces: {
      '400normal': 'WorkSans-Regular.ttf',
      '700normal': 'WorkSans-Bold.ttf',
      '400italic': 'WorkSans-Italic.ttf',
      '700italic': 'WorkSans-BoldItalic.ttf',
    },
    fallback: 'system-ui, -apple-system, sans-serif',
  },
  {
    name: 'Lora',
    role: 'serif',
    note: 'Serif with brushed terminals. The default heading and quote face.',
    faces: {
      '400normal': 'Lora-Regular.ttf',
      '700normal': 'Lora-Bold.ttf',
      '400italic': 'Lora-Italic.ttf',
      '700italic': 'Lora-BoldItalic.ttf',
    },
    fallback: 'Georgia, serif',
  },
  {
    name: 'Literata',
    role: 'serif',
    note: 'Reading serif with a large x-height. Stays legible at small sizes.',
    faces: {
      '400normal': 'Literata-Regular.ttf',
      '700normal': 'Literata-Bold.ttf',
      '400italic': 'Literata-Italic.ttf',
      '700italic': 'Literata-BoldItalic.ttf',
    },
    fallback: 'Georgia, serif',
  },
  {
    name: 'Young Serif',
    role: 'display',
    note: 'Heavy display serif. One upright weight, no italic.',
    faces: {
      '400normal': 'YoungSerif-Regular.ttf',
    },
    fallback: 'Georgia, serif',
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
  {
    name: 'Space Mono',
    role: 'mono',
    note: 'Fixed pitch with squared shapes. More technical in tone than Courier Prime.',
    faces: {
      '400normal': 'SpaceMono-Regular.ttf',
      '700normal': 'SpaceMono-Bold.ttf',
      '400italic': 'SpaceMono-Italic.ttf',
      '700italic': 'SpaceMono-BoldItalic.ttf',
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
 * Young Serif has one upright weight and no italic. In that case return the
 * upright face with a `synthetic` flag: the browser slants it and the PDF
 * writer applies the same shear, so screen and print agree.
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
