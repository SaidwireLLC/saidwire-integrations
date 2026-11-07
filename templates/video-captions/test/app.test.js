import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planPieces } from '../lib/audio.js';
import { buildCues, toSrt, toVtt, wrap } from '../lib/captions.js';

const KEY = 'sk_live_test.do-not-leak-this-secret';
const ms = (text) => text.split(' ').map((w, i) => ({ word: w, punctuated_word: w, start: i * 0.3, end: i * 0.3 + 0.25 }));

test('caption lines stay within the size limits', () => {
  const words = ms('This is a fairly long sentence that needs to be split into more than one caption so that people can read it on a small screen without any trouble at all, and then it goes on.');
  const cues = buildCues(words);
  assert.ok(cues.length > 1);
  for (const c of cues) {
    assert.ok(c.lines.length <= 2, c.lines.join('|'));
    assert.ok(c.lines.every((l) => l.length <= 42), c.lines.join('|'));
    assert.ok(c.end - c.start <= 6);
  }
  assert.equal(cues.flatMap((c) => c.lines).join(' '), words.map((w) => w.word).join(' '));
});

test('a long pause starts a new caption', () => {
  const a = ms('Hello there.');
  const b = ms('Much later.').map((w) => ({ ...w, start: w.start + 5, end: w.end + 5 }));
  assert.equal(buildCues([...a, ...b]).length, 2);
});

test('two lines are balanced', () => {
  const [one, two] = wrap('one two three four five six seven eight nine ten eleven twelve', 42);
  assert.ok(Math.abs(one.length - two.length) < 10);
});

test('SRT and WebVTT stamps are right past one hour', () => {
  const cues = [{ start: 3661.5, end: 3662.25, lines: ['Hi'] }];
  assert.match(toSrt(cues), /01:01:01,500 --> 01:01:02,250/);
  assert.match(toVtt(cues), /^WEBVTT\n\n01:01:01\.500 --> 01:01:02\.250/);
});

test('a cut moves back to a quiet moment, and pieces cover the whole file with no gap', () => {
  const pieces = planPieces(7000, 3000, [2990, 5950]);
  assert.deepEqual(pieces.map((p) => Math.round(p.start)), [0, 2990, 5950]);
  assert.ok(pieces.every((p) => p.length <= 3000));
  assert.equal(pieces.reduce((s, p) => s + p.length, 0), 7000);
  assert.equal(planPieces(100, 3000).length, 1);
  assert.deepEqual(planPieces(7000, 3000).map((p) => p.start), [0, 3000, 6000]);
});
