import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, test } from 'node:test';
import { buildNotes, sentences } from '../notes.js';
import { createApp } from '../server.js';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const KEY = 'sk_live_test.do-not-leak-this-secret';
const say = (text, t0 = 0) => text.split(' ').map((w, i) => ({ word: w.toLowerCase(), punctuated_word: w, start: t0 + i * 0.4, end: t0 + i * 0.4 + 0.3 }));
const shape = (words, duration = 60) => ({ metadata: { duration, request_id: 'r1' }, results: { channels: [{ alternatives: [{ transcript: 'x', words }] }] } });

test('finds decisions, action items and questions, with times', () => {
  const words = [...say('Thanks for coming.'), ...say('We decided to ship on Friday.', 2), ...say('I will send the contract by Monday.', 5), ...say('Who owns the launch post?', 9)];
  const n = buildNotes(shape(words), { title: 'Weekly' });
  assert.equal(n.decisions.length, 1);
  assert.match(n.decisions[0].text, /decided/);
  assert.equal(n.actions.length, 1);
  assert.equal(n.actions[0].start, 5);
  assert.equal(n.questions.length, 1);
  assert.match(n.markdown, /^# Weekly/);
  assert.match(n.markdown, /\[00:00:05\] I will send/);
});

test('says so when nothing was found, and copes with an empty result', () => {
  const n = buildNotes({ metadata: { duration: 3 }, results: { channels: [{ alternatives: [{ transcript: '', words: [] }] }] } });
  assert.match(n.markdown, /None found/);
  assert.deepEqual(n.paragraphs, []);
});

test('text with no final punctuation is kept', () => {
  assert.equal(sentences(say('no full stop here')).length, 1);
});

describe('server rules', () => {
  test('page holds no key; other sites and video are refused; size limit holds', async () => {
    const app = createApp({ config: { baseUrl: 'http://127.0.0.1:9', apiKey: KEY }, maxBytes: 1000 });
    const port = await listen(app);
    const origin = `http://127.0.0.1:${port}`;
    const page = await (await fetch(origin)).text();
    assert.ok(!page.includes(KEY) && !/sk_live|SAIDWIRE_API_KEY/.test(page));
    const post = (headers, body = 'abc') => fetch(`${origin}/api/notes`, { method: 'POST', headers, body });
    assert.equal((await post({ Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post({})).status, 403);
    assert.equal((await post({ Origin: origin, 'Content-Type': 'video/mp4' })).status, 415);
    await post({ Origin: origin }, Buffer.alloc(5000)).then((r) => assert.equal(r.status, 413), () => { /* a closed socket also means refused */ });
    app.closeAllConnections(); app.close();
  });

  test('errors from the API reach the user without the key', async () => {
    const fake = createServer((_q, r) => { r.writeHead(401, { 'Content-Type': 'application/json', 'x-request-id': 'req9' }); r.end('{"err_code":"INVALID_AUTH","err_msg":"nope"}'); });
    const fakePort = await listen(fake);
    const app = createApp({ config: { baseUrl: `http://127.0.0.1:${fakePort}`, apiKey: KEY } });
    const port = await listen(app);
    const res = await fetch(`http://127.0.0.1:${port}/api/notes`, { method: 'POST', headers: { Origin: `http://127.0.0.1:${port}` }, body: 'abc' });
    const text = await res.text();
    assert.equal(res.status, 401);
    assert.match(text, /API key was refused/);
    assert.match(text, /req9/);
    assert.ok(!text.includes(KEY));
    app.closeAllConnections(); app.close(); fake.closeAllConnections(); fake.close();
  });
});
