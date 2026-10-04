import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('sw.js', root), 'utf8');
const currentCache = 'mogura-tataki-precache-v1';

function worker() {
  const handlers = {};
  const deleted = [];
  const added = [];
  const entries = new Map();
  const cache = {
    addAll: async (requests) => { added.push(...requests); },
    match: async (key) => entries.get(String(key)),
  };
  const caches = {
    open: async (name) => { assert.equal(name, currentCache); return cache; },
    keys: async () => [currentCache, 'mogura-tataki-precache-v0', 'mogura-tataki-precache-v20',
      'mogura-tataki-precache-v1-backup', 'mogura-tataki-other', 'manabi-rpg-v4', 'unrelated-cache'],
    delete: async (name) => { deleted.push(name); },
  };
  const self = { location: new URL('https://example.test/mogura-tataki/sw.js'),
    addEventListener: (name, callback) => { handlers[name] = callback; } };
  vm.runInNewContext(source, { self, caches, URL, Request, Response, fetch: async () => new Response('network') });
  return { handlers, deleted, added, entries };
}

test('activation deletes only versioned caches owned by this app', async () => {
  const w = worker(); let task;
  w.handlers.activate({ waitUntil: (promise) => { task = promise; } });
  await task;
  assert.deepEqual(w.deleted, ['mogura-tataki-precache-v0', 'mogura-tataki-precache-v20']);
});

test('installation lists every offline dependency within the app scope', async () => {
  const w = worker(); let task;
  w.handlers.install({ waitUntil: (promise) => { task = promise; } }); await task;
  assert.equal(w.added.length, 8);
  for (const request of w.added) {
    assert(request.url.startsWith('https://example.test/mogura-tataki/'));
    assert.equal(request.cache, 'reload');
    const path = new URL(request.url).pathname.replace('/mogura-tataki/', '') || 'index.html';
    assert((await readFile(new URL(path, root))).length > 0);
  }
});

test('other origins, sibling apps, lookalike prefixes and POST are never intercepted', () => {
  const w = worker();
  for (const [url, method] of [
    ['https://other.test/mogura-tataki/', 'GET'],
    ['https://example.test/manabi-sugoroku/', 'GET'],
    ['https://example.test/mogura-tataki-sibling/', 'GET'],
    ['https://example.test/mogura-tataki/index.html', 'POST'],
  ]) w.handlers.fetch({ request: new Request(url, { method }), respondWith: () => assert.fail(url) });
});

test('scope shell requests use only their canonical own-cache response', async () => {
  const w = worker(); let task;
  w.entries.set('https://example.test/mogura-tataki/index.html', new Response('saved shell'));
  w.handlers.fetch({ request: new Request('https://example.test/mogura-tataki/index.html?from=home'), respondWith: (promise) => { task = promise; } });
  assert.equal(await (await task).text(), 'saved shell');
});

test('ready status is false when any required shell item is missing', async () => {
  const w = worker(); let task; let message;
  w.handlers.message({ data: { type: 'CHECK_OFFLINE' }, ports: [{ postMessage: (data) => { message = data; } }], waitUntil: (promise) => { task = promise; } });
  await task; assert.equal(message.ready, false);
});

test('manifest identity and actual PNG dimensions match the deployed subpath', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  for (const key of ['id', 'start_url', 'scope']) assert.equal(manifest[key], '/mogura-tataki/');
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const png = await readFile(new URL(icon.src, root));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
  }
  assert(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('game storage key and 30-second game remain; no forced update or reload code', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const pwa = await readFile(new URL('pwa.js', root), 'utf8');
  assert.match(html, /const GAME_TIME = 30/);
  assert.match(html, /localStorage\.getItem\("mogura_high"\)/);
  assert.match(html, /localStorage\.setItem\("mogura_high", String\(v\)\)/);
  assert.doesNotMatch(source, /skipWaiting\s*\(|clients\.claim\s*\(/);
  assert.doesNotMatch(pwa, /location\.reload\s*\(/);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  for (const [, script] of inline) new vm.Script(script);
  new vm.Script(pwa); new vm.Script(source);
});
