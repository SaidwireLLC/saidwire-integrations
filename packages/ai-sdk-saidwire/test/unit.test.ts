import { APICallError, LoadAPIKeyError, NoSuchModelError } from '@ai-sdk/provider';
import { transcribe } from 'ai';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createSaidwire, VERSION } from '../src';

const VERBOSE = {
  task: 'transcribe',
  language: 'english',
  duration: 12.0,
  text: 'And we know that corruption. Who hand this president power.',
  segments: [
    { id: 0, seek: 0, start: 1.92, end: 8.96, text: ' And we know that corruption.', tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
    { id: 1, seek: 0, start: 9.28, end: 11.6, text: ' Who hand this president power.', tokens: [], temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0 },
  ],
  usage: { type: 'duration', seconds: 12.0 },
};

type Captured = { url: string; headers: Record<string, string>; form: FormData };

function mockFetch(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  const calls: Captured[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((v, k) => (headers[k] = v));
    calls.push({ url: String(url), headers, form: init?.body as FormData });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_test', ...extraHeaders },
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);

describe('provider', () => {
  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(VERSION).toBe(pkg.version);
  });

  it('exposes v4 spec and transcription aliases', () => {
    const sw = createSaidwire({ apiKey: 'k' });
    expect(sw.specificationVersion).toBe('v4');
    const m = sw.transcription('saidwire-en');
    expect(m.specificationVersion).toBe('v4');
    expect(m.provider).toBe('saidwire.transcription');
    expect(m.modelId).toBe('saidwire-en');
    expect(sw('saidwire-en').modelId).toBe('saidwire-en');
    expect(sw.transcriptionModel('x').modelId).toBe('x');
  });

  it('throws NoSuchModelError for other model types', () => {
    const sw = createSaidwire({ apiKey: 'k' });
    expect(() => sw.languageModel('a')).toThrow(NoSuchModelError);
    expect(() => sw.embeddingModel('a')).toThrow(NoSuchModelError);
    expect(() => sw.imageModel('a')).toThrow(NoSuchModelError);
  });
});

describe('doGenerate request', () => {
  it('posts multipart to /audio/transcriptions with Bearer and user agent', async () => {
    const { fetch, calls } = mockFetch(200, VERBOSE);
    const sw = createSaidwire({ apiKey: 'sk_live_test.secret', fetch, headers: { 'x-custom': '1' } });
    await sw.transcription('saidwire-en').doGenerate({ audio, mediaType: 'audio/wav' });
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.url).toBe('https://api.saidwire.com/v1/audio/transcriptions');
    expect(c.headers.authorization).toBe('Bearer sk_live_test.secret');
    expect(c.headers['x-custom']).toBe('1');
    expect(c.headers['user-agent']).toContain(`ai-sdk/saidwire/${VERSION}`);
    expect(c.form.get('model')).toBe('saidwire-en');
    expect(c.form.get('response_format')).toBe('verbose_json');
    expect(c.form.getAll('timestamp_granularities[]')).toEqual(['segment']);
    expect(c.form.get('language')).toBeNull();
    const file = c.form.get('file') as File;
    expect(file.name).toBe('audio.wav');
    expect(file.type).toBe('audio/wav');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio);
  });

  it('honours baseURL (trailing slash stripped), language and word granularity', async () => {
    const { fetch, calls } = mockFetch(200, VERBOSE);
    const sw = createSaidwire({ apiKey: 'k', fetch, baseURL: 'https://us-east.api.saidwire.com/v1/' });
    await sw.transcription('saidwire-en').doGenerate({
      audio,
      mediaType: 'audio/mpeg',
      providerOptions: { saidwire: { language: 'en-US', timestampGranularities: ['word', 'segment'] } },
    });
    const c = calls[0];
    expect(c.url).toBe('https://us-east.api.saidwire.com/v1/audio/transcriptions');
    expect(c.form.get('language')).toBe('en-US');
    expect(c.form.getAll('timestamp_granularities[]')).toEqual(['word', 'segment']);
    expect((c.form.get('file') as File).name).toBe('audio.mp3');
  });

  it('accepts base64 audio', async () => {
    const { fetch, calls } = mockFetch(200, VERBOSE);
    const sw = createSaidwire({ apiKey: 'k', fetch });
    await sw.transcription('saidwire-en').doGenerate({
      audio: Buffer.from(audio).toString('base64'),
      mediaType: 'audio/wav',
    });
    const file = calls[0].form.get('file') as File;
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio);
  });

  it('rejects invalid provider options', async () => {
    const { fetch } = mockFetch(200, VERBOSE);
    const sw = createSaidwire({ apiKey: 'k', fetch });
    await expect(
      sw.transcription('saidwire-en').doGenerate({
        audio,
        mediaType: 'audio/wav',
        providerOptions: { saidwire: { timestampGranularities: ['char'] } as never },
      }),
    ).rejects.toThrow();
  });

  it('reads SAIDWIRE_API_KEY and errors clearly when missing', async () => {
    const { fetch, calls } = mockFetch(200, VERBOSE);
    vi.stubEnv('SAIDWIRE_API_KEY', 'sk_live_env.secret');
    await createSaidwire({ fetch }).transcription('saidwire-en').doGenerate({ audio, mediaType: 'audio/wav' });
    expect(calls[0].headers.authorization).toBe('Bearer sk_live_env.secret');
    vi.stubEnv('SAIDWIRE_API_KEY', undefined as unknown as string);
    await expect(
      createSaidwire({ fetch }).transcription('saidwire-en').doGenerate({ audio, mediaType: 'audio/wav' }),
    ).rejects.toThrow(LoadAPIKeyError);
    vi.unstubAllEnvs();
  });
});

describe('doGenerate response', () => {
  it('maps verbose_json', async () => {
    const { fetch } = mockFetch(200, VERBOSE);
    const r = await createSaidwire({ apiKey: 'k', fetch, })
      .transcription('saidwire-en')
      .doGenerate({ audio, mediaType: 'audio/wav' });
    expect(r.text).toBe(VERBOSE.text);
    expect(r.segments).toEqual([
      { text: 'And we know that corruption.', startSecond: 1.92, endSecond: 8.96 },
      { text: 'Who hand this president power.', startSecond: 9.28, endSecond: 11.6 },
    ]);
    expect(r.language).toBe('en');
    expect(r.durationInSeconds).toBe(12);
    expect(r.usage).toEqual({ type: 'duration', seconds: 12 });
    expect(r.warnings).toEqual([]);
    expect(r.providerMetadata).toBeUndefined();
    expect(r.response.modelId).toBe('saidwire-en');
    expect(r.response.headers?.['x-request-id']).toBe('req_test');
  });

  it('returns words in providerMetadata and falls back to usage for duration', async () => {
    const words = [
      { word: 'And', start: 1.92, end: 2.1 },
      { word: 'we', start: 2.1, end: 2.3 },
    ];
    const { fetch } = mockFetch(200, { text: 'And we', language: 'en', words, usage: { type: 'duration', seconds: 3.5 } });
    const r = await createSaidwire({ apiKey: 'k', fetch })
      .transcription('saidwire-en')
      .doGenerate({ audio, mediaType: 'audio/wav', providerOptions: { saidwire: { timestampGranularities: ['word'] } } });
    expect(r.segments).toEqual([
      { text: 'And', startSecond: 1.92, endSecond: 2.1 },
      { text: 'we', startSecond: 2.1, endSecond: 2.3 },
    ]);
    expect(r.providerMetadata).toEqual({ saidwire: { words } });
    expect(r.language).toBe('en');
    expect(r.durationInSeconds).toBe(3.5);
  });

  it('works through transcribe() from ai', async () => {
    const { fetch } = mockFetch(200, VERBOSE);
    const r = await transcribe({ model: createSaidwire({ apiKey: 'k', fetch }).transcription('saidwire-en'), audio });
    expect(r.text).toBe(VERBOSE.text);
    expect(r.segments).toHaveLength(2);
    expect(r.durationInSeconds).toBe(12);
    expect(r.language).toBe('en');
  });
});

describe('errors', () => {
  const err = (message: string, code: string, param: string | null = null) => ({
    error: { message, type: 'invalid_request_error', param, code },
  });

  it('401 -> APICallError, not retryable', async () => {
    const { fetch } = mockFetch(401, err('Incorrect API key provided.', 'invalid_api_key'));
    const p = createSaidwire({ apiKey: 'bad', fetch }).transcription('saidwire-en').doGenerate({ audio, mediaType: 'audio/wav' });
    await expect(p).rejects.toSatisfy((e: unknown) =>
      APICallError.isInstance(e) && e.statusCode === 401 && e.message === 'Incorrect API key provided.' && !e.isRetryable,
    );
  });

  it('400 unsupported language', async () => {
    const { fetch } = mockFetch(400, err('Unsupported language: fr. Saidwire transcribes English.', 'unsupported_language', 'language'));
    const p = createSaidwire({ apiKey: 'k', fetch })
      .transcription('saidwire-en')
      .doGenerate({ audio, mediaType: 'audio/wav', providerOptions: { saidwire: { language: 'fr' } } });
    await expect(p).rejects.toSatisfy((e: unknown) => APICallError.isInstance(e) && e.statusCode === 400 && !e.isRetryable);
  });

  it('429 busy is retryable, 429 quota is not', async () => {
    const busy = mockFetch(429, err('Too many concurrent requests.', 'rate_limit_exceeded'), { 'retry-after': '1' });
    await expect(
      createSaidwire({ apiKey: 'k', fetch: busy.fetch }).transcription('saidwire-en').doGenerate({ audio, mediaType: 'audio/wav' }),
    ).rejects.toSatisfy((e: unknown) => APICallError.isInstance(e) && e.statusCode === 429 && e.isRetryable);

    const quota = mockFetch(429, err('You exceeded your current quota.', 'insufficient_quota'), { 'x-should-retry': 'false' });
    await expect(
      createSaidwire({ apiKey: 'k', fetch: quota.fetch }).transcription('saidwire-en').doGenerate({ audio, mediaType: 'audio/wav' }),
    ).rejects.toSatisfy((e: unknown) => APICallError.isInstance(e) && e.statusCode === 429 && !e.isRetryable);
  });
});
