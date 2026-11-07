// Voice notes: a small server that holds the API key and relays microphone audio to Saidwire.
// The browser only ever talks to this server, so the key never reaches client code.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { LIMITS, explainStatus, getConfig, liveUrl, loadEnv } from './lib/saidwire.js';

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// Notes live in one JSON file so the template runs with nothing to set up. Swap these two functions for your database.
function notesStore(file) {
  const read = () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return []; } };
  const write = (notes) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(notes, null, 2)); };
  return {
    list: read,
    add(note) { write([note, ...read()]); return note; },
    remove(id) { write(read().filter((n) => n.id !== id)); },
  };
}

// Anyone who can reach this server can spend your audio hours, so only your own pages may connect.
// Before you deploy for other people, add your own login check here too.
function allowed(req, allowedOrigin) {
  const origin = req.headers.origin;
  if (!origin) return false;
  return origin === (allowedOrigin || `http://${req.headers.host}`);
}

function relay(browser, { config, sampleRate, store, onDone }) {
  const say = (msg) => { if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify(msg)); };
  const upstream = new WebSocket(
    liveUrl(config.baseUrl, { encoding: 'linear16', sample_rate: sampleRate, interim_results: true, punctuate: true }),
    { headers: { Authorization: `Token ${config.apiKey}` } },
  );
  const started = Date.now();
  const finals = [];
  const waiting = [];
  let lastSent = Date.now();
  let saved = false;

  // A stream with no audio and no KeepAlive for 10 seconds is closed by the API.
  const keepAlive = setInterval(() => {
    if (upstream.readyState === WebSocket.OPEN && Date.now() - lastSent > 4000) {
      upstream.send(JSON.stringify({ type: 'KeepAlive' }));
      lastSent = Date.now();
    }
  }, 1000);

  function finish() {
    if (saved) return;
    saved = true;
    clearInterval(keepAlive);
    onDone();
    const text = finals.join(' ').trim();
    if (text) say({ type: 'saved', note: store.add({ id: randomUUID(), createdAt: new Date(started).toISOString(), seconds: Math.round((Date.now() - started) / 1000), text }) });
    else say({ type: 'empty' });
    browser.close();
  }

  upstream.on('open', () => { for (const piece of waiting.splice(0)) upstream.send(piece); });
  upstream.on('unexpected-response', (_req, res) => { say({ type: 'error', message: explainStatus(res.statusCode) }); finish(); });
  upstream.on('error', () => { say({ type: 'error', message: 'Could not reach Saidwire.' }); finish(); });
  upstream.on('close', finish);
  upstream.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'Results') {
      const text = m.channel?.alternatives?.[0]?.transcript ?? '';
      if (m.is_final) { if (text) finals.push(text); say({ type: 'final', text }); } else say({ type: 'interim', text });
    } else if (m.type === 'Error') say({ type: 'error', message: m.description || m.err_msg || 'The stream stopped.' });
  });

  browser.on('message', (data, isBinary) => {
    if (isBinary) {
      lastSent = Date.now();
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
      else if (upstream.readyState === WebSocket.CONNECTING && waiting.length < 200) waiting.push(data);
    } else {
      const close = JSON.stringify({ type: 'CloseStream' });
      if (upstream.readyState === WebSocket.OPEN) upstream.send(close);
      else if (upstream.readyState === WebSocket.CONNECTING) waiting.push(close);   // Stop pressed before the stream opened
    }
  });
  browser.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: 'CloseStream' }));
    else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
  });
}

export function createApp({ config, dataFile = join(here, 'data/notes.json'), allowedOrigin, maxStreams = LIMITS.liveStreamsAtOnce } = {}) {
  const store = notesStore(dataFile);
  let open = 0;

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/api/notes' && req.method === 'GET') return json(200, store.list());
    const del = url.pathname.match(/^\/api\/notes\/([\w-]+)$/);
    if (del && req.method === 'DELETE') {
      if (!allowed(req, allowedOrigin)) return json(403, { error: 'Not allowed' });
      store.remove(del[1]);
      return json(200, { ok: true });
    }
    const path = normalize(url.pathname === '/' ? '/index.html' : url.pathname);
    try {
      const body = readFileSync(join(here, 'public', path));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch { json(404, { error: 'Not found' }); }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const sampleRate = Number(url.searchParams.get('sample_rate'));
    const refuse = (line) => { socket.write(`HTTP/1.1 ${line}\r\n\r\n`); socket.destroy(); };
    if (url.pathname !== '/live') return refuse('404 Not Found');
    if (!allowed(req, allowedOrigin)) return refuse('403 Forbidden');
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) return refuse('400 Bad Request');
    if (open >= maxStreams) return refuse('429 Too Many Requests');
    open++;
    wss.handleUpgrade(req, socket, head, (ws) => relay(ws, { config, sampleRate, store, onDone: () => { open--; } }));
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv(join(here, '.env'));
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  createApp({ config: getConfig(), allowedOrigin: process.env.ALLOWED_ORIGIN }).listen(port, host, () => console.log(`Voice notes on http://${host}:${port}`));
}
