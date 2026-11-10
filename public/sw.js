/*
 * Excel Workflow Builder: service worker (hand-written, no dependencies).
 *
 * Registered in production builds only, by components/shell/ServiceWorkerRegistration.jsx.
 * The app does all its work in the browser, so once its pages and scripts are cached it
 * opens and processes files without a network connection.
 *
 * Strategies (same-origin GET requests only; cross-origin and non-GET requests are never
 * touched, so they behave exactly as without a service worker):
 *   navigations            network first (4 s), then the cached page, then a small offline page
 *   /_next/static/*        cache first: the files are content-hashed and never change
 *   RSC payloads (?_rsc=)  network first, cached copy (or an empty 204) when offline
 *   everything else        stale-while-revalidate (samples, icons, manifest)
 *
 * Precache on install: the app routes, the samples and the icons, plus every script, style
 * sheet and font those pages need (found by following the /_next/static references in the
 * HTML, the scripts and the CSS). That includes the data worker, which only starts when a
 * file is added, so a page loaded once can process a file offline.
 *
 * Updates: bump VERSION for every release. The browser installs the new worker next to the
 * old one; the page shows "A new version is available" and its Reload button sends
 * SKIP_WAITING. Activation deletes the caches of older versions.
 */

const VERSION = "v1";
const PREFIX = "ewb";
const CACHE = {
  pages: `${PREFIX}-pages-${VERSION}`,
  static: `${PREFIX}-static-${VERSION}`,
  rsc: `${PREFIX}-rsc-${VERSION}`,
  runtime: `${PREFIX}-runtime-${VERSION}`,
};

/** Routes cached on install. Without the first two the install fails and is retried later. */
const REQUIRED_ROUTES = ["/", "/workflow"];
const OPTIONAL_ROUTES = ["/templates", "/batch", "/history"];
const FILES = [
  "/samples/sample-data.xlsx",
  "/samples/sample-data-renamed.xlsx",
  "/samples/sample-template.json",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

const NAVIGATION_TIMEOUT_MS = 4000;
const MAX_CRAWL = 400;
const LIMITS = { static: 300, rsc: 60, runtime: 60 };
const STATIC_PATH = "/_next/static/";

/* ------------------------------------------------------------------ helpers */

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function pageKey(url) {
  // The pages are static: the query string never changes the HTML.
  const { origin, pathname } = new URL(url);
  return `${origin}${pathname}`;
}

function isCacheable(response) {
  return Boolean(response && response.ok && response.type === "basic" && !response.redirected);
}

function isHtml(response) {
  return (response.headers.get("content-type") || "").includes("text/html");
}

function isRsc(request, url) {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
}

/** Drop the oldest entries of a cache beyond `max` (keys() lists them in insertion order). */
async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i += 1) await cache.delete(keys[i]);
}

/** /_next/static URLs referenced by an HTML page, a script or a style sheet. */
function staticRefs(text, baseUrl, type) {
  const found = new Set();
  const add = (raw) => {
    try {
      const url = new URL(raw, baseUrl);
      if (isSameOrigin(url) && url.pathname.startsWith(STATIC_PATH)) found.add(url.href);
    } catch {
      // not a URL
    }
  };
  // "/_next/static/chunks/a.js" in HTML and scripts, "static/chunks/a.js" in Turbopack's chunk lists.
  const PATHS = /(?:\/_next\/)?static\/[A-Za-z0-9_\-./~]+\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|jpe?g|webp|avif|gif|ico|json|wasm)/g;
  for (const match of text.matchAll(PATHS)) {
    const path = match[0];
    add(path.startsWith("/_next/") ? path : `/_next/${path}`);
  }
  if (type === "css") {
    // Fonts and images in CSS are relative to the style sheet (url(../media/x.woff2)).
    for (const match of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) add(match[1]);
  }
  return found;
}

/** Icons and the manifest linked from a page (their URLs carry a content hash). */
function linkedFiles(html, baseUrl) {
  const found = new Set();
  for (const tag of html.match(/<link\b[^>]*>/g) || []) {
    if (!/\brel="(?:icon|apple-touch-icon|manifest|shortcut icon)"/.test(tag)) continue;
    const href = /\bhref="([^"]+)"/.exec(tag);
    if (!href) continue;
    try {
      const url = new URL(href[1].replace(/&amp;/g, "&"), baseUrl);
      if (isSameOrigin(url)) found.add(url.href);
    } catch {
      // not a URL
    }
  }
  return found;
}

function assetType(url) {
  const { pathname } = new URL(url);
  if (pathname.endsWith(".css")) return "css";
  if (pathname.endsWith(".js") || pathname.endsWith(".mjs")) return "js";
  return "other";
}

/**
 * Make sure every static file in `urls`, and every static file those reference, is in the
 * static cache. Already cached files are skipped together with their references (they were
 * followed when they were added). A file still held by an older version's cache is copied
 * instead of downloaded: static files never change.
 */
async function cacheStaticGraph(urls) {
  const cache = await caches.open(CACHE.static);
  const queue = [...urls];
  const seen = new Set(queue);

  async function next() {
    while (queue.length) {
      const url = queue.shift();
      if (await cache.match(url, { ignoreVary: true })) continue;
      let response = await caches.match(url, { ignoreVary: true });
      if (!response) {
        try {
          response = await fetch(url, { credentials: "same-origin" });
        } catch {
          continue;
        }
      }
      if (!isCacheable(response)) continue;
      const type = assetType(url);
      if (type !== "other") {
        const text = await response.clone().text();
        for (const ref of staticRefs(text, url, type)) {
          if (seen.size >= MAX_CRAWL) break;
          if (!seen.has(ref)) {
            seen.add(ref);
            queue.push(ref);
          }
        }
      }
      await cache.put(url, response);
    }
  }

  // A few downloads at a time; each runner keeps pulling from the shared queue.
  await Promise.all(Array.from({ length: 6 }, () => next()));
  // A runner can stop while another one is still adding references: drain the rest.
  if (queue.length) await next();
}

/** Same-origin files (icons, manifest) into the runtime cache, unless already there. */
async function cacheFiles(urls) {
  const runtime = await caches.open(CACHE.runtime);
  await Promise.all(
    [...urls].map(async (url) => {
      if (await runtime.match(url)) return;
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (isCacheable(response)) await runtime.put(url, response);
      } catch {
        // best effort
      }
    }),
  );
}

/** Everything a page needs to start: its scripts, styles, fonts, icons and manifest. */
async function cachePageAssets(pagesHtml) {
  const assets = new Set();
  const files = new Set();
  for (const { html, url } of pagesHtml) {
    for (const ref of staticRefs(html, url, "html")) assets.add(ref);
    for (const ref of linkedFiles(html, url)) files.add(ref);
  }
  await Promise.all([cacheStaticGraph(assets), cacheFiles(files)]);
}

/** Download one route's HTML into the pages cache. Resolves to { html, url } or null. */
async function precacheRoute(path, required) {
  const url = new URL(path, self.location.origin).href;
  let response;
  try {
    response = await fetch(url, { cache: "reload", credentials: "same-origin" });
  } catch (error) {
    if (required) throw error;
    return null;
  }
  if (!isCacheable(response) || !isHtml(response)) {
    if (required) throw new Error(`Could not precache ${path} (${response.status})`);
    return null;
  }
  const html = await response.clone().text();
  await (await caches.open(CACHE.pages)).put(pageKey(url), response);
  return { html, url };
}

async function precacheFile(path) {
  const url = new URL(path, self.location.origin).href;
  try {
    const response = await fetch(url, { cache: "reload", credentials: "same-origin" });
    if (isCacheable(response)) await (await caches.open(CACHE.runtime)).put(url, response);
  } catch {
    // optional
  }
}

async function precache() {
  const [pages] = await Promise.all([
    Promise.all([
      ...REQUIRED_ROUTES.map((path) => precacheRoute(path, true)),
      ...OPTIONAL_ROUTES.map((path) => precacheRoute(path, false)),
    ]),
    Promise.all(FILES.map((path) => precacheFile(path))),
  ]);
  // One crawl for all pages, so shared chunks are downloaded once.
  await cachePageAssets(pages.filter(Boolean));
}

/* -------------------------------------------------------------- lifecycle */

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
  // No skipWaiting() here: an update waits until the page asks for it (see "message"),
  // so an open tab never switches versions under the user's feet. A first install has no
  // older worker to wait for and activates straight away.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const current = new Set(Object.values(CACHE));
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith(`${PREFIX}-`) && !current.has(name)).map((name) => caches.delete(name)),
      );
      // Control the page that installed us, so files it loads from now on are cached too.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (data.type === "GET_VERSION" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

/* ------------------------------------------------------------- strategies */

const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline | Excel Workflow Builder</title>
<link rel="icon" href="/icons/icon-192.png" type="image/png">
<link rel="manifest" href="/manifest.webmanifest">
<style>
  :root { color-scheme: light dark; --bg: #f5f7f6; --fg: #16201b; --muted: #5b6861; --brand: #047857; --brand-fg: #ffffff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0c110f; --fg: #e6ece8; --muted: #97a49d; --brand: #34d399; --brand-fg: #04261a; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 28rem; padding: 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { margin: 0 0 1rem; color: var(--muted); }
  a { display: inline-flex; align-items: center; min-height: 2.5rem; padding: 0 1rem; border-radius: 0.5rem;
      background: var(--brand); color: var(--brand-fg); font-weight: 500; text-decoration: none; }
  a:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <h1>You are offline</h1>
  <p>This page has not been saved on this device yet. The rest of the app works offline: open it from the start page.</p>
  <a href="/">Go to the start page</a>
</main>
</body>
</html>`;

function offlineResponse() {
  return new Response(OFFLINE_PAGE, {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function handleNavigation(event) {
  const { request } = event;
  const key = pageKey(request.url);
  const pages = await caches.open(CACHE.pages);

  const network = fetch(request).then((response) => {
    if (isCacheable(response) && isHtml(response)) {
      const forCache = response.clone();
      const forScan = response.clone();
      event.waitUntil(
        (async () => {
          await pages.put(key, forCache);
          // A new deployment brings new scripts: cache them while the page is fresh.
          await cachePageAssets([{ html: await forScan.text(), url: request.url }]);
        })().catch(() => {}),
      );
    }
    return response;
  });

  const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS, null));
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;

  const cached = await pages.match(key, { ignoreVary: true });
  if (cached) {
    // Slow or no network: answer from the cache, and let a late response still refresh it.
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  try {
    return await network;
  } catch {
    return offlineResponse();
  }
}

/**
 * A worker reads its own location: Turbopack passes the worker's chunk list in the script
 * URL's #fragment. A response from the cache carries the cached URL (no fragment), so for
 * worker scripts hand out a fresh Response, which takes the request's full URL instead.
 */
function forDestination(request, response) {
  if (request.destination !== "worker" && request.destination !== "sharedworker") return response;
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function cacheFirst(event) {
  return forDestination(event.request, await cacheFirstResponse(event));
}

async function cacheFirstResponse(event) {
  const cache = await caches.open(CACHE.static);
  const cached = await cache.match(event.request, { ignoreVary: true });
  if (cached) return cached;
  let response;
  try {
    response = await fetch(event.request);
  } catch (error) {
    // Offline: the same hashed file with another query string (?dpl=...) is the same file.
    const similar = await cache.match(event.request, { ignoreVary: true, ignoreSearch: true });
    if (similar) return similar;
    throw error;
  }
  if (isCacheable(response)) {
    const copy = response.clone();
    event.waitUntil(
      cache
        .put(event.request, copy)
        .then(() => trim(CACHE.static, LIMITS.static))
        .catch(() => {}),
    );
  }
  return response;
}

/**
 * RSC payloads (client-side navigations and prefetches). Offline, with no cached copy, the
 * answer is an empty 204: Next.js treats that as "nothing usable" (a prefetch is retried
 * later, a navigation falls back to a full page load, which the navigation handler serves
 * from the cache) instead of a failed request.
 */
async function networkFirstRsc(event) {
  const cache = await caches.open(CACHE.rsc);
  try {
    const response = await fetch(event.request);
    if (isCacheable(response)) {
      const copy = response.clone();
      event.waitUntil(
        cache
          .put(event.request, copy)
          .then(() => trim(CACHE.rsc, LIMITS.rsc))
          .catch(() => {}),
      );
    }
    return response;
  } catch {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    return new Response(null, { status: 204, statusText: "Offline", headers: { "Cache-Control": "no-store" } });
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE.runtime);
  const cached = await cache.match(event.request);
  const network = fetch(event.request).then((response) => {
    if (isCacheable(response)) {
      const copy = response.clone();
      event.waitUntil(
        cache
          .put(event.request, copy)
          .then(() => trim(CACHE.runtime, LIMITS.runtime))
          .catch(() => {}),
      );
    }
    return response;
  });
  if (cached) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }
  return network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;
  // Partial (media) requests and the worker script itself are left to the browser.
  if (request.headers.has("range") || url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
  } else if (url.pathname.startsWith(STATIC_PATH)) {
    event.respondWith(cacheFirst(event));
  } else if (isRsc(request, url)) {
    event.respondWith(networkFirstRsc(event));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
});
