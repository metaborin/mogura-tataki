import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only server. No dependencies or build step are required.
export async function startServer({ port = 4197, oldVersion = false, failAsset = false } = {}) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let old = oldVersion;
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (!url.pathname.startsWith('/mogura-tataki/')) { response.writeHead(404); response.end('Not found'); return; }
      const relative = decodeURIComponent(url.pathname.slice('/mogura-tataki/'.length)) || 'index.html';
      if (failAsset && relative === 'icons/maskable-512.png') { response.writeHead(503); response.end('Test: asset unavailable'); return; }
      const file = resolve(root, relative);
      if (!file.startsWith(resolve(root) + sep)) { response.writeHead(403); response.end(); return; }
      let bytes = await readFile(file);
      if (old && relative === 'sw.js') bytes = Buffer.from(bytes.toString().replaceAll('mogura-tataki-precache-v1', 'mogura-tataki-precache-v0'));
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolveReady) => server.listen(port, '127.0.0.1', resolveReady));
  return { server, url: `http://127.0.0.1:${server.address().port}/mogura-tataki/`, setCurrent: () => { old = false; },
    close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startServer(); console.log(`Open ${app.url}`);
}
