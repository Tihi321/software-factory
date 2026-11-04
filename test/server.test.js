import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { start } from '../src/server.js';

function request(port, { method = 'GET', path = '/', host } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { Host: host ?? `127.0.0.1:${port}` } },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('server: GET index ok, POST 405, foreign Host 403', async () => {
  const index = { version: 1, generatedAt: '2026-11-04T00:00:00Z', errors: [], inbox: [] };
  const server = await start({ host: '127.0.0.1', port: 0, cacheSeconds: 15 }, async () => index);
  const { port } = server.address();
  try {
    const ok = await request(port, { path: '/api/index' });
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).version, 1);
    assert.equal((await request(port, { method: 'POST', path: '/api/index' })).status, 405);
    assert.equal((await request(port, { path: '/api/index', host: 'evil.test' })).status, 403);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
