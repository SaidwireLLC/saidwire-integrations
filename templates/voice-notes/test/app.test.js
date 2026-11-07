import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { createApp } from '../server.js';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const KEY = 'sk_live_test.do-not-leak-this-secret';
const tempData = () => join(mkdtempSync(join(tmpdir(), 'notes-')), 'notes.json');

function record(port, { rate = 16000, origin = `http://127.0.0.1:${port}`, pcm, keepOpenMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/live?sample_rate=${rate}`, { origin });
    const got = [];
    ws.on('error', reject);
    ws.on('message', (m) => got.push(JSON.parse(m.toString())));
    ws.on('close', () => resolve(got));
    ws.on('open', async () => {
      const step = rate * 2 / 20;
      for (let i = 0; pcm && i < pcm.length; i += step) { ws.send(pcm.subarray(i, i + step)); await new Promise((r) => setTimeout(r, 5)); }
      if (keepOpenMs) await new Promise((r) => setTimeout(r, keepOpenMs));
      ws.send(JSON.stringify({ type: 'stop' }));
    });
  });
}

describe('with no network', () => {
  const app = createApp({ config: { baseUrl: 'http://127.0.0.1:9', apiKey: KEY }, dataFile: tempData(), maxStreams: 1 });
  after(() => { app.closeAllConnections(); app.close(); });

  test('pages and scripts hold no key', async () => {
    const port = await listen(app);
    for (const f of readdirSync(new URL('../public/', import.meta.url))) {
      const body = await (await fetch(`http://127.0.0.1:${port}/${f}`)).text();
      assert.ok(body.length > 0, f);
      assert.ok(!body.includes(KEY) && !/sk_live|SAIDWIRE_API_KEY/.test(body), `key material in ${f}`);
    }
  });

  test('a page on another site cannot use the relay', async () => {
    const port = app.address().port;
    await assert.rejects(record(port, { origin: 'https://evil.example' }), /403/);
  });

  test('a client with no Origin header is refused', async () => {
    const port = app.address().port;
    await assert.rejects(new Promise((_, rej) => { const w = new WebSocket(`ws://127.0.0.1:${port}/live?sample_rate=16000`); w.on('error', rej); }), /403/);
  });

  test('a bad sample rate is refused', async () => {
    await assert.rejects(record(app.address().port, { rate: 96000 }), /400/);
  });

  test('files outside public cannot be read', async () => {
    const res = await fetch(`http://127.0.0.1:${app.address().port}/..%2fserver.js`);
    assert.equal(res.status, 404);
  });

  test('deleting needs your own origin', async () => {
    const res = await fetch(`http://127.0.0.1:${app.address().port}/api/notes/x`, { method: 'DELETE', headers: { Origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
  });
});

test('a refused key shows a clear message and the key is not repeated', async () => {
  const fake = createServer((_q, r) => r.end());
  fake.on('upgrade', (_q, s) => { s.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'); s.destroy(); });
  const fakePort = await listen(fake);
  const app = createApp({ config: { baseUrl: `http://127.0.0.1:${fakePort}`, apiKey: KEY }, dataFile: tempData() });
  const port = await listen(app);
  const got = await record(port);
  const err = got.find((m) => m.type === 'error');
  assert.match(err.message, /API key was refused/);
  assert.ok(!JSON.stringify(got).includes(KEY));
  app.closeAllConnections(); app.close(); fake.closeAllConnections(); fake.close();
});

test('sends KeepAlive through a long pause and the key in a header, not the URL', async () => {
  const fake = createServer();
  const wss = new WebSocketServer({ server: fake });
  const seen = [];
  let upgrade;
  wss.on('connection', (ws, req) => {
    upgrade = req;
    ws.on('message', (m, bin) => { if (!bin) { const c = JSON.parse(m.toString()); seen.push(c.type); if (c.type === 'CloseStream') ws.close(1000); } });
  });
  const fakePort = await listen(fake);
  const app = createApp({ config: { baseUrl: `http://127.0.0.1:${fakePort}`, apiKey: KEY }, dataFile: tempData() });
  const port = await listen(app);
  await record(port, { keepOpenMs: 5200 });
  assert.ok(seen.includes('KeepAlive'), seen.join());
  assert.equal(upgrade.headers.authorization, `Token ${KEY}`);
  assert.ok(!upgrade.url.includes(KEY));
  assert.match(upgrade.url, /encoding=linear16/);
  app.closeAllConnections(); app.close(); fake.closeAllConnections(); fake.close();
});
