// Read-only dashboard server. GET only, loopback only, no file writes.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PUBLIC = new URL('../public/', import.meta.url);
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLoopback(host) {
  return LOOPBACK.has(String(host).replace(/^\[|\]$/g, ''));
}

export function createServer(config, scanFn) {
  const cacheMs = (config.cacheSeconds ?? 15) * 1000;
  let cached = null; // { at, promise }

  function getIndex(refresh) {
    if (!refresh && cached && Date.now() - cached.at < cacheMs) return cached.promise;
    const promise = Promise.resolve().then(() => scanFn(config));
    cached = { at: Date.now(), promise };
    promise.catch(() => { if (cached && cached.promise === promise) cached = null; });
    return promise;
  }

  const server = http.createServer(async (req, res) => {
    const send = (code, type, body) => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
    };
    const text = (code, msg) => send(code, 'text/plain; charset=utf-8', msg);
    try {
      const port = server.address().port;
      const host = String(req.headers.host || '').toLowerCase();
      if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host)) {
        return text(403, 'Forbidden host');
      }
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return text(405, 'Method not allowed');
      }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/index') {
        const index = await getIndex(url.searchParams.get('refresh') === '1');
        return send(200, 'application/json; charset=utf-8', JSON.stringify(index));
      }
      const entry = Object.hasOwn(STATIC, url.pathname) ? STATIC[url.pathname] : null;
      if (!entry) return text(404, 'Not found');
      return send(200, entry[1], await readFile(new URL(entry[0], PUBLIC)));
    } catch (err) {
      console.error('request failed:', err);
      return text(500, 'Internal error');
    }
  });
  return server;
}

export async function start(config, scanFn) {
  if (!isLoopback(config.host)) {
    throw new Error(`Refusing to listen on non-loopback host "${config.host}"`);
  }
  const server = createServer(config, scanFn);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { loadConfig, parseRoots, scanAll } = await import('./scan/index.js');
  const args = process.argv.slice(2);
  const i = args.indexOf('--roots');
  const roots = i >= 0 ? parseRoots(args[i + 1]) : undefined;
  const config = await loadConfig(undefined, { roots });
  // Re-read config on every rescan so config.local.json edits apply without a restart (host/port still need one).
  const server = await start(config, async () => scanAll(await loadConfig(undefined, { roots })));
  console.log(`Dashboard: http://${config.host}:${server.address().port}/ (read-only)`);
}
