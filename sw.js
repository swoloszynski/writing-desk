// The service worker.
//
// Two jobs, and only two of them.
//
// It makes the desk installable, which is the point: an installed application
// is one the browser stops treating as a site you passed through, so it grants
// persistent storage rather than refusing it, and Safari stops clearing the
// place out after a week of not being opened. And it keeps a copy of the
// application itself, so opening the desk on a train shows you your work
// instead of a dinosaur.
//
// It does not cache anything of yours. Documents are in IndexedDB and, if you
// have pointed the desk at one, a folder on your disk; neither is a thing a
// cache should be holding an opinion about.

const VERSION = 'v1';
const CACHE = `writing-desk-${VERSION}`;

// The application, less the fonts. Everything here is small, and all of it has
// to be present for the desk to open at all.
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js', 'js/comments.js', 'js/doc.js', 'js/draft.js', 'js/editor.js',
  'js/extract.js', 'js/flow.js', 'js/folder.js', 'js/fonts.js',
  'js/imposition.js', 'js/markdown.js', 'js/markdown-input.js',
  'js/paginate.js', 'js/pdf.js', 'js/preview.js', 'js/settings-ui.js',
  'js/share.js', 'js/zip.js',
  'js/vendor/pdf-lib.min.js', 'js/vendor/fontkit.umd.min.js',
];

// The two folders _headers marks immutable. A file in either never changes
// under the same name, so once it is in the cache there is nothing to check.
const IMMUTABLE = /\/(fonts|js\/vendor)\//;

self.addEventListener('install', e => {
  // Failing here would leave the old worker in place, which is the right
  // outcome: a half-installed cache is worse than no new one.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE && key.startsWith('writing-desk-')) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/**
 * Network first, cache second — for everything but the immutable folders.
 *
 * The other way round is the usual advice and it is wrong here. serve.py
 * exists because a stale .js file being served out of a cache means debugging
 * code that is no longer running, and a worker that answers from the cache
 * first would reintroduce exactly that, only harder to clear. So: ask the
 * network, and keep what it says. The cache is there for the case the network
 * is not — which is the case it was added for.
 *
 * Fonts and the vendored libraries go the other way, because a file that
 * cannot change is a file there is no point asking about twice.
 */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (IMMUTABLE.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fromNetwork(e.request)));
    return;
  }
  e.respondWith(fromNetwork(e.request).catch(async () =>
    await caches.match(e.request) ||
    // A navigation to any path inside the app is still the one page.
    (e.request.mode === 'navigate' ? caches.match('./') : undefined)));
});

async function fromNetwork(request) {
  const res = await fetch(request);
  // Opaque and error responses are not worth keeping, and a partial one would
  // be handed back later as if it were whole.
  if (res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
  }
  return res;
}
