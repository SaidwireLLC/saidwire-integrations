// Video captions: upload a video, get captions back. The API key stays on this server. The upload is kept in a temp
// folder only until the captions are made. This needs ffmpeg, so run it on your computer or a host that has ffmpeg.
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { makeCaptions } from './make-captions.js';
import { SaidwireError, getConfig, loadEnv } from './lib/saidwire.js';

const here = dirname(fileURLToPath(import.meta.url));

// Anyone who can reach this server can spend your audio hours, so only your own pages may upload.
// Before you deploy for other people, add your own login check here too.
function allowed(req, allowedOrigin) {
  return req.headers.origin === (allowedOrigin || `http://${req.headers.host}`);
}

function sizeCap(maxBytes) {
  let size = 0;
  return new Transform({
    transform(chunk, _enc, done) {
      size += chunk.length;
      done(size > maxBytes ? new SaidwireError('That file is too big for this app. Raise MAX_UPLOAD_MB to allow it.', { status: 413 }) : null, chunk);
    },
  });
}

export function createApp({ config, allowedOrigin, maxBytes = 2048 * 1024 * 1024, chunkSeconds } = {}) {
  return createServer(async (req, res) => {
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(readFileSync(join(here, 'public/index.html')));
    }
    if (req.url !== '/api/captions' || req.method !== 'POST') return json(404, { error: 'Not found' });
    if (!allowed(req, allowedOrigin)) return json(403, { error: 'Not allowed' });
    const dir = await mkdtemp(join(tmpdir(), 'captions-'));
    try {
      const path = join(dir, 'upload');
      await pipeline(req, sizeCap(maxBytes), createWriteStream(path));
      const { srt, vtt, cues, seconds } = await makeCaptions(path, { config, chunkSeconds });
      return json(200, { srt, vtt, count: cues.length, seconds });
    } catch (e) {
      const known = e instanceof SaidwireError;
      if (!known) console.error(e.message);
      return json(known && e.status >= 400 && e.status < 500 ? e.status : known ? 502 : 400, { error: known ? e.message : 'Could not read that file. Is it a video or audio file?', requestId: e.requestId });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnv(join(here, '.env'));
  const port = Number(process.env.PORT || 3002);
  const host = process.env.HOST || '127.0.0.1';
  const maxBytes = Number(process.env.MAX_UPLOAD_MB || 2048) * 1024 * 1024;
  createApp({ config: getConfig(), allowedOrigin: process.env.ALLOWED_ORIGIN, maxBytes }).listen(port, host, () => console.log(`Video captions on http://${host}:${port}`));
}
