// Meeting notes: a small server that holds the API key. The browser uploads a recording here, and this server sends it
// to Saidwire. Nothing is written to disk: the recording and the notes exist only for the length of the request.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, SaidwireError, getConfig, loadEnv, transcribeBytes } from './lib/saidwire.js';
import { buildNotes } from './notes.js';

const here = dirname(fileURLToPath(import.meta.url));

// Anyone who can reach this server can spend your audio hours, so only your own pages may upload.
// Before you deploy for other people, add your own login check here too.
function allowed(req, allowedOrigin) {
  return req.headers.origin === (allowedOrigin || `http://${req.headers.host}`);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (d) => {
      size += d.length;
      if (size > maxBytes) { reject(new SaidwireError('That file is over the limit of 100 MB.', { status: 413 })); req.destroy(); } else parts.push(d);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

export function createApp({ config, allowedOrigin, maxBytes = LIMITS.maxFileBytes } = {}) {
  return createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(join(here, 'public/index.html')));
    }
    if (url.pathname !== '/api/notes' || req.method !== 'POST') return json(404, { error: 'Not found' });
    if (!allowed(req, allowedOrigin)) return json(403, { error: 'Not allowed' });
    const type = req.headers['content-type'] || '';
    if (type.startsWith('video/')) return json(415, { error: 'Send the audio only. See the README for a one-line ffmpeg command.' });
    try {
      const bytes = await readBody(req, maxBytes);
      if (!bytes.length) return json(400, { error: 'The file is empty.' });
      const result = await transcribeBytes(bytes, { contentType: type.startsWith('audio/') ? type : 'application/octet-stream', config });
      return json(200, buildNotes(result, { title: basename(url.searchParams.get('name') || 'Meeting').replace(/\.[^.]+$/, '') }));
    } catch (e) {
      if (!(e instanceof SaidwireError)) console.error(e);
      return json(e.status >= 400 && e.status < 500 ? e.status : 502, { error: e instanceof SaidwireError ? e.message : 'Something went wrong.', requestId: e.requestId });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv(join(here, '.env'));
  const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || '127.0.0.1';
  createApp({ config: getConfig(), allowedOrigin: process.env.ALLOWED_ORIGIN }).listen(port, host, () => console.log(`Meeting notes on http://${host}:${port}`));
}
