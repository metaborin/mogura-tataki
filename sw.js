'use strict';

const CACHE = 'mogura-tataki-precache-v1';
const OWN_CACHE = /^mogura-tataki-precache-v\d+$/;
const SCOPE = new URL('./', self.location.href);
const ASSETS = [
  './', './index.html', './pwa.css', './pwa.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
].map((path) => new URL(path, SCOPE).href);

async function offlineComplete() {
  if (!(await caches.keys()).includes(CACHE)) return false;
  const cache = await caches.open(CACHE);
  const responses = await Promise.all(ASSETS.map((url) => cache.match(url)));
  return responses.every((response) => response && response.ok);
}

self.addEventListener('install', (event) => {
  // Installation succeeds only after every required local asset has been saved.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(
    ASSETS.map((url) => new Request(url, { cache: 'reload' })),
  )));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Storage may be evicted while this version waits. Keep the older cache then.
    if (!(await offlineComplete())) return;
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE && OWN_CACHE.test(name))
      .map((name) => caches.delete(name)));
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  // Only this app's authored shell is cached. Other paths never enter its cache.
  const canonical = new URL(url.href);
  canonical.search = '';
  canonical.hash = '';
  if (ASSETS.includes(canonical.href)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => (
      await cache.match(canonical.href) || fetch(request)
    )));
  } else if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (
      await (await caches.open(CACHE)).match(new URL('./index.html', SCOPE).href) || Response.error()
    )));
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CHECK_OFFLINE' || !event.ports[0]) return;
  event.waitUntil(offlineComplete().then((ready) => {
    event.ports[0].postMessage({ type: 'OFFLINE_STATUS', ready, version: CACHE });
  }).catch(() => event.ports[0].postMessage({ type: 'OFFLINE_STATUS', ready: false })));
});
