// Live call against api.saidwire.com. Runs only with SAIDWIRE_LIVE=1 and SAIDWIRE_API_KEY set.
//   SAIDWIRE_API_KEY=sk_live_... npm run test:live
// SAIDWIRE_TEST_AUDIO=/path/to/english.wav  (default ./test/fixtures/sample.wav, not shipped)
// SAIDWIRE_EXPECT_TEXT="a phrase"           (optional: must appear in the transcript)
// SAIDWIRE_EXPECT_SECONDS=12                (optional: expected clip length, +/- 1 s)
import { transcribe } from 'ai';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSaidwire } from '../src';

const live = process.env.SAIDWIRE_LIVE === '1' && !!process.env.SAIDWIRE_API_KEY;
const audioPath = process.env.SAIDWIRE_TEST_AUDIO ?? new URL('./fixtures/sample.wav', import.meta.url).pathname;

describe.runIf(live && existsSync(audioPath))('live: api.saidwire.com', () => {
  it('transcribes a 12 s English clip', { timeout: 60_000 }, async () => {
    const saidwire = createSaidwire();
    const t0 = Date.now();
    const result = await transcribe({
      model: saidwire.transcription('saidwire-en'),
      audio: readFileSync(audioPath),
      providerOptions: { saidwire: { timestampGranularities: ['word', 'segment'] } },
    });
    const ms = Date.now() - t0;
    console.log(`live transcribe: ${ms} ms, ${result.segments.length} segments, ${result.durationInSeconds} s`);
    console.log(`text: ${result.text}`);
    if (process.env.SAIDWIRE_EXPECT_TEXT) expect(result.text).toContain(process.env.SAIDWIRE_EXPECT_TEXT);
    if (process.env.SAIDWIRE_EXPECT_SECONDS) {
      expect(Math.abs((result.durationInSeconds ?? 0) - Number(process.env.SAIDWIRE_EXPECT_SECONDS))).toBeLessThan(1);
    }
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.language).toBe('en');
    const words = (result.providerMetadata?.saidwire as { words?: unknown[] } | undefined)?.words;
    expect(Array.isArray(words) && words.length > 0).toBe(true);
  });
});
