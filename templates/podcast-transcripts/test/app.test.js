import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, test } from 'node:test';
import { parseFeed, slug } from '../feed.js';
import { SaidwireError, getConfig, liveUrl, transcribeBytes } from '../lib/saidwire.js';
import { toHtml } from '../render.js';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const KEY = 'sk_live_test.do-not-leak-this-secret';
const FEED = (base) => `<?xml version="1.0"?><rss><channel><title>My &amp; Show</title>
<item><title><![CDATA[Ep 2: Q&A]]></title><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><enclosure url="${base}/ep2.mp3" type="audio/mpeg"/></item>
<item><title>No audio here</title></item>
<item><title>Ep 1</title><enclosure type="audio/mpeg" url="${base}/ep1.mp3"/></item>
</channel></rss>`;

test('reads shows and episodes from a feed, and skips items with no audio', () => {
  const f = parseFeed(FEED('https://x.example'));
  assert.equal(f.show, 'My & Show');
  assert.deepEqual(f.episodes.map((e) => e.title), ['Ep 2: Q&A', 'Ep 1']);
  assert.equal(f.episodes[1].url, 'https://x.example/ep1.mp3');
});

test('folder names are safe', () => {
  assert.equal(slug('Ep 2: Q&A / ../../etc'), 'ep-2-q-a-etc');
  assert.equal(slug('???'), 'episode');
});

test('page text is escaped', () => {
  const html = toHtml('<b>x</b>', [{ start: 0, text: '<script>alert(1)</script>' }]);
  assert.ok(!html.includes('<script>') && !html.includes('<b>x'));
});

test('missing key gives a plain message', () => {
  assert.throws(() => getConfig({}), /SAIDWIRE_API_KEY is not set/);
});

test('the real API is the default, and base URL is the only switch', () => {
  assert.equal(getConfig({ SAIDWIRE_API_KEY: 'k' }).baseUrl, 'https://api.saidwire.com');
  assert.equal(getConfig({ SAIDWIRE_API_KEY: 'k', SAIDWIRE_BASE_URL: 'http://127.0.0.1:8899/' }).baseUrl, 'http://127.0.0.1:8899');
  assert.match(liveUrl('https://api.saidwire.com', { punctuate: true }), /^wss:\/\/api\.saidwire\.com\/v1\/listen\?punctuate=true$/);
  assert.match(liveUrl('http://127.0.0.1:8899'), /^ws:\/\/127\.0\.0\.1:8899\/v1\/listen$/);
});

describe('client retries', () => {
  async function stub(replies) {
    let n = 0;
    const server = createServer((req, res) => {
      req.resume();
      const r = replies[Math.min(n++, replies.length - 1)];
      res.writeHead(r.status, { 'Content-Type': 'application/json', ...r.headers });
      res.end(JSON.stringify(r.body ?? {}));
    });
    const port = await listen(server);
    return { config: { baseUrl: `http://127.0.0.1:${port}`, apiKey: KEY }, calls: () => n, stop: () => { server.closeAllConnections(); server.close(); } };
  }

  test('waits and retries on 429 with Retry-After', async () => {
    const s = await stub([{ status: 429, headers: { 'Retry-After': '0' }, body: { err_code: 'TOO_MANY_REQUESTS' } }, { status: 200, body: { ok: 1 } }]);
    assert.deepEqual(await transcribeBytes(Buffer.from('x'), { config: s.config }), { ok: 1 });
    assert.equal(s.calls(), 2);
    s.stop();
  });

  test('does not retry when the hours have run out', async () => {
    const s = await stub([{ status: 429, body: { error: { code: 'insufficient_quota', message: 'used up' } } }]);
    await assert.rejects(transcribeBytes(Buffer.from('x'), { config: s.config }), /no audio hours left/);
    assert.equal(s.calls(), 1);
    s.stop();
  });

  test('gives up after a few tries on 503, and keeps the request id', async () => {
    const s = await stub([{ status: 503, headers: { 'Retry-After': '0', 'x-request-id': 'req7' }, body: { err_code: 'SERVICE_UNAVAILABLE' } }]);
    await assert.rejects(transcribeBytes(Buffer.from('x'), { config: s.config, retry: { tries: 2 } }), (e) => e instanceof SaidwireError && e.requestId === 'req7' && e.status === 503);
    assert.equal(s.calls(), 2);
    s.stop();
  });

  test('errors never carry the key', async () => {
    const s = await stub([{ status: 400, body: { err_code: 'BAD_REQUEST', err_msg: 'bad' } }]);
    await assert.rejects(transcribeBytes(Buffer.from('x'), { config: s.config }), (e) => !JSON.stringify({ ...e, m: e.message }).includes(KEY));
    s.stop();
  });
});
